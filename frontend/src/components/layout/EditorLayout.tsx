import { Panel, PanelGroup, PanelResizeHandle } from 'react-resizable-panels';
import { useOperationSync } from '../../collaboration/useOperationSync';
import { useProjectStore } from '../../state/projectStore';
import { AssetBrowser } from '../assets/AssetBrowser';
import { InspectorPanel } from '../inspector/InspectorPanel';
import { VideoPlayer } from '../player/VideoPlayer';
import { Timeline } from '../timeline/Timeline';
import { TopBar } from '../topbar/TopBar';

interface Props {
  onBack?(): void;
}

export function EditorLayout({ onBack }: Props) {
  const projectId = useProjectStore((state) => state.project?.id ?? null);
  const syncableId = projectId === 'project-seed' ? null : projectId;

  useOperationSync(syncableId);

  return (
    <div className="flex h-full flex-col bg-[#111318]">
      <TopBar onBack={onBack} />
      <PanelGroup direction="vertical" className="min-h-0 flex-1">
        <Panel minSize={40}>
          <PanelGroup direction="horizontal">
            <Panel defaultSize={20} minSize={14}><AssetBrowser /></Panel>
            <PanelResizeHandle className="w-1 bg-border" />
            <Panel defaultSize={55} minSize={35}><VideoPlayer /></Panel>
            <PanelResizeHandle className="w-1 bg-border" />
            <Panel defaultSize={25} minSize={18}><InspectorPanel /></Panel>
          </PanelGroup>
        </Panel>
        <PanelResizeHandle className="h-1 bg-border" />
        <Panel defaultSize={40} minSize={24}><Timeline /></Panel>
      </PanelGroup>
    </div>
  );
}
