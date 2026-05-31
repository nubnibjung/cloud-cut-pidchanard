import { useEffect, useRef, useState } from 'react';
import { api } from '../../services/api';
import { usePlaybackStore } from '../../state/playbackStore';
import { useProjectStore } from '../../state/projectStore';
import { useUIStore } from '../../state/uiStore';
import type { Asset } from '../../types';
import { PlayerControls } from './PlayerControls';

const API_BASE = import.meta.env.VITE_API_BASE ?? 'http://localhost:8080';

function buildCssFilter(effects: { type: string; params: { value: number }; enabled: boolean }[]): string {
  const parts: string[] = [];
  for (const e of effects.filter((x) => x.enabled)) {
    const v = e.params.value;
    if (e.type === 'brightness') parts.push(`brightness(${(1 + v / 100).toFixed(2)})`);
    else if (e.type === 'contrast') parts.push(`contrast(${(1 + v / 100).toFixed(2)})`);
    else if (e.type === 'saturation') parts.push(`saturate(${(1 + v / 100).toFixed(2)})`);
    else if (e.type === 'blur' && v > 0) parts.push(`blur(${v.toFixed(1)}px)`);
  }
  return parts.join(' ');
}

function resolveUrl(url: string) {
  return url.startsWith('http') ? url : `${API_BASE}/${url.replace(/^\//, '')}`;
}

export function VideoPlayer() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const { isPlaying, playbackSpeed, currentTimeMs, volume, isMuted, seek, pause } = usePlaybackStore();
  const { selectedClipIds } = useUIStore();
  const { clips, effects, project } = useProjectStore();
  const [assetCache, setAssetCache] = useState<Record<string, Asset>>({});

  // RAF playhead
  useEffect(() => {
    if (!isPlaying) return;
    let frame = 0;
    let last = performance.now();
    const tick = (now: number) => {
      seek(usePlaybackStore.getState().currentTimeMs + (now - last) * playbackSpeed);
      last = now;
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [isPlaying, playbackSpeed, seek]);

  // Active clip at playhead
  const activeClip = clips.find(
    (c) => currentTimeMs >= c.track_position_ms && currentTimeMs < c.track_position_ms + c.duration_ms,
  );

  // Fetch asset metadata
  useEffect(() => {
    if (!activeClip || assetCache[activeClip.asset_id] || !project) return;
    api<Asset>(`/assets/${activeClip.asset_id}`).then((a) => {
      setAssetCache((prev) => ({ ...prev, [a.id]: a }));
    }).catch(() => {});
  }, [activeClip?.asset_id, project]);

  const activeAsset = activeClip ? assetCache[activeClip.asset_id] : null;
  const mediaUrl = activeAsset ? resolveUrl(activeAsset.original_url) : null;

  // check if the active clip's track is muted
  const { tracks } = useProjectStore();
  const activeTrack = activeClip ? tracks.find((t) => t.id === activeClip.track_id) : null;
  const trackMuted = activeTrack?.is_muted ?? false;

  // Sync video: time
  useEffect(() => {
    const v = videoRef.current;
    if (!v || !activeAsset || activeAsset.type !== 'video' || !activeClip) return;
    const clipTime = currentTimeMs - activeClip.track_position_ms + activeClip.in_point_ms;
    if (Math.abs(v.currentTime * 1000 - clipTime) > 250) v.currentTime = clipTime / 1000;
  }, [currentTimeMs, activeClip, activeAsset]);

  // Sync video/audio: play/pause
  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    if (isPlaying && (activeAsset?.type === 'video' || activeAsset?.type === 'audio')) {
      v.play().catch((err) => console.warn('play failed:', err));
    } else {
      v.pause();
    }
  }, [isPlaying, activeAsset?.type]);

  // Sync video: volume + mute (player mute OR track mute)
  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    v.volume = volume;
    v.muted = isMuted || trackMuted;
  }, [volume, isMuted, trackMuted]);

  // CSS filter from selected clip effects
  const selectedClip = clips.find((c) => c.id === selectedClipIds[0]);
  const clipEffects = selectedClip ? (effects[selectedClip.id] ?? []) : [];
  const cssFilter = buildCssFilter(clipEffects) || undefined;

  return (
    <section className="flex h-full flex-col bg-[#101217]">
      <div className="relative grid min-h-0 flex-1 overflow-hidden place-items-center bg-black">
        {!activeClip && (
          <p className="text-xs text-slate-600 select-none">No clip at playhead</p>
        )}

        {activeAsset?.type === 'image' && mediaUrl && (
          <img key={mediaUrl} src={mediaUrl} alt=""
            className="max-h-full max-w-full object-contain"
            style={{ filter: cssFilter }} />
        )}

        {(activeAsset?.type === 'video' || activeAsset?.type === 'audio') && mediaUrl && (
          <video
            ref={videoRef}
            key={activeClip!.asset_id}
            src={mediaUrl}
            className={activeAsset.type === 'audio' ? 'hidden' : 'max-h-full max-w-full'}
            style={{ filter: cssFilter }}
            playsInline
            onEnded={pause}
            onCanPlay={(e) => {
              const v = e.currentTarget;
              v.volume = volume;
              v.muted = isMuted || trackMuted;
              if (isPlaying) v.play().catch(() => {});
            }}
          />
        )}

        {activeAsset?.type === 'audio' && (
          <div className="flex flex-col items-center gap-2 text-slate-500">
            <svg className="h-16 w-16 opacity-40" viewBox="0 0 24 24" fill="currentColor">
              <path d="M12 3v10.55A4 4 0 1 0 14 17V7h4V3h-6z"/>
            </svg>
            <span className="text-sm">{activeAsset.original_url.split('/').pop()}</span>
          </div>
        )}

        {activeClip && !activeAsset && (
          <p className="text-xs text-slate-500 animate-pulse">Loading…</p>
        )}
      </div>
      <PlayerControls totalMs={clips.reduce((m, c) => Math.max(m, c.track_position_ms + c.duration_ms), 0)} />
    </section>
  );
}
