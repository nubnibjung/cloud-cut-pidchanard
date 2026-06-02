import { useAuthStore } from '../state/authStore';

const API_BASE = import.meta.env.VITE_API_BASE ?? 'http://localhost:8080';

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
    'content-type': 'application/json',
    ...(init?.headers as Record<string, string> | undefined ?? {}),
  };
  if (token) {
    headers['authorization'] = `Bearer ${token}`;
  }

  const response = await fetch(`${API_BASE}${path}`, { ...init, headers });

  if (response.status === 401) {
    useAuthStore.getState().clearAuth();
    throw new Error('Unauthorized');
  }
  if (!response.ok) {
    const text = await response.text();
    throw new Error(readErrorMessage(text));
  }
  return response.json() as Promise<T>;
}

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

export interface Workspace {
  id: string;
  name: string;
  slug: string;
  plan: string;
  owner_id: string;
}

export async function listWorkspaces(): Promise<Workspace[]> {
  return api<Workspace[]>('/workspaces');
}

export async function createWorkspace(name: string, slug: string): Promise<Workspace> {
  return api<Workspace>('/workspaces', { method: 'POST', body: JSON.stringify({ name, slug }) });
}

export interface ProjectSummary {
  id: string;
  workspace_id: string;
  name: string;
  description?: string;
  settings: Record<string, unknown>;
  updated_at: string;
}

export async function listProjects(workspaceId: string, cursor?: string): Promise<{ items: ProjectSummary[]; next_cursor?: string }> {
  const qs = cursor ? `?workspaceId=${workspaceId}&cursor=${cursor}` : `?workspaceId=${workspaceId}`;
  return api(`/projects${qs}`);
}

export async function createProject(workspaceId: string, name: string): Promise<ProjectSummary> {
  return api('/projects', { method: 'POST', body: JSON.stringify({ workspace_id: workspaceId, name }) });
}
