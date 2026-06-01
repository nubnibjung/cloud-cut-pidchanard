import { Film, Music, Image, Loader2, Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { api } from '../../services/api';
import { useProjectStore } from '../../state/projectStore';
import { usePlaybackStore } from '../../state/playbackStore';
import { useUIStore } from '../../state/uiStore';
import type { Asset, AssetType } from '../../types';
import { formatTimecode } from '../../utils/timecode';
import { AssetUpload } from './AssetUpload';

const API_BASE = import.meta.env.VITE_API_BASE ?? 'http://localhost:8080';
function resolveAssetUrl(url: string) {
  return url.startsWith('http') ? url : `${API_BASE}/${url.replace(/^\//, '')}`;
}

function probeUrlDurationMs(url: string, type: 'video' | 'audio'): Promise<number> {
  return new Promise((resolve) => {
    const el = type === 'audio' ? document.createElement('audio') : document.createElement('video');
    el.preload = 'metadata';
    el.onloadedmetadata = () => { el.src = ''; resolve(isFinite(el.duration) && el.duration > 0 ? Math.round(el.duration * 1000) : 5000); };
    el.onerror = () => { el.src = ''; resolve(5000); };
    el.src = url;
  });
}

const TYPE_ICON: Record<string, React.ReactNode> = {
  video: <Film className="h-4 w-4 shrink-0 text-blue-400" />,
  audio: <Music className="h-4 w-4 shrink-0 text-green-400" />,
  image: <Image className="h-4 w-4 shrink-0 text-purple-400" />,
};

const STATUS_COLOR: Record<string, string> = {
  ready: 'bg-green-900/40 text-green-400',
  processing: 'bg-yellow-900/40 text-yellow-400',
  uploading: 'bg-blue-900/40 text-blue-400',
  failed: 'bg-red-900/40 text-red-400',
};

export function AssetBrowser() {
  const project = useProjectStore((state) => state.project);
  const addClip = useProjectStore((state) => state.addClip);
  const tracks = useProjectStore((state) => state.tracks);
  const zoomLevel = useUIStore((state) => state.zoomLevel);
  const pendingAsset = useUIStore((state) => state.pendingAsset);
  const setPendingAsset = useUIStore((state) => state.setPendingAsset);
  const [assets, setAssets] = useState<Asset[]>([]);
  const [filter, setFilter] = useState<AssetType | 'all'>('all');
  const [loading, setLoading] = useState(false);

  const autoAddReadyAssets = async (loadedAssets: Asset[]) => {
    const { clips: existingClips, tracks: currentTracks } = useProjectStore.getState();
    const existingAssetIds = new Set(existingClips.map((c) => c.asset_id));

    const trackEndMs: Record<string, number> = {};
    for (const clip of existingClips) {
      const end = clip.track_position_ms + clip.duration_ms;
      trackEndMs[clip.track_id] = Math.max(trackEndMs[clip.track_id] ?? 0, end);
    }

    for (const asset of loadedAssets) {
      if (asset.status === 'failed') continue;
      if (existingAssetIds.has(asset.id)) continue;

      const trackType = asset.type === 'audio' ? 'audio' : 'video';
      const targetTrack = currentTracks.find((t) => t.type === trackType);
      if (!targetTrack) continue;

      // Probe real duration from browser — don't rely on metadata default 5s
      let durationMs = asset.metadata?.duration_ms ?? 0;
      if (!durationMs && asset.type !== 'image') {
        durationMs = await probeUrlDurationMs(resolveAssetUrl(asset.original_url), asset.type as 'video' | 'audio');
      }
      if (!durationMs) durationMs = 5000;

      const startMs = trackEndMs[targetTrack.id] ?? 0;

      addClip({
        track_id: targetTrack.id,
        asset_id: asset.id,
        name: asset.original_url.split('/').pop() ?? 'Clip',
        track_position_ms: startMs,
        in_point_ms: 0,
        out_point_ms: durationMs,
      });

      trackEndMs[targetTrack.id] = startMs + durationMs;
    }
  };

  const load = () => {
    if (!project || project.id === 'project-seed') return;
    setLoading(true);
    api<Asset[]>(`/assets?projectId=${project.id}`)
      .then((loadedAssets) => {
        setAssets(loadedAssets);
        autoAddReadyAssets(loadedAssets);
      })
      .catch(console.error)
      .finally(() => setLoading(false));
  };

  useEffect(() => { load(); }, [project?.id]);

  const onAssetPointerDown = (e: React.PointerEvent<HTMLDivElement>, asset: Asset) => {
    if (e.button !== 0) return;
    if ((e.target as HTMLElement).closest('button')) return;

    const card = e.currentTarget;
    // setPointerCapture guarantees pointermove/pointerup reach us even when
    // the cursor leaves this element and moves into the timeline panel.
    card.setPointerCapture(e.pointerId);

    const zoom = zoomLevel;
    const startX = e.clientX;
    const startY = e.clientY;
    let dragging = false;
    let ghost: HTMLDivElement | null = null;

    const findTrack = (x: number, y: number): HTMLElement | null => {
      // Primary: topmost element → walk up to [data-track-id]
      const hit = document.elementFromPoint(x, y) as HTMLElement | null;
      const direct = hit?.closest<HTMLElement>('[data-track-id]') ?? null;
      if (direct) return direct;
      // Fallback: cursor may be over the sticky 120px header — match by Y band
      for (const el of Array.from(document.querySelectorAll<HTMLElement>('[data-track-id]'))) {
        const r = el.getBoundingClientRect();
        if (y >= r.top && y <= r.bottom) return el;
      }
      return null;
    };

    const onMove = (ev: PointerEvent) => {
      if (!dragging) {
        if (Math.hypot(ev.clientX - startX, ev.clientY - startY) < 6) return;
        dragging = true;
        document.body.style.cursor = 'grabbing';
        document.body.style.userSelect = 'none';
        ghost = document.createElement('div');
        ghost.textContent = asset.original_url.split('/').pop() ?? 'Clip';
        ghost.style.cssText =
          'position:fixed;z-index:9999;pointer-events:none;padding:4px 10px;' +
          'border-radius:4px;border:1px solid rgba(52,211,153,.6);' +
          'background:#1e2330;font-size:12px;color:#fff;white-space:nowrap';
        document.body.appendChild(ghost);
      }
      if (ghost) {
        ghost.style.left = `${ev.clientX + 12}px`;
        ghost.style.top = `${ev.clientY + 12}px`;
      }
    };

    const onUp = (ev: PointerEvent) => {
      card.removeEventListener('pointermove', onMove);
      card.removeEventListener('pointerup', onUp);
      card.removeEventListener('pointercancel', onUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      ghost?.remove();
      ghost = null;
      if (!dragging) return;

      const trackEl = findTrack(ev.clientX, ev.clientY);
      if (!trackEl) return;
      const targetTrack = tracks.find((t) => t.id === trackEl.dataset.trackId);
      if (!targetTrack) return;
      if (targetTrack.type !== (asset.type === 'audio' ? 'audio' : 'video')) return;

      const rect = trackEl.getBoundingClientRect();
      addClip({
        track_id: targetTrack.id,
        asset_id: asset.id,
        name: asset.original_url.split('/').pop() ?? 'Clip',
        track_position_ms: Math.max(0, Math.round(((ev.clientX - rect.left) / zoom) * 1000)),
        in_point_ms: 0,
        out_point_ms: asset.metadata?.duration_ms ?? 5000,
      });
    };

    card.addEventListener('pointermove', onMove);
    card.addEventListener('pointerup', onUp);
    card.addEventListener('pointercancel', onUp);
  };

  const handleDropOnTrack = (asset: Asset) => {
    const trackType = asset.type === 'audio' ? 'audio' : 'video';
    const targetTrack = tracks.find((t) => t.type === trackType);
    if (!targetTrack) return;
    const durationMs = asset.metadata?.duration_ms ?? 5000;
    const currentTimeMs = usePlaybackStore.getState().currentTimeMs;
    addClip({
      track_id: targetTrack.id,
      asset_id: asset.id,
      name: asset.original_url.split('/').pop() ?? 'Clip',
      track_position_ms: currentTimeMs,
      in_point_ms: 0,
      out_point_ms: durationMs,
    });
  };

  const deleteAsset = async (assetId: string) => {
    if (!project) return;
    setAssets((prev) => prev.filter((a) => a.id !== assetId));
    api(`/assets/${assetId}`, { method: 'DELETE' }).catch((err) => {
      console.error('Failed to delete asset:', err);
      load();
    });
  };

  const visible = assets.filter((a) => filter === 'all' || a.type === filter);

  return (
    <aside className="flex h-full flex-col border-r border-border bg-[#171b23]">
      <div className="flex h-11 items-center justify-between border-b border-border px-3">
        <span className="text-sm font-semibold">Assets</span>
        {loading && <Loader2 className="h-3.5 w-3.5 animate-spin text-slate-400" />}
      </div>

      <div className="flex gap-1 border-b border-border p-2">
        {(['all', 'video', 'audio', 'image'] as const).map((t) => (
          <button
            key={t}
            className={`rounded px-2 py-1 text-xs capitalize ${filter === t ? 'bg-accent text-black' : 'bg-[#1e2330] text-slate-300 hover:bg-[#252b3b]'}`}
            onClick={() => setFilter(t)}
          >{t}</button>
        ))}
      </div>

      <AssetUpload
        projectId={project?.id ?? null}
        typeFilter={filter}
        onUploaded={(a) => {
          setAssets((prev) => [a, ...prev]);
          const trackType = a.type === 'audio' ? 'audio' : 'video';
          const targetTrack = tracks.find((t) => t.type === trackType);
          if (targetTrack) {
            const durationMs = a.metadata?.duration_ms ?? 5000;
            const currentTimeMs = usePlaybackStore.getState().currentTimeMs;
            addClip({
              track_id: targetTrack.id,
              asset_id: a.id,
              name: a.original_url.split('/').pop() ?? 'Clip',
              track_position_ms: currentTimeMs,
              in_point_ms: 0,
              out_point_ms: durationMs,
            });
          }
        }}
      />

      <div className="flex flex-col gap-2 overflow-auto p-2">
        {pendingAsset && (
          <div className="rounded border border-accent/50 bg-accent/10 px-2 py-1.5 text-xs text-accent">
            Click a compatible timeline track to place this asset.
          </div>
        )}
        {visible.length === 0 && !loading && (
          <p className="py-6 text-center text-xs text-slate-500">No assets yet.<br />Upload a file above.</p>
        )}
        {visible.map((asset) => (
          <div
            key={asset.id}
            className={[
              'group relative cursor-grab rounded border bg-[#1e2330] p-2 hover:border-accent/40 active:cursor-grabbing',
              pendingAsset?.id === asset.id ? 'border-accent ring-1 ring-accent/50' : 'border-border',
            ].join(' ')}
            draggable={false}
            onDragStart={(e) => e.preventDefault()}
            onPointerDown={(e) => onAssetPointerDown(e, asset)}
            onClick={() => setPendingAsset(pendingAsset?.id === asset.id ? null : asset)}
            onDoubleClick={() => handleDropOnTrack(asset)}
            title="Drag to a track. Click to select then click a track. Double-click to add at playhead."
          >
            <div className="mb-1.5 flex items-center gap-2">
              {TYPE_ICON[asset.type] ?? TYPE_ICON.video}
              <span className="min-w-0 flex-1 truncate text-xs font-medium">
                {asset.original_url.split('/').pop()}
              </span>
            </div>
            <div className="flex items-center justify-between gap-2">
              <span className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${STATUS_COLOR[asset.status] ?? 'bg-surface text-slate-400'}`}>
                {asset.status}
              </span>
              {asset.metadata?.duration_ms && (
                <span className="text-[10px] text-slate-500 tabular-nums">
                  {formatTimecode(asset.metadata.duration_ms)}
                </span>
              )}
            </div>
            <button
              className="absolute right-1.5 top-1.5 flex h-5 w-5 items-center justify-center rounded bg-red-600/80 opacity-0 transition-opacity group-hover:opacity-100 hover:bg-red-500"
              title="Delete asset"
              onClick={(e) => { e.stopPropagation(); deleteAsset(asset.id); }}
              onPointerDown={(e) => e.stopPropagation()}
            >
              <Trash2 className="h-3 w-3 text-white" />
            </button>
          </div>
        ))}
      </div>
    </aside>
  );
}
