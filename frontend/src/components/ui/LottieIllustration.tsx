import { Film, Search } from 'lucide-react';
import { lazy, Suspense, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useThemeStore } from '../../state/themeStore';
import { cn } from '../../utils/cn';

// The player and each animation load only when shown. None of the animations use
// expressions, so the light build of the engine is enough.
const LottieLight = lazy(() => import('lottie-react').then((m) => ({ default: m.LottieLight })));

interface Illustration {
  load(): Promise<{ default: unknown }>;
  /** Static icon shown while the animation loads. */
  fallback: ReactNode;
  /** Fill/stroke colour swaps for dark mode, keyed by the file's own hex colours. */
  darkPalette?: Record<string, string>;
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
} satisfies Record<string, Illustration>;

export type IllustrationName = keyof typeof ILLUSTRATIONS;

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
  const [data, setData] = useState<object | null>(null);
  const theme = useThemeStore((state) => state.theme);
  const reducedMotion = usePrefersReducedMotion();

  useEffect(() => {
    let cancelled = false;
    setData(null);
    illustration.load().then((module) => {
      if (!cancelled) setData(module.default as object);
    });
    return () => { cancelled = true; };
  }, [illustration]);

  const themed = useMemo(() => {
    if (!data) return null;
    return theme === 'dark' && illustration.darkPalette ? recolor(data, illustration.darkPalette) : data;
  }, [data, theme, illustration]);

  return (
    <div aria-hidden className={cn('flex items-center justify-center', className)}>
      {themed ? (
        <Suspense fallback={illustration.fallback}>
          <LottieLight
            key={`${name}-${theme}`}
            src={themed}
            loop={!reducedMotion}
            autoplay={!reducedMotion}
            className="h-full w-full"
          />
        </Suspense>
      ) : (
        illustration.fallback
      )}
    </div>
  );
}
