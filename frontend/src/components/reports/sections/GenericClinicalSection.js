import React from 'react';
import { SectionTitle } from '../SectionTitle';

/**
 * Generic renderer for the 6 P2 clinical tabs (Special Tests, OAE, Sound Field,
 * ABR/ASSR, Pediatric, Tinnitus). Because each panel stores data as a flat
 * `fields: Dict[str,str]` keyed by form-field names, the report simply walks
 * the populated entries and prints them grouped by a prefix.
 *
 * Hidden when nothing is populated.
 */
const humanize = (key) =>
  key
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase())
    .replace(/\bHz\b/, 'Hz').replace(/\bDb\b/, 'dB')
    .replace(/Ms Ms/, 'ms').replace(/\bWi\b/, 'Wave I')
    .replace(/\bWiii\b/, 'Wave III').replace(/\bWv\b/, 'Wave V')
    .replace(/\bIp13\b/, 'I-III').replace(/\bIp35\b/, 'III-V').replace(/\bIp15\b/, 'I-V')
    .replace(/\bAc\b/, 'AC').replace(/\bBc\b/, 'BC').replace(/\bSf\b/, 'SF')
    .replace(/\bSnr\b/, 'SNR').replace(/\bSrt\b/, 'SRT').replace(/\bWrs\b/, 'WRS')
    .replace(/\bMml\b/, 'MML').replace(/\bRi\b/, 'RI').replace(/\bThi\b/, 'THI');

export const GenericClinicalSection = ({ title, data, impressionKey, layoutHint }) => {
  const f = data?.fields || {};
  const entries = Object.entries(f).filter(([, v]) => v && String(v).trim() !== '');
  if (!entries.length) return null;

  const impression = impressionKey ? f[impressionKey] : '';
  const other = entries.filter(([k]) => k !== impressionKey);

  return (
    <div>
      <SectionTitle>{title}</SectionTitle>
      {layoutHint && <div className="text-[9px] italic text-gray-500 mb-0.5">{layoutHint}</div>}
      <table className="w-full text-[10px] border border-gray-400 mb-1">
        <tbody>
          {other.map(([k, v], idx) => (
            <tr key={k} className={idx % 2 ? 'bg-gray-50' : ''}>
              <td className="border border-gray-300 px-2 py-0.5 font-semibold text-gray-700 w-2/5">
                {humanize(k)}
              </td>
              <td className="border border-gray-300 px-2 py-0.5 text-gray-800 font-mono">
                {v}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {impression && (
        <div className="text-[10px] text-gray-800 leading-snug whitespace-pre-wrap">
          <span className="font-bold text-blue-800 uppercase tracking-wide text-[9px] mr-1">Impression:</span>
          {impression}
        </div>
      )}
    </div>
  );
};
