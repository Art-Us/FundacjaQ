'use client';

import { ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight } from 'lucide-react';
import { cn } from '@/lib/utils';

interface PaginationProps {
  page: number;
  totalPages: number;
  onPageChange: (page: number) => void;
  disabled?: boolean;
}

const ELLIPSIS = '…';

/** Classic "1 … 4 5 6 … 12" window around the current page, never more than 2 dots. */
function pageNumbers(page: number, totalPages: number): Array<number | typeof ELLIPSIS> {
  const delta = 1;
  const items: Array<number | typeof ELLIPSIS> = [1];

  const rangeStart = Math.max(2, page - delta);
  const rangeEnd = Math.min(totalPages - 1, page + delta);

  if (rangeStart > 2) items.push(ELLIPSIS);
  for (let i = rangeStart; i <= rangeEnd; i++) items.push(i);
  if (rangeEnd < totalPages - 1) items.push(ELLIPSIS);

  if (totalPages > 1) items.push(totalPages);
  return items;
}

/** Numbered page picker (1 2 3 … N), shared by any directory that lists a page at a time instead of infinite-scrolling. */
export function Pagination({ page, totalPages, onPageChange, disabled = false }: PaginationProps) {
  if (totalPages <= 1) return null;

  const buttonBase =
    'inline-flex h-8 min-w-8 items-center justify-center rounded-lg px-2 text-xs font-bold transition disabled:opacity-40 disabled:pointer-events-none';

  return (
    <nav className="flex items-center justify-center gap-1" aria-label="Paginacja">
      <button
        type="button"
        onClick={() => onPageChange(1)}
        disabled={disabled || page <= 1}
        aria-label="Pierwsza strona"
        className={cn(buttonBase, 'text-slate-500 hover:bg-slate-100')}
      >
        <ChevronsLeft className="h-4 w-4" />
      </button>

      <button
        type="button"
        onClick={() => onPageChange(page - 1)}
        disabled={disabled || page <= 1}
        aria-label="Poprzednia strona"
        className={cn(buttonBase, 'text-slate-500 hover:bg-slate-100')}
      >
        <ChevronLeft className="h-4 w-4" />
      </button>

      {pageNumbers(page, totalPages).map((item, i) =>
        item === ELLIPSIS ? (
          <span key={`dots-${i}`} className="px-1 text-xs text-slate-400 select-none">
            {ELLIPSIS}
          </span>
        ) : (
          <button
            key={item}
            type="button"
            onClick={() => onPageChange(item)}
            disabled={disabled}
            aria-current={item === page ? 'page' : undefined}
            className={cn(
              buttonBase,
              item === page ? 'bg-indigo-600 text-white' : 'text-slate-700 hover:bg-slate-100'
            )}
          >
            {item}
          </button>
        )
      )}

      <button
        type="button"
        onClick={() => onPageChange(page + 1)}
        disabled={disabled || page >= totalPages}
        aria-label="Następna strona"
        className={cn(buttonBase, 'text-slate-500 hover:bg-slate-100')}
      >
        <ChevronRight className="h-4 w-4" />
      </button>

      <button
        type="button"
        onClick={() => onPageChange(totalPages)}
        disabled={disabled || page >= totalPages}
        aria-label="Ostatnia strona"
        className={cn(buttonBase, 'text-slate-500 hover:bg-slate-100')}
      >
        <ChevronsRight className="h-4 w-4" />
      </button>
    </nav>
  );
}
