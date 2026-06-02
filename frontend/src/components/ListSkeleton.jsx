/**
 * ListSkeleton — shimmering placeholder rows for long lists.
 *
 * Used while the first page of a Patients / Invoices / HA Sales table
 * is in flight. The "Load more" second-page fetch shows a small inline
 * spinner instead (see `LoadMoreButton`), so users don't see the whole
 * table flash back to skeletons every paginate.
 */
import React from 'react';

export function ListSkeleton({ rows = 8, cols = 4, className = '' }) {
  return (
    <div className={`space-y-2 ${className}`} data-testid="list-skeleton">
      {Array.from({ length: rows }).map((_, i) => (
        <div
          key={i}
          className="flex items-center gap-3 px-4 py-3 bg-white border border-slate-200 rounded-lg"
        >
          {Array.from({ length: cols }).map((__, j) => (
            <div
              key={j}
              className={`shimmer h-3 rounded ${
                j === 0 ? 'w-32' : j === cols - 1 ? 'w-16 ml-auto' : 'w-24'
              }`}
            />
          ))}
        </div>
      ))}
      <style>{`
        .shimmer {
          background: linear-gradient(90deg,
            rgb(226 232 240) 0%,
            rgb(241 245 249) 50%,
            rgb(226 232 240) 100%);
          background-size: 200% 100%;
          animation: shimmer 1.4s linear infinite;
        }
        @keyframes shimmer {
          0%   { background-position: 200% 0; }
          100% { background-position: -200% 0; }
        }
      `}</style>
    </div>
  );
}


/**
 * LoadMoreButton — pairs with the cursor-mode list endpoints.
 *
 * Props:
 *   hasMore: boolean   — whether the server signalled `has_more=true`
 *   loading: boolean   — true while the next page is in flight
 *   onClick: () => void
 */
export function LoadMoreButton({ hasMore, loading, onClick, label = 'Load more' }) {
  if (!hasMore && !loading) return null;
  return (
    <div className="py-4 flex justify-center" data-testid="load-more-row">
      <button
        type="button"
        onClick={onClick}
        disabled={loading || !hasMore}
        data-testid="load-more-btn"
        className="px-5 py-2 text-sm font-semibold rounded-full border border-slate-300
                   bg-white hover:bg-slate-50 disabled:opacity-50 disabled:cursor-not-allowed
                   text-slate-700 transition-colors flex items-center gap-2"
      >
        {loading ? (
          <>
            <span className="inline-block w-3.5 h-3.5 rounded-full border-2 border-slate-300 border-t-slate-600 animate-spin" />
            Loading…
          </>
        ) : (
          label
        )}
      </button>
    </div>
  );
}
