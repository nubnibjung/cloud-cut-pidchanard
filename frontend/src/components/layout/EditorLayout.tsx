import { Panel, PanelGroup, PanelResizeHandle } from 'react-resizable-panels';
import { useEffect } from 'react';
import { useOperationSync } from '../../collaboration/useOperationSync';
import { useProjectStore } from '../../state/projectStore';
import { AssetBrowser } from '../assets/AssetBrowser';
import { InspectorPanel } from '../inspector/InspectorPanel';
import { VideoPlayer } from '../player/VideoPlayer';
import { Timeline } from '../timeline/Timeline';
import { TopBar } from '../topbar/TopBar';
import { api } from '../../services/api';
import type { Asset } from '../../types';

const API_BASE = import.meta.env.VITE_API_BASE ?? 'http://localhost:8080';
function resolveUrl(url: string) {
  return url.startsWith('http') ? url : `${API_BASE}/${url.replace(/^\//, '')}`;
}

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
    };
    video.onerror = () => resolve(null);
    video.src = videoUrl;
  });
}

interface Props {
  onBack?(): void;
}

export function EditorLayout({ onBack }: Props) {
  const projectId = useProjectStore((state) => state.project?.id ?? null);
  const clips = useProjectStore((state) => state.clips);
  const syncableId = projectId === 'project-seed' ? null : projectId;

  useOperationSync(syncableId);

  // Generate thumbnail from the first video clip and save to localStorage
  useEffect(() => {
    if (!projectId || clips.length === 0) return;
    const key = `thumbnail_project_${projectId}`;
    const firstVideoClip = clips[0];
    if (!firstVideoClip) return;

    api<Asset>(`/assets/${firstVideoClip.asset_id}`)
      .then(async (asset) => {
        if (asset.type === 'image') {
          // Use image URL directly as thumbnail
          localStorage.setItem(key, resolveUrl(asset.original_url));
          return;
        }
        if (asset.type !== 'video') return;
        const thumb = await captureThumbnail(resolveUrl(asset.original_url));
        if (thumb) localStorage.setItem(key, thumb);
      })
      .catch(() => {});
  }, [projectId, clips.length > 0]);

  return (
    <div className="flex h-full flex-col bg-[#111318]">
      <TopBar onBack={onBack} />
      <PanelGroup direction="vertical" className="min-h-0 flex-1">
        <Panel minSize={40}>
          <PanelGroup direction="horizontal">
            <Panel defaultSize={20} minSize={14}><AssetBrowser /></Panel>
            <PanelResizeHandle className="w-1 bg-border" />
            <Panel defaultSize={55} minSize={35}><VideoPlayer /></Panel>
            <PanelResizeHandle className="w-1 bg-border" />
            <Panel defaultSize={25} minSize={18}><InspectorPanel /></Panel>
          </PanelGroup>
        </Panel>
        <PanelResizeHandle className="h-1 bg-border" />
        <Panel defaultSize={40} minSize={24}><Timeline /></Panel>
      </PanelGroup>
    </div>
  );
}
