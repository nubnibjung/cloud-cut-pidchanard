import { MousePointerClick } from 'lucide-react';
import type { ReactNode } from 'react';
import { useProjectStore } from '../../state/projectStore';
import { useUIStore } from '../../state/uiStore';
import { EmptyState } from '../ui/Feedback';
import { ClipInfo } from './ClipInfo';
import { EffectEditor } from './EffectEditor';
import { TransformEditor } from './TransformEditor';

/** One titled group inside the inspector. */
export function InspectorSection({ title, action, children }: { title: string; action?: ReactNode; children: ReactNode }) {
  return (
    <section className="border-b border-border px-3 py-3">
      <div className="mb-2.5 flex h-6 items-center justify-between">
        <h3 className="text-xs font-medium uppercase tracking-wider text-fg-subtle">{title}</h3>
        {action}
      </div>
      {children}
    </section>
  );
}

export function InspectorPanel() {
  const selectedClipId = useUIStore((state) => state.selectedClipIds[0]);
  const clip = useProjectStore((state) => state.clips.find((item) => item.id === selectedClipId));

  return (
    <aside className="flex h-full flex-col overflow-clip bg-panel" aria-label="Inspector">
      <div className="flex h-11 shrink-0 items-center border-b border-border px-3 max-md:hidden">
        <h2 className="text-sm font-semibold">Inspector</h2>
      </div>
      {clip ? (
        <div className="min-h-0 flex-1 overflow-auto">
          <ClipInfo clip={clip} />
          <TransformEditor clip={clip} />
          <EffectEditor clip={clip} />
        </div>
      ) : (
        <EmptyState
          compact
          className="flex-1"
          icon={<MousePointerClick className="h-6 w-6" />}
          title="No clip selected"
          description="Select a clip in the timeline to edit its name, transform and effects."
        />
      )}
    </aside>
  );
}
