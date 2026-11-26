import { useUIStore } from '../../state/uiStore';
import { msToPixels } from '../../utils/timecode';

function fmtRuler(ms: number): string {
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  const sec = s % 60;
  return m > 0 ? `${m}:${sec.toString().padStart(2, '0')}` : `${sec}s`;
}

export function TimelineRuler({ durationMs }: { durationMs: number }) {
  const zoomLevel = useUIStore((s) => s.zoomLevel);

  // Pick a sensible major tick interval based on zoom
  const majorStep =
    zoomLevel >= 40 ? 1000 :
    zoomLevel >= 20 ? 2000 :
    zoomLevel >= 10 ? 5000 :
    zoomLevel >= 4  ? 10000 : 30000;

  const count = Math.ceil(durationMs / majorStep) + 2;
  const totalWidth = msToPixels(durationMs + majorStep, zoomLevel);

  return (
    <div
      className="sticky top-0 z-10 grid h-7 grid-cols-[120px_1fr] border-b border-border bg-panel"
      style={{ minWidth: 120 + totalWidth }}
      aria-hidden
    >
      <div className="sticky left-0 z-[5] border-r border-border bg-panel" />
      <div className="relative select-none text-2xs tabular-nums text-fg-subtle">
        {Array.from({ length: count }, (_, i) => {
          const ms = i * majorStep;
          const x = msToPixels(ms, zoomLevel);
          return (
            <div key={ms} className="absolute top-0 h-full" style={{ left: x }}>
              <div className="absolute top-0 h-2 w-px bg-border-strong" />
              <span className="absolute top-2 ml-1 leading-none">{fmtRuler(ms)}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
