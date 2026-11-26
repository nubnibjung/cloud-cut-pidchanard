import { create } from 'zustand';
import { useAuthStore } from '../state/authStore';
import { api, type AuthResponse } from './api';
import { API_BASE } from './config';

/* ── Server wake-up ───────────────────────────────────────────────────────
   The API may be asleep (free hosting tiers stop idle instances). Ping it the
   moment the app boots so it is warming up while the user types. */

type ServerStatus = 'checking' | 'waking' | 'ready' | 'unreachable';

export const useServerStatus = create<{ status: ServerStatus }>(() => ({ status: 'checking' }));

const RETRY_MS = 5000;
const MAX_RETRIES = 18; // ~90 seconds

let wakeStarted = false;

export function wakeServer(): void {
  if (wakeStarted) return;
  wakeStarted = true;

  const slow = window.setTimeout(() => {
    if (useServerStatus.getState().status === 'checking') useServerStatus.setState({ status: 'waking' });
  }, 2500);

  const attempt = async (tries: number) => {
    try {
      // No custom headers: a plain GET needs no CORS preflight
      const response = await fetch(`${API_BASE}/health`, { cache: 'no-store' });
      if (!response.ok) throw new Error(`health ${response.status}`);
      window.clearTimeout(slow);
      useServerStatus.setState({ status: 'ready' });
    } catch {
      if (tries >= MAX_RETRIES) {
        useServerStatus.setState({ status: 'unreachable' });
        return;
      }
      useServerStatus.setState({ status: 'waking' });
      window.setTimeout(() => attempt(tries + 1), RETRY_MS);
    }
  };
  void attempt(0);
}

/* ── Session keep-alive ───────────────────────────────────────────────────
   Access tokens are short-lived. Swap them for a fresh one shortly before
   they expire so an active user is never bounced to the sign-in page. */

const REFRESH_BEFORE_MS = 5 * 60 * 1000;

function tokenExpiryMs(token: string): number | null {
  try {
    const payload = token.split('.')[1];
    const json = atob(payload.replace(/-/g, '+').replace(/_/g, '/'));
    const exp = (JSON.parse(json) as { exp?: unknown }).exp;
    return typeof exp === 'number' ? exp * 1000 : null;
  } catch {
    return null;
  }
}

let refreshTimer: number | undefined;
let refreshing = false;

async function refreshNow(): Promise<void> {
  const { token, user } = useAuthStore.getState();
  if (!token || refreshing) return;
  refreshing = true;
  try {
    const result = await api<AuthResponse>('/auth/refresh', { method: 'POST' });
    const nextUser = result.user ?? user;
    if (result.access_token && nextUser) useAuthStore.getState().setAuth(result.access_token, nextUser);
  } catch {
    // Offline or server asleep: try again shortly (a 401 has already signed the user out)
    refreshTimer = window.setTimeout(schedule, 30_000);
  } finally {
    refreshing = false;
  }
}

function schedule(): void {
  window.clearTimeout(refreshTimer);
  const token = useAuthStore.getState().token;
  if (!token) return;
  const expiry = tokenExpiryMs(token);
  if (!expiry) return;

  const now = Date.now();
  if (expiry <= now) {
    useAuthStore.getState().clearAuth();
    return;
  }
  const delay = expiry - now - REFRESH_BEFORE_MS;
  if (delay <= 0) void refreshNow();
  else refreshTimer = window.setTimeout(refreshNow, Math.min(delay, 2 ** 31 - 1));
}

let sessionStarted = false;

export function startSessionKeepAlive(): void {
  if (sessionStarted) return;
  sessionStarted = true;
  schedule();
  useAuthStore.subscribe((state, previous) => {
    if (state.token !== previous.token) schedule();
  });
  // Timers are throttled in background tabs — re-check when the tab comes back
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') schedule();
  });
}
