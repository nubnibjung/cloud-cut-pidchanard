import { useId } from 'react';
import { cn } from '../../utils/cn';

export const APP_NAME = 'Snipline';

/**
 * The Snipline mark: two clip bars offset like timeline tracks, cut through by a
 * diagonal slash. Together they read as an "S" and as a clip being snipped.
 * The cut is a mask (real transparency), so the mark works on any background.
 */
export function LogoMark({ className, title }: { className?: string; title?: string }) {
  const maskId = useId();
  return (
    <svg
      viewBox="0 0 32 32"
      className={cn('shrink-0', className)}
      role={title ? 'img' : undefined}
      aria-label={title}
      aria-hidden={title ? undefined : true}
    >
      <defs>
        <mask id={maskId} maskUnits="userSpaceOnUse" x="0" y="0" width="32" height="32">
          <rect width="32" height="32" fill="white" />
          {/* The snip */}
          <path d="M20.5 4.5 11.5 27.5" stroke="black" strokeWidth="3.2" strokeLinecap="round" />
        </mask>
      </defs>
      <g mask={`url(#${maskId})`} fill="currentColor">
        {/* Upper track, then the lower track shifted right */}
        <rect x="3" y="7.5" width="18" height="7" rx="3.5" />
        <rect x="11" y="17.5" width="18" height="7" rx="3.5" />
      </g>
      {/* Playhead dot riding the cut */}
      <circle cx="16" cy="16" r="1.6" fill="currentColor" opacity="0.55" />
    </svg>
  );
}

/** Mark in a soft tile — the app icon as used in headers. */
export function LogoTile({ className, size = 'md' }: { className?: string; size?: 'md' | 'lg' }) {
  return (
    <span
      className={cn(
        'flex shrink-0 items-center justify-center bg-accent/15 text-accent',
        size === 'lg' ? 'h-14 w-14 rounded-2xl' : 'h-8 w-8 rounded-lg',
        className,
      )}
    >
      <LogoMark className={size === 'lg' ? 'h-9 w-9' : 'h-5 w-5'} />
    </span>
  );
}

/** "Snipline" with the dot of the i in the theme colour. */
export function Wordmark({ className }: { className?: string }) {
  return (
    <span className={cn('font-semibold tracking-tight text-fg', className)} aria-label={APP_NAME}>
      <span aria-hidden>
        Sn
        <span className="relative inline-block">
          {/* dotless i + our own dot */}
          {'ı'}
          <span className="absolute left-1/2 top-[0.12em] h-[0.2em] w-[0.2em] -translate-x-1/2 rounded-full bg-accent" />
        </span>
        pline
      </span>
    </span>
  );
}

/** Tile + wordmark, side by side. */
export function Logo({ className, hideWordmarkOnMobile }: { className?: string; hideWordmarkOnMobile?: boolean }) {
  return (
    <span className={cn('flex items-center gap-2.5', className)}>
      <LogoTile />
      <Wordmark className={cn('text-[15px]', hideWordmarkOnMobile && 'hidden sm:inline')} />
    </span>
  );
}
