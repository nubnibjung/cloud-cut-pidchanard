import { Check, ChevronDown, Film, FolderOpen, MoreVertical, Pencil, Pin, PinOff, Plus, Trash2 } from 'lucide-react';
import { LottieIllustration } from '../ui/LottieIllustration';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  createProject,
  createWorkspace,
  deleteProject,
  deleteWorkspace,
  listProjects,
  listWorkspaces,
  peekCached,
  projectsPath,
  PROJECTS_PAGE_SIZE,
  renameProject,
  renameWorkspace,
  setWorkspacePinned,
  setProjectPinned,
  WORKSPACES_PATH,
  type ProjectPage,
  type ProjectSummary,
  type Workspace,
} from '../../services/api';
import { useAuthStore } from '../../state/authStore';
import { toast } from '../../state/toastStore';
import { cn } from '../../utils/cn';
import { Button, IconButton } from '../ui/Button';
import { EmptyState, Skeleton } from '../ui/Feedback';
import { Input } from '../ui/Input';
import { Menu } from '../ui/Menu';
import { Modal } from '../ui/Modal';
import { Pagination } from '../ui/Pagination';
import { AppHeader } from './AppHeader';
import { loadEditor } from './editorChunk';

interface Props {
  onOpen(projectId: string, workspaceId: string): void;
}

interface WorkspaceSwitcherProps {
  workspaces: Workspace[];
  activeId: string | null;
  onSelect(id: string): void;
  className?: string;
}

/** Compact workspace picker for small screens: the current workspace, tap to choose another. */
function WorkspaceSwitcher({ workspaces, activeId, onSelect, className }: WorkspaceSwitcherProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const active = workspaces.find((ws) => ws.id === activeId) ?? null;

  useEffect(() => {
    if (!open) return;
    rootRef.current?.querySelector<HTMLElement>('[aria-selected="true"], [role="option"]')?.focus();
    const onPointerDown = (e: PointerEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKeyDown = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    window.addEventListener('pointerdown', onPointerDown);
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  if (workspaces.length === 0) return null;

  return (
    <div ref={rootRef} className={cn('relative', className)}>
      <button
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={`Workspace: ${active?.name ?? 'none'}. Change workspace`}
        className={cn(
          'flex h-11 w-full items-center gap-2 rounded-lg border bg-panel px-3 text-left outline-none transition-colors focus-visible:outline-none',
          open ? 'border-border-strong bg-surface' : 'border-border hover:border-border-strong',
        )}
        onClick={() => setOpen((value) => !value)}
      >
        <span className="min-w-0 flex-1 truncate text-sm font-semibold text-fg">{active?.name ?? 'Choose a workspace'}</span>
        <ChevronDown aria-hidden className={cn('h-4 w-4 shrink-0 text-fg-subtle transition-transform duration-200', open && 'rotate-180')} />
      </button>

      {open && (
        <ul
          role="listbox"
          aria-label="Workspaces"
          className="absolute inset-x-0 top-12 z-30 max-h-72 animate-pop-in overflow-auto rounded-xl border border-border bg-raised p-1 shadow-menu"
        >
          {workspaces.map((ws) => {
            const selected = ws.id === activeId;
            return (
              <li key={ws.id}>
                <button
                  type="button"
                  role="option"
                  aria-selected={selected}
                  className={cn(
                    // No focus ring here: keyboard focus shows as the same soft highlight as hover
                    'flex h-11 w-full items-center gap-2 rounded-lg px-3 text-left text-sm outline-none transition-colors focus-visible:bg-ink/[0.06] focus-visible:outline-none',
                    selected ? 'font-semibold text-accent' : 'text-fg hover:bg-ink/[0.05]',
                  )}
                  onClick={() => { onSelect(ws.id); setOpen(false); }}
                >
                  <Check aria-hidden className={cn('h-4 w-4 shrink-0', selected ? 'opacity-100' : 'opacity-0')} />
                  {ws.pinned && <Pin aria-label="Pinned" className="h-3 w-3 shrink-0 text-accent" />}
                  <span className="min-w-0 flex-1 truncate">{ws.name}</span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

/** Pinned workspaces first; the sort is stable, so the server's order is kept otherwise. */
function sortWorkspaces(list: Workspace[]): Workspace[] {
  return [...list].sort((a, b) => Number(!!b.pinned) - Number(!!a.pinned));
}

const dateFormat = new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short', year: 'numeric' });

function formatUpdated(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? '' : dateFormat.format(date);
}

export function ProjectsPage({ onOpen }: Props) {
  const user = useAuthStore((state) => state.user);
  const [query, setQuery] = useState('');
  const lastWsKey = `cc_last_ws_${user?.id ?? 'anon'}`;

  const [workspaces, setWorkspaces] = useState<Workspace[]>(() => peekCached<Workspace[]>(WORKSPACES_PATH) ?? []);
  const [workspacesLoaded, setWorkspacesLoaded] = useState(() => peekCached(WORKSPACES_PATH) !== undefined);
  // Start from the workspace used last time so its projects can load in parallel with the workspace list
  const [activeWsId, setActiveWsId] = useState<string | null>(() => localStorage.getItem(lastWsKey));
  const [projects, setProjects] = useState<ProjectSummary[]>(() =>
    activeWsId ? peekCached<ProjectPage>(projectsPath(activeWsId))?.items ?? [] : [],
  );
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  // Search runs on the server across every page; wait for a pause in typing
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  /** Which workspace/page/search the cards on screen belong to. */
  const shownViewKey = useRef<string | null>(null);

  const [newProjectName, setNewProjectName] = useState('');
  const [creating, setCreating] = useState(false);
  const [savingProject, setSavingProject] = useState(false);
  const [newWsName, setNewWsName] = useState('');
  const [creatingWs, setCreatingWs] = useState(false);
  const wsInputRef = useRef<HTMLInputElement>(null);
  // Focus the name field once the form starts opening (it stays mounted, so autoFocus won't fire)
  useEffect(() => {
    if (creatingWs) wsInputRef.current?.focus({ preventScroll: true });
  }, [creatingWs]);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [deleteTarget, setDeleteTarget] = useState<ProjectSummary | null>(null);
  const [wsRenameTarget, setWsRenameTarget] = useState<Workspace | null>(null);
  const [wsRenameValue, setWsRenameValue] = useState('');
  const [wsDeleteTarget, setWsDeleteTarget] = useState<Workspace | null>(null);
  const [wsSaving, setWsSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const renameCancelled = useRef(false);

  const activeWs = workspaces.find((ws) => ws.id === activeWsId) ?? null;

  useEffect(() => {
    let cancelled = false;
    listWorkspaces()
      .then((list) => {
        if (cancelled) return;
        setWorkspaces(list);
        setWorkspacesLoaded(true);
        setActiveWsId((current) => (list.some((ws) => ws.id === current) ? current : list[0]?.id ?? null));
      })
      .catch((err) => {
        if (cancelled) return;
        setWorkspacesLoaded(true);
        setLoadFailed(true);
        toast.fromError('Could not load your workspaces')(err);
      });
    return () => { cancelled = true; };
  }, [reloadKey]);

  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedQuery(query.trim()), 250);
    return () => window.clearTimeout(timer);
  }, [query]);

  // A different workspace or search starts again from page 1
  useEffect(() => { setPage(1); }, [activeWsId, debouncedQuery]);

  useEffect(() => {
    if (!activeWsId) {
      setProjects([]);
      setTotal(0);
      return;
    }
    let cancelled = false;
    localStorage.setItem(lastWsKey, activeWsId);

    const viewKey = `${activeWsId}|${page}|${debouncedQuery}`;
    // Same view, just refreshing after a pin/rename/delete: keep the cards on screen
    // and swap the data in quietly, instead of flashing the loading skeleton.
    const refreshingSameView = shownViewKey.current === viewKey;
    const cached = peekCached<ProjectPage>(projectsPath(activeWsId, page, debouncedQuery));
    if (cached) {
      setProjects(cached.items);
      setTotal(cached.total ?? 0);
    }
    setLoading(!cached && !refreshingSameView);
    setLoadFailed(false);

    listProjects(activeWsId, page, debouncedQuery)
      .then((result) => {
        if (cancelled) return;
        const pages = Math.max(1, Math.ceil((result.total ?? 0) / PROJECTS_PAGE_SIZE));
        // e.g. the last project on the last page was deleted: step back a page
        if (page > pages) { setPage(pages); return; }
        setProjects(result.items);
        setTotal(result.total ?? 0);
        shownViewKey.current = viewKey;
      })
      .catch((err) => {
        if (cancelled) return;
        if (!cached) setLoadFailed(true);
        toast.fromError('Could not load projects')(err);
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [activeWsId, lastWsKey, reloadKey, page, debouncedQuery]);

  // Thumbnails are captured by the editor into localStorage; read them once per list, not per render
  const thumbnails = useMemo(() => {
    const map: Record<string, string | null> = {};
    for (const project of projects) map[project.id] = localStorage.getItem(`thumbnail_project_${project.id}`);
    return map;
  }, [projects]);

  const handleCreate = async () => {
    const name = newProjectName.trim();
    if (!activeWsId || !name || savingProject) return;
    setSavingProject(true);
    try {
      await createProject(activeWsId, name);
      // Newest projects come first, so show page 1 with the new one on it
      setPage(1);
      setReloadKey((key) => key + 1);
      setNewProjectName('');
      setCreating(false);
    } catch (err) {
      toast.fromError('Could not create the project')(err);
    } finally {
      setSavingProject(false);
    }
  };

  const handleCreateWs = async () => {
    const name = newWsName.trim();
    if (!name) return;
    const base = name.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '') || 'ws';
    const slug = `${base}-${crypto.randomUUID().slice(0, 6)}`;
    try {
      const ws = await createWorkspace(name, slug);
      setWorkspaces((prev) => [...prev, ws]);
      setActiveWsId(ws.id);
      setNewWsName('');
      setCreatingWs(false);
    } catch (err) {
      toast.fromError('Could not create the workspace')(err);
    }
  };

  const startRename = (project: ProjectSummary) => {
    renameCancelled.current = false;
    setRenamingId(project.id);
    setRenameValue(project.name);
  };

  const commitRename = async (project: ProjectSummary) => {
    const name = renameValue.trim();
    setRenamingId(null);
    if (renameCancelled.current || !name || name === project.name) return;
    setProjects((prev) => prev.map((p) => (p.id === project.id ? { ...p, name } : p)));
    try {
      await renameProject(project.id, name);
    } catch (err) {
      setProjects((prev) => prev.map((p) => (p.id === project.id ? { ...p, name: project.name } : p)));
      toast.fromError('Could not rename the project')(err);
    }
  };

  const confirmDelete = async () => {
    if (!deleteTarget || deleting) return;
    setDeleting(true);
    try {
      await deleteProject(deleteTarget.id);
      setProjects((prev) => prev.filter((p) => p.id !== deleteTarget.id));
      localStorage.removeItem(`thumbnail_project_${deleteTarget.id}`);
      setDeleteTarget(null);
      setReloadKey((key) => key + 1); // pull the next project up into this page
    } catch (err) {
      toast.fromError('Could not delete the project')(err);
    } finally {
      setDeleting(false);
    }
  };

  const togglePin = async (project: ProjectSummary) => {
    const pinned = !project.pinned;
    // Optimistic: the card moves between sections right away
    setProjects((prev) => prev.map((p) => (p.id === project.id ? { ...p, pinned } : p)));
    try {
      await setProjectPinned(project.id, pinned);
      setReloadKey((key) => key + 1); // page contents and counts change when a pin moves
    } catch (err) {
      setProjects((prev) => prev.map((p) => (p.id === project.id ? { ...p, pinned: !pinned } : p)));
      toast.fromError(pinned ? 'Could not pin the project' : 'Could not unpin the project')(err);
    }
  };

  const startRenameWs = (ws: Workspace) => {
    setWsRenameTarget(ws);
    setWsRenameValue(ws.name);
  };

  const confirmRenameWs = async () => {
    const target = wsRenameTarget;
    const name = wsRenameValue.trim();
    if (!target || !name || wsSaving) return;
    if (name === target.name) { setWsRenameTarget(null); return; }
    setWsSaving(true);
    try {
      const updated = await renameWorkspace(target.id, name);
      setWorkspaces((prev) => prev.map((ws) => (ws.id === updated.id ? { ...ws, name: updated.name } : ws)));
      setWsRenameTarget(null);
    } catch (err) {
      toast.fromError('Could not rename the workspace')(err);
    } finally {
      setWsSaving(false);
    }
  };

  const confirmDeleteWs = async () => {
    const target = wsDeleteTarget;
    if (!target || wsSaving) return;
    setWsSaving(true);
    try {
      await deleteWorkspace(target.id);
      const remaining = workspaces.filter((ws) => ws.id !== target.id);
      setWorkspaces(remaining);
      if (activeWsId === target.id) setActiveWsId(remaining[0]?.id ?? null);
      setWsDeleteTarget(null);
      toast.info(`Deleted ${target.name}`);
    } catch (err) {
      toast.fromError('Could not delete the workspace')(err);
    } finally {
      setWsSaving(false);
    }
  };

  const toggleWsPin = async (ws: Workspace) => {
    const pinned = !ws.pinned;
    const apply = (value: boolean) =>
      setWorkspaces((prev) => sortWorkspaces(prev.map((w) => (w.id === ws.id ? { ...w, pinned: value } : w))));
    apply(pinned); // optimistic: the row jumps to (or out of) the pinned group right away
    try {
      await setWorkspacePinned(ws.id, pinned);
    } catch (err) {
      apply(!pinned);
      toast.fromError(pinned ? 'Could not pin the workspace' : 'Could not unpin the workspace')(err);
    }
  };

  const workspaceMenuItems = (ws: Workspace) => [
    ws.pinned
      ? { label: 'Unpin', icon: <PinOff aria-hidden className="h-3.5 w-3.5 text-fg-muted" />, onSelect: () => void toggleWsPin(ws) }
      : { label: 'Pin to top', icon: <Pin aria-hidden className="h-3.5 w-3.5 text-fg-muted" />, onSelect: () => void toggleWsPin(ws) },
    { label: 'Rename', icon: <Pencil aria-hidden className="h-3.5 w-3.5 text-fg-muted" />, onSelect: () => startRenameWs(ws) },
    // Your last workspace can't be deleted, so don't offer it
    ...(workspaces.length > 1
      ? [{ label: 'Delete', icon: <Trash2 aria-hidden className="h-3.5 w-3.5" />, danger: true, onSelect: () => setWsDeleteTarget(ws) }]
      : []),
  ];

  const renderProjectCard = (project: ProjectSummary) => {
    const thumb = thumbnails[project.id];
    return (
          <li
            key={project.id}
            className="group relative rounded-xl border border-border bg-panel transition-colors focus-within:border-border-strong hover:border-border-strong hover:bg-surface"
          >
            <button
              type="button"
              className="block w-full rounded-t-xl p-3 pb-0 text-left"
              aria-label={`Open ${project.name}`}
              onClick={() => onOpen(project.id, project.workspace_id)}
              onPointerEnter={() => { void loadEditor(); }}
              onFocus={() => { void loadEditor(); }}
            >
              {project.pinned && (
              <span className="absolute left-5 top-5 z-[1] flex h-6 w-6 items-center justify-center rounded-full bg-accent text-on-accent shadow-sm" title="Pinned">
                <Pin aria-hidden className="h-3 w-3" />
                <span className="sr-only">Pinned</span>
              </span>
            )}
            {thumb ? (
                <img
                  src={thumb}
                  alt=""
                  width={320}
                  height={180}
                  loading="lazy"
                  decoding="async"
                  className="aspect-video w-full rounded-lg bg-canvas object-cover"
                />
              ) : (
                <div className="flex aspect-video w-full items-center justify-center rounded-lg bg-canvas text-fg-subtle/60">
                  <Film aria-hidden className="h-7 w-7" />
                </div>
              )}
            </button>

            <div className="flex items-start gap-1 p-3">
              <div className="min-w-0 flex-1">
                {renamingId === project.id ? (
                  <Input
                    controlSize="sm"
                    className="w-full"
                    aria-label="Project name"
                    value={renameValue}
                    autoFocus
                    onFocus={(e) => e.currentTarget.select()}
                    onChange={(e) => setRenameValue(e.target.value)}
                    onBlur={() => void commitRename(project)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') e.currentTarget.blur();
                      if (e.key === 'Escape') { renameCancelled.current = true; e.currentTarget.blur(); }
                    }}
                  />
                ) : (
                  <p
                    className="truncate text-sm font-medium text-fg"
                    title={project.name}
                    onDoubleClick={() => startRename(project)}
                  >
                    {project.name}
                  </p>
                )}
                <p className="mt-0.5 text-xs text-fg-subtle">Updated {formatUpdated(project.updated_at)}</p>
              </div>
              <Menu
                label={`Actions for ${project.name}`}
                trigger={<MoreVertical aria-hidden className="h-4 w-4" />}
                items={[
                  project.pinned
        ? { label: 'Unpin', icon: <PinOff aria-hidden className="h-3.5 w-3.5 text-fg-muted" />, onSelect: () => void togglePin(project) }
        : { label: 'Pin to top', icon: <Pin aria-hidden className="h-3.5 w-3.5 text-fg-muted" />, onSelect: () => void togglePin(project) },
      { label: 'Rename', icon: <Pencil aria-hidden className="h-3.5 w-3.5 text-fg-muted" />, onSelect: () => startRename(project) },
                  { label: 'Delete', icon: <Trash2 aria-hidden className="h-3.5 w-3.5" />, danger: true, onSelect: () => setDeleteTarget(project) },
                ]}
              />
            </div>
          </li>
    );
  };

  const showSkeleton = !workspacesLoaded || (activeWsId !== null && loading);
  const needle = debouncedQuery;
  const shownProjects = projects; // already filtered by the server
  const pageCount = Math.max(1, Math.ceil(total / PROJECTS_PAGE_SIZE));
  const pinnedProjects = shownProjects.filter((p) => p.pinned);
  const otherProjects = shownProjects.filter((p) => !p.pinned);

  return (
    <div className="flex min-h-full flex-col bg-canvas">
      <AppHeader query={query} onQueryChange={setQuery} />

      <div className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-6 p-4 sm:p-6 md:flex-row md:gap-8">
        {/* Workspaces: sidebar on wide screens, scrolling chips on narrow ones */}
        <aside className="shrink-0 md:w-56">
          <div className="mb-2 flex items-center justify-between">
            <h2 className="text-xs font-medium uppercase tracking-wider text-fg-subtle">Workspaces</h2>
            <IconButton
              label={creatingWs ? 'Cancel new workspace' : 'New workspace'}
              size="sm"
              active={creatingWs}
              aria-expanded={creatingWs}
              aria-controls="new-workspace-form"
              onClick={() => setCreatingWs(!creatingWs)}
            >
              {/* The plus turns into a close (×) as the form opens */}
              <Plus aria-hidden className={cn('h-4 w-4 transition-transform duration-300 ease-in-out', creatingWs && 'rotate-45')} />
            </IconButton>
          </div>
          {/* Always mounted so it can slide open and closed; grid rows 0fr → 1fr animates to its natural height */}
          <div
            id="new-workspace-form"
            inert={!creatingWs}
            className={cn(
              'grid transition-[grid-template-rows,opacity,margin] duration-300 ease-in-out',
              creatingWs ? 'mb-2 grid-rows-[1fr] opacity-100' : 'mb-0 grid-rows-[0fr] opacity-0',
            )}
          >
            <div className="min-h-0 overflow-hidden">
              <form
                className={cn(
                  'flex gap-1.5 p-px transition-transform duration-300 ease-in-out',
                  creatingWs ? 'translate-y-0' : '-translate-y-2',
                )}
                onSubmit={(e) => { e.preventDefault(); void handleCreateWs(); }}
              >
                <Input
                  ref={wsInputRef}
                  controlSize="sm"
                  className="min-w-0 flex-1"
                  aria-label="Workspace name"
                  placeholder="Workspace name"
                  value={newWsName}
                  onChange={(e) => setNewWsName(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Escape') setCreatingWs(false); }}
                />
                <Button type="submit" size="sm" variant="primary" disabled={!newWsName.trim()}>Add</Button>
              </form>
            </div>
          </div>
          {!workspacesLoaded ? (
            <div className="flex flex-col gap-2">
              <Skeleton className="h-10 w-full md:h-9" />
              <Skeleton className="hidden h-9 w-full md:block" />
            </div>
          ) : (
            <>
            {/* Phones: one dropdown instead of a row of chips that runs off the screen */}
            <div className="flex items-center gap-1.5 md:hidden">
              <WorkspaceSwitcher
                className="min-w-0 flex-1"
                workspaces={workspaces}
                activeId={activeWsId}
                onSelect={setActiveWsId}
              />
              {activeWs && (
                <Menu
                  label={`Actions for ${activeWs.name}`}
                  trigger={<MoreVertical aria-hidden className="h-4 w-4" />}
                  items={workspaceMenuItems(activeWs)}
                />
              )}
            </div>
            <ul className="hidden flex-col gap-1 md:flex">
              {workspaces.map((ws) => {
                const active = ws.id === activeWsId;
                return (
                  <li
                    key={ws.id}
                    className={cn(
                      'group/ws flex shrink-0 items-center rounded-md transition-colors',
                      active ? 'bg-accent/10' : 'hover:bg-ink/5',
                    )}
                  >
                    <button
                      type="button"
                      aria-current={active ? 'true' : undefined}
                      className={cn(
                        'flex min-w-0 flex-1 items-center justify-between gap-2 whitespace-nowrap rounded-md py-2 pl-3 pr-1 text-left text-sm outline-none focus-visible:outline-none',
                        active ? 'font-medium text-accent' : 'text-fg-muted group-hover/ws:text-fg',
                      )}
                      onClick={() => setActiveWsId(ws.id)}
                    >
                      <span className="flex min-w-0 items-center gap-1.5">
                        {ws.pinned && <Pin aria-label="Pinned" className="h-3 w-3 shrink-0 text-accent" />}
                        <span className="min-w-0 truncate">{ws.name}</span>
                      </span>
                    </button>
                    {/* Shown on hover or keyboard focus so the list stays calm */}
                    <Menu
                      label={`Actions for ${ws.name}`}
                      className="mr-0.5 opacity-0 transition-opacity focus-within:opacity-100 group-hover/ws:opacity-100"
                      trigger={<MoreVertical aria-hidden className="h-4 w-4" />}
                      items={workspaceMenuItems(ws)}
                    />
                  </li>
                );
              })}
            </ul>
            </>
          )}
        </aside>

        <main className="flex min-w-0 flex-1 flex-col">
          <div className="mb-5 flex items-center justify-between gap-3">
            <h1 className="truncate text-xl font-semibold tracking-tight">{activeWs?.name ?? 'Projects'}</h1>
            {activeWs && (
              <Button variant="primary" onClick={() => setCreating(true)}>
                <Plus aria-hidden className="h-4 w-4" /> New project
              </Button>
            )}
          </div>

          {showSkeleton ? (
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3" aria-busy="true" aria-label="Loading projects">
              {Array.from({ length: 6 }, (_, i) => (
                <div key={i} className="rounded-xl border border-border bg-panel p-3">
                  <Skeleton className="aspect-video w-full rounded-lg" />
                  <Skeleton className="mt-3 h-4 w-2/3" />
                  <Skeleton className="mt-2 h-3 w-1/3" />
                </div>
              ))}
            </div>
          ) : loadFailed ? (
            <EmptyState
              icon={<FolderOpen className="h-9 w-9" />}
              title="Projects didn't load"
              description="The server may still be starting up. Give it a few seconds and try again."
              action={<Button variant="primary" onClick={() => setReloadKey((key) => key + 1)}>Try again</Button>}
            />
          ) : !activeWs ? (
            <EmptyState
              icon={<FolderOpen className="h-9 w-9" />}
              title="No workspace yet"
              description="Create a workspace to start organising your projects."
              action={<Button variant="primary" onClick={() => setCreatingWs(true)}><Plus aria-hidden className="h-4 w-4" /> New workspace</Button>}
            />
          ) : projects.length === 0 && !needle ? (
            <EmptyState
              large
              className="min-h-[calc(100vh-14rem)] flex-1"
              icon={<LottieIllustration name="cut-video" className="-my-8 h-64 w-64 sm:h-80 sm:w-80" />}
              title="No projects"
              description="Create a project, upload your footage and start cutting."
              action={
                <Button size="lg" variant="primary" onClick={() => setCreating(true)}>
                  <Plus aria-hidden className="h-4 w-4" /> New project
                </Button>
              }
            />
          ) : shownProjects.length === 0 ? (
            <EmptyState
              large
              className="min-h-[calc(100vh-14rem)] flex-1"
              icon={<LottieIllustration name="not-found" className="-my-10 h-72 w-72 sm:h-96 sm:w-96" />}
              title={`No projects match “${query.trim()}”`}
              description="Check the spelling, or try searching for part of the name."
              action={<Button size="lg" variant="primary" onClick={() => setQuery('')}>Clear search</Button>}
            />
          ) : (
            <>
              {pinnedProjects.length > 0 && (
                <section aria-labelledby="pinned-heading" className="mb-8">
                  <h2 id="pinned-heading" className="mb-3 flex items-center gap-1.5 text-xs font-medium uppercase tracking-wider text-fg-subtle">
                    <Pin aria-hidden className="h-3.5 w-3.5" /> Pinned
                  </h2>
                  <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">{pinnedProjects.map(renderProjectCard)}</ul>
                </section>
              )}
              {pinnedProjects.length > 0 && (otherProjects.length > 0 || !needle) && (
                <h2 className="mb-3 text-xs font-medium uppercase tracking-wider text-fg-subtle">All projects</h2>
              )}
              <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {!needle && page === 1 && (
                  <li className="hidden sm:block">
                    <button
                      type="button"
                      className="group flex h-full min-h-[13rem] w-full flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-border-strong text-fg-muted transition-colors hover:border-accent/60 hover:bg-accent/[0.05] hover:text-fg"
                      onClick={() => setCreating(true)}
                    >
                      <span className="flex h-11 w-11 items-center justify-center rounded-full bg-ink/[0.06] transition-colors group-hover:bg-accent group-hover:text-on-accent">
                        <Plus aria-hidden className="h-5 w-5" />
                      </span>
                      <span className="text-sm font-semibold">New project</span>
                    </button>
                  </li>
                )}
                {otherProjects.map(renderProjectCard)}
              </ul>
              <Pagination
                className="mt-10"
                page={page}
                pageCount={pageCount}
                onPageChange={(next) => {
                  setPage(next);
                  window.scrollTo({ top: 0, behavior: 'smooth' });
                }}
              />
            </>
          )}
        </main>
      </div>

      {creating && activeWs && (
        <Modal
          title="New project"
          onClose={() => { if (!savingProject) { setCreating(false); setNewProjectName(''); } }}
          icon={
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-accent/15 text-accent">
              <Film aria-hidden className="h-5 w-5" />
            </div>
          }
          footer={
            <>
              <Button onClick={() => { setCreating(false); setNewProjectName(''); }} disabled={savingProject}>Cancel</Button>
              <Button variant="primary" loading={savingProject} disabled={!newProjectName.trim()} onClick={() => void handleCreate()}>
                Create project
              </Button>
            </>
          }
          description={<>In <span className="font-medium text-fg">{activeWs.name}</span>. You can rename it any time.</>}
        >
          <form onSubmit={(e) => { e.preventDefault(); void handleCreate(); }}>
            <label htmlFor="new-project-name" className="mb-2 block text-sm font-medium text-fg">Project name</label>
            <Input
              id="new-project-name"
              data-autofocus
              className="h-11 w-full rounded-lg px-3.5"
              placeholder="e.g. Product launch teaser"
              maxLength={120}
              value={newProjectName}
              onChange={(e) => setNewProjectName(e.target.value)}
            />
          </form>
        </Modal>
      )}

      {wsRenameTarget && (
        <Modal
          title="Rename workspace"
          onClose={() => { if (!wsSaving) setWsRenameTarget(null); }}
          icon={
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-accent/15 text-accent">
              <Pencil aria-hidden className="h-5 w-5" />
            </div>
          }
          footer={
            <>
              <Button onClick={() => setWsRenameTarget(null)} disabled={wsSaving}>Cancel</Button>
              <Button variant="primary" loading={wsSaving} disabled={!wsRenameValue.trim()} onClick={() => void confirmRenameWs()}>Save</Button>
            </>
          }
        >
          <form onSubmit={(e) => { e.preventDefault(); void confirmRenameWs(); }}>
            <label htmlFor="rename-workspace" className="mb-2 block text-sm font-medium text-fg">Workspace name</label>
            <Input
              id="rename-workspace"
              data-autofocus
              className="h-11 w-full rounded-lg px-3.5"
              maxLength={120}
              value={wsRenameValue}
              onFocus={(e) => e.currentTarget.select()}
              onChange={(e) => setWsRenameValue(e.target.value)}
            />
          </form>
        </Modal>
      )}

      {wsDeleteTarget && (
        <Modal
          title="Delete workspace?"
          onClose={() => { if (!wsSaving) setWsDeleteTarget(null); }}
          icon={
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-danger/10 text-danger">
              <Trash2 aria-hidden className="h-5 w-5" />
            </div>
          }
          description={
            <>
              <span className="font-medium text-fg">{wsDeleteTarget.name}</span> and every project in it will be deleted. This can't be undone.
            </>
          }
          footer={
            <>
              <Button data-autofocus onClick={() => setWsDeleteTarget(null)} disabled={wsSaving}>Cancel</Button>
              <Button variant="danger" loading={wsSaving} onClick={() => void confirmDeleteWs()}>Delete workspace</Button>
            </>
          }
        />
      )}

      {deleteTarget && (
        <Modal
          title="Delete project?"
          onClose={() => { if (!deleting) setDeleteTarget(null); }}
          icon={
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-danger/10 text-danger">
              <Trash2 aria-hidden className="h-5 w-5" />
            </div>
          }
          footer={
            <>
              <Button data-autofocus onClick={() => setDeleteTarget(null)} disabled={deleting}>Cancel</Button>
              <Button variant="danger" loading={deleting} onClick={() => void confirmDelete()}>Delete project</Button>
            </>
          }
          description={<><span className="font-medium text-fg">{deleteTarget.name}</span> will be permanently deleted. This can't be undone.</>}
        />
      )}
    </div>
  );
}
