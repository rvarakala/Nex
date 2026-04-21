import React from 'react';
import { SectionTitle } from '../SectionTitle';
import { LABELS, pick } from '../constants';

// Full Tuning Fork table — shown when ABC and/or Bing are enabled in Report Builder.
export const TuningForkSection = ({ tf = {}, showABC = false, showBing = false }) => {
  const rows = [];
  rows.push({ id: 'rinne', label: 'Rinne', r: pick(LABELS.rinne, tf.rinne_right), l: pick(LABELS.rinne, tf.rinne_left), notes: tf.rinne_notes || '' });
  rows.push({ id: 'weber', label: 'Weber', both: pick(LABELS.weber, tf.weber), notes: tf.weber_notes || '' });
  if (showABC) rows.push({ id: 'abc', label: 'ABC', r: pick(LABELS.abc, tf.abc_right), l: pick(LABELS.abc, tf.abc_left), notes: tf.abc_notes || '' });
  if (showBing) rows.push({ id: 'bing', label: 'Bing', r: pick(LABELS.bing, tf.bing_right), l: pick(LABELS.bing, tf.bing_left), notes: tf.bing_notes || '' });
  return (
    <div>
      <SectionTitle>Tuning Fork Tests ({tf.frequency_hz || 512} Hz)</SectionTitle>
      <table className="w-full text-[11px] border border-gray-400">
        <thead className="bg-gray-100">
          <tr>
            <th className="border border-gray-400 px-2 py-0.5 text-left">Test</th>
            <th className="border border-gray-400 px-2 py-0.5">Right</th>
            <th className="border border-gray-400 px-2 py-0.5">Left</th>
            <th className="border border-gray-400 px-2 py-0.5 text-left">Notes</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id}>
              <td className="border border-gray-400 px-2 py-0.5 font-medium">{r.label}</td>
              {r.both ? (
                <td className="border border-gray-400 px-2 py-0.5" colSpan={2}>{r.both}</td>
              ) : (
                <>
                  <td className="border border-gray-400 px-2 py-0.5">{r.r}</td>
                  <td className="border border-gray-400 px-2 py-0.5">{r.l}</td>
                </>
              )}
              <td className="border border-gray-400 px-2 py-0.5">{r.notes}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
};
