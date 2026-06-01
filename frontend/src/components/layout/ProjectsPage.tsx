import { FolderOpen, LogOut, MoreVertical, Pencil, Plus, Scissors, Trash2 } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { api, createProject, createWorkspace, listProjects, listWorkspaces, type ProjectSummary, type Workspace } from '../../services/api';
import { useAuthStore } from '../../state/authStore';

interface Props {
  onOpen(projectId: string, workspaceId: string): void;
}

export function ProjectsPage({ onOpen }: Props) {
  const { user, clearAuth } = useAuthStore();
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [activeWs, setActiveWs] = useState<Workspace | null>(null);
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [newProjectName, setNewProjectName] = useState('');
  const [creating, setCreating] = useState(false);
  const [newWsName, setNewWsName] = useState('');
  const [creatingWs, setCreatingWs] = useState(false);
  // rename state
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  // context menu
  const [menuId, setMenuId] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<ProjectSummary | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const close = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuId(null);
    };
    window.addEventListener('mousedown', close);
    return () => window.removeEventListener('mousedown', close);
  }, []);

  useEffect(() => {
    listWorkspaces()
      .then((ws) => { setWorkspaces(ws); if (ws.length > 0) setActiveWs(ws[0]); else setLoading(false); })
      .catch((err) => { setError(String(err)); setLoading(false); });
  }, []);

  useEffect(() => {
    if (!activeWs) return;
    setLoading(true);
    listProjects(activeWs.id)
      .then((page) => setProjects(page.items))
      .catch((err) => setError(String(err)))
      .finally(() => setLoading(false));
  }, [activeWs]);

  const handleCreate = async () => {
    if (!activeWs || !newProjectName.trim()) return;
    try {
      const proj = await createProject(activeWs.id, newProjectName.trim());
      setProjects((prev) => [proj, ...prev]);
      setNewProjectName('');
      setCreating(false);
    } catch (err) { setError(String(err)); }
  };

  const handleCreateWs = async () => {
    if (!newWsName.trim()) return;
    const base = newWsName.trim().toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '') || 'ws';
    const slug = `${base}-${crypto.randomUUID().slice(0, 6)}`;
    try {
      const ws = await createWorkspace(newWsName.trim(), slug);
      setWorkspaces((prev) => [...prev, ws]);
      setActiveWs(ws);
      setNewWsName('');
      setCreatingWs(false);
    } catch (err) { setError(String(err)); }
  };

  const startRename = (project: ProjectSummary) => {
    setMenuId(null);
    setRenamingId(project.id);
    setRenameValue(project.name);
  };

  const commitRename = async (id: string) => {
    const name = renameValue.trim();
    setRenamingId(null);
    if (!name) return;
    try {
      await api(`/projects/${id}`, { method: 'PATCH', body: JSON.stringify({ name }) });
      setProjects((prev) => prev.map((p) => p.id === id ? { ...p, name } : p));
    } catch (err) { setError(String(err)); }
  };

  const requestDelete = (project: ProjectSummary) => {
    setMenuId(null);
    setDeleteTarget(project);
  };

  const confirmDelete = async () => {
    if (!deleteTarget) return;
    try {
      await api(`/projects/${deleteTarget.id}`, { method: 'DELETE' });
      setProjects((prev) => prev.filter((p) => p.id !== deleteTarget.id));
      setDeleteTarget(null);
    } catch (err) { setError(String(err)); }
  };

  return (
    <div className="flex min-h-screen flex-col bg-[#0d0f14]">
      <header className="flex h-14 items-center justify-between border-b border-border bg-[#151820] px-6">
        <div className="flex items-center gap-2">
          <Scissors className="h-5 w-5 text-accent" />
          <span className="font-bold">CloudCut</span>
        </div>
        <div className="flex items-center gap-4">
          <span className="text-sm text-slate-400">{user?.email}</span>
          <button onClick={clearAuth} className="flex items-center gap-1 rounded border border-border px-3 py-1.5 text-sm hover:border-red-500 hover:text-red-400">
            <LogOut className="h-4 w-4" /> Sign out
          </button>
        </div>
      </header>

      <div className="mx-auto flex w-full max-w-5xl flex-1 gap-6 p-6">
        {/* Sidebar */}
        <aside className="w-56 shrink-0">
          <div className="mb-3 flex items-center justify-between">
            <span className="text-xs font-semibold uppercase tracking-wider text-slate-400">Workspaces</span>
            <button onClick={() => setCreatingWs(!creatingWs)} className="rounded p-1 hover:bg-white/10"><Plus className="h-3.5 w-3.5" /></button>
          </div>
          {creatingWs && (
            <div className="mb-2 flex gap-1">
              <input className="min-w-0 flex-1 rounded border border-border bg-[#0d0f14] px-2 py-1 text-xs text-white focus:border-accent focus:outline-none"
                placeholder="Workspace name" value={newWsName} onChange={(e) => setNewWsName(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleCreateWs()} autoFocus />
              <button onClick={handleCreateWs} className="rounded bg-accent px-2 py-1 text-xs font-medium text-black">Add</button>
            </div>
          )}
          <ul className="flex flex-col gap-1">
            {workspaces.map((ws) => (
              <li key={ws.id}>
                <button
                  className={`w-full rounded px-3 py-2 text-left text-sm transition-colors ${activeWs?.id === ws.id ? 'bg-accent/20 text-accent' : 'text-slate-300 hover:bg-white/5'}`}
                  onClick={() => setActiveWs(ws)}
                >
                  {ws.name}
                  <span className="ml-1 rounded bg-[#252a35] px-1.5 py-0.5 text-[10px] text-slate-400">{ws.plan}</span>
                </button>
              </li>
            ))}
          </ul>
        </aside>

        {/* Main */}
        <main className="min-w-0 flex-1">
          <div className="mb-4 flex items-center justify-between">
            <h1 className="text-lg font-semibold">{activeWs?.name ?? 'Projects'}</h1>
            {activeWs && (
              <button onClick={() => setCreating(!creating)} className="flex items-center gap-1.5 rounded bg-accent px-3 py-1.5 text-sm font-medium text-black">
                <Plus className="h-4 w-4" /> New project
              </button>
            )}
          </div>

          {creating && activeWs && (
            <div className="mb-4 flex gap-2">
              <input className="min-w-0 flex-1 rounded border border-border bg-[#151820] px-3 py-2 text-sm text-white focus:border-accent focus:outline-none"
                placeholder="Project name…" value={newProjectName} onChange={(e) => setNewProjectName(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleCreate()} autoFocus />
              <button onClick={handleCreate} className="rounded bg-accent px-4 py-2 text-sm font-medium text-black">Create</button>
            </div>
          )}

          {error && <div className="mb-4 rounded border border-red-800 bg-red-900/20 p-3 text-sm text-red-400">{error}</div>}

          {loading ? (
            <div className="py-12 text-center text-sm text-slate-500">Loading…</div>
          ) : projects.length === 0 ? (
            <div className="py-12 text-center text-slate-500">
              <FolderOpen className="mx-auto mb-3 h-10 w-10 opacity-30" />
              <p className="text-sm">No projects yet. Create your first one!</p>
            </div>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {projects.map((project) => (
                <div key={project.id} className="group relative rounded-xl border border-border bg-[#151820] transition-all hover:border-accent/40 hover:bg-[#1a1f2b]">
                  {/* Thumbnail — click to open */}
                  <button className="w-full p-4 text-left" onClick={() => onOpen(project.id, project.workspace_id)}>
                    {(() => {
                      const thumb = localStorage.getItem(`thumbnail_project_${project.id}`);
                      return thumb
                        ? <img src={thumb} alt="" className="mb-3 aspect-video w-full rounded-lg object-cover" />
                        : <div className="mb-3 aspect-video rounded-lg bg-[#0d0f14]" />;
                    })()}
                  </button>

                  {/* Name row */}
                  <div className="flex items-center gap-1 px-4 pb-3">
                    {renamingId === project.id ? (
                      <input
                        className="min-w-0 flex-1 rounded border border-accent bg-[#0d0f14] px-2 py-0.5 text-sm text-white focus:outline-none"
                        value={renameValue}
                        autoFocus
                        onChange={(e) => setRenameValue(e.target.value)}
                        onBlur={() => commitRename(project.id)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') commitRename(project.id);
                          if (e.key === 'Escape') setRenamingId(null);
                        }}
                      />
                    ) : (
                      <span
                        className="min-w-0 flex-1 cursor-pointer truncate text-sm font-medium"
                        onDoubleClick={() => startRename(project)}
                        title="Double-click to rename"
                      >
                        {project.name}
                      </span>
                    )}

                    {/* ⋮ menu */}
                    <div className="relative" ref={menuId === project.id ? menuRef : undefined}>
                      <button
                        className="rounded p-1 opacity-0 group-hover:opacity-100 hover:bg-white/10"
                        onClick={(e) => { e.stopPropagation(); setMenuId(menuId === project.id ? null : project.id); }}
                      >
                        <MoreVertical className="h-4 w-4 text-slate-400" />
                      </button>

                      {menuId === project.id && (
                        <div className="absolute right-0 top-7 z-50 w-36 rounded-lg border border-border bg-[#1e2330] py-1 shadow-xl">
                          <button
                            className="flex w-full items-center gap-2 px-3 py-2 text-sm hover:bg-white/5"
                            onClick={() => startRename(project)}
                          >
                            <Pencil className="h-3.5 w-3.5 text-slate-400" /> Rename
                          </button>
                          <button
                            className="flex w-full items-center gap-2 px-3 py-2 text-sm text-red-400 hover:bg-red-900/20"
                            onClick={() => requestDelete(project)}
                          >
                            <Trash2 className="h-3.5 w-3.5" /> Delete
                          </button>
                        </div>
                      )}
                    </div>
                  </div>

                  <p className="px-4 pb-3 text-xs text-slate-500">Updated {new Date(project.updated_at).toLocaleDateString()}</p>
                </div>
              ))}
            </div>
          )}
        </main>
      </div>

      {deleteTarget && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 px-4">
          <div className="w-full max-w-sm rounded-lg border border-border bg-[#151820] p-5 shadow-2xl">
            <div className="mb-4 flex items-start gap-3">
              <div className="rounded bg-red-500/10 p-2 text-red-400">
                <Trash2 className="h-5 w-5" />
              </div>
              <div className="min-w-0">
                <h2 className="font-semibold text-white">Delete project?</h2>
                <p className="mt-1 text-sm text-slate-400">
                  This will permanently delete <span className="font-medium text-slate-200">{deleteTarget.name}</span>. This cannot be undone.
                </p>
              </div>
            </div>
            <div className="flex justify-end gap-2">
              <button
                className="rounded border border-border px-3 py-1.5 text-sm text-slate-300 hover:bg-white/5"
                onClick={() => setDeleteTarget(null)}
              >
                Cancel
              </button>
              <button
                className="rounded bg-red-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-red-500"
                onClick={confirmDelete}
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
