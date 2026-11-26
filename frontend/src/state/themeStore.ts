import { create } from 'zustand';

export type ThemePreference = 'light' | 'dark' | 'system';
export type Theme = 'light' | 'dark';

const STORAGE_KEY = 'cc_theme';
const media = window.matchMedia('(prefers-color-scheme: light)');

function readPreference(): ThemePreference {
  const saved = localStorage.getItem(STORAGE_KEY);
  return saved === 'light' || saved === 'dark' || saved === 'system' ? saved : 'dark';
}

function resolve(preference: ThemePreference): Theme {
  if (preference === 'system') return media.matches ? 'light' : 'dark';
  return preference;
}

function apply(theme: Theme) {
  const root = document.documentElement;
  if (theme === 'light') root.dataset.theme = 'light';
  else delete root.dataset.theme;
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', theme === 'light' ? '#f0f7f7' : '#081113');
  document.querySelector('meta[name="color-scheme"]')?.setAttribute('content', theme);
}

interface ThemeState {
  preference: ThemePreference;
  theme: Theme;
  setPreference(preference: ThemePreference): void;
}

const initial = readPreference();

export const useThemeStore = create<ThemeState>((set) => ({
  preference: initial,
  theme: resolve(initial),
  setPreference(preference) {
    localStorage.setItem(STORAGE_KEY, preference);
    const theme = resolve(preference);
    apply(theme);
    set({ preference, theme });
  },
}));

apply(resolve(initial));

// Follow the operating system while the preference is "system"
media.addEventListener('change', () => {
  const { preference } = useThemeStore.getState();
  if (preference !== 'system') return;
  const theme = resolve('system');
  apply(theme);
  useThemeStore.setState({ theme });
});

// Dev only: see projectStore — reload rather than hot-swap a store
if (import.meta.hot) {
  import.meta.hot.accept(() => window.location.reload());
}
