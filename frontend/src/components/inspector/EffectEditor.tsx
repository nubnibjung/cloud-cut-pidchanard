import { Contrast, Droplet, Plus, Sun, Trash2, Undo2, Waves } from 'lucide-react';
import { useProjectStore } from '../../state/projectStore';
import type { Clip, ClipEffect } from '../../types';
import { IconButton } from '../ui/Button';
import { Slider } from '../ui/Input';
import { ScrubField } from '../ui/ScrubField';
import { InspectorSection } from './InspectorPanel';

const EMPTY_EFFECTS: ClipEffect[] = [];

type EffectType = ClipEffect['type'];

const EFFECTS: Record<EffectType, {
  label: string;
  icon: typeof Sun;
  min: number;
  max: number;
  step: number;
  defaultValue: number;
  /** How the value is shown: brightness 1.0 reads as 100%. */
  factor: number;
  unit: string;
  decimals: number;
}> = {
  brightness: { label: 'Brightness', icon: Sun,      min: 0, max: 3,  step: 0.01, defaultValue: 1, factor: 100, unit: '%',  decimals: 0 },
  contrast:   { label: 'Contrast',   icon: Contrast, min: 0, max: 3,  step: 0.01, defaultValue: 1, factor: 100, unit: '%',  decimals: 0 },
  saturation: { label: 'Saturation', icon: Droplet,  min: 0, max: 3,  step: 0.01, defaultValue: 1, factor: 100, unit: '%',  decimals: 0 },
  blur:       { label: 'Blur',       icon: Waves,    min: 0, max: 20, step: 0.5,  defaultValue: 0, factor: 1,   unit: 'px', decimals: 1 },
};

const ORDER: EffectType[] = ['brightness', 'contrast', 'saturation', 'blur'];

export function EffectEditor({ clip }: { clip: Clip }) {
  const effects = useProjectStore((state) => state.effects[clip.id] ?? EMPTY_EFFECTS);
  const addEffect = useProjectStore((state) => state.addEffect);
  const updateEffect = useProjectStore((state) => state.updateEffect);
  const deleteEffect = useProjectStore((state) => state.deleteEffect);

  // Each adjustment is used once per clip, so offer only those not added yet
  const used = new Set(effects.map((e) => e.type));
  const available = ORDER.filter((type) => !used.has(type));

  const add = (type: EffectType) => {
    addEffect(clip.id, {
      type,
      order_index: effects.length + 1,
      params: { value: EFFECTS[type].defaultValue },
      enabled: true,
    });
  };

  return (
    <InspectorSection title="Adjust">
      {effects.length > 0 && (
        <ul className="mb-3 grid gap-3">
          {effects.map((effect) => {
            const cfg = EFFECTS[effect.type] ?? EFFECTS.brightness;
            const Icon = cfg.icon;
            const value = effect.params.value;
            const changed = Math.abs(value - cfg.defaultValue) > 1e-9;
            const setValue = (next: number) => updateEffect(clip.id, effect.id, { value: next });
            return (
              <li key={effect.id}>
                <div className="mb-1.5 flex items-center gap-1.5">
                  <Icon aria-hidden className="h-3.5 w-3.5 text-fg-subtle" />
                  <span className="flex-1 text-xs text-fg-muted">{cfg.label}</span>
                  {changed && (
                    <IconButton label={`Reset ${cfg.label.toLowerCase()}`} size="sm" className="h-6 w-6" onClick={() => setValue(cfg.defaultValue)}>
                      <Undo2 aria-hidden className="h-3 w-3" />
                    </IconButton>
                  )}
                  <IconButton
                    label={`Remove ${cfg.label.toLowerCase()}`}
                    size="sm"
                    className="h-6 w-6 hover:bg-danger/15 hover:text-danger"
                    onClick={() => deleteEffect(clip.id, effect.id)}
                  >
                    <Trash2 aria-hidden className="h-3 w-3" />
                  </IconButton>
                </div>
                <div className="flex items-center gap-2">
                  <Slider
                    label={cfg.label}
                    min={cfg.min}
                    max={cfg.max}
                    step={cfg.step}
                    value={value}
                    className="flex-1"
                    onChange={(ev) => setValue(Number(ev.target.value))}
                    onDoubleClick={() => setValue(cfg.defaultValue)}
                    title="Double-click to reset"
                  />
                  <ScrubField
                    label={cfg.label}
                    hideLabel
                    value={value}
                    factor={cfg.factor}
                    step={cfg.factor === 100 ? 1 : cfg.step}
                    min={cfg.min}
                    max={cfg.max}
                    unit={cfg.unit}
                    decimals={cfg.decimals}
                    className="w-[72px]"
                    onChange={setValue}
                  />
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {available.length > 0 ? (
        <div className="grid grid-cols-2 gap-1">
          {available.map((type) => {
            const Icon = EFFECTS[type].icon;
            return (
              <button
                key={type}
                type="button"
                className="flex h-8 items-center gap-1.5 rounded-md border border-dashed border-border-strong px-2 text-xs font-semibold text-fg-muted transition-colors hover:border-accent/60 hover:bg-accent/[0.06] hover:text-fg"
                onClick={() => add(type)}
              >
                <Plus aria-hidden className="h-3 w-3" />
                <Icon aria-hidden className="h-3.5 w-3.5" />
                {EFFECTS[type].label}
              </button>
            );
          })}
        </div>
      ) : (
        <p className="text-2xs text-fg-subtle">All adjustments added.</p>
      )}
    </InspectorSection>
  );
}
