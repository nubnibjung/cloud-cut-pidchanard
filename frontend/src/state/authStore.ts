import { create } from 'zustand';

interface AuthUser {
  id: string;
  email: string;
  name: string;
  avatar_url: string | null;
}

interface AuthState {
  token: string | null;
  user: AuthUser | null;
  setAuth(token: string, user: AuthUser): void;
  clearAuth(): void;
}

const stored = localStorage.getItem('cc_token');
const storedUser = localStorage.getItem('cc_user');

export const useAuthStore = create<AuthState>((set) => ({
  token: stored ?? null,
  user: storedUser ? (JSON.parse(storedUser) as AuthUser) : null,
  setAuth(token, user) {
    localStorage.setItem('cc_token', token);
    localStorage.setItem('cc_user', JSON.stringify(user));
    set({ token, user });
  },
  clearAuth() {
    localStorage.removeItem('cc_token');
    localStorage.removeItem('cc_user');
    set({ token: null, user: null });
  },
}));
