import { Moon, Sun } from 'lucide-react';
import { useRef } from 'react';
import { flushSync } from 'react-dom';
import { useThemeStore } from '../../state/themeStore';
import { cn } from '../../utils/cn';

interface Props {
  className?: string;
  /** Length of the reveal in milliseconds. */
  duration?: number;
}

type ViewTransitionDocument = Document & {
  startViewTransition?: (update: () => void) => { ready: Promise<void> };
};

/**
 * Sun/moon button that switches light and dark. The new theme is revealed as a
 * circle growing out of the button (View Transitions API); browsers without it,
 * or users who prefer reduced motion, get an instant switch.
 */
export function AnimatedThemeToggler({ className, duration = 450 }: Props) {
  const theme = useThemeStore((state) => state.theme);
  const setPreference = useThemeStore((state) => state.setPreference);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const next = theme === 'dark' ? 'light' : 'dark';

  const toggle = async () => {
    const doc = document as ViewTransitionDocument;
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const button = buttonRef.current;
    if (!doc.startViewTransition || reduced || !button) {
      setPreference(next);
      return;
    }

    const rect = button.getBoundingClientRect();
    const x = rect.left + rect.width / 2;
    const y = rect.top + rect.height / 2;
    // Far enough to cover the corner of the window farthest from the button
    const radius = Math.hypot(Math.max(x, window.innerWidth - x), Math.max(y, window.innerHeight - y));

    const transition = doc.startViewTransition(() => {
      flushSync(() => setPreference(next));
    });
    try {
      await transition.ready;
    } catch {
      return; // transition skipped — the theme has still changed
    }
    document.documentElement.animate(
      { clipPath: [`circle(0px at ${x}px ${y}px)`, `circle(${radius}px at ${x}px ${y}px)`] },
      { duration, easing: 'cubic-bezier(0.4, 0, 0.2, 1)', pseudoElement: '::view-transition-new(root)' },
    );
  };

  return (
    <button
      ref={buttonRef}
      type="button"
      aria-label={`Switch to ${next} mode`}
      title={`Switch to ${next} mode`}
      className={cn(
        'relative flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-full text-fg-muted transition-colors hover:bg-ink/[0.06] hover:text-fg',
        className,
      )}
      onClick={() => void toggle()}
    >
      <Sun
        aria-hidden
        className={cn(
          'absolute h-[18px] w-[18px] transition-all duration-300',
          theme === 'dark' ? 'rotate-0 scale-100 opacity-100' : '-rotate-90 scale-50 opacity-0',
        )}
      />
      <Moon
        aria-hidden
        className={cn(
          'absolute h-[18px] w-[18px] transition-all duration-300',
          theme === 'light' ? 'rotate-0 scale-100 opacity-100' : 'rotate-90 scale-50 opacity-0',
        )}
      />
    </button>
  );
}
