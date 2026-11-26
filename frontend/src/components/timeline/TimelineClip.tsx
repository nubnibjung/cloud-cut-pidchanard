import { useRef, useState } from 'react';
import { X } from 'lucide-react';
import { useProjectStore } from '../../state/projectStore';
import { usePlaybackStore } from '../../state/playbackStore';
import { useUIStore } from '../../state/uiStore';
import type { Clip } from '../../types';
import { resolveOverlap, snapTime, trimLimits } from '../../utils/geometry';
import { formatTimecode, msToPixels, pixelsToMs } from '../../utils/timecode';

interface Props { clip: Clip; trackColor?: string; trackMuted?: boolean }
type Mode = 'move' | 'trim-left' | 'trim-right';
type StartDragEvent = React.PointerEvent | React.MouseEvent;

export function TimelineClip({ clip, trackColor = '#4a90d9', trackMuted }: Props) {
  // Narrow subscriptions: a clip re-renders when *it* changes, not on every playhead frame
  const deleteClips = useProjectStore((s) => s.deleteClips);
  const updateClip = useProjectStore((s) => s.updateClip);
  const isSelected = useUIStore((s) => s.selectedClipIds.includes(clip.id));
  const selectClip = useUIStore((s) => s.selectClip);
  const zoomLevel = useUIStore((s) => s.zoomLevel);

  const elRef   = useRef<HTMLDivElement>(null);
  const draggingRef = useRef(false);
  const [active, setActive] = useState(false);   // only for cursor class

  /* always-fresh values — read from the stores at drag time so they never go stale */
  const clipsRef = { get current() { return useProjectStore.getState().clips; } };
  const snapRef  = { get current() { return useUIStore.getState().snapEnabled; } };
  const timeRef  = { get current() { return usePlaybackStore.getState().currentTimeMs; } };
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

    /* a trim may grow the clip only up to its neighbours on the same track */
    const { minStartMs, maxEndMs } = trimLimits(clip, clipsRef.current);
    const minIn  = Math.max(0, baseIn - (basePos - minStartMs));
    const maxOut = baseIn + (maxEndMs - basePos);

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
        const newIn  = Math.max(minIn, Math.min(baseIn + dxMs, baseOut - 500));
        const newPos = basePos + (newIn - baseIn);
        const newDur = baseOut - newIn;
        
        const visualDx = msToPixels(Math.max(0, newPos), z) - left;
        el.style.transform = `translateX(${visualDx}px)`;
        el.style.width = `${Math.max(16, msToPixels(newDur, z))}px`;

      } else {
        const newOut = Math.min(maxOut, Math.max(baseIn + 500, baseOut + dxMs));
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

      /* Put back exactly what React last rendered. Clearing these instead would
         leave the clip with no left/width at all whenever the new value happens to
         equal the old one, because React only writes style values that changed. */
      el.style.left  = `${left}px`;
      el.style.width = `${width}px`;
      el.style.transform = '';
      el.style.zIndex = '';
      el.style.opacity = '';

      const dxMs = pixelsToMs(up.clientX - startX, z);

      if (mode === 'move') {
        const raw = Math.max(0, basePos + dxMs);
        const { timeMs } = snapRef.current
          ? snapTime(raw, clipsRef.current.filter((c) => c.id !== clip.id), timeRef.current)
          : { timeMs: raw };
        
        // Never drop a clip on top of another: slide it to the nearest free gap,
        // or leave it where it was if the track has no room near the drop point.
        const targetTrack = newTrack ?? clip.track_id;
        const freeMs = resolveOverlap(
          timeMs,
          clip.duration_ms,
          clipsRef.current.filter((c) => c.id !== clip.id && c.track_id === targetTrack),
        );
        if (freeMs === null) return;

        updateClip(clip.id, {
          track_position_ms: freeMs,
          ...(targetTrack !== clip.track_id ? { track_id: targetTrack } : {}),
        });

      } else if (mode === 'trim-left') {
        const newIn  = Math.max(minIn, Math.min(baseIn + dxMs, baseOut - 500));
        const newPos = Math.max(0, basePos + (newIn - baseIn));
        
        updateClip(clip.id, {
          in_point_ms: newIn,
          out_point_ms: baseOut,
          track_position_ms: newPos,
        });

      } else {
        const newOut = Math.min(maxOut, Math.max(baseIn + 500, baseOut + dxMs));
        
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
        'group absolute top-1 h-14 select-none touch-none rounded-md border text-xs overflow-hidden',
        isSelected
          ? 'border-accent bg-clip-selected ring-2 ring-accent/40 z-10'
          : 'border-clip-border bg-clip hover:border-border-strong hover:bg-clip-hover',
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
      <div className={isSelected ? 'absolute bottom-0 left-0 top-0 w-0.5 bg-accent' : 'absolute bottom-0 left-0 top-0 w-0.5'} style={isSelected ? undefined : { backgroundColor: trackColor }} />

      {/* Trim-left */}
      <div
        className="absolute left-0 top-0 z-10 h-full w-4 cursor-ew-resize hover:bg-ink/10 flex items-center justify-center"
        onPointerDown={(event) => { event.stopPropagation(); startDrag(event, 'trim-left'); }}
        onMouseDown={(event) => { event.stopPropagation(); startDrag(event, 'trim-left'); }}
      >
        <div className="h-5 w-0.5 rounded bg-ink/40" />
      </div>

      <div className="pointer-events-none flex h-full flex-col justify-center px-5">
        <div className="truncate text-2xs font-medium leading-tight text-fg">{clip.name}</div>
        <div className="mt-0.5 truncate text-2xs tabular-nums text-fg-muted">{formatTimecode(clip.duration_ms)}</div>
      </div>

      {/* Delete — shown on hover and on keyboard focus; undoable with Ctrl+Z */}
      <button
        type="button"
        aria-label={`Delete clip ${clip.name}`}
        className="absolute right-0 top-0 z-20 flex h-5 w-5 items-center justify-center rounded-bl-md bg-danger-solid text-white opacity-0 transition-opacity duration-150 hover:bg-red-500 focus-visible:opacity-100 group-hover:opacity-100"
        onPointerDown={(e) => e.stopPropagation()}
        onMouseDown={(e) => e.stopPropagation()}
        onClick={(e) => { e.stopPropagation(); deleteClips([clip.id]); }}
        title="Delete (Del)"
      >
        <X aria-hidden className="h-3 w-3" />
      </button>

      {/* Trim-right */}
      <div
        className="absolute right-0 top-0 z-10 h-full w-4 cursor-ew-resize hover:bg-ink/10 flex items-center justify-center"
        onPointerDown={(event) => { event.stopPropagation(); startDrag(event, 'trim-right'); }}
        onMouseDown={(event) => { event.stopPropagation(); startDrag(event, 'trim-right'); }}
      >
        <div className="h-5 w-0.5 rounded bg-ink/30" />
      </div>
    </div>
  );
}
