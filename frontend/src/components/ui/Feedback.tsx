import { Loader2 } from 'lucide-react';
import type { ReactNode } from 'react';
import { cn } from '../../utils/cn';

export function Spinner({ className }: { className?: string }) {
  return <Loader2 aria-hidden className={cn('animate-spin', className ?? 'h-4 w-4')} />;
}

export function Skeleton({ className }: { className?: string }) {
  return <div aria-hidden className={cn('animate-pulse rounded-md bg-ink/[0.06]', className)} />;
}

interface EmptyStateProps {
  icon?: ReactNode;
  title: string;
  description?: ReactNode;
  action?: ReactNode;
  compact?: boolean;
  /** Big, page-level version: larger heading and text, for when it's the only thing on screen. */
  large?: boolean;
  className?: string;
}

export function EmptyState({ icon, title, description, action, compact, large, className }: EmptyStateProps) {
  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center text-center',
        compact ? 'gap-1.5 px-3 py-6' : large ? 'gap-3 px-6 py-10' : 'gap-2 px-6 py-14',
        className,
      )}
    >
      {icon && <div className={cn('text-fg-subtle', compact ? 'mb-1' : large ? 'mb-1' : 'mb-2')}>{icon}</div>}
      <p className={cn('font-semibold text-fg', compact ? 'text-xs font-medium' : large ? 'text-2xl tracking-tight' : 'text-sm font-medium')}>
        {title}
      </p>
      {description && (
        <p className={cn('text-fg-muted', compact ? 'max-w-xs text-2xs' : large ? 'max-w-md text-base' : 'max-w-xs text-sm')}>{description}</p>
      )}
      {action && <div className={large ? 'mt-4' : 'mt-3'}>{action}</div>}
    </div>
  );
}
