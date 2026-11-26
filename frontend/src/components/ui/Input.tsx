import type { InputHTMLAttributes, Ref, SelectHTMLAttributes } from 'react';
import { cn } from '../../utils/cn';

const CONTROL =
  'rounded-md border border-border bg-canvas text-fg placeholder:text-fg-subtle transition-colors hover:border-border-strong focus:border-accent focus:outline-none disabled:opacity-50';

const SIZES = {
  sm: 'h-7 px-2 text-xs',
  md: 'h-8 px-3 text-sm',
};

interface InputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'size'> {
  controlSize?: keyof typeof SIZES;
  /** React 19 passes ref as a regular prop; it lands on the <input>. */
  ref?: Ref<HTMLInputElement>;
}

export function Input({ controlSize = 'md', className, ...rest }: InputProps) {
  return <input className={cn(CONTROL, SIZES[controlSize], className)} {...rest} />;
}

interface SelectProps extends Omit<SelectHTMLAttributes<HTMLSelectElement>, 'size'> {
  controlSize?: keyof typeof SIZES;
}

export function Select({ controlSize = 'md', className, children, ...rest }: SelectProps) {
  return (
    <select className={cn(CONTROL, SIZES[controlSize], 'cursor-pointer pr-1', className)} {...rest}>
      {children}
    </select>
  );
}

interface SliderProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'type' | 'aria-label'> {
  /** Accessible name — sliders have no visible text of their own. */
  label: string;
}

export function Slider({ label, className, ...rest }: SliderProps) {
  return <input type="range" aria-label={label} className={cn('min-w-0', className)} {...rest} />;
}
