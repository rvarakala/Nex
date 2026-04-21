import React from 'react';
import { SectionTitle } from '../SectionTitle';

/**
 * Results grid — renders only the findings cells whose corresponding test section
 * is enabled in the report (user-controlled via the Report Builder checkboxes).
 *
 * Inputs:
 *   - `entries` : array of { key, title, text } — only entries present in this array will render.
 *     The parent decides which to include based on which test sections are enabled.
 *
 * Layout auto-adapts:
 *   - 1 entry : full-width cell
 *   - 2 entries : 2-column grid
 *   - 3+ entries : 3-column grid (wraps to next row if more)
 */
export const ResultsGridSection = ({ entries = [] }) => {
  const visible = entries.filter((e) => e && e.title);
  if (!visible.length) return null;

  const cols = visible.length === 1 ? 1 : visible.length === 2 ? 2 : 3;

  const Cell = ({ title, text }) => (
    <div className="border border-gray-400 p-1.5">
      <div className="text-[10px] font-bold text-blue-800 uppercase tracking-wide mb-0.5">{title}</div>
      <p className="text-[11px] leading-snug text-gray-800 whitespace-pre-wrap min-h-[32px]">
        {text || <span className="italic text-gray-400">—</span>}
      </p>
    </div>
  );

  return (
    <div>
      <SectionTitle>Results</SectionTitle>
      <div
        className="grid gap-0 border border-gray-400"
        style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}
      >
        {visible.map((e, idx) => {
          // Add right border between cells (except on the last column of each row)
          const isLastInRow = (idx + 1) % cols === 0;
          return (
            <div
              key={e.key}
              className={isLastInRow ? '' : 'border-r border-gray-400 -mr-px'}
            >
              <Cell title={e.title} text={e.text} />
            </div>
          );
        })}
      </div>
    </div>
  );
};
