import React from 'react';

// Renders the "Recommendations" narrative row. Full-width single column.
// The former "Further Advice (ENT)" cell was removed on 2026-07-30 per
// user request — clinicians preferred writing referral notes directly in
// the recommendations block instead of maintaining two parallel fields.
// `advice` is kept in the props signature so upstream callers don't need
// to change; it's intentionally ignored here.
export const RecommendationsAdviceSection = ({ recommendations }) => (
  <div>
    <div className="border border-gray-400 p-1.5">
      <div className="text-[10px] font-bold text-blue-800 uppercase tracking-wide mb-0.5">Recommendations</div>
      <p className="text-[11px] leading-snug text-gray-800 whitespace-pre-wrap min-h-[40px]">
        {recommendations || <span className="italic text-gray-400">(no recommendations entered)</span>}
      </p>
    </div>
  </div>
);
