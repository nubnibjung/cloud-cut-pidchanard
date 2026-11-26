import { AlertCircle } from 'lucide-react';
import { lazy, Suspense, useEffect, useState } from 'react';
import { LoginPage } from './components/layout/LoginPage';
import { ProjectsPage } from './components/layout/ProjectsPage';
import { loadEditor } from './components/layout/editorChunk';
import { Button } from './components/ui/Button';
import { ErrorBoundary } from './components/ui/ErrorBoundary';
import { EmptyState, Spinner } from './components/ui/Feedback';
import { Toaster } from './components/ui/Toaster';
import { useAuthStore } from './state/authStore';
import { useProjectStore } from './state/projectStore';

const EditorLayout = lazy(() => loadEditor().then((module) => ({ default: module.EditorLayout })));

function FullScreenLoader({ label }: { label: string }) {
  return (
    <div className="flex h-full items-center justify-center gap-2 bg-canvas text-sm text-fg-muted" role="status">
      <Spinner />
      {label}
    </div>
  );
}

export function App() {
  const token = useAuthStore((state) => state.token);
  const loadProject = useProjectStore((state) => state.loadProject);
  const loadedProjectId = useProjectStore((state) => state.project?.id ?? null);
  const loadError = useProjectStore((state) => state.error);
  const [openProjectId, setOpenProjectId] = useState<string | null>(null);

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

  // Signing out always returns to the project list on the next sign-in
  useEffect(() => {
    if (!token) setOpenProjectId(null);
  }, [token]);

  // If the open project ever goes missing from the store, fetch it again instead of hanging
  const loading = useProjectStore((state) => state.loading);
  useEffect(() => {
    if (openProjectId && loadedProjectId !== openProjectId && !loading && !loadError) void loadProject(openProjectId);
  }, [openProjectId, loadedProjectId, loading, loadError, loadProject]);

  const openProject = (projectId: string) => {
    setOpenProjectId(projectId);
    void loadProject(projectId);
  };

  let screen;
  if (!token) {
    screen = <LoginPage />;
  } else if (!openProjectId) {
    screen = <ProjectsPage onOpen={(projectId) => openProject(projectId)} />;
  } else if (loadedProjectId !== openProjectId) {
    // Still fetching this project (or it failed) — never flash the previous one
    screen = loadError ? (
      <div className="flex h-full items-center justify-center bg-canvas">
        <EmptyState
          icon={<AlertCircle className="h-8 w-8 text-danger" />}
          title="Couldn't open this project"
          description={loadError}
          action={
            <div className="flex gap-2">
              <Button onClick={() => setOpenProjectId(null)}>Back to projects</Button>
              <Button variant="primary" onClick={() => openProject(openProjectId)}>Try again</Button>
            </div>
          }
        />
      </div>
    ) : (
      <FullScreenLoader label="Opening project…" />
    );
  } else {
    screen = (
      <ErrorBoundary onExit={() => setOpenProjectId(null)} exitLabel="Back to projects">
        <Suspense fallback={<FullScreenLoader label="Loading editor…" />}>
          <EditorLayout onBack={() => setOpenProjectId(null)} />
        </Suspense>
      </ErrorBoundary>
    );
  }

  return (
    <>
      {screen}
      <Toaster />
    </>
  );
}
