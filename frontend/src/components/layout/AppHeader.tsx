import { ChevronDown, LogOut, Search, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useAuthStore } from '../../state/authStore';
import { cn } from '../../utils/cn';
import { AnimatedThemeToggler } from '../ui/AnimatedThemeToggler';
import { Logo } from '../ui/Logo';

function initialsOf(name: string | undefined, email: string | undefined): string {
  const source = (name?.trim() || email?.split('@')[0] || '?').replace(/[^\p{L}\p{N}\s]/gu, ' ').trim();
  const parts = source.split(/\s+/).filter(Boolean);
  const letters = parts.length > 1 ? parts[0][0] + parts[1][0] : source.slice(0, 2);
  return letters.toUpperCase() || '?';
}

function Avatar({ initials, size }: { initials: string; size: 'sm' | 'md' }) {
  return (
    <span
      aria-hidden
      className={cn(
        'flex shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-accent to-sky-500 font-semibold text-canvas',
        size === 'sm' ? 'h-7 w-7 text-2xs' : 'h-10 w-10 text-sm',
      )}
    >
      {initials}
    </span>
  );
}

/** Avatar button with the account's name and email, and Sign out. */
function UserMenu() {
  const user = useAuthStore((state) => state.user);
  const clearAuth = useAuthStore((state) => state.clearAuth);
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    rootRef.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus();
    const onPointerDown = (e: PointerEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { setOpen(false); buttonRef.current?.focus(); }
    };
    window.addEventListener('pointerdown', onPointerDown);
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  const initials = initialsOf(user?.name, user?.email);
  const displayName = user?.name?.trim() || user?.email?.split('@')[0] || 'Account';

  return (
    <div ref={rootRef} className="relative">
      <button
        ref={buttonRef}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`Account: ${displayName}`}
        className={cn(
          'flex h-9 items-center gap-2 rounded-full py-1 pl-1 pr-2.5 transition-colors hover:bg-ink/[0.06]',
          open && 'bg-ink/[0.08]',
        )}
        onClick={() => setOpen((value) => !value)}
      >
        <Avatar initials={initials} size="sm" />
        <span className="hidden max-w-[10rem] truncate text-sm font-medium text-fg sm:block">{displayName}</span>
        <ChevronDown aria-hidden className={cn('h-3.5 w-3.5 text-fg-subtle transition-transform', open && 'rotate-180')} />
      </button>

      {open && (
        <div
          role="menu"
          aria-label="Account"
          className="absolute right-0 top-12 z-50 w-72 animate-pop-in overflow-hidden rounded-xl border border-border bg-raised shadow-menu"
        >
          <div className="flex items-center gap-3 p-4">
            <Avatar initials={initials} size="md" />
            <div className="min-w-0 space-y-0.5">
              <p className="truncate text-sm font-semibold leading-5 text-fg">{displayName}</p>
              <p className="truncate text-xs leading-4 text-fg-subtle">{user?.email}</p>
            </div>
          </div>
          <div className="border-t border-border p-1.5">
            <button
              type="button"
              role="menuitem"
              className="flex h-9 w-full items-center gap-2.5 rounded-lg px-2.5 text-left text-sm font-semibold text-fg-muted outline-none transition-colors hover:bg-ink/[0.06] hover:text-fg focus-visible:bg-ink/[0.06] focus-visible:text-fg"
              onClick={() => { setOpen(false); clearAuth(); }}
            >
              <LogOut aria-hidden className="h-4 w-4" />
              Sign out
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

interface AppHeaderProps {
  query: string;
  onQueryChange(query: string): void;
}

/** Top bar of the project list: brand, project search, theme, account. */
export function AppHeader({ query, onQueryChange }: AppHeaderProps) {
  const searchRef = useRef<HTMLInputElement>(null);
  const mobileSearchRef = useRef<HTMLInputElement>(null);
  // Phones show a search icon; tapping it opens the field across the whole bar
  const [mobileSearchOpen, setMobileSearchOpen] = useState(false);

  useEffect(() => {
    if (mobileSearchOpen) mobileSearchRef.current?.focus();
  }, [mobileSearchOpen]);

  const closeMobileSearch = () => {
    onQueryChange('');
    setMobileSearchOpen(false);
  };

  // "/" jumps to search from anywhere on the page, like most web apps
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== '/' || e.ctrlKey || e.metaKey || e.altKey) return;
      const target = e.target instanceof Element ? e.target : null;
      if (target?.closest('input, textarea, select, [contenteditable="true"]')) return;
      e.preventDefault();
      if (window.matchMedia('(min-width: 640px)').matches) searchRef.current?.focus();
      else setMobileSearchOpen(true);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  return (
    <header className="sticky top-0 z-20 grid h-16 shrink-0 grid-cols-[auto_1fr_auto] items-center gap-4 border-b border-border bg-panel/85 px-4 backdrop-blur-md sm:gap-8 sm:px-6">
      <Logo hideWordmarkOnMobile />

      {/* Tablet and up: the full search bar */}
      <div className="hidden justify-center sm:flex">
        <label className="group relative flex w-full max-w-md items-center">
          <span className="sr-only">Search projects</span>
          <Search aria-hidden className="pointer-events-none absolute left-3 h-4 w-4 text-fg-subtle transition-colors group-focus-within:text-fg-muted" />
          <input
            ref={searchRef}
            type="search"
            placeholder="Search projects"
            value={query}
            onChange={(e) => onQueryChange(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Escape') { onQueryChange(''); e.currentTarget.blur(); } }}
            className="h-10 w-full rounded-lg border border-transparent bg-ink/[0.05] pl-9 pr-9 text-sm text-fg placeholder:text-fg-subtle transition-colors hover:bg-ink/[0.07] focus:border-border-strong focus:bg-canvas focus:outline-none [&::-webkit-search-cancel-button]:hidden"
          />
          {query ? (
            <button
              type="button"
              aria-label="Clear search"
              className="absolute right-2 flex h-6 w-6 items-center justify-center rounded-md text-fg-subtle hover:bg-ink/10 hover:text-fg"
              onClick={() => { onQueryChange(''); searchRef.current?.focus(); }}
            >
              <X aria-hidden className="h-3.5 w-3.5" />
            </button>
          ) : (
            <kbd aria-hidden className="pointer-events-none absolute right-2.5 rounded border border-border-strong px-1.5 text-2xs leading-4 text-fg-subtle">
              /
            </kbd>
          )}
        </label>
      </div>
      {/* Phones: keep the middle empty; the icon lives with the other actions */}
      <div className="sm:hidden" />

      <div className="flex items-center gap-1 sm:gap-2">
        <button
          type="button"
          aria-label="Search projects"
          aria-expanded={mobileSearchOpen}
          className={cn(
            'relative flex h-9 w-9 items-center justify-center rounded-full text-fg-muted transition-colors hover:bg-ink/[0.06] hover:text-fg sm:hidden',
            query && 'text-accent',
          )}
          onClick={() => setMobileSearchOpen(true)}
        >
          <Search aria-hidden className="h-[18px] w-[18px]" />
          {/* A dot shows a search is still filtering the list after the field closes */}
          {query && <span aria-hidden className="absolute right-1.5 top-1.5 h-2 w-2 rounded-full bg-accent" />}
        </button>
        <AnimatedThemeToggler />
        <div aria-hidden className="h-5 w-px bg-border" />
        <UserMenu />
      </div>

      {/* Phones: the open search covers the whole bar */}
      {mobileSearchOpen && (
        <div className="absolute inset-0 z-10 flex animate-fade-in items-center gap-2 bg-panel px-3 sm:hidden">
          <label className="relative flex min-w-0 flex-1 items-center">
            <span className="sr-only">Search projects</span>
            <Search aria-hidden className="pointer-events-none absolute left-3 h-4 w-4 text-fg-subtle" />
            <input
              ref={mobileSearchRef}
              type="search"
              enterKeyHint="search"
              placeholder="Search projects"
              value={query}
              onChange={(e) => onQueryChange(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Escape') closeMobileSearch();
                if (e.key === 'Enter') { e.currentTarget.blur(); setMobileSearchOpen(false); }
              }}
              className="h-10 w-full rounded-lg border border-border-strong bg-canvas pl-9 pr-3 text-sm text-fg placeholder:text-fg-subtle focus:outline-none [&::-webkit-search-cancel-button]:hidden"
            />
          </label>
          <button
            type="button"
            aria-label="Close search"
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-fg-muted hover:bg-ink/[0.06] hover:text-fg"
            onClick={closeMobileSearch}
          >
            <X aria-hidden className="h-5 w-5" />
          </button>
        </div>
      )}
    </header>
  );
}
