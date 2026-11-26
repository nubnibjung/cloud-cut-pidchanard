import type { CSSProperties } from 'react';
import { cn } from '../../utils/cn';

interface ShimmeringTextProps {
  text: string;
  className?: string;
  /** Base colour of the text, as a CSS colour (defaults to the muted text colour). */
  color?: string;
  /** Colour of the band of light that sweeps across. */
  shimmerColor?: string;
  /** Seconds per sweep. */
  duration?: number;
}

/**
 * Text with a band of light sweeping across it, for "something is happening" labels
 * such as Processing or Uploading. Pure CSS (a moving gradient clipped to the
 * glyphs), so it costs nothing per character. Holds still under reduced motion.
 */
export function ShimmeringText({
  text,
  className,
  color = 'rgb(var(--c-fg-muted))',
  shimmerColor = 'rgb(var(--c-fg))',
  duration = 1.6,
}: ShimmeringTextProps) {
  const style = {
    '--shimmer-base': color,
    '--shimmer-highlight': shimmerColor,
    '--shimmer-duration': `${duration}s`,
  } as CSSProperties;

  return (
    <span className={cn('shimmer-text', className)} style={style}>
      {text}
    </span>
  );
}
