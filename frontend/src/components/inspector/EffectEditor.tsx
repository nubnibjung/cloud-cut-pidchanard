import { Plus, Trash2 } from 'lucide-react';
import { useProjectStore } from '../../state/projectStore';
import type { Clip } from '../../types';

export function EffectEditor({ clip }: { clip: Clip }) {
  const effects = useProjectStore((state) => state.effects[clip.id] ?? []);
  const addEffect = useProjectStore((state) => state.addEffect);
  const updateEffect = useProjectStore((state) => state.updateEffect);
  return (
    <section className="rounded border border-border bg-surface p-3">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-sm font-semibold">Effects</h2>
        <button className="rounded border border-border p-1.5" onClick={() => addEffect(clip.id, { type: 'brightness', order_index: effects.length + 1, params: { value: 1 }, enabled: true })}><Plus className="h-4 w-4" /></button>
      </div>
      <div className="grid gap-3">
        {effects.map((effect) => (
          <div key={effect.id} className="rounded border border-border p-2">
            <div className="mb-2 flex items-center justify-between text-xs">
              <span>{effect.type}</span>
              <Trash2 className="h-3.5 w-3.5 text-slate-400" />
            </div>
            <input type="range" min={effect.type === 'blur' ? 0 : 0.2} max={effect.type === 'blur' ? 12 : 2} step={0.05} value={effect.params.value} onChange={(event) => updateEffect(clip.id, effect.id, { value: Number(event.target.value) })} />
          </div>
        ))}
      </div>
    </section>
  );
}
