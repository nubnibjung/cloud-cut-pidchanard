import { Plus, Trash2 } from 'lucide-react';
import { useProjectStore } from '../../state/projectStore';
import type { Clip, ClipEffect } from '../../types';

const EMPTY_EFFECTS: ClipEffect[] = [];

const EFFECT_TYPES = ['brightness', 'contrast', 'saturation', 'blur'] as const;
type EffectType = typeof EFFECT_TYPES[number];

const EFFECT_CONFIG: Record<EffectType, { min: number; max: number; step: number; defaultValue: number; unit?: string }> = {
  brightness:  { min: 0,   max: 3,   step: 0.05, defaultValue: 1 },
  contrast:    { min: 0,   max: 3,   step: 0.05, defaultValue: 1 },
  saturation:  { min: 0,   max: 3,   step: 0.05, defaultValue: 1 },
  blur:        { min: 0,   max: 20,  step: 0.5,  defaultValue: 0, unit: 'px' },
};

export function EffectEditor({ clip }: { clip: Clip }) {
  const effects = useProjectStore((state) => state.effects[clip.id] ?? EMPTY_EFFECTS);
  const addEffect = useProjectStore((state) => state.addEffect);
  const updateEffect = useProjectStore((state) => state.updateEffect);
  const deleteEffect = useProjectStore((state) => state.deleteEffect);

  const handleAdd = () => {
    addEffect(clip.id, {
      type: 'brightness',
      order_index: effects.length + 1,
      params: { value: EFFECT_CONFIG.brightness.defaultValue },
      enabled: true,
    });
  };

  const handleTypeChange = (effectId: string, newType: EffectType) => {
    updateEffect(clip.id, effectId, { value: EFFECT_CONFIG[newType].defaultValue });
    // update type by re-creating via store internals — simplest: delete + add would reset order
    // Instead patch directly on the effect object in the store
    useProjectStore.setState((state) => ({
      effects: {
        ...state.effects,
        [clip.id]: (state.effects[clip.id] ?? []).map((e) =>
          e.id === effectId ? { ...e, type: newType, params: { value: EFFECT_CONFIG[newType].defaultValue } } : e
        ),
      },
    }));
  };

  return (
    <section className="rounded border border-border bg-surface p-3">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-sm font-semibold">Effects</h2>
        <button
          className="rounded border border-border p-1.5 hover:bg-white/5"
          title="Add effect"
          onClick={handleAdd}
        >
          <Plus className="h-4 w-4" />
        </button>
      </div>
      <div className="grid gap-3">
        {effects.length === 0 && (
          <p className="text-[11px] text-slate-500">No effects. Click + to add one.</p>
        )}
        {effects.map((effect) => {
          const type = effect.type as EffectType;
          const cfg = EFFECT_CONFIG[type] ?? EFFECT_CONFIG.brightness;
          return (
            <div key={effect.id} className="rounded border border-border p-2">
              <div className="mb-2 flex items-center justify-between gap-2">
                <select
                  className="flex-1 rounded border border-border bg-[#111318] px-1.5 py-0.5 text-xs text-white"
                  value={type}
                  onChange={(e) => handleTypeChange(effect.id, e.target.value as EffectType)}
                >
                  {EFFECT_TYPES.map((t) => (
                    <option key={t} value={t}>{t.charAt(0).toUpperCase() + t.slice(1)}</option>
                  ))}
                </select>
                <button
                  className="rounded p-1 text-slate-400 hover:bg-red-900/30 hover:text-red-400"
                  title="Remove effect"
                  onClick={() => deleteEffect(clip.id, effect.id)}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
              <div className="flex items-center gap-2">
                <input
                  type="range"
                  min={cfg.min}
                  max={cfg.max}
                  step={cfg.step}
                  value={effect.params.value}
                  className="min-w-0 flex-1 accent-accent"
                  onChange={(ev) => updateEffect(clip.id, effect.id, { value: Number(ev.target.value) })}
                />
                <span className="w-12 text-right text-[10px] tabular-nums text-slate-400">
                  {effect.params.value.toFixed(type === 'blur' ? 1 : 2)}{cfg.unit ?? ''}
                </span>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
