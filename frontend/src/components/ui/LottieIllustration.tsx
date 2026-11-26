import { AlertCircle, Clapperboard, Film, Search } from 'lucide-react';
import { useEffect, useMemo, useRef, useState, type ComponentType, type ReactNode } from 'react';
import { useThemeStore } from '../../state/themeStore';
import { cn } from '../../utils/cn';

// The player and each animation load on demand, and are kept once loaded so the next
// time they show on the very first frame. None of the animations use expressions,
// so the light build of the engine is enough.
// (lottie-react would pull in the full ~200 KB-gzip engine; the light SVG build is a fraction.)
type PlayerProps = { src: object; loop?: boolean; autoplay?: boolean; className?: string };
type Player = ComponentType<PlayerProps>;
let player: Player | null = null;
let playerPromise: Promise<Player> | null = null;
const loadPlayer = () =>
  (playerPromise ??= import('lottie-web/build/player/lottie_light')
    .then(({ default: lottie }) => {
      const LightPlayer = ({ src, loop = true, autoplay = true, className }: PlayerProps) => {
        const ref = useRef<HTMLDivElement>(null);
        useEffect(() => {
          if (!ref.current) return;
          const anim = lottie.loadAnimation({ container: ref.current, renderer: 'svg', loop, autoplay, animationData: src });
          return () => anim.destroy();
        }, [src, loop, autoplay]);
        return <div ref={ref} className={className} />;
      };
      return (player = LightPlayer);
    })
    .catch((err) => { playerPromise = null; throw err; })); // let a later attempt retry

interface Illustration {
  load(): Promise<{ default: unknown }>;
  /** Static icon shown while the animation loads. */
  fallback: ReactNode;
  /** Fill/stroke colour swaps for dark mode, keyed by the file's own hex colours. */
  darkPalette?: Record<string, string>;
  /** Same, for light mode. */
  lightPalette?: Record<string, string>;
}

const ILLUSTRATIONS = {
  /** "404" with balloons — empty search results. */
  'not-found': {
    load: () => import('../../assets/lottie/not-found.json'),
    fallback: <Search aria-hidden className="h-9 w-9 text-fg-subtle" />,
    // Drawn for light backgrounds: on dark, the pale blob and clouds would glare,
    // so they turn deep teal, the "404" text turns light, and the palest blues deepen.
    darkPalette: {
      '#d7f0e9': '#183230',
      '#e3f8f2': '#1d3a37',
      '#ffffff': '#2b4a4d',
      '#7a827b': '#c8d6d2',
      '#637e7f': '#a7c2c2',
      '#bce0e8': '#4f8792',
      '#ace0e8': '#478b96',
      '#9fc0ca': '#5f8d97',
      '#8cd0d8': '#5fb3bd',
      '#80a9b0': '#6b9aa2',
      '#63b7bd': '#4fb0b7',
      '#559da1': '#3f9196',
    },
  },
  /** Clapperboard snapping — a workspace with no projects yet. Reads well on both themes. */
  'cut-video': {
    load: () => import('../../assets/lottie/cut-video.json'),
    fallback: <Film aria-hidden className="h-9 w-9 text-fg-subtle" />,
  },
  /** Unplugged cable with "404" — something failed to load or crashed. */
  error: {
    load: () => import('../../assets/lottie/error.json'),
    fallback: <AlertCircle aria-hidden className="h-9 w-9 text-danger" />,
    // Drawn in two dark greys: use the theme's text colours so it reads on both.
    lightPalette: { '#262626': '#0c1f22', '#383838': '#405c60' },
    darkPalette: { '#262626': '#ecf6f5', '#383838': '#9bb4b4' },
  },
  /** Tablet filling with clips, then a play button — an export is rendering. */
  rendering: {
    load: () => import('../../assets/lottie/rendering.json'),
    fallback: <Clapperboard aria-hidden className="h-9 w-9 text-accent" />,
    // The light-blue clips take the app's teal; the dark tablet reads on both themes.
    lightPalette: { '#63b8e8': '#0d9494' },
    darkPalette: { '#63b8e8': '#2bd4c8', '#4c4c4c': '#2a3d40' },
  },
} satisfies Record<string, Illustration>;

export type IllustrationName = keyof typeof ILLUSTRATIONS;

const loaded = new Map<IllustrationName, object>();
const loadData = (name: IllustrationName) =>
  loaded.has(name)
    ? Promise.resolve(loaded.get(name)!)
    : (ILLUSTRATIONS[name] as Illustration).load().then((m) => {
        loaded.set(name, m.default as object);
        return m.default as object;
      });

/**
 * Fetches the player and an animation ahead of time. Used for the error screens,
 * which tend to appear exactly when the network is down and a late download would fail.
 */
export function preloadIllustration(name: IllustrationName) {
  return Promise.all([loadPlayer(), loadData(name)]).catch(() => { /* retried when shown */ });
}

const toHex = (rgb: number[]) =>
  '#' + rgb.slice(0, 3).map((v) => Math.round(v * 255).toString(16).padStart(2, '0')).join('');
const fromHex = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);

/** Returns a copy of the animation with every static fill/stroke colour passed through `palette`. */
function recolor(data: object, palette: Record<string, string>): object {
  const walk = (node: unknown): unknown => {
    if (Array.isArray(node)) return node.map(walk);
    if (!node || typeof node !== 'object') return node;
    const out: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(node)) out[key] = walk(value);
    const color = out.c as { a?: number; k?: unknown } | undefined;
    if ((out.ty === 'fl' || out.ty === 'st') && color?.a === 0 && Array.isArray(color.k)) {
      const k = color.k as number[];
      const mapped = palette[toHex(k)];
      if (mapped) out.c = { ...color, k: [...fromHex(mapped), k[3] ?? 1] };
    }
    return out;
  };
  return walk(data) as object;
}

function usePrefersReducedMotion() {
  const [reduced, setReduced] = useState(() => window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  useEffect(() => {
    const media = window.matchMedia('(prefers-reduced-motion: reduce)');
    const onChange = () => setReduced(media.matches);
    media.addEventListener('change', onChange);
    return () => media.removeEventListener('change', onChange);
  }, []);
  return reduced;
}

/** Looping Lottie illustration for empty states, coloured for the current theme. */
export function LottieIllustration({ name, className }: { name: IllustrationName; className?: string }) {
  const illustration: Illustration = ILLUSTRATIONS[name];
  const [data, setData] = useState<object | null>(() => loaded.get(name) ?? null);
  const [Lottie, setLottie] = useState<Player | null>(() => player);
  const theme = useThemeStore((state) => state.theme);
  const reducedMotion = usePrefersReducedMotion();

  useEffect(() => {
    let cancelled = false;
    setData(loaded.get(name) ?? null);
    Promise.all([loadPlayer(), loadData(name)])
      .then(([p, d]) => { if (!cancelled) { setLottie(() => p); setData(d); } })
      .catch(() => { /* offline: keep the static icon */ });
    return () => { cancelled = true; };
  }, [name]);

  const themed = useMemo(() => {
    if (!data) return null;
    const palette = theme === 'dark' ? illustration.darkPalette : illustration.lightPalette;
    return palette ? recolor(data, palette) : data;
  }, [data, theme, illustration]);

  return (
    <div aria-hidden className={cn('flex items-center justify-center', className)}>
      {themed && Lottie ? (
        <Lottie
          key={`${name}-${theme}`}
          src={themed}
          loop={!reducedMotion}
          autoplay={!reducedMotion}
          className="h-full w-full"
        />
      ) : (
        illustration.fallback
      )}
    </div>
  );
}
