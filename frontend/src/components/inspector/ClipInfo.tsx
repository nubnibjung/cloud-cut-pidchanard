import { useEffect, useId, useState } from 'react';
import { useProjectStore } from '../../state/projectStore';
import type { Clip } from '../../types';
import { formatTimecode } from '../../utils/timecode';
import { Input } from '../ui/Input';
import { InspectorSection } from './InspectorPanel';

export function ClipInfo({ clip }: { clip: Clip }) {
  const updateClip = useProjectStore((s) => s.updateClip);
  const [name, setName] = useState(clip.name);
  const nameId = useId();

  // Sync when a different clip is selected
  useEffect(() => { setName(clip.name); }, [clip.id, clip.name]);

  const commit = () => {
    const trimmed = name.trim();
    if (trimmed && trimmed !== clip.name) updateClip(clip.id, { name: trimmed });
    else setName(clip.name);
  };

  return (
    <InspectorSection title="Clip">
      <label htmlFor={nameId} className="mb-1 block text-xs text-fg-muted">Name</label>
      <Input
        id={nameId}
        controlSize="sm"
        className="w-full"
        value={name}
        onChange={(e) => setName(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); if (e.key === 'Escape') { setName(clip.name); e.currentTarget.blur(); } }}
      />
      <dl className="mt-3 grid grid-cols-3 gap-2 text-xs">
        {[
          ['Duration', clip.duration_ms],
          ['In', clip.in_point_ms],
          ['Out', clip.out_point_ms],
        ].map(([label, value]) => (
          <div key={label}>
            <dt className="text-fg-subtle">{label}</dt>
            <dd className="mt-0.5 tabular-nums text-fg">{formatTimecode(value as number)}</dd>
          </div>
        ))}
      </dl>
    </InspectorSection>
  );
}
