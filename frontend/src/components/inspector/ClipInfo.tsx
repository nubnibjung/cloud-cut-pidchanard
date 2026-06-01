import { useEffect, useState } from 'react';
import { useProjectStore } from '../../state/projectStore';
import type { Clip } from '../../types';
import { formatTimecode } from '../../utils/timecode';

export function ClipInfo({ clip }: { clip: Clip }) {
  const updateClip = useProjectStore((s) => s.updateClip);
  const [name, setName] = useState(clip.name);

  // Sync when a different clip is selected
  useEffect(() => { setName(clip.name); }, [clip.id, clip.name]);

  const commit = () => {
    const trimmed = name.trim();
    if (trimmed && trimmed !== clip.name) updateClip(clip.id, { name: trimmed });
    else setName(clip.name);
  };

  return (
    <section className="rounded border border-border bg-surface p-3">
      <h2 className="mb-3 text-sm font-semibold">Clip</h2>
      <div className="grid gap-2 text-xs text-slate-300">
        <label className="flex flex-col gap-1">
          <span>Name</span>
          <input
            className="rounded border border-border bg-[#111318] px-2 py-1 text-white focus:border-accent focus:outline-none"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onBlur={commit}
            onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); if (e.key === 'Escape') { setName(clip.name); e.currentTarget.blur(); } }}
          />
        </label>
        <div>Duration <span className="tabular-nums">{formatTimecode(clip.duration_ms)}</span></div>
        <div>In <span className="tabular-nums">{formatTimecode(clip.in_point_ms)}</span></div>
        <div>Out <span className="tabular-nums">{formatTimecode(clip.out_point_ms)}</span></div>
      </div>
    </section>
  );
}
