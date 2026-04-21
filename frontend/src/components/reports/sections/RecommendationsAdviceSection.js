import React from 'react';

// Recommendations (3fr, wider) + Further Advice (2fr, narrower) rendered in a single row.
export const RecommendationsAdviceSection = ({ recommendations, advice }) => {
  const Cell = ({ title, text, placeholder }) => (
    <div className="border border-gray-400 p-1.5">
      <div className="text-[10px] font-bold text-blue-800 uppercase tracking-wide mb-0.5">{title}</div>
      <p className="text-[11px] leading-snug text-gray-800 whitespace-pre-wrap min-h-[40px]">
        {text || <span className="italic text-gray-400">{placeholder}</span>}
      </p>
    </div>
  );
  return (
    <div>
      <div className="grid gap-0" style={{ gridTemplateColumns: '3fr 2fr' }}>
        <div className="-mr-px">
          <Cell
            title="Recommendations"
            text={recommendations}
            placeholder="(no recommendations entered)"
          />
        </div>
        <div>
          <Cell
            title="Further Advice (ENT)"
            text={advice}
            placeholder="(no further advice)"
          />
        </div>
      </div>
    </div>
  );
};
