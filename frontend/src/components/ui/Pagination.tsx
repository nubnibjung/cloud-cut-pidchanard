import { ChevronLeft, ChevronRight, MoreHorizontal } from 'lucide-react';
import { cn } from '../../utils/cn';

interface PaginationProps {
  page: number;
  pageCount: number;
  onPageChange(page: number): void;
  className?: string;
}

/**
 * Page numbers to show: always the first and last, the current page with one
 * neighbour on each side, and an ellipsis for any gap — e.g. 1 … 4 5 6 … 12.
 */
export function pageItems(page: number, pageCount: number): Array<number | 'gap'> {
  if (pageCount <= 7) return Array.from({ length: pageCount }, (_, i) => i + 1);
  const pages = new Set([1, pageCount, page - 1, page, page + 1]);
  if (page <= 3) [2, 3, 4].forEach((n) => pages.add(n));
  if (page >= pageCount - 2) [pageCount - 3, pageCount - 2, pageCount - 1].forEach((n) => pages.add(n));
  const sorted = [...pages].filter((n) => n >= 1 && n <= pageCount).sort((a, b) => a - b);
  const out: Array<number | 'gap'> = [];
  sorted.forEach((n, i) => {
    if (i > 0 && n - sorted[i - 1] > 1) out.push('gap');
    out.push(n);
  });
  return out;
}

const ITEM =
  'inline-flex h-9 min-w-9 items-center justify-center gap-1 rounded-md px-2.5 text-sm font-semibold transition-colors disabled:pointer-events-none disabled:opacity-40';

/** Previous · 1 2 3 … · Next, in the style of shadcn/ui's Pagination. */
export function Pagination({ page, pageCount, onPageChange, className }: PaginationProps) {
  if (pageCount <= 1) return null;
  const go = (next: number) => {
    if (next >= 1 && next <= pageCount && next !== page) onPageChange(next);
  };

  return (
    <nav role="navigation" aria-label="Pagination" className={cn('flex justify-center', className)}>
      <ul className="flex flex-wrap items-center gap-1">
        <li>
          <button
            type="button"
            aria-label="Go to previous page"
            className={cn(ITEM, 'pl-2 text-fg-muted hover:bg-ink/[0.06] hover:text-fg')}
            disabled={page <= 1}
            onClick={() => go(page - 1)}
          >
            <ChevronLeft aria-hidden className="h-4 w-4" />
            <span className="hidden sm:inline">Previous</span>
          </button>
        </li>

        {pageItems(page, pageCount).map((item, index) =>
          item === 'gap' ? (
            <li key={`gap-${index}`} aria-hidden className="flex h-9 w-9 items-center justify-center text-fg-subtle">
              <MoreHorizontal className="h-4 w-4" />
            </li>
          ) : (
            <li key={item}>
              <button
                type="button"
                aria-label={`Page ${item}`}
                aria-current={item === page ? 'page' : undefined}
                className={cn(
                  ITEM,
                  item === page
                    ? 'border border-border-strong bg-panel text-fg shadow-sm'
                    : 'text-fg-muted hover:bg-ink/[0.06] hover:text-fg',
                )}
                onClick={() => go(item)}
              >
                {item}
              </button>
            </li>
          ),
        )}

        <li>
          <button
            type="button"
            aria-label="Go to next page"
            className={cn(ITEM, 'pr-2 text-fg-muted hover:bg-ink/[0.06] hover:text-fg')}
            disabled={page >= pageCount}
            onClick={() => go(page + 1)}
          >
            <span className="hidden sm:inline">Next</span>
            <ChevronRight aria-hidden className="h-4 w-4" />
          </button>
        </li>
      </ul>
    </nav>
  );
}
