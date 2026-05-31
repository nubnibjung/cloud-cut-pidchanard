import { useProjectStore } from '../../state/projectStore';
import type { Clip } from '../../types';

const FIELDS: { key: keyof Clip['transform']; label: string; min: number; max: number; step: number }[] = [
  { key: 'x', label: 'X', min: -1920, max: 1920, step: 1 },
  { key: 'y', label: 'Y', min: -1080, max: 1080, step: 1 },
  { key: 'scale', label: 'Scale', min: 0.01, max: 4, step: 0.01 },
  { key: 'rotation', label: 'Rotation', min: -360, max: 360, step: 1 },
  { key: 'opacity', label: 'Opacity', min: 0, max: 1, step: 0.01 },
];

export function TransformEditor({ clip }: { clip: Clip }) {
  const updateClipTransform = useProjectStore((state) => state.updateClipTransform);

  return (
    <section className="rounded border border-border bg-surface p-3">
      <h2 className="mb-3 text-sm font-semibold">Transform</h2>
      <div className="grid gap-2 text-xs">
        {FIELDS.map(({ key, label, min, max, step }) => (
          <div key={key} className="grid grid-cols-[64px_1fr_48px] items-center gap-2">
            <span className="text-slate-400">{label}</span>
            <input
              type="range"
              min={min}
              max={max}
              step={step}
              value={clip.transform[key]}
              className="accent-accent"
              onChange={(e) => updateClipTransform(clip.id, { ...clip.transform, [key]: Number(e.target.value) })}
            />
            <input
              type="number"
              min={min}
              max={max}
              step={step}
              value={clip.transform[key]}
              className="rounded border border-border bg-[#111318] px-1.5 py-1 text-right tabular-nums"
              onChange={(e) => updateClipTransform(clip.id, { ...clip.transform, [key]: Number(e.target.value) })}
            />
          </div>
        ))}
      </div>
    </section>
  );
}
