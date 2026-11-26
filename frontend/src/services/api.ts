import { useAuthStore } from '../state/authStore';
import { API_BASE } from './config';

function readErrorMessage(text: string): string {
  if (!text.trim()) {
    return 'Request failed';
  }

  try {
    const body = JSON.parse(text) as { message?: unknown };
    return typeof body.message === 'string' ? body.message : text;
  } catch {
    return text;
  }
}

export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const token = useAuthStore.getState().token;
  const headers: Record<string, string> = {
    ...(init?.headers as Record<string, string> | undefined ?? {}),
  };
  // Only declare a JSON body when there is one — keeps body-less requests "simple" for CORS
  if (typeof init?.body === 'string' && !headers['content-type']) {
    headers['content-type'] = 'application/json';
  }
  if (token) {
    headers['authorization'] = `Bearer ${token}`;
  }

  const response = await fetch(`${API_BASE}${path}`, { ...init, headers });

  if (response.status === 401) {
    // A wrong password on the sign-in form is not an expired session
    if (token) useAuthStore.getState().clearAuth();
    const text = await response.text().catch(() => '');
    throw new Error(token ? 'Unauthorized' : readErrorMessage(text));
  }
  if (!response.ok) {
    const text = await response.text();
    throw new Error(readErrorMessage(text));
  }
  const text = await response.text();
  return (text ? JSON.parse(text) : undefined) as T;
}

/* ── GET cache ────────────────────────────────────────────────────────────
   Small in-memory cache so screens can paint the last known data instantly
   and concurrent callers share one request. */

const cache = new Map<string, unknown>();
const inflight = new Map<string, Promise<unknown>>();

/** Last successful response for this path, if any. */
export function peekCached<T>(path: string): T | undefined {
  return cache.get(path) as T | undefined;
}

/** Fetches the path (sharing any request already in flight) and stores the result. */
export function getFresh<T>(path: string): Promise<T> {
  const pending = inflight.get(path);
  if (pending) return pending as Promise<T>;
  const request = api<T>(path)
    .then((data) => {
      cache.set(path, data);
      return data;
    })
    .finally(() => inflight.delete(path));
  inflight.set(path, request);
  return request;
}

/** Drops cached responses whose path starts with `prefix` (everything when omitted). */
export function invalidateCache(prefix?: string): void {
  for (const key of Array.from(cache.keys())) {
    if (!prefix || key.startsWith(prefix)) cache.delete(key);
  }
}

// Never show one account's data to another
useAuthStore.subscribe((state, previous) => {
  if (state.user?.id !== previous.user?.id) {
    cache.clear();
    inflight.clear();
  }
});

/* ── Auth ───────────────────────────────────────────────────────────────── */

export interface AuthResponse {
  access_token: string;
  user: { id: string; email: string; name: string; avatar_url: string | null };
}

export async function login(email: string, password: string): Promise<AuthResponse> {
  return api<AuthResponse>('/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email, password }),
  });
}

export async function register(email: string, password: string, name: string): Promise<AuthResponse> {
  return api<AuthResponse>('/auth/register', {
    method: 'POST',
    body: JSON.stringify({ email, password, name }),
  });
}

/* ── Workspaces & projects ──────────────────────────────────────────────── */

export interface Workspace {
  id: string;
  name: string;
  slug: string;
  plan: string;
  owner_id: string;
  /** Pinned by the signed-in user; the server lists pinned workspaces first. */
  pinned?: boolean;
}

export const WORKSPACES_PATH = '/workspaces';

export async function listWorkspaces(): Promise<Workspace[]> {
  return getFresh<Workspace[]>(WORKSPACES_PATH);
}

export async function createWorkspace(name: string, slug: string): Promise<Workspace> {
  const workspace = await api<Workspace>('/workspaces', { method: 'POST', body: JSON.stringify({ name, slug }) });
  invalidateCache(WORKSPACES_PATH);
  return workspace;
}

export async function setWorkspacePinned(id: string, pinned: boolean): Promise<void> {
  await api(`/workspaces/${id}/pin`, { method: pinned ? 'PUT' : 'DELETE' });
  invalidateCache(WORKSPACES_PATH);
}

export async function renameWorkspace(id: string, name: string): Promise<Workspace> {
  const workspace = await api<Workspace>(`/workspaces/${id}`, { method: 'PATCH', body: JSON.stringify({ name }) });
  invalidateCache(WORKSPACES_PATH);
  return workspace;
}

/** Deletes the workspace and all of its projects. Owner only; not allowed for your last workspace. */
export async function deleteWorkspace(id: string): Promise<void> {
  await api(`/workspaces/${id}`, { method: 'DELETE' });
  invalidateCache(WORKSPACES_PATH);
  invalidateCache(`/projects?workspaceId=${encodeURIComponent(id)}`);
}

export interface ProjectSummary {
  id: string;
  workspace_id: string;
  name: string;
  description?: string;
  settings: Record<string, unknown>;
  updated_at: string;
  /** Pinned by the signed-in user (pins are personal). */
  pinned?: boolean;
}

export interface ProjectPage {
  /** Pinned projects first (on every page), then this page of unpinned ones. */
  items: ProjectSummary[];
  next_cursor?: string | null;
  /** Unpinned projects matching the search, across all pages. */
  total?: number;
  page?: number;
  page_size?: number;
}

export const PROJECTS_PAGE_SIZE = 12;

export function projectsPath(workspaceId: string, page = 1, q = ''): string {
  const params = new URLSearchParams({ workspaceId, page: String(page), limit: String(PROJECTS_PAGE_SIZE) });
  if (q.trim()) params.set('q', q.trim());
  return `/projects?${params.toString()}`;
}

/** One numbered page of a workspace's projects, optionally filtered by name. Cached per page. */
export async function listProjects(workspaceId: string, page = 1, q = ''): Promise<ProjectPage> {
  return getFresh<ProjectPage>(projectsPath(workspaceId, page, q));
}

export async function createProject(workspaceId: string, name: string): Promise<ProjectSummary> {
  const project = await api<ProjectSummary>('/projects', { method: 'POST', body: JSON.stringify({ workspace_id: workspaceId, name }) });
  invalidateCache('/projects');
  return project;
}

export async function renameProject(id: string, name: string): Promise<void> {
  await api(`/projects/${id}`, { method: 'PATCH', body: JSON.stringify({ name }) });
  invalidateCache('/projects');
}

export async function deleteProject(id: string): Promise<void> {
  await api(`/projects/${id}`, { method: 'DELETE' });
  invalidateCache('/projects');
}

export async function setProjectPinned(id: string, pinned: boolean): Promise<void> {
  await api(`/projects/${id}/pin`, { method: pinned ? 'PUT' : 'DELETE' });
  invalidateCache('/projects');
}
