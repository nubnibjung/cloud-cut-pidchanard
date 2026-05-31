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
      className="sticky top-0 z-10 grid h-7 grid-cols-[96px_1fr] border-b border-border bg-[#14171d]"
      style={{ minWidth: 96 + totalWidth }}
    >
      <div className="border-r border-border" />
      <div className="relative text-[10px] text-slate-500 select-none">
        {Array.from({ length: count }, (_, i) => {
          const ms = i * majorStep;
          const x = msToPixels(ms, zoomLevel);
          return (
            <div key={ms} className="absolute top-0 h-full" style={{ left: x }}>
              <div className="absolute top-0 h-2 w-px bg-[#3a4050]" />
              <span className="absolute top-2 ml-1 leading-none">{fmtRuler(ms)}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
