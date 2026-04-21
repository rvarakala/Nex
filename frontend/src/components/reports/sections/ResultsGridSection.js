import React from 'react';
import { SectionTitle } from '../SectionTitle';

// Two-column Results grid: Puretone findings | Immitence findings.
export const ResultsGridSection = ({ puretone, immitence }) => {
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
      <div className="grid grid-cols-2 gap-0 border border-gray-400">
        <div className="border-r border-gray-400 -mr-px">
          <Cell title="Puretone Audiometry Findings" text={puretone} />
        </div>
        <div>
          <Cell title="Immitence Audiometry Findings" text={immitence} />
        </div>
      </div>
    </div>
  );
};
