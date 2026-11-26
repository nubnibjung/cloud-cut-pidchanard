import { useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { useProjectStore } from '../../state/projectStore';
import type { Clip } from '../../types';

export interface MediaSize { width: number; height: number }
export interface CanvasSize { width: number; height: number }

/** Where a clip's picture sits on the preview canvas, in canvas pixels (before rotation). */
export function contentBox(clip: Clip, media: MediaSize | undefined, canvas: CanvasSize, canvasScale: number) {
  const aspect = media && media.width > 0 && media.height > 0 ? media.width / media.height : 16 / 9;
  // Layers are drawn with object-fit: contain inside the whole canvas
  const fitW = aspect > canvas.width / canvas.height ? canvas.width : canvas.height * aspect;
  const fitH = fitW / aspect;
  const { x, y, scale, rotation } = clip.transform;
  return {
    cx: canvas.width / 2 + x * canvasScale,
    cy: canvas.height / 2 + y * canvasScale,
    width: fitW * scale,
    height: fitH * scale,
    rotation,
  };
}

/** Whether a canvas point falls inside a clip's (possibly rotated) picture. */
export function hitsClip(px: number, py: number, box: ReturnType<typeof contentBox>): boolean {
  const rad = (-box.rotation * Math.PI) / 180;
  const dx = px - box.cx;
  const dy = py - box.cy;
  const lx = dx * Math.cos(rad) - dy * Math.sin(rad);
  const ly = dx * Math.sin(rad) + dy * Math.cos(rad);
  return Math.abs(lx) <= box.width / 2 && Math.abs(ly) <= box.height / 2;
}

const SNAP_PX = 6;
const CORNERS = [
  { key: 'nw', className: '-left-1.5 -top-1.5 cursor-nwse-resize' },
  { key: 'ne', className: '-right-1.5 -top-1.5 cursor-nesw-resize' },
  { key: 'sw', className: '-bottom-1.5 -left-1.5 cursor-nesw-resize' },
  { key: 'se', className: '-bottom-1.5 -right-1.5 cursor-nwse-resize' },
] as const;

type Mode = 'move' | 'scale' | 'rotate';

interface Props {
  clip: Clip;
  media: MediaSize | undefined;
  canvas: CanvasSize;
  canvasScale: number;
  canvasEl: HTMLDivElement | null;
  /** Lets the canvas start a move right after it selects a clip. */
  startRef?: React.MutableRefObject<((e: PointerEvent) => void) | null>;
}

/**
 * Selection frame drawn over the selected clip in the preview: drag inside to move,
 * pull a corner to scale, use the top handle to rotate. Snaps to the centre lines,
 * and rotation snaps to 15° steps while Shift is held.
 */
export function TransformOverlay({ clip, media, canvas, canvasScale, canvasEl, startRef }: Props) {
  const updateClipTransform = useProjectStore((s) => s.updateClipTransform);
  const commitClipTransform = useProjectStore((s) => s.commitClipTransform);
  const [guides, setGuides] = useState<{ v: boolean; h: boolean }>({ v: false, h: false });
  const [readout, setReadout] = useState<string | null>(null);
  const box = contentBox(clip, media, canvas, canvasScale);
  const boxRef = useRef(box);
  boxRef.current = box;
  // The preview clips its edges, so the rotate handle needs ~40px above the frame
  const roomAbove = box.cy - box.height / 2 > 40;

  const toCanvas = (e: PointerEvent) => {
    const rect = canvasEl?.getBoundingClientRect();
    return { x: e.clientX - (rect?.left ?? 0), y: e.clientY - (rect?.top ?? 0) };
  };

  const begin = (mode: Mode, down: PointerEvent, target: Element) => {
    if (!canvasEl || canvasScale <= 0) return;
    const start = toCanvas(down);
    const startT = { ...clip.transform };
    const startBox = { ...boxRef.current };
    const startDist = Math.hypot(start.x - startBox.cx, start.y - startBox.cy) || 1;
    const startAngle = Math.atan2(start.y - startBox.cy, start.x - startBox.cx);
    (target as HTMLElement).setPointerCapture?.(down.pointerId);
    document.body.style.userSelect = 'none';

    const onMove = (move: PointerEvent) => {
      // The button was released without us seeing pointerup (e.g. a quick click
      // that ended before this drag was wired up) — stop, don't follow a free mouse
      if (move.pointerType === 'mouse' && (move.buttons & 1) === 0) { onUp(); return; }
      const p = toCanvas(move);
      if (mode === 'move') {
        let dx = p.x - start.x;
        let dy = p.y - start.y;
        if (move.shiftKey) { if (Math.abs(dx) > Math.abs(dy)) dy = 0; else dx = 0; } // lock to one axis
        let x = startT.x + dx / canvasScale;
        let y = startT.y + dy / canvasScale;
        const snapV = Math.abs(x * canvasScale) < SNAP_PX;
        const snapH = Math.abs(y * canvasScale) < SNAP_PX;
        if (snapV) x = 0;
        if (snapH) y = 0;
        setGuides({ v: snapV, h: snapH });
        x = Math.round(x);
        y = Math.round(y);
        setReadout(`X ${x}  Y ${y}`);
        updateClipTransform(clip.id, { ...startT, x, y });
      } else if (mode === 'scale') {
        const dist = Math.hypot(p.x - startBox.cx, p.y - startBox.cy);
        let scale = Math.min(10, Math.max(0.05, startT.scale * (dist / startDist)));
        if (Math.abs(scale - 1) < 0.03) scale = 1; // snap back to the original size
        scale = Math.round(scale * 100) / 100;
        setReadout(`${Math.round(scale * 100)}%`);
        updateClipTransform(clip.id, { ...startT, scale });
      } else {
        const angle = Math.atan2(p.y - startBox.cy, p.x - startBox.cx);
        let rotation = startT.rotation + ((angle - startAngle) * 180) / Math.PI;
        rotation = ((((rotation + 180) % 360) + 360) % 360) - 180;
        if (move.shiftKey) rotation = Math.round(rotation / 15) * 15;
        else {
          const nearest = Math.round(rotation / 90) * 90;
          if (Math.abs(rotation - nearest) < 3) rotation = nearest; // snap to square angles
        }
        rotation = Math.round(rotation);
        if (rotation === -180) rotation = 180;
        setReadout(`${rotation}°`);
        updateClipTransform(clip.id, { ...startT, rotation });
      }
    };
    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
      document.body.style.userSelect = '';
      setGuides({ v: false, h: false });
      setReadout(null);
      commitClipTransform(clip.id);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
  };

  if (startRef) startRef.current = (e) => begin('move', e, canvasEl as Element);

  const handle = (mode: Mode) => (e: ReactPointerEvent) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    begin(mode, e.nativeEvent, e.currentTarget);
  };

  return (
    <div className="pointer-events-none absolute inset-0 z-10">
      {guides.v && <div className="absolute bottom-0 top-0 w-px bg-fuchsia-400/80" style={{ left: canvas.width / 2 }} />}
      {guides.h && <div className="absolute left-0 right-0 h-px bg-fuchsia-400/80" style={{ top: canvas.height / 2 }} />}

      <div
        className="pointer-events-auto absolute cursor-move touch-none outline outline-1 outline-accent"
        style={{
          left: box.cx - box.width / 2,
          top: box.cy - box.height / 2,
          width: box.width,
          height: box.height,
          transform: `rotate(${box.rotation}deg)`,
        }}
        onPointerDown={handle('move')}
        onClick={(e) => e.stopPropagation()}
      >
        {CORNERS.map((corner) => (
          <div
            key={corner.key}
            aria-hidden
            className={`absolute h-3 w-3 touch-none rounded-sm border border-accent bg-white shadow ${corner.className}`}
            onPointerDown={handle('scale')}
          />
        ))}
        {/* Rotate handle — above the frame, or tucked inside when the clip fills the preview */}
        <div className={`absolute left-1/2 h-6 w-px -translate-x-1/2 bg-accent ${roomAbove ? '-top-7' : 'top-0'}`} />
        <div
          aria-hidden
          title="Drag to rotate · Shift snaps to 15°"
          className={`absolute left-1/2 h-3.5 w-3.5 -translate-x-1/2 cursor-grab touch-none rounded-full border border-accent bg-white shadow active:cursor-grabbing ${roomAbove ? '-top-9' : 'top-6'}`}
          onPointerDown={handle('rotate')}
        />
      </div>

      {readout && (
        <div
          className="absolute rounded bg-black/75 px-1.5 py-0.5 text-2xs tabular-nums text-white"
          style={{ left: box.cx, top: Math.min(canvas.height - 20, box.cy + box.height / 2 + 10), transform: 'translateX(-50%)' }}
        >
          {readout}
        </div>
      )}
    </div>
  );
}
