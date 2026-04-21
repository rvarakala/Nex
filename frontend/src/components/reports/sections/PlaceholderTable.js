import React from 'react';
import { SectionTitle } from '../SectionTitle';

// Generic empty table placeholder used by tabs that are not yet wired up (e.g. Speech).
export const PlaceholderTable = ({ title, columns }) => (
  <div>
    <SectionTitle>{title}</SectionTitle>
    <table className="w-full text-[11px] border border-gray-400">
      <thead className="bg-gray-100">
        <tr>
          <th className="border border-gray-400 px-2 py-0.5"></th>
          {columns.map((c) => <th key={c} className="border border-gray-400 px-2 py-0.5">{c}</th>)}
        </tr>
      </thead>
      <tbody>
        {['Right', 'Left', 'Binaural'].map((ear) => (
          <tr key={ear}>
            <td className="border border-gray-400 px-2 py-0.5 font-semibold">{ear}</td>
            {columns.map((c) => <td key={c} className="border border-gray-400 px-2 py-0.5 text-center text-gray-400 italic">—</td>)}
          </tr>
        ))}
      </tbody>
    </table>
    <div className="text-[10px] italic text-gray-500 mt-0.5">Not assessed.</div>
  </div>
);
