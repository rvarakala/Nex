import React from 'react';
import { SectionTitle } from '../SectionTitle';

/**
 * Provisional Diagnosis — single full-width narrative cell. Audiologist enters
 * the working diagnosis (e.g. "Bilateral mild SNHL", "Right ear OME").
 *
 * Sits between the Results grid and the Recommendations/Advice row. Only
 * rendered when the `provisional_diagnosis` section is enabled in the Report
 * Builder sidebar (default: ON). Empty state shows a muted placeholder.
 */
export const ProvisionalDiagnosisSection = ({ text }) => (
  <div data-testid="report-provisional-diagnosis">
    <SectionTitle>Provisional Diagnosis</SectionTitle>
    <div className="border border-gray-400 p-1.5">
      <p className="text-[11px] leading-snug text-gray-800 whitespace-pre-wrap min-h-[32px]">
        {text || (
          <span className="italic text-gray-400">(no provisional diagnosis entered)</span>
        )}
      </p>
    </div>
  </div>
);
