import { useEffect, useRef, useState } from 'react';
import { api } from '../../services/api';
import { usePlaybackStore } from '../../state/playbackStore';
import { useProjectStore } from '../../state/projectStore';
import { useUIStore } from '../../state/uiStore';
import type { Asset, Clip } from '../../types';
import { PlayerControls } from './PlayerControls';

const API_BASE = import.meta.env.VITE_API_BASE ?? 'http://localhost:8080';

function resolveUrl(url: string) {
  return url.startsWith('http') ? url : `${API_BASE}/${url.replace(/^\//, '')}`;
}

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
}

function ClipLayer({ clip, asset, cssFilter, isPlaying, currentTimeMs, volume, isMuted, trackMuted }: LayerProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const url = resolveUrl(asset.original_url);
  const updateClip = useProjectStore((s) => s.updateClip);

  const { x, y, scale, rotation, opacity } = clip.transform;
  const transform = [
    `translate(${x}px, ${y}px)`,
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
    return <img src={url} alt="" style={sharedStyle} draggable={false} />;
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
  const { isPlaying, playbackSpeed, currentTimeMs, volume, isMuted, seek, pause } = usePlaybackStore();
  const { selectedClipIds, hiddenTrackIds } = useUIStore();
  const { clips, effects, tracks, project, updateClip } = useProjectStore();
  const [assetCache, setAssetCache] = useState<Record<string, Asset>>({});

  // On project load: probe real duration for all clips that have default 5s duration
  useEffect(() => {
    if (!project) return;
    const defaultClips = clips.filter((c) => c.in_point_ms === 0 && c.out_point_ms <= 5000);
    if (defaultClips.length === 0) return;

    for (const clip of defaultClips) {
      api<Asset>(`/assets/${clip.asset_id}`).then((asset) => {
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
        api<Asset>(`/assets/${clip.asset_id}`).then((a) => {
          setAssetCache((prev) => ({ ...prev, [a.id]: a }));
        }).catch(() => {});
      }
    }
  }, [activeLayers.map((c) => c.asset_id).join(','), project]);

  // selected clip effects for inspector preview
  const selectedClip = clips.find((c) => c.id === selectedClipIds[0]);
  const selectedEffects = selectedClip ? (effects[selectedClip.id] ?? []) : [];

  const totalMs = clips.reduce((m, c) => Math.max(m, c.track_position_ms + c.duration_ms), 0);

  return (
    <section className="flex h-full flex-col bg-[#101217]">
      <div className="relative min-h-0 flex-1 overflow-hidden bg-black">
        {activeLayers.length === 0 && (
          <div className="absolute inset-0 flex items-center justify-center text-xs text-slate-600 select-none">
            No clip at playhead
          </div>
        )}

        {activeLayers.map((clip) => {
          const asset = assetCache[clip.asset_id];
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
            />
          );
        })}
      </div>
      <PlayerControls totalMs={totalMs} />
    </section>
  );
}
