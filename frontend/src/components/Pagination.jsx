/**
 * Reusable list pagination controls.
 *
 *   <Pagination
 *     page={page} setPage={setPage}
 *     total={total} pageSize={25}
 *   />
 *
 * Shows: Prev · page numbers · Next + "Showing 1-25 of 143"
 *
 * Pair with `usePagination` hook for client-side data slicing.
 */
import React, { useMemo } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';

export const DEFAULT_PAGE_SIZE = 25;

export function usePaginationSlice(items, page, pageSize = DEFAULT_PAGE_SIZE) {
  return useMemo(() => {
    if (!Array.isArray(items)) return [];
    const start = (page - 1) * pageSize;
    return items.slice(start, start + pageSize);
  }, [items, page, pageSize]);
}

export default function Pagination({
  page, setPage, total, pageSize = DEFAULT_PAGE_SIZE,
  testidPrefix = 'pagination',
}) {
  const totalPages = Math.max(1, Math.ceil((total || 0) / pageSize));
  const start = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const end = Math.min(total, page * pageSize);

  // Build compact page number list: 1 … p-1 p p+1 … N
  const pages = useMemo(() => {
    if (totalPages <= 7) return Array.from({ length: totalPages }, (_, i) => i + 1);
    const arr = [1];
    const from = Math.max(2, page - 1);
    const to = Math.min(totalPages - 1, page + 1);
    if (from > 2) arr.push('…');
    for (let i = from; i <= to; i += 1) arr.push(i);
    if (to < totalPages - 1) arr.push('…');
    arr.push(totalPages);
    return arr;
  }, [page, totalPages]);

  if (total <= pageSize) {
    // Show just a summary — no prev/next needed
    return (
      <div className="flex items-center justify-end px-3 py-2 text-[11px] text-slate-500" data-testid={`${testidPrefix}-summary`}>
        Showing {total} {total === 1 ? 'record' : 'records'}
      </div>
    );
  }

  return (
    <div className="flex flex-col sm:flex-row items-center justify-between gap-2 px-3 py-2 border-t border-slate-200" data-testid={testidPrefix}>
      <div className="text-[11px] text-slate-500" data-testid={`${testidPrefix}-summary`}>
        Showing <b>{start}–{end}</b> of <b>{total}</b>
      </div>
      <div className="flex items-center gap-1">
        <button
          onClick={() => setPage(Math.max(1, page - 1))}
          disabled={page <= 1}
          data-testid={`${testidPrefix}-prev`}
          className="flex items-center gap-0.5 px-2 py-1 text-xs font-semibold text-slate-600 hover:bg-slate-100 rounded disabled:opacity-40 disabled:cursor-not-allowed"
        >
          <ChevronLeft size={12} /> Prev
        </button>
        {pages.map((p, i) =>
          p === '…' ? (
            <span key={`e-${i}`} className="px-2 text-slate-400">…</span>
          ) : (
            <button
              key={p}
              onClick={() => setPage(p)}
              data-testid={`${testidPrefix}-page-${p}`}
              className={`min-w-[26px] h-7 px-2 text-xs font-semibold rounded transition-colors ${
                p === page
                  ? 'bg-slate-900 text-white'
                  : 'text-slate-600 hover:bg-slate-100'
              }`}
            >
              {p}
            </button>
          )
        )}
        <button
          onClick={() => setPage(Math.min(totalPages, page + 1))}
          disabled={page >= totalPages}
          data-testid={`${testidPrefix}-next`}
          className="flex items-center gap-0.5 px-2 py-1 text-xs font-semibold text-slate-600 hover:bg-slate-100 rounded disabled:opacity-40 disabled:cursor-not-allowed"
        >
          Next <ChevronRight size={12} />
        </button>
      </div>
    </div>
  );
}
