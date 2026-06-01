import { useRef, useState } from 'react';
import { X } from 'lucide-react';
import { useProjectStore } from '../../state/projectStore';
import { usePlaybackStore } from '../../state/playbackStore';
import { useUIStore } from '../../state/uiStore';
import type { Clip } from '../../types';
import { snapTime } from '../../utils/geometry';
import { formatTimecode, msToPixels, pixelsToMs } from '../../utils/timecode';

interface Props { clip: Clip; trackColor?: string; trackMuted?: boolean }
type Mode = 'move' | 'trim-left' | 'trim-right';
type StartDragEvent = React.PointerEvent | React.MouseEvent;

export function TimelineClip({ clip, trackColor = '#4a90d9', trackMuted }: Props) {
  const { clips, deleteClips, updateClip } = useProjectStore();
  const { selectedClipIds, selectClip, zoomLevel, snapEnabled } = useUIStore();
  const currentTimeMs = usePlaybackStore((s) => s.currentTimeMs);
  const isSelected = selectedClipIds.includes(clip.id);

  const elRef   = useRef<HTMLDivElement>(null);
  const draggingRef = useRef(false);
  const [active, setActive] = useState(false);   // only for cursor class

  /* always-fresh refs — closures read these so they never go stale */
  const clipsRef = useRef(clips);        clipsRef.current  = clips;
  const snapRef  = useRef(snapEnabled);  snapRef.current   = snapEnabled;
  const timeRef  = useRef(currentTimeMs); timeRef.current  = currentTimeMs;
  const zoomRef  = useRef(zoomLevel);    zoomRef.current   = zoomLevel;

  const left  = msToPixels(clip.track_position_ms, zoomLevel);
  const width = Math.max(16, msToPixels(clip.duration_ms, zoomLevel));

  /* ── helper: which track row is under pointer ──────────────────────── */
  const trackUnder = (_x: number, y: number) => {
    const trackElements = Array.from(document.querySelectorAll('[data-track-id]')) as HTMLElement[];
    let bestTrackId: string | undefined = undefined;
    let minDistance = Number.POSITIVE_INFINITY;
    for (const trackEl of trackElements) {
      const rect = trackEl.getBoundingClientRect();
      if (y >= rect.top && y <= rect.bottom) return trackEl.dataset.trackId;
      const distance = Math.min(Math.abs(y - rect.top), Math.abs(y - rect.bottom));
      if (distance < minDistance) { minDistance = distance; bestTrackId = trackEl.dataset.trackId; }
    }
    return bestTrackId;
  };

  /* ── start drag — manipulates DOM directly, zero React re-renders ── */
  const startDrag = (e: StartDragEvent, mode: Mode) => {
    if (e.button !== 0) return;
    if (draggingRef.current) return;
    draggingRef.current = true;
    e.preventDefault();
    e.stopPropagation();

    const el = elRef.current;
    if (!el) return;

    // Set z-index immediately via DOM — don't wait for React re-render
    el.style.zIndex = '20';
    el.style.opacity = '0.85';
    document.body.style.cursor = mode === 'move' ? 'grabbing' : 'ew-resize';
    document.body.style.userSelect = 'none';

    if (mode === 'move') selectClip(clip.id, e.shiftKey);
    setActive(true);

    const z       = zoomRef.current;
    const startX  = e.clientX;
    const startY  = e.clientY;
    /* snapshot of clip data at drag start */
    const basePos = clip.track_position_ms;
    const baseIn  = clip.in_point_ms;
    const baseOut = clip.out_point_ms;

    /* set correct cursor on body so it stays while outside element */
    document.body.style.cursor = mode === 'move' ? 'grabbing' : 'ew-resize';
    document.body.style.userSelect = 'none';

    const onMove = (mv: PointerEvent | MouseEvent) => {
      mv.preventDefault();
      const dxPx = mv.clientX - startX;
      const dxMs = pixelsToMs(dxPx, z);

      if (mode === 'move') {
        const raw = Math.max(0, basePos + dxMs);
        const { timeMs } = snapRef.current
          ? snapTime(raw, clipsRef.current.filter((c) => c.id !== clip.id), timeRef.current)
          : { timeMs: raw };
        
        const visualDx = msToPixels(timeMs, z) - left;
        const visualDy = mv.clientY - startY;
        el.style.transform = `translate(${visualDx}px, ${visualDy}px)`;

      } else if (mode === 'trim-left') {
        const newIn  = Math.max(0, Math.min(baseIn + dxMs, baseOut - 500));
        const newPos = basePos + (newIn - baseIn);
        const newDur = baseOut - newIn;
        
        const visualDx = msToPixels(Math.max(0, newPos), z) - left;
        el.style.transform = `translateX(${visualDx}px)`;
        el.style.width = `${Math.max(16, msToPixels(newDur, z))}px`;

      } else {
        const newOut = Math.max(baseIn + 500, baseOut + dxMs);
        el.style.width = `${Math.max(16, msToPixels(newOut - baseIn, z))}px`;
      }
    };

    const finishDrag = (up: PointerEvent | MouseEvent) => {
      document.removeEventListener('pointermove', onMove, true);
      document.removeEventListener('pointerup', finishDrag, true);
      document.removeEventListener('pointercancel', finishDrag, true);
      document.removeEventListener('mousemove', onMove, true);
      document.removeEventListener('mouseup', finishDrag, true);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      draggingRef.current = false;
      setActive(false);

      const newTrack = trackUnder(up.clientX, up.clientY);

      /* reset DOM so React takes over again */
      el.style.left  = '';
      el.style.width = '';
      el.style.transform = '';
      el.style.zIndex = '';
      el.style.opacity = '';

      const dxMs = pixelsToMs(up.clientX - startX, z);

      if (mode === 'move') {
        const raw = Math.max(0, basePos + dxMs);
        const { timeMs } = snapRef.current
          ? snapTime(raw, clipsRef.current.filter((c) => c.id !== clip.id), timeRef.current)
          : { timeMs: raw };
        
        updateClip(clip.id, {
          track_position_ms: timeMs,
          ...(newTrack && newTrack !== clip.track_id ? { track_id: newTrack } : {}),
        });

      } else if (mode === 'trim-left') {
        const newIn  = Math.max(0, Math.min(baseIn + dxMs, baseOut - 500));
        const newPos = Math.max(0, basePos + (newIn - baseIn));
        
        updateClip(clip.id, {
          in_point_ms: newIn,
          out_point_ms: baseOut,
          track_position_ms: newPos,
        });

      } else {
        const newOut = Math.max(baseIn + 500, baseOut + dxMs);
        
        updateClip(clip.id, {
          in_point_ms: baseIn,
          out_point_ms: newOut,
        });
      }
    };

    /* attach SYNCHRONOUSLY — no React cycle delay */
    document.addEventListener('pointermove', onMove, true);
    document.addEventListener('pointerup', finishDrag, true);
    document.addEventListener('pointercancel', finishDrag, true);
    document.addEventListener('mousemove', onMove, true);
    document.addEventListener('mouseup', finishDrag, true);
  };

  return (
    <div
      ref={elRef}
      data-clip-id={clip.id}
      className={[
        'group absolute top-1 h-14 select-none touch-none rounded border text-xs overflow-hidden',
        isSelected
          ? 'border-accent/60 bg-[#1a2d4a] ring-1 ring-accent/40 z-10'
          : 'border-[#2a3550] bg-[#18243a] hover:border-[#3a4f70] hover:bg-[#1e2d48]',
        active ? 'z-20 opacity-80 shadow-xl' : 'cursor-grab',
        trackMuted ? 'opacity-40 saturate-50' : '',
      ].join(' ')}
      style={{ left, width }}
      draggable={false}
      onDragStart={(e) => e.preventDefault()}
      onClick={(e) => e.stopPropagation()}
      onPointerDown={(e) => startDrag(e, 'move')}
      onMouseDown={(e) => startDrag(e, 'move')}
    >
      {/* left accent bar — track color */}
      <div className="absolute left-0 top-0 bottom-0 w-0.5" style={{ backgroundColor: isSelected ? '#34d399' : trackColor }} />

      {/* Trim-left */}
      <div
        className="absolute left-0 top-0 z-10 h-full w-4 cursor-ew-resize hover:bg-white/10 flex items-center justify-center"
        onPointerDown={(event) => { event.stopPropagation(); startDrag(event, 'trim-left'); }}
        onMouseDown={(event) => { event.stopPropagation(); startDrag(event, 'trim-left'); }}
      >
        <div className="h-5 w-0.5 rounded bg-white/30" />
      </div>

      <div className="pointer-events-none flex h-full flex-col justify-center px-5">
        <div className="truncate font-medium text-white/90 text-[11px] leading-tight">{clip.name}</div>
        <div className="truncate text-[10px] text-slate-400/80 mt-0.5">{formatTimecode(clip.duration_ms)}</div>
      </div>

      {/* Delete on hover */}
      <button
        className="absolute right-0 top-0 z-20 flex h-5 w-5 items-center justify-center rounded-bl bg-red-600 opacity-0 group-hover:opacity-100 hover:bg-red-500 transition-all duration-150"
        onPointerDown={(e) => e.stopPropagation()}
        onMouseDown={(e) => e.stopPropagation()}
        onClick={(e) => { e.stopPropagation(); deleteClips([clip.id]); }}
        title="Delete (Del)"
      >
        <X className="h-2.5 w-2.5" />
      </button>

      {/* Trim-right */}
      <div
        className="absolute right-0 top-0 z-10 h-full w-4 cursor-ew-resize hover:bg-white/10 flex items-center justify-center"
        onPointerDown={(event) => { event.stopPropagation(); startDrag(event, 'trim-right'); }}
        onMouseDown={(event) => { event.stopPropagation(); startDrag(event, 'trim-right'); }}
      >
        <div className="h-5 w-0.5 rounded bg-white/30" />
      </div>
    </div>
  );
}
