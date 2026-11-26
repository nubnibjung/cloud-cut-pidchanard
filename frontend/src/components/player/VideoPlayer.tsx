import { useCallback, useEffect, useRef, useState } from 'react';
import { Film } from 'lucide-react';
import { getAsset, peekAsset } from '../../services/assets';
import { resolveUrl } from '../../services/config';
import { usePlaybackStore } from '../../state/playbackStore';
import { useProjectStore } from '../../state/projectStore';
import { useUIStore } from '../../state/uiStore';
import type { Asset, Clip } from '../../types';
import { PlayerControls } from './PlayerControls';
import { contentBox, hitsClip, TransformOverlay, type CanvasSize, type MediaSize } from './TransformOverlay';

function buildCssFilter(effects: { type: string; params: { value: number }; enabled: boolean }[]): string {
  const parts: string[] = [];
  for (const e of effects.filter((x) => x.enabled)) {
    const v = e.params.value;
    // slider values map directly to CSS filter values:
    // brightness/contrast/saturation: 0=black/flat/grey, 1=normal, 2=double
    // blur: value in pixels
    if (e.type === 'brightness') parts.push(`brightness(${v.toFixed(2)})`);
    else if (e.type === 'contrast') parts.push(`contrast(${v.toFixed(2)})`);
    else if (e.type === 'saturation') parts.push(`saturate(${v.toFixed(2)})`);
    else if (e.type === 'blur' && v > 0) parts.push(`blur(${v.toFixed(1)}px)`);
  }
  return parts.join(' ');
}

interface LayerProps {
  clip: Clip;
  asset: Asset;
  cssFilter?: string;
  isPlaying: boolean;
  currentTimeMs: number;
  volume: number;
  isMuted: boolean;
  trackMuted: boolean;
  canvasScale: number;
  onMediaSize(clipId: string, size: MediaSize): void;
}

function ClipLayer({ clip, asset, cssFilter, isPlaying, currentTimeMs, volume, isMuted, trackMuted, canvasScale, onMediaSize }: LayerProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const url = resolveUrl(asset.original_url);
  const updateClip = useProjectStore((s) => s.updateClip);

  const { x, y, scale, rotation, opacity } = clip.transform;
  const transform = [
    `translate(${x * canvasScale}px, ${y * canvasScale}px)`,
    `scale(${scale})`,
    `rotate(${rotation}deg)`,
  ].join(' ');

  // sync video time
  useEffect(() => {
    const v = videoRef.current;
    if (!v || asset.type === 'image') return;
    const clipTime = currentTimeMs - clip.track_position_ms + clip.in_point_ms;
    if (Math.abs(v.currentTime * 1000 - clipTime) > 250) v.currentTime = clipTime / 1000;
  }, [currentTimeMs, clip, asset.type]);

  // sync play/pause
  useEffect(() => {
    const v = videoRef.current;
    if (!v || asset.type === 'image') return;
    if (isPlaying) v.play().catch(() => {});
    else v.pause();
  }, [isPlaying, asset.type]);

  // sync volume/mute — all layers play audio unless globally muted or track muted
  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    v.volume = volume;
    v.muted = isMuted || trackMuted;
  }, [volume, isMuted, trackMuted]);

  const sharedStyle: React.CSSProperties = {
    position: 'absolute',
    inset: 0,
    objectFit: 'contain',
    width: '100%',
    height: '100%',
    opacity,
    transform,
    filter: cssFilter,
  };

  if (asset.type === 'image') {
    return (
      <img
        src={url}
        alt=""
        style={sharedStyle}
        draggable={false}
        onLoad={(ev) => onMediaSize(clip.id, { width: ev.currentTarget.naturalWidth, height: ev.currentTarget.naturalHeight })}
      />
    );
  }

  return (
    <video
      ref={videoRef}
      src={url}
      key={`${clip.id}-${url}`}
      style={sharedStyle}
      className={asset.type === 'audio' ? '!opacity-0 !w-0 !h-0' : ''}
      playsInline
      onLoadedMetadata={(ev) => {
        onMediaSize(clip.id, { width: ev.currentTarget.videoWidth, height: ev.currentTarget.videoHeight });
        const actual = Math.round(ev.currentTarget.duration * 1000);
        // Only fix clips that still have the default 5s duration (in_point=0, out_point≤5000)
        if (isFinite(actual) && actual > 5000 && clip.in_point_ms === 0 && clip.out_point_ms <= 5000) {
          updateClip(clip.id, { in_point_ms: 0, out_point_ms: actual });
        }
      }}
      onCanPlay={(ev) => {
        const v = ev.currentTarget;
        v.volume = volume;
        v.muted = isMuted || trackMuted;
        if (isPlaying) v.play().catch(() => {});
      }}
    />
  );
}

export function VideoPlayer() {
  const isPlaying = usePlaybackStore((s) => s.isPlaying);
  const playbackSpeed = usePlaybackStore((s) => s.playbackSpeed);
  const currentTimeMs = usePlaybackStore((s) => s.currentTimeMs);
  const volume = usePlaybackStore((s) => s.volume);
  const isMuted = usePlaybackStore((s) => s.isMuted);
  const seek = usePlaybackStore((s) => s.seek);
  const pause = usePlaybackStore((s) => s.pause);
  const selectedClipIds = useUIStore((s) => s.selectedClipIds);
  const hiddenTrackIds = useUIStore((s) => s.hiddenTrackIds);
  const clips = useProjectStore((s) => s.clips);
  const effects = useProjectStore((s) => s.effects);
  const tracks = useProjectStore((s) => s.tracks);
  const project = useProjectStore((s) => s.project);
  const updateClip = useProjectStore((s) => s.updateClip);
  const [assetCache, setAssetCache] = useState<Record<string, Asset>>({});
  const selectClip = useUIStore((s) => s.selectClip);
  const canvasRef = useRef<HTMLDivElement>(null);
  const [canvasScale, setCanvasScale] = useState(1);
  const [canvasSize, setCanvasSize] = useState<CanvasSize>({ width: 0, height: 0 });
  const [mediaSizes, setMediaSizes] = useState<Record<string, MediaSize>>({});
  const startMoveRef = useRef<((e: PointerEvent) => void) | null>(null);
  const onMediaSize = useCallback((clipId: string, size: MediaSize) => {
    if (!size.width || !size.height) return;
    setMediaSizes((prev) =>
      prev[clipId]?.width === size.width && prev[clipId]?.height === size.height ? prev : { ...prev, [clipId]: size },
    );
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const updateCanvasScale = () => {
      const { width, height } = canvas.getBoundingClientRect();
      setCanvasScale(Math.min(width / 1920, height / 1080));
      setCanvasSize({ width, height });
    };
    const observer = new ResizeObserver(updateCanvasScale);
    observer.observe(canvas);
    updateCanvasScale();
    return () => observer.disconnect();
  }, []);

  // On project load: probe real duration for all clips that have default 5s duration
  useEffect(() => {
    if (!project) return;
    const defaultClips = clips.filter((c) => c.in_point_ms === 0 && c.out_point_ms <= 5000);
    if (defaultClips.length === 0) return;

    for (const clip of defaultClips) {
      getAsset(clip.asset_id, project.id).then((asset) => {
        if (asset.type === 'image') return;
        // Use metadata if already available
        if (asset.metadata?.duration_ms && asset.metadata.duration_ms > 5000) {
          updateClip(clip.id, { in_point_ms: 0, out_point_ms: asset.metadata.duration_ms });
          return;
        }
        // Probe via browser media element
        const el = asset.type === 'audio'
          ? document.createElement('audio')
          : document.createElement('video');
        el.preload = 'metadata';
        el.onloadedmetadata = () => {
          const actual = Math.round(el.duration * 1000);
          el.src = '';
          if (isFinite(actual) && actual > 5000) {
            updateClip(clip.id, { in_point_ms: 0, out_point_ms: actual });
          }
        };
        el.src = resolveUrl(asset.original_url);
      }).catch(() => {});
    }
  }, [project?.id]);

  // RAF playhead — auto-stop at end of last clip
  useEffect(() => {
    if (!isPlaying) return;
    let frame = 0;
    let last = performance.now();
    const tick = (now: number) => {
      const endMs = useProjectStore.getState().clips.reduce(
        (m, c) => Math.max(m, c.track_position_ms + c.duration_ms), 0,
      );
      const next = usePlaybackStore.getState().currentTimeMs + (now - last) * playbackSpeed;
      if (endMs > 0 && next >= endMs) {
        seek(endMs);
        pause();
        return;
      }
      seek(next);
      last = now;
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [isPlaying, playbackSpeed, seek, pause]);

  // All clips active at current playhead, on visible tracks, sorted by track order (bottom first)
  const trackOrder = Object.fromEntries(tracks.map((t) => [t.id, t.order_index]));
  // Sort descending: highest order_index renders first (bottom layer), lowest renders last (top layer)
  // So V1 (order_index=1) is on top — matches timeline where V1 is topmost row
  const activeLayers = clips
    .filter((c) =>
      currentTimeMs >= c.track_position_ms &&
      currentTimeMs < c.track_position_ms + c.duration_ms &&
      !hiddenTrackIds.has(c.track_id)
    )
    .sort((a, b) => (trackOrder[b.track_id] ?? 0) - (trackOrder[a.track_id] ?? 0));

  // Fetch asset info for any new clips
  useEffect(() => {
    if (!project) return;
    for (const clip of activeLayers) {
      if (!assetCache[clip.asset_id]) {
        // Resolved from the project's shared asset list — no per-clip request
        getAsset(clip.asset_id, project.id).then((a) => {
          setAssetCache((prev) => (prev[a.id] ? prev : { ...prev, [a.id]: a }));
        }).catch(() => {});
      }
    }
  }, [activeLayers.map((c) => c.asset_id).join(','), project]);

  // selected clip effects for inspector preview
  const selectedClip = clips.find((c) => c.id === selectedClipIds[0]);
  const selectedEffects = selectedClip ? (effects[selectedClip.id] ?? []) : [];

  const totalMs = clips.reduce((m, c) => Math.max(m, c.track_position_ms + c.duration_ms), 0);

  // Layers you can see and grab in the preview (audio has no picture)
  const visualLayers = activeLayers.filter((c) => {
    const asset = assetCache[c.asset_id] ?? peekAsset(c.asset_id);
    return asset && asset.type !== 'audio';
  });
  const editable = selectedClip && !isPlaying && visualLayers.some((c) => c.id === selectedClip.id) ? selectedClip : null;

  // Click a picture in the preview to select it — and keep holding to drag it right away
  const onCanvasPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0 || isPlaying) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const px = e.clientX - rect.left;
    const py = e.clientY - rect.top;
    const hit = [...visualLayers].reverse().find((c) => hitsClip(px, py, contentBox(c, mediaSizes[c.id], canvasSize, canvasScale)));
    if (!hit) { useUIStore.getState().deselectAll(); return; }
    selectClip(hit.id);
    const native = e.nativeEvent;
    // The overlay for the newly selected clip mounts on the next frame. Only start
    // dragging if the button is still held by then — a plain click just selects.
    let released = false;
    window.addEventListener('pointerup', () => { released = true; }, { once: true });
    requestAnimationFrame(() => { if (!released) startMoveRef.current?.(native); });
  };

  return (
    <section className="flex h-full flex-col overflow-clip bg-canvas" aria-label="Preview">
      <div ref={canvasRef} className="relative min-h-0 flex-1 overflow-hidden bg-black" onPointerDown={onCanvasPointerDown}>
        {activeLayers.length === 0 && (
          <div className="absolute inset-0 flex select-none flex-col items-center justify-center gap-2 text-fg-subtle">
            <Film aria-hidden className="h-7 w-7 opacity-60" />
            <p className="text-xs">
              {clips.length === 0 ? 'Add a clip to the timeline to see it here' : 'Nothing at the playhead'}
            </p>
          </div>
        )}

        {activeLayers.map((clip) => {
          const asset = assetCache[clip.asset_id] ?? peekAsset(clip.asset_id);
          if (!asset) return null;
          const track = tracks.find((t) => t.id === clip.track_id);
          const clipEffects = effects[clip.id] ?? [];
          const cssFilter = buildCssFilter(
            clip.id === selectedClip?.id ? selectedEffects : clipEffects
          ) || undefined;
          return (
            <ClipLayer
              key={clip.id}
              clip={clip}
              asset={asset}
              cssFilter={cssFilter}
              isPlaying={isPlaying}
              currentTimeMs={currentTimeMs}
              volume={volume}
              isMuted={isMuted}
              trackMuted={track?.is_muted ?? false}
              canvasScale={canvasScale}
              onMediaSize={onMediaSize}
            />
          );
        })}

        {editable && canvasSize.width > 0 && (
          <TransformOverlay
            key={editable.id}
            clip={editable}
            media={mediaSizes[editable.id]}
            canvas={canvasSize}
            canvasScale={canvasScale}
            canvasEl={canvasRef.current}
            startRef={startMoveRef}
          />
        )}
      </div>
      <PlayerControls totalMs={totalMs} />
    </section>
  );
}
