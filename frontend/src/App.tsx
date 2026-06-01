import { useEffect, useState } from 'react';
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

  useEffect(() => {
    if (window.location.search.includes('project=')) {
      window.history.replaceState(null, '', '/');
    }
  }, []);

  useEffect(() => {
    const preventBrowserDropNavigation = (event: DragEvent) => {
      event.preventDefault();
    };
    const preventNativeDrag = (event: DragEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.closest('[data-allow-native-drag="true"]')) return;
      event.preventDefault();
    };

    window.addEventListener('dragstart', preventNativeDrag, true);
    window.addEventListener('dragenter', preventBrowserDropNavigation, true);
    window.addEventListener('dragover', preventBrowserDropNavigation, true);
    window.addEventListener('drop', preventBrowserDropNavigation, true);

    return () => {
      window.removeEventListener('dragstart', preventNativeDrag, true);
      window.removeEventListener('dragenter', preventBrowserDropNavigation, true);
      window.removeEventListener('dragover', preventBrowserDropNavigation, true);
      window.removeEventListener('drop', preventBrowserDropNavigation, true);
    };
  }, []);

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

  return <EditorLayout onBack={() => {
    setView('projects');
  }} />;
}
