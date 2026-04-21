import React from 'react';
import { SectionTitle } from '../SectionTitle';

export const CaseHistorySection = ({ narrative }) => (
  <div>
    <SectionTitle>Case History</SectionTitle>
    <p className="text-[11px] leading-snug text-gray-800 whitespace-pre-wrap">{narrative || '—'}</p>
  </div>
);
