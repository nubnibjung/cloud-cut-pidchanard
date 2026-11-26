import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { cn } from '../../utils/cn';
import { Spinner } from './Feedback';

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'dangerOutline';
type Size = 'sm' | 'md' | 'lg';

const BASE =
  'inline-flex shrink-0 select-none items-center justify-center gap-1.5 whitespace-nowrap font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-40';

const VARIANTS: Record<Variant, string> = {
  primary: 'bg-accent text-on-accent hover:bg-accent/90 enabled:active:bg-accent/80',
  secondary: 'border border-border bg-surface text-fg hover:border-border-strong hover:bg-raised',
  ghost: 'text-fg-muted hover:bg-ink/5 hover:text-fg',
  danger: 'bg-danger-solid text-white hover:bg-red-500',
  dangerOutline: 'border border-danger/40 text-danger hover:bg-danger/10',
};

const SIZES: Record<Size, string> = {
  sm: 'h-7 rounded-md px-2.5 text-xs',
  md: 'h-8 rounded-md px-3 text-sm',
  lg: 'h-11 rounded-full px-5 text-sm',
};

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  loading?: boolean;
}

export function Button({ variant = 'secondary', size = 'md', loading, disabled, className, children, type = 'button', ...rest }: ButtonProps) {
  return (
    <button
      type={type}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={cn(BASE, VARIANTS[variant], SIZES[size], className)}
      {...rest}
    >
      {loading && <Spinner className="h-3.5 w-3.5" />}
      {children}
    </button>
  );
}

interface IconButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'aria-label' | 'children'> {
  /** Accessible name; also shown as the tooltip unless `title` is given. */
  label: string;
  children: ReactNode;
  variant?: 'ghost' | 'outline' | 'danger';
  size?: 'sm' | 'md';
  active?: boolean;
}

const ICON_VARIANTS = {
  ghost: 'text-fg-muted hover:bg-ink/10 hover:text-fg',
  outline: 'border border-border text-fg-muted hover:border-border-strong hover:bg-ink/5 hover:text-fg',
  danger: 'border border-danger/40 text-danger hover:bg-danger/10',
};

export function IconButton({ label, title, variant = 'ghost', size = 'md', active, className, children, type = 'button', ...rest }: IconButtonProps) {
  return (
    <button
      type={type}
      aria-label={label}
      title={title ?? label}
      className={cn(
        'inline-flex shrink-0 items-center justify-center rounded-md transition-colors disabled:cursor-not-allowed disabled:opacity-35',
        size === 'sm' ? 'h-7 w-7' : 'h-8 w-8',
        ICON_VARIANTS[variant],
        active && 'bg-ink/10 text-fg',
        className,
      )}
      {...rest}
    >
      {children}
    </button>
  );
}
