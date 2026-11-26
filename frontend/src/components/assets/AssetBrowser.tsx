import { Film, FolderOpen, Image, Music, Trash2 } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { api } from '../../services/api';
import { forgetAsset, loadProjectAssets, rememberAsset } from '../../services/assets';
import { assetName, resolveUrl } from '../../services/config';
import { useProjectStore } from '../../state/projectStore';
import { usePlaybackStore } from '../../state/playbackStore';
import { toast } from '../../state/toastStore';
import { useUIStore } from '../../state/uiStore';
import type { Asset, AssetType } from '../../types';
import { cn } from '../../utils/cn';
import { IconButton } from '../ui/Button';
import { EmptyState, Spinner } from '../ui/Feedback';
import { ShimmeringText } from '../ui/ShimmeringText';
import { AssetUpload } from './AssetUpload';

function probeUrlDurationMs(url: string, type: 'video' | 'audio'): Promise<number> {
  return new Promise((resolve) => {
    const el = type === 'audio' ? document.createElement('audio') : document.createElement('video');
    el.preload = 'metadata';
    el.onloadedmetadata = () => { el.src = ''; resolve(isFinite(el.duration) && el.duration > 0 ? Math.round(el.duration * 1000) : 5000); };
    el.onerror = () => { el.src = ''; resolve(5000); };
    el.src = url;
  });
}

const TYPE_STYLE: Record<AssetType, { icon: typeof Film; tile: string; label: string }> = {
  video: { icon: Film, tile: 'bg-sky-400/10 text-sky-400', label: 'Video' },
  audio: { icon: Music, tile: 'bg-success/10 text-success', label: 'Audio' },
  image: { icon: Image, tile: 'bg-violet-400/10 text-violet-400', label: 'Image' },
};

/** Compact length for list rows: 0:12, 1:05, 1:02:30. */
function formatDuration(ms: number): string {
  const total = Math.round(ms / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = (total % 60).toString().padStart(2, '0');
  return h > 0 ? `${h}:${m.toString().padStart(2, '0')}:${s}` : `${m}:${s}`;
}

/** Square preview: the picture itself for images, a tinted type icon otherwise. */
function AssetTile({ asset }: { asset: Asset }) {
  const [broken, setBroken] = useState(false);
  const style = TYPE_STYLE[asset.type] ?? TYPE_STYLE.video;
  const Icon = style.icon;
  if (asset.type === 'image' && asset.status === 'ready' && !broken) {
    return (
      <img
        src={resolveUrl(asset.original_url)}
        alt=""
        width={40}
        height={40}
        loading="lazy"
        decoding="async"
        draggable={false}
        className="h-10 w-10 shrink-0 rounded-lg bg-canvas object-cover"
        onError={() => setBroken(true)}
      />
    );
  }
  return (
    <div className={cn('flex h-10 w-10 shrink-0 items-center justify-center rounded-lg', style.tile)}>
      <Icon aria-hidden className="h-[18px] w-[18px]" />
    </div>
  );
}

const UNDO_WINDOW_MS = 5000;

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
  // Assets removed from the list but not yet deleted on the server (still undoable)
  const pendingDeletes = useRef(new Map<string, number>());

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
        durationMs = await probeUrlDurationMs(resolveUrl(asset.original_url), asset.type as 'video' | 'audio');
      }
      if (!durationMs) durationMs = 5000;

      const startMs = trackEndMs[targetTrack.id] ?? 0;

      addClip({
        track_id: targetTrack.id,
        asset_id: asset.id,
        name: assetName(asset),
        track_position_ms: startMs,
        in_point_ms: 0,
        out_point_ms: durationMs,
      });

      trackEndMs[targetTrack.id] = startMs + durationMs;
    }
  };

  const load = (force = false) => {
    if (!project || project.id === 'project-seed') return;
    setLoading(true);
    // Shared with the player and thumbnail code, so the list is fetched once per project
    loadProjectAssets(project.id, force)
      .then((loadedAssets) => {
        const listed = loadedAssets.filter((a) => !pendingDeletes.current.has(a.id));
        setAssets(listed);
        autoAddReadyAssets(listed);
      })
      .catch(toast.fromError('Could not load assets'))
      .finally(() => setLoading(false));
  };

  useEffect(() => { load(true); }, [project?.id]);

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
        ghost.textContent = assetName(asset);
        ghost.style.cssText =
          'position:fixed;z-index:9999;pointer-events:none;padding:4px 10px;' +
          'border-radius:6px;border:1px solid rgba(45,212,191,.6);' +
          'background:rgb(var(--c-raised));font-size:12px;color:rgb(var(--c-fg));white-space:nowrap;' +
          'box-shadow:0 12px 32px -8px rgba(0,0,0,.6)';
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
        name: assetName(asset),
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
      name: assetName(asset),
      track_position_ms: currentTimeMs,
      in_point_ms: 0,
      out_point_ms: durationMs,
    });
  };

  // The server delete waits a few seconds so the toast can offer Undo
  const deleteAsset = (asset: Asset) => {
    if (!project) return;
    setAssets((prev) => prev.filter((a) => a.id !== asset.id));
    if (pendingAsset?.id === asset.id) setPendingAsset(null);

    const timer = window.setTimeout(() => {
      pendingDeletes.current.delete(asset.id);
      forgetAsset(asset.id);
      api(`/assets/${asset.id}`, { method: 'DELETE' }).catch((err) => {
        toast.fromError('Could not delete the asset')(err);
        load(true);
      });
    }, UNDO_WINDOW_MS);
    pendingDeletes.current.set(asset.id, timer);

    toast.info(
      `Deleted ${assetName(asset)}`,
      {
        label: 'Undo',
        onClick: () => {
          if (!pendingDeletes.current.delete(asset.id)) return;
          window.clearTimeout(timer);
          setAssets((prev) => (prev.some((a) => a.id === asset.id) ? prev : [asset, ...prev]));
        },
      },
      UNDO_WINDOW_MS,
    );
  };

  const visible = assets.filter((a) => filter === 'all' || a.type === filter);

  return (
    <aside className="flex h-full flex-col overflow-clip bg-panel" aria-label="Assets">
      <div className="flex h-11 shrink-0 items-center justify-between border-b border-border px-3 max-md:hidden">
        <h2 className="flex items-center gap-2 text-sm font-semibold">
          Assets
          {assets.length > 0 && (
            <span className="rounded-full bg-ink/[0.08] px-1.5 py-px text-2xs font-medium tabular-nums text-fg-muted">{assets.length}</span>
          )}
        </h2>
        {loading && <Spinner className="h-3.5 w-3.5 text-fg-muted" />}
      </div>

      {/* Segmented filter */}
      <div className="shrink-0 px-2 pt-2">
        <div className="flex rounded-lg bg-canvas p-0.5" role="group" aria-label="Filter assets by type">
          {(['all', 'video', 'audio', 'image'] as const).map((t) => (
            <button
              key={t}
              type="button"
              aria-pressed={filter === t}
              className={cn(
                'h-7 flex-1 rounded-md text-xs font-semibold capitalize transition-colors',
                filter === t ? 'bg-raised text-fg shadow-sm' : 'text-fg-muted hover:text-fg',
              )}
              onClick={() => setFilter(t)}
            >
              {t}
            </button>
          ))}
        </div>
      </div>

      <AssetUpload
        projectId={project?.id ?? null}
        typeFilter={filter}
        onUploaded={(a) => {
          rememberAsset(a);
          setAssets((prev) => [a, ...prev]);
          const trackType = a.type === 'audio' ? 'audio' : 'video';
          const targetTrack = tracks.find((t) => t.type === trackType);
          if (targetTrack) {
            const durationMs = a.metadata?.duration_ms ?? 5000;
            const currentTimeMs = usePlaybackStore.getState().currentTimeMs;
            addClip({
              track_id: targetTrack.id,
              asset_id: a.id,
              name: assetName(a),
              track_position_ms: currentTimeMs,
              in_point_ms: 0,
              out_point_ms: durationMs,
            });
          }
        }}
      />

      <div className="flex min-h-0 flex-1 flex-col gap-0.5 overflow-auto p-2 pt-0">
        {pendingAsset && (
          <p className="mb-1 rounded-lg bg-accent/10 px-2.5 py-2 text-xs text-accent" role="status">
            Click a matching track in the timeline to place it.
          </p>
        )}
        {visible.length === 0 && !loading && (
          <EmptyState
            compact
            className="flex-1"
            icon={<FolderOpen className="h-6 w-6" />}
            title={assets.length === 0 ? 'No assets yet' : `No ${filter} assets`}
            description={assets.length === 0 ? 'Upload video, audio or images to start building your timeline.' : undefined}
          />
        )}
        {visible.map((asset) => {
          const name = assetName(asset);
          const selected = pendingAsset?.id === asset.id;
          return (
            <div
              key={asset.id}
              role="button"
              tabIndex={0}
              aria-pressed={selected}
              aria-label={`${name}, ${asset.type}. Press Enter to add at the playhead.`}
              className={cn(
                'group relative flex cursor-grab items-center gap-2.5 rounded-lg p-1.5 transition-colors active:cursor-grabbing',
                selected ? 'bg-accent/10 ring-1 ring-inset ring-accent/50' : 'hover:bg-ink/[0.05]',
              )}
              draggable={false}
              onDragStart={(e) => e.preventDefault()}
              onPointerDown={(e) => onAssetPointerDown(e, asset)}
              onClick={() => setPendingAsset(selected ? null : asset)}
              onDoubleClick={() => handleDropOnTrack(asset)}
              onKeyDown={(e) => {
                if (e.target !== e.currentTarget) return;
                // Space is the editor-wide play/pause key, so only Enter acts here
                if (e.key === 'Enter') { e.preventDefault(); handleDropOnTrack(asset); }
              }}
              title="Drag to a track, or double-click to add at the playhead"
            >
              <AssetTile asset={asset} />
              <div className="min-w-0 flex-1">
                <p className="truncate text-xs font-medium text-fg">{name}</p>
                <p className="mt-0.5 flex items-center gap-1.5 text-2xs text-fg-subtle">
                  <span>{(TYPE_STYLE[asset.type] ?? TYPE_STYLE.video).label}</span>
                  {asset.metadata?.duration_ms ? (
                    <>
                      <span aria-hidden>·</span>
                      <span className="tabular-nums">{formatDuration(asset.metadata.duration_ms)}</span>
                    </>
                  ) : null}
                  {/* "Ready" is the normal case, so only the exceptions are called out */}
                  {asset.status === 'failed' && <span className="font-medium text-danger">· Failed</span>}
                  {(asset.status === 'processing' || asset.status === 'uploading') && (
                    <>
                      <span aria-hidden>·</span>
                      <ShimmeringText
                        className="font-medium"
                        text={asset.status === 'uploading' ? 'Uploading' : 'Processing'}
                        color="rgb(var(--c-warning) / 0.75)"
                        shimmerColor="rgb(var(--c-fg))"
                      />
                    </>
                  )}
                </p>
              </div>
              <IconButton
                label={`Delete ${name}`}
                size="sm"
                className="shrink-0 opacity-0 hover:bg-danger/15 hover:text-danger focus-visible:opacity-100 group-focus-within:opacity-100 group-hover:opacity-100"
                onClick={(e) => { e.stopPropagation(); deleteAsset(asset); }}
                onPointerDown={(e) => e.stopPropagation()}
              >
                <Trash2 aria-hidden className="h-3.5 w-3.5" />
              </IconButton>
            </div>
          );
        })}
      </div>
    </aside>
  );
}
