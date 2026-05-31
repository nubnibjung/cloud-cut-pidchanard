import { useState } from 'react';
import { LoginPage } from './components/layout/LoginPage';
import { ProjectsPage } from './components/layout/ProjectsPage';
import { EditorLayout } from './components/layout/EditorLayout';
import { useAuthStore } from './state/authStore';
import { useProjectStore } from './state/projectStore';

type View = 'projects' | 'editor';

export function App() {
  const token = useAuthStore((state) => state.token);
  const loadProject = useProjectStore((state) => state.loadProject);
  const [view, setView] = useState<View>('projects');

  if (!token) {
    return <LoginPage />;
  }

  if (view === 'projects') {
    return (
      <ProjectsPage
        onOpen={(projectId, _workspaceId) => {
          loadProject(projectId).catch(console.error);
          setView('editor');
        }}
      />
    );
  }

  return <EditorLayout onBack={() => setView('projects')} />;
}
