import type { Clip } from '../../types';
import { formatTimecode } from '../../utils/timecode';

export function ClipInfo({ clip }: { clip: Clip }) {
  return (
    <section className="rounded border border-border bg-surface p-3">
      <h2 className="mb-3 text-sm font-semibold">Clip</h2>
      <div className="grid gap-2 text-xs text-slate-300">
        <label>Name <input className="mt-1 w-full rounded border border-border bg-[#111318] px-2 py-1 text-white" defaultValue={clip.name} /></label>
        <div>Duration {formatTimecode(clip.duration_ms)}</div>
        <div>In {formatTimecode(clip.in_point_ms)}</div>
        <div>Out {formatTimecode(clip.out_point_ms)}</div>
      </div>
    </section>
  );
}
