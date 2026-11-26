import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { cn } from '../../utils/cn';

interface ScrubFieldProps {
  label: string;
  /** Value in model units (e.g. scale 1.0). */
  value: number;
  onChange(value: number): void;
  /** Called once a drag or typed edit is finished. */
  onCommit?(): void;
  /** Model value → shown value (e.g. 100 for percentages). */
  factor?: number;
  /** Step in *shown* units, used for arrows and per pixel of drag. */
  step?: number;
  /** Bounds in model units. */
  min?: number;
  max?: number;
  unit?: string;
  decimals?: number;
  /** Hide the visible label (still used as the accessible name). */
  hideLabel?: boolean;
  className?: string;
}

const clamp = (v: number, min = -Infinity, max = Infinity) => Math.min(max, Math.max(min, v));

/**
 * A number you can change three ways: drag left/right on the label, type into the
 * box, or press ↑/↓ (Shift ×10, Alt ×0.1). The same control desktop editors use.
 */
export function ScrubField({
  label, value, onChange, onCommit, factor = 1, step = 1, min, max, unit, decimals = 0, hideLabel, className,
}: ScrubFieldProps) {
  const shown = value * factor;
  const format = (v: number) => (Object.is(Math.round(v * 10 ** decimals) / 10 ** decimals, -0) ? 0 : v).toFixed(decimals);
  const [text, setText] = useState(format(shown));
  const [editing, setEditing] = useState(false);
  const [scrubbing, setScrubbing] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!editing) setText(format(shown));
  }, [shown, editing, decimals]);

  const emit = (nextShown: number) => {
    const rounded = Math.round(nextShown * 10 ** decimals) / 10 ** decimals;
    onChange(clamp(rounded / factor, min, max));
  };

  const commitText = () => {
    setEditing(false);
    const parsed = Number.parseFloat(text.replace(',', '.'));
    if (Number.isFinite(parsed)) emit(parsed);
    else setText(format(shown));
    onCommit?.();
  };

  const startScrub = (event: ReactPointerEvent<HTMLElement>) => {
    if (event.button !== 0) return;
    event.preventDefault();
    const target = event.currentTarget;
    target.setPointerCapture(event.pointerId);
    const startX = event.clientX;
    const startShown = shown;
    let moved = false;
    setScrubbing(true);
    document.body.style.cursor = 'ew-resize';

    const onMove = (move: PointerEvent) => {
      const dx = move.clientX - startX;
      if (!moved && Math.abs(dx) < 2) return;
      moved = true;
      const speed = move.shiftKey ? 10 : move.altKey ? 0.1 : 1;
      emit(startShown + dx * step * speed);
    };
    const onUp = () => {
      target.removeEventListener('pointermove', onMove);
      target.removeEventListener('pointerup', onUp);
      target.removeEventListener('pointercancel', onUp);
      document.body.style.cursor = '';
      setScrubbing(false);
      if (moved) onCommit?.();
      else inputRef.current?.focus(); // a plain click on the label edits the number
    };
    target.addEventListener('pointermove', onMove);
    target.addEventListener('pointerup', onUp);
    target.addEventListener('pointercancel', onUp);
  };

  return (
    <div
      className={cn(
        'group/scrub flex h-7 min-w-0 items-center rounded-md border bg-canvas transition-colors',
        scrubbing || editing ? 'border-accent' : 'border-border hover:border-border-strong',
        className,
      )}
    >
      <span
        aria-hidden
        title="Drag to change · Shift for bigger steps"
        className={cn(
          'flex h-full shrink-0 cursor-ew-resize select-none items-center pl-2 pr-1 text-2xs font-medium transition-colors',
          scrubbing ? 'text-accent' : 'text-fg-subtle group-hover/scrub:text-fg-muted',
          hideLabel && 'sr-only',
        )}
        onPointerDown={startScrub}
      >
        {label}
      </span>
      <input
        ref={inputRef}
        inputMode="decimal"
        aria-label={label}
        className="h-full min-w-0 flex-1 bg-transparent pr-1 text-right text-xs tabular-nums text-fg outline-none"
        value={text}
        onFocus={(e) => { setEditing(true); e.currentTarget.select(); }}
        onChange={(e) => setText(e.target.value)}
        onBlur={commitText}
        onKeyDown={(e) => {
          if (e.key === 'Enter') e.currentTarget.blur();
          else if (e.key === 'Escape') { setText(format(shown)); setEditing(false); e.currentTarget.blur(); }
          else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
            e.preventDefault();
            const speed = e.shiftKey ? 10 : e.altKey ? 0.1 : 1;
            const next = shown + (e.key === 'ArrowUp' ? 1 : -1) * step * speed;
            emit(next);
            setText(format(clamp(next / factor, min, max) * factor));
          }
        }}
        onKeyUp={(e) => { if (e.key === 'ArrowUp' || e.key === 'ArrowDown') onCommit?.(); }}
      />
      {unit && <span aria-hidden className="shrink-0 pr-2 text-2xs text-fg-subtle">{unit}</span>}
    </div>
  );
}
