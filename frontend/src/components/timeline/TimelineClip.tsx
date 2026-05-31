import { useRef, useState } from 'react';
import { X } from 'lucide-react';
import { useProjectStore } from '../../state/projectStore';
import { usePlaybackStore } from '../../state/playbackStore';
import { useUIStore } from '../../state/uiStore';
import type { Clip } from '../../types';
import { snapTime } from '../../utils/geometry';
import { formatTimecode, msToPixels, pixelsToMs } from '../../utils/timecode';

interface Props { clip: Clip; trackMuted?: boolean }
type Mode = 'move' | 'trim-left' | 'trim-right';

export function TimelineClip({ clip, trackMuted }: Props) {
  const { clips, moveClip, trimClip, deleteClips } = useProjectStore();
  const { selectedClipIds, selectClip, zoomLevel, snapEnabled } = useUIStore();
  const currentTimeMs = usePlaybackStore((s) => s.currentTimeMs);

  // local visual state during drag (don't touch store until drop)
  const [dragPos, setDragPos] = useState<{ left: number; width: number } | null>(null);

  const dragRef = useRef<{
    mode: Mode;
    startX: number;
    startPositionMs: number;
    startInMs: number;
    startOutMs: number;
    startTrackId: string;
  } | null>(null);

  const isSelected = selectedClipIds.includes(clip.id);
  const baseLeft  = msToPixels(clip.track_position_ms, zoomLevel);
  const baseWidth = Math.max(16, msToPixels(clip.duration_ms, zoomLevel));

  const visLeft  = dragPos?.left  ?? baseLeft;
  const visWidth = dragPos?.width ?? baseWidth;

  /* ── find track under pointer ────────────────────────────────────────── */
  const trackIdAt = (x: number, y: number): string | undefined => {
    const el = document.querySelector(`[data-clip-id="${clip.id}"]`) as HTMLElement | null;
    if (el) el.style.pointerEvents = 'none';
    const hit = document.elementFromPoint(x, y);
    if (el) el.style.pointerEvents = '';
    return (hit?.closest('[data-track-id]') as HTMLElement | null)?.dataset.trackId;
  };

  /* ── pointer down ────────────────────────────────────────────────────── */
  const onDown = (e: React.PointerEvent, mode: Mode) => {
    e.stopPropagation();
    if (mode === 'move') selectClip(clip.id, e.shiftKey);
    dragRef.current = {
      mode,
      startX: e.clientX,
      startPositionMs: clip.track_position_ms,
      startInMs: clip.in_point_ms,
      startOutMs: clip.out_point_ms,
      startTrackId: clip.track_id,
    };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  };

  /* ── pointer move — update local visual only ─────────────────────────── */
  const onMove = (e: React.PointerEvent) => {
    const d = dragRef.current;
    if (!d) return;
    const deltaMs = pixelsToMs(e.clientX - d.startX, zoomLevel);

    if (d.mode === 'move') {
      const raw = Math.max(0, d.startPositionMs + deltaMs);
      const { timeMs } = snapEnabled && !e.altKey
        ? snapTime(raw, clips.filter((c) => c.id !== clip.id), currentTimeMs)
        : { timeMs: raw };
      setDragPos({ left: msToPixels(timeMs, zoomLevel), width: visWidth });

    } else if (d.mode === 'trim-left') {
      const newIn  = Math.max(0, Math.min(d.startInMs + deltaMs, d.startOutMs - 500));
      const newDur = d.startOutMs - newIn;
      const newPos = d.startPositionMs + (newIn - d.startInMs);
      setDragPos({ left: msToPixels(Math.max(0, newPos), zoomLevel), width: Math.max(16, msToPixels(newDur, zoomLevel)) });

    } else {
      const newOut = Math.max(d.startInMs + 500, d.startOutMs + deltaMs);
      setDragPos({ left: visLeft, width: Math.max(16, msToPixels(newOut - d.startInMs, zoomLevel)) });
    }
  };

  /* ── pointer up — commit to store + API ─────────────────────────────── */
  const onUp = (e: React.PointerEvent) => {
    const d = dragRef.current;
    dragRef.current = null;

    if (!d || !dragPos) { setDragPos(null); return; }

    const deltaMs = pixelsToMs(e.clientX - d.startX, zoomLevel);

    if (d.mode === 'move') {
      const raw = Math.max(0, d.startPositionMs + deltaMs);
      const { timeMs } = snapEnabled && !e.altKey
        ? snapTime(raw, clips.filter((c) => c.id !== clip.id), currentTimeMs)
        : { timeMs: raw };
      const newTrackId = trackIdAt(e.clientX, e.clientY);
      moveClip(clip.id, timeMs, newTrackId && newTrackId !== d.startTrackId ? newTrackId : undefined);

    } else if (d.mode === 'trim-left') {
      const newIn  = Math.max(0, Math.min(d.startInMs + deltaMs, d.startOutMs - 500));
      const newPos = d.startPositionMs + (newIn - d.startInMs);
      trimClip(clip.id, newIn, d.startOutMs);
      moveClip(clip.id, Math.max(0, newPos));

    } else {
      const newOut = Math.max(d.startInMs + 500, d.startOutMs + deltaMs);
      trimClip(clip.id, d.startInMs, newOut);
    }

    setDragPos(null);
  };

  return (
    <div
      data-clip-id={clip.id}
      className={[
        'absolute top-1 h-14 select-none rounded border text-xs',
        isSelected
          ? 'border-accent bg-[#1a3d37] ring-1 ring-accent z-10'
          : 'border-[#3a4560] bg-[#1e2d44] hover:border-slate-500',
        trackMuted ? 'opacity-50' : '',
        dragPos ? 'z-20 opacity-80 cursor-grabbing shadow-xl' : 'cursor-grab',
      ].join(' ')}
      style={{ left: visLeft, width: visWidth }}
      onClick={(e) => e.stopPropagation()}
      onPointerDown={(e) => onDown(e, 'move')}
      onPointerMove={onMove}
      onPointerUp={onUp}
    >
      {/* trim-left handle */}
      <div
        className="absolute left-0 top-0 z-10 h-full w-3 cursor-ew-resize hover:bg-accent/40"
        onPointerDown={(e) => { e.stopPropagation(); onDown(e, 'trim-left'); }}
      >
        <div className="absolute left-1 top-1/2 -translate-y-1/2 h-5 w-0.5 rounded bg-white/40" />
      </div>

      {/* clip content */}
      <div className="pointer-events-none flex h-full flex-col justify-center px-4">
        <div className="truncate font-medium text-white leading-tight">{clip.name}</div>
        <div className="truncate text-[10px] text-slate-400">{formatTimecode(clip.duration_ms)}</div>
      </div>

      {/* delete button — top-right */}
      {isSelected && (
        <button
          className="absolute right-0 top-0 z-20 flex h-5 w-5 items-center justify-center rounded-bl rounded-tr bg-red-600 hover:bg-red-500"
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => { e.stopPropagation(); deleteClips([clip.id]); }}
          title="Delete clip"
        >
          <X className="h-3 w-3" />
        </button>
      )}

      {/* trim-right handle */}
      <div
        className="absolute right-0 top-0 z-10 h-full w-3 cursor-ew-resize hover:bg-accent/40"
        onPointerDown={(e) => { e.stopPropagation(); onDown(e, 'trim-right'); }}
      >
        <div className="absolute right-1 top-1/2 -translate-y-1/2 h-5 w-0.5 rounded bg-white/40" />
      </div>
    </div>
  );
}
