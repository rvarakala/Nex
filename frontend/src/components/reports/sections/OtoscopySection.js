import React from 'react';
import { SectionTitle } from '../SectionTitle';
import { LABELS, pick } from '../constants';

export const OtoscopySection = ({ ot = {} }) => {
  const R = ot.right || {};
  const L = ot.left || {};
  return (
    <div>
      <SectionTitle>Otoscopic Examination</SectionTitle>
      <table className="w-full text-[11px] border border-gray-400">
        <thead className="bg-gray-100">
          <tr>
            <th className="border border-gray-400 px-2 py-0.5 text-left">Finding</th>
            <th className="border border-gray-400 px-2 py-0.5">Right</th>
            <th className="border border-gray-400 px-2 py-0.5">Left</th>
          </tr>
        </thead>
        <tbody>
          <tr><td className="border border-gray-400 px-2 py-0.5">Pinna</td><td className="border border-gray-400 px-2 py-0.5">{pick(LABELS.pinna, R.pinna)}</td><td className="border border-gray-400 px-2 py-0.5">{pick(LABELS.pinna, L.pinna)}</td></tr>
          <tr><td className="border border-gray-400 px-2 py-0.5">EAC</td><td className="border border-gray-400 px-2 py-0.5">{pick(LABELS.eac, R.eac)}</td><td className="border border-gray-400 px-2 py-0.5">{pick(LABELS.eac, L.eac)}</td></tr>
          <tr><td className="border border-gray-400 px-2 py-0.5">TM</td><td className="border border-gray-400 px-2 py-0.5">{pick(LABELS.tm, R.tm)}</td><td className="border border-gray-400 px-2 py-0.5">{pick(LABELS.tm, L.tm)}</td></tr>
          <tr><td className="border border-gray-400 px-2 py-0.5">Notes</td><td className="border border-gray-400 px-2 py-0.5">{R.notes || ''}</td><td className="border border-gray-400 px-2 py-0.5">{L.notes || ''}</td></tr>
        </tbody>
      </table>
      {(R.image_base64 || L.image_base64) && (
        <div className="flex gap-2 mt-1.5">
          <div className="flex-1">
            <div className="text-[10px] font-semibold text-red-600 mb-0.5">Right</div>
            {R.image_base64 ? <img src={R.image_base64} alt="R otoscopy" className="w-full max-h-32 object-contain border border-gray-300 rounded" /> : <div className="text-[10px] italic text-gray-400">(no image)</div>}
          </div>
          <div className="flex-1">
            <div className="text-[10px] font-semibold text-blue-600 mb-0.5">Left</div>
            {L.image_base64 ? <img src={L.image_base64} alt="L otoscopy" className="w-full max-h-32 object-contain border border-gray-300 rounded" /> : <div className="text-[10px] italic text-gray-400">(no image)</div>}
          </div>
        </div>
      )}
    </div>
  );
};
