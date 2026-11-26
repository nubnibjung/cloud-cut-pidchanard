import { create } from 'zustand';

export interface ToastAction {
  label: string;
  onClick(): void;
}

export interface Toast {
  id: string;
  kind: 'info' | 'error';
  message: string;
  action?: ToastAction;
}

interface ToastState {
  toasts: Toast[];
  push(toast: Omit<Toast, 'id'>, durationMs?: number): string;
  dismiss(id: string): void;
}

export const useToastStore = create<ToastState>((set, get) => ({
  toasts: [],
  push(toast, durationMs = 5000) {
    // Don't stack the same message twice
    const existing = get().toasts.find((t) => t.message === toast.message && t.kind === toast.kind);
    if (existing) return existing.id;
    const id = crypto.randomUUID();
    set((state) => ({ toasts: [...state.toasts.slice(-3), { ...toast, id }] }));
    window.setTimeout(() => get().dismiss(id), durationMs);
    return id;
  },
  dismiss(id) {
    set((state) => ({ toasts: state.toasts.filter((t) => t.id !== id) }));
  },
}));

function messageOf(err: unknown, fallback: string): string {
  if (!(err instanceof Error) || !err.message || err.message === 'Unauthorized') return fallback;
  // Browser wording for "no network / server down" — not useful to show as-is
  if (err instanceof TypeError || err.message === 'Failed to fetch') return `${fallback}. The server can't be reached.`;
  return err.message;
}

export const toast = {
  info(message: string, action?: ToastAction, durationMs?: number) {
    return useToastStore.getState().push({ kind: 'info', message, action }, durationMs);
  },
  error(message: string) {
    return useToastStore.getState().push({ kind: 'error', message }, 7000);
  },
  /** Use as `.catch(toast.fromError('Could not save'))`. */
  fromError(fallback: string) {
    return (err: unknown) => {
      console.error(err);
      useToastStore.getState().push({ kind: 'error', message: messageOf(err, fallback) }, 7000);
    };
  },
  dismiss(id: string) {
    useToastStore.getState().dismiss(id);
  },
};

// Dev only: hot-swapping this module would create a second, empty store while
// components still hold the old one. Reload the page instead.
if (import.meta.hot) {
  import.meta.hot.accept(() => window.location.reload());
}
