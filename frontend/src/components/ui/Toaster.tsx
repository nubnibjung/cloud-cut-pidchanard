import { AlertCircle, X } from 'lucide-react';
import { useToastStore } from '../../state/toastStore';
import { cn } from '../../utils/cn';

/** Renders the toast stack. Mount once near the app root. */
export function Toaster() {
  const toasts = useToastStore((state) => state.toasts);
  const dismiss = useToastStore((state) => state.dismiss);

  return (
    // Top centre, just under the navbar (newest on top), so it never covers the timeline or footer buttons
    <div className="pointer-events-none fixed inset-x-0 top-[4.5rem] z-[200] flex flex-col-reverse items-center gap-2 px-4" role="status" aria-live="polite">
      {toasts.map((item) => (
        <div
          key={item.id}
          className={cn(
            'pointer-events-auto flex max-w-md animate-drop-in items-center gap-3 rounded-lg border bg-raised py-2 pl-3 pr-2 text-sm shadow-menu',
            item.kind === 'error' ? 'border-danger/40' : 'border-border-strong',
          )}
        >
          {item.kind === 'error' && <AlertCircle aria-hidden className="h-4 w-4 shrink-0 text-danger" />}
          <span className="min-w-0 break-words text-fg">{item.message}</span>
          {item.action && (
            <button
              type="button"
              className="shrink-0 rounded-md px-2 py-1 text-sm font-semibold text-accent hover:bg-accent/10"
              onClick={() => { item.action?.onClick(); dismiss(item.id); }}
            >
              {item.action.label}
            </button>
          )}
          <button
            type="button"
            aria-label="Dismiss"
            className="shrink-0 rounded-md p-1 text-fg-subtle hover:bg-ink/10 hover:text-fg"
            onClick={() => dismiss(item.id)}
          >
            <X aria-hidden className="h-3.5 w-3.5" />
          </button>
        </div>
      ))}
    </div>
  );
}
