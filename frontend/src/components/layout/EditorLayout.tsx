import { FolderOpen, Layers, SlidersHorizontal } from 'lucide-react';
import { Panel, PanelGroup, PanelResizeHandle } from 'react-resizable-panels';
import { useEffect, useRef, useState } from 'react';
import { useOperationSync } from '../../collaboration/useOperationSync';
import { MOBILE_QUERY, useMediaQuery } from '../../hooks/useMediaQuery';
import { useUIStore } from '../../state/uiStore';
import { cn } from '../../utils/cn';
import { getAsset } from '../../services/assets';
import { resolveUrl } from '../../services/config';
import { useProjectStore } from '../../state/projectStore';
import { AssetBrowser } from '../assets/AssetBrowser';
import { InspectorPanel } from '../inspector/InspectorPanel';
import { VideoPlayer } from '../player/VideoPlayer';
import { Timeline } from '../timeline/Timeline';
import { TopBar } from '../topbar/TopBar';

function captureThumbnail(videoUrl: string): Promise<string | null> {
  return new Promise((resolve) => {
    const video = document.createElement('video');
    video.crossOrigin = 'anonymous';
    video.preload = 'metadata';
    video.muted = true;
    video.onloadedmetadata = () => { video.currentTime = Math.min(1, video.duration * 0.1); };
    video.onseeked = () => {
      try {
        const W = 320, H = 180;
        const canvas = document.createElement('canvas');
        canvas.width = W; canvas.height = H;
        const ctx = canvas.getContext('2d');
        if (!ctx) { resolve(null); return; }
        // Center-crop (object-fit: cover) — no distortion
        const vw = video.videoWidth || W;
        const vh = video.videoHeight || H;
        const scale = Math.max(W / vw, H / vh);
        const sw = W / scale, sh = H / scale;
        const sx = (vw - sw) / 2, sy = (vh - sh) / 2;
        ctx.drawImage(video, sx, sy, sw, sh, 0, 0, W, H);
        resolve(canvas.toDataURL('image/jpeg', 0.6));
      } catch { resolve(null); }
      video.removeAttribute('src');
      video.load();
    };
    video.onerror = () => resolve(null);
    video.src = videoUrl;
  });
}

interface Props {
  onBack?(): void;
}

type MobileTab = 'timeline' | 'assets' | 'inspector';

const MOBILE_TABS: { id: MobileTab; label: string; icon: typeof Layers }[] = [
  { id: 'timeline', label: 'Timeline', icon: Layers },
  { id: 'assets', label: 'Assets', icon: FolderOpen },
  { id: 'inspector', label: 'Inspector', icon: SlidersHorizontal },
];

const HANDLE = 'bg-border transition-colors hover:bg-border-strong data-[resize-handle-state=drag]:bg-accent';

export function EditorLayout({ onBack }: Props) {
  const projectId = useProjectStore((state) => state.project?.id ?? null);
  const firstClipAssetId = useProjectStore((state) => state.clips[0]?.asset_id ?? null);
  const syncableId = projectId === 'project-seed' ? null : projectId;

  useOperationSync(syncableId);

  const isMobile = useMediaQuery(MOBILE_QUERY);
  const [mobileTab, setMobileTab] = useState<MobileTab>('timeline');
  // On a phone, picking an asset means "place it": jump to the timeline so the
  // user can tap a track. Selecting a clip in the preview opens its settings.
  const pendingAssetId = useUIStore((s) => s.pendingAsset?.id ?? null);
  const selectedClipId = useUIStore((s) => s.selectedClipIds[0] ?? null);
  useEffect(() => {
    if (isMobile && pendingAssetId) setMobileTab('timeline');
  }, [isMobile, pendingAssetId]);
  const prevSelected = useRef(selectedClipId);
  useEffect(() => {
    if (isMobile && selectedClipId && selectedClipId !== prevSelected.current && mobileTab === 'assets') setMobileTab('inspector');
    prevSelected.current = selectedClipId;
  }, [isMobile, selectedClipId, mobileTab]);

  // The editor is an app screen, not a document: it fills the window exactly and the
  // page itself never scrolls (each panel scrolls on its own). Without this, a drag
  // ghost or a focused control near an edge could make the browser scroll the whole
  // layout sideways, hiding the left edge.
  useEffect(() => {
    const html = document.documentElement;
    const previous = { html: html.style.overflow, body: document.body.style.overflow };
    html.style.overflow = 'hidden';
    document.body.style.overflow = 'hidden';
    window.scrollTo(0, 0);
    return () => {
      html.style.overflow = previous.html;
      document.body.style.overflow = previous.body;
    };
  }, []);

  // Capture a project thumbnail from the first clip — once per source asset, not on every open
  useEffect(() => {
    if (!projectId || !firstClipAssetId) return;
    const key = `thumbnail_project_${projectId}`;
    const sourceKey = `${key}_asset`;
    if (localStorage.getItem(key) && localStorage.getItem(sourceKey) === firstClipAssetId) return;

    let cancelled = false;
    getAsset(firstClipAssetId, projectId)
      .then(async (asset) => {
        let thumb: string | null = null;
        if (asset.type === 'image') thumb = resolveUrl(asset.original_url);
        else if (asset.type === 'video') thumb = await captureThumbnail(resolveUrl(asset.original_url));
        if (!thumb || cancelled) return;
        try {
          localStorage.setItem(key, thumb);
          localStorage.setItem(sourceKey, firstClipAssetId);
        } catch { /* storage full — thumbnails are optional */ }
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [projectId, firstClipAssetId]);

  if (isMobile) {
    // Phone layout: preview stays on top, one panel at a time below it
    return (
      <div className="fixed inset-0 flex flex-col overflow-clip bg-canvas">
        <TopBar onBack={onBack} />
        <div className="h-[36dvh] min-h-[200px] shrink-0 border-b border-border">
          <VideoPlayer />
        </div>
        <div role="tablist" aria-label="Editor panels" className="flex h-11 shrink-0 border-b border-border bg-panel px-1">
          {MOBILE_TABS.map(({ id, label, icon: Icon }) => {
            const selected = mobileTab === id;
            return (
              <button
                key={id}
                type="button"
                role="tab"
                id={`tab-${id}`}
                aria-selected={selected}
                aria-controls="mobile-panel"
                className={cn(
                  'relative flex flex-1 items-center justify-center gap-1.5 text-xs font-semibold transition-colors',
                  'after:absolute after:inset-x-3 after:bottom-0 after:h-0.5 after:rounded-full after:bg-accent after:transition-opacity',
                  selected ? 'text-accent after:opacity-100' : 'text-fg-muted after:opacity-0 hover:text-fg',
                )}
                onClick={() => setMobileTab(id)}
              >
                <Icon aria-hidden className="h-4 w-4" />
                {label}
              </button>
            );
          })}
        </div>
        <div id="mobile-panel" role="tabpanel" aria-labelledby={`tab-${mobileTab}`} className="min-h-0 flex-1">
          {mobileTab === 'timeline' && <Timeline />}
          {mobileTab === 'assets' && <AssetBrowser />}
          {mobileTab === 'inspector' && <InspectorPanel />}
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 flex flex-col overflow-clip bg-canvas">
      <TopBar onBack={onBack} />
      <PanelGroup direction="vertical" className="min-h-0 flex-1">
        <Panel minSize={40}>
          <PanelGroup direction="horizontal">
            <Panel defaultSize={20} minSize={14}><AssetBrowser /></Panel>
            <PanelResizeHandle className={`w-px ${HANDLE}`} />
            <Panel defaultSize={55} minSize={35}><VideoPlayer /></Panel>
            <PanelResizeHandle className={`w-px ${HANDLE}`} />
            <Panel defaultSize={25} minSize={18}><InspectorPanel /></Panel>
          </PanelGroup>
        </Panel>
        <PanelResizeHandle className={`h-px ${HANDLE}`} />
        <Panel defaultSize={40} minSize={24}><Timeline /></Panel>
      </PanelGroup>
    </div>
  );
}
