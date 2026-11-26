import { Crosshair, Maximize, RotateCcw, RotateCw, Undo2 } from 'lucide-react';
import type { ReactNode } from 'react';
import { DEFAULT_TRANSFORM, useProjectStore } from '../../state/projectStore';
import type { Clip } from '../../types';
import { IconButton } from '../ui/Button';
import { Slider } from '../ui/Input';
import { ScrubField } from '../ui/ScrubField';
import { InspectorSection } from './InspectorPanel';

type Transform = Clip['transform'];

/** Normalises any angle to the -180…180 range. */
const wrapAngle = (deg: number) => ((((deg + 180) % 360) + 360) % 360) - 180;

function Row({ label, onReset, changed, children }: { label: string; onReset(): void; changed: boolean; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[64px_1fr_24px] items-center gap-2">
      <span className="text-xs text-fg-muted">{label}</span>
      <div className="flex min-w-0 items-center gap-2">{children}</div>
      <IconButton
        label={`Reset ${label.toLowerCase()}`}
        size="sm"
        className={changed ? 'h-6 w-6' : 'pointer-events-none h-6 w-6 opacity-0'}
        tabIndex={changed ? 0 : -1}
        onClick={onReset}
      >
        <Undo2 aria-hidden className="h-3 w-3" />
      </IconButton>
    </div>
  );
}

export function TransformEditor({ clip }: { clip: Clip }) {
  const updateClipTransform = useProjectStore((state) => state.updateClipTransform);
  const commitClipTransform = useProjectStore((state) => state.commitClipTransform);
  const t = clip.transform;

  const set = (patch: Partial<Transform>) => updateClipTransform(clip.id, { ...t, ...patch });
  // One-off actions are saved at once instead of waiting for the settle timer
  const apply = (patch: Partial<Transform>) => {
    updateClipTransform(clip.id, { ...t, ...patch });
    commitClipTransform(clip.id);
  };
  const commit = () => commitClipTransform(clip.id);

  const isDefault = (Object.keys(DEFAULT_TRANSFORM) as (keyof Transform)[]).every((key) => t[key] === DEFAULT_TRANSFORM[key]);

  return (
    <InspectorSection
      title="Transform"
      action={
        !isDefault && (
          <button
            type="button"
            className="rounded px-1.5 py-0.5 text-2xs font-semibold text-fg-muted hover:bg-ink/10 hover:text-fg"
            onClick={() => apply(DEFAULT_TRANSFORM)}
          >
            Reset all
          </button>
        )
      }
    >
      {/* Quick actions — the things people reach for most */}
      <div className="mb-3 grid grid-cols-4 gap-1">
        {[
          { label: 'Center', icon: <Crosshair aria-hidden className="h-3.5 w-3.5" />, onClick: () => apply({ x: 0, y: 0 }) },
          { label: 'Fit', icon: <Maximize aria-hidden className="h-3.5 w-3.5" />, onClick: () => apply({ x: 0, y: 0, scale: 1 }) },
          { label: '−90°', icon: <RotateCcw aria-hidden className="h-3.5 w-3.5" />, onClick: () => apply({ rotation: wrapAngle(t.rotation - 90) }) },
          { label: '+90°', icon: <RotateCw aria-hidden className="h-3.5 w-3.5" />, onClick: () => apply({ rotation: wrapAngle(t.rotation + 90) }) },
        ].map((action) => (
          <button
            key={action.label}
            type="button"
            className="flex h-12 flex-col items-center justify-center gap-1 rounded-md bg-ink/[0.04] text-2xs font-semibold text-fg-muted transition-colors hover:bg-ink/[0.08] hover:text-fg"
            onClick={action.onClick}
          >
            {action.icon}
            {action.label}
          </button>
        ))}
      </div>

      <div className="grid gap-2.5">
        <Row label="Position" changed={t.x !== 0 || t.y !== 0} onReset={() => apply({ x: 0, y: 0 })}>
          <ScrubField label="X" value={t.x} min={-3840} max={3840} unit="px" className="flex-1" onChange={(x) => set({ x })} onCommit={commit} />
          <ScrubField label="Y" value={t.y} min={-2160} max={2160} unit="px" className="flex-1" onChange={(y) => set({ y })} onCommit={commit} />
        </Row>

        <Row label="Scale" changed={t.scale !== 1} onReset={() => apply({ scale: 1 })}>
          <Slider
            label="Scale"
            min={0.1}
            max={4}
            step={0.01}
            value={t.scale}
            className="flex-1"
            onChange={(e) => set({ scale: Number(e.target.value) })}
            onPointerUp={commit}
            onKeyUp={commit}
          />
          <ScrubField label="Scale" hideLabel value={t.scale} factor={100} min={0.01} max={10} unit="%" className="w-[72px]" onChange={(scale) => set({ scale })} onCommit={commit} />
        </Row>

        <Row label="Rotation" changed={t.rotation !== 0} onReset={() => apply({ rotation: 0 })}>
          <Slider
            label="Rotation"
            min={-180}
            max={180}
            step={1}
            value={wrapAngle(t.rotation)}
            className="flex-1"
            onChange={(e) => set({ rotation: Number(e.target.value) })}
            onPointerUp={commit}
            onKeyUp={commit}
          />
          <ScrubField label="Rotation" hideLabel value={t.rotation} min={-360} max={360} unit="°" className="w-[72px]" onChange={(rotation) => set({ rotation })} onCommit={commit} />
        </Row>

        <Row label="Opacity" changed={t.opacity !== 1} onReset={() => apply({ opacity: 1 })}>
          <Slider
            label="Opacity"
            min={0}
            max={1}
            step={0.01}
            value={t.opacity}
            className="flex-1"
            onChange={(e) => set({ opacity: Number(e.target.value) })}
            onPointerUp={commit}
            onKeyUp={commit}
          />
          <ScrubField label="Opacity" hideLabel value={t.opacity} factor={100} min={0} max={1} unit="%" className="w-[72px]" onChange={(opacity) => set({ opacity })} onCommit={commit} />
        </Row>
      </div>

      <p className="mt-3 text-2xs leading-relaxed text-fg-subtle">
        Tip: drag the clip in the preview to move it, pull a corner to resize, or use the round handle to rotate.
      </p>
    </InspectorSection>
  );
}
