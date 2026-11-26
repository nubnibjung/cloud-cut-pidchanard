import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { cn } from '../../utils/cn';
import { IconButton } from './Button';

export interface MenuItem {
  label: string;
  icon?: ReactNode;
  danger?: boolean;
  onSelect(): void;
}

interface MenuProps {
  /** Accessible name of the trigger button. */
  label: string;
  trigger: ReactNode;
  items: MenuItem[];
  className?: string;
}

/** Icon-button trigger with a small dropdown. Arrow keys, Home/End, Enter and Escape all work. */
export function Menu({ label, trigger, items, className }: MenuProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    listRef.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus();
    const onPointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    window.addEventListener('pointerdown', onPointerDown);
    return () => window.removeEventListener('pointerdown', onPointerDown);
  }, [open]);

  const close = (refocus = true) => {
    setOpen(false);
    if (refocus) rootRef.current?.querySelector<HTMLElement>('button')?.focus();
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const options = Array.from(listRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? []);
    const index = options.indexOf(document.activeElement as HTMLElement);
    if (event.key === 'Escape') { event.stopPropagation(); close(); }
    else if (event.key === 'ArrowDown') { event.preventDefault(); options[(index + 1) % options.length]?.focus(); }
    else if (event.key === 'ArrowUp') { event.preventDefault(); options[(index - 1 + options.length) % options.length]?.focus(); }
    else if (event.key === 'Home') { event.preventDefault(); options[0]?.focus(); }
    else if (event.key === 'End') { event.preventDefault(); options[options.length - 1]?.focus(); }
    else if (event.key === 'Tab') close(false);
  };

  return (
    <div ref={rootRef} className={cn('relative', className)}>
      <IconButton
        label={label}
        size="sm"
        aria-haspopup="menu"
        aria-expanded={open}
        active={open}
        onClick={(event) => { event.stopPropagation(); setOpen((value) => !value); }}
      >
        {trigger}
      </IconButton>
      {open && (
        <div
          ref={listRef}
          role="menu"
          aria-label={label}
          className="absolute right-0 top-8 z-50 min-w-36 animate-pop-in rounded-lg border border-border bg-raised p-1 shadow-menu"
          onKeyDown={onKeyDown}
        >
          {items.map((item) => (
            <button
              key={item.label}
              type="button"
              role="menuitem"
              className={cn(
                'flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-sm font-semibold outline-none transition-colors',
                item.danger
                  ? 'text-danger hover:bg-danger/10 focus-visible:bg-danger/10'
                  : 'text-fg hover:bg-ink/[0.07] focus-visible:bg-ink/[0.07]',
              )}
              onClick={(event) => { event.stopPropagation(); close(false); item.onSelect(); }}
            >
              {item.icon}
              {item.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
