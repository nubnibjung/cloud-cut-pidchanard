import { useProjectStore } from '../../state/projectStore';
import { useUIStore } from '../../state/uiStore';
import { ClipInfo } from './ClipInfo';
import { EffectEditor } from './EffectEditor';
import { TransformEditor } from './TransformEditor';

export function InspectorPanel() {
  const selectedClipId = useUIStore((state) => state.selectedClipIds[0]);
  const clip = useProjectStore((state) => state.clips.find((item) => item.id === selectedClipId));
  if (!clip) {
    return <aside className="h-full border-l border-border bg-[#171b23] p-4 text-sm text-slate-300">Select a clip</aside>;
  }
  return (
    <aside className="flex h-full flex-col gap-4 overflow-auto border-l border-border bg-[#171b23] p-4">
      <ClipInfo clip={clip} />
      <TransformEditor clip={clip} />
      <EffectEditor clip={clip} />
    </aside>
  );
}
