import { useEffect, useId, useRef, type ReactNode } from 'react';
import { cn } from '../../utils/cn';

interface ModalProps {
  title: string;
  onClose(): void;
  /** Short line under the title, beside the icon. */
  description?: ReactNode;
  /** Form fields etc. — spans the full width of the dialog, below the header. */
  children?: ReactNode;
  /** Buttons row, right-aligned. */
  footer?: ReactNode;
  icon?: ReactNode;
}

const FOCUSABLE = 'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function Modal({ title, onClose, description, children, footer, icon }: ModalProps) {
  const titleId = useId();
  const descriptionId = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const panel = panelRef.current;
    // Focus the first control in the footer-less body, falling back to the panel
    (panel?.querySelector<HTMLElement>('[data-autofocus]') ?? panel?.querySelector<HTMLElement>(FOCUSABLE) ?? panel)?.focus();

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        onCloseRef.current();
        return;
      }
      if (event.key !== 'Tab' || !panel) return;
      const items = Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE));
      if (items.length === 0) return;
      const first = items[0];
      const last = items[items.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', onKeyDown, true);
    return () => {
      document.removeEventListener('keydown', onKeyDown, true);
      previous?.focus?.();
    };
  }, []);

  // Phones: swipe the drawer down by its handle to dismiss it
  const dragStart = useRef<number | null>(null);
  const onHandlePointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    dragStart.current = event.clientY;
    event.currentTarget.setPointerCapture(event.pointerId);
    if (panelRef.current) panelRef.current.style.transition = 'none';
  };
  const onHandlePointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    if (dragStart.current === null || !panelRef.current) return;
    const dy = Math.max(0, event.clientY - dragStart.current);
    panelRef.current.style.transform = `translateY(${dy}px)`;
  };
  const onHandlePointerUp = (event: React.PointerEvent<HTMLDivElement>) => {
    if (dragStart.current === null || !panelRef.current) return;
    const dy = event.clientY - dragStart.current;
    dragStart.current = null;
    const panel = panelRef.current;
    panel.style.transition = 'transform 200ms cubic-bezier(0.22, 1, 0.36, 1)';
    if (dy > 90) {
      panel.style.transform = 'translateY(100%)';
      window.setTimeout(() => onCloseRef.current(), 180);
    } else {
      panel.style.transform = '';
    }
  };

  return (
    <div
      className="fixed inset-0 z-[100] flex animate-fade-in items-end justify-center bg-black/60 backdrop-blur-sm sm:items-center sm:px-4"
      onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={description ? descriptionId : undefined}
        tabIndex={-1}
        className={cn(
          'w-full border border-border bg-surface shadow-card outline-none',
          // Phones: a bottom drawer that slides up and respects the home-indicator area
          'max-h-[90dvh] animate-sheet-up overflow-y-auto rounded-t-3xl border-b-0 px-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] pt-2',
          // Tablet and up: a centred dialog
          'sm:max-w-md sm:animate-pop-in sm:rounded-2xl sm:border-b sm:p-6',
        )}
      >
        <div
          aria-hidden
          className="-mx-5 mb-3 flex cursor-grab touch-none justify-center pb-2 pt-1 active:cursor-grabbing sm:hidden"
          onPointerDown={onHandlePointerDown}
          onPointerMove={onHandlePointerMove}
          onPointerUp={onHandlePointerUp}
          onPointerCancel={onHandlePointerUp}
        >
          <span className="h-1.5 w-10 rounded-full bg-border-strong" />
        </div>
        {/* Icon and title share one row; text, fields and buttons sit below at full
            width, starting from the icon's left edge — no indented empty column. */}
        <div className="flex items-center gap-3">
          {icon && <div className="shrink-0">{icon}</div>}
          <h2 id={titleId} className="min-w-0 text-lg font-semibold leading-6 tracking-tight text-fg">{title}</h2>
        </div>
        {description && <p id={descriptionId} className="mt-3 text-sm leading-6 text-fg-muted">{description}</p>}
        {children && <div className="mt-5">{children}</div>}
        {/* Phones: full-width, thumb-sized buttons with the main action on top */}
        {footer && (
          <div className="mt-6 flex flex-col-reverse gap-2 max-sm:[&>button]:h-11 max-sm:[&>button]:w-full max-sm:[&>button]:text-sm sm:flex-row sm:justify-end">
            {footer}
          </div>
        )}
      </div>
    </div>
  );
}
