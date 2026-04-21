import React from 'react';

// Shared building blocks for the clinical data-entry tabs (Special Tests, OAE,
// Sound Field, ABR/ASSR, Pediatric, Tinnitus). All panels use a flat
// `fields: Dict[str,str]` model on the backend so we can evolve the form layout
// without schema migrations.

// A compact labelled text input.
export const CFField = ({ label, labelColor = 'text-gray-700', value, onChange, testId, placeholder = '', width = 'w-20' }) => (
  <div className="flex flex-col items-start">
    {label && <div className={`text-[10px] font-semibold ${labelColor} mb-0.5`}>{label}</div>}
    <input
      type="text"
      value={value ?? ''}
      onChange={(e) => onChange(e.target.value)}
      data-testid={testId}
      placeholder={placeholder}
      className={`${width} text-xs border border-gray-300 rounded px-1.5 py-0.5 focus:outline-none focus:border-blue-500`}
    />
  </div>
);

// Dropdown with a fixed set of options.
export const CFSelect = ({ label, labelColor = 'text-gray-700', value, onChange, testId, options = [] }) => (
  <div className="flex flex-col items-start">
    {label && <div className={`text-[10px] font-semibold ${labelColor} mb-0.5`}>{label}</div>}
    <select
      value={value ?? ''}
      onChange={(e) => onChange(e.target.value)}
      data-testid={testId}
      className="text-xs border border-gray-300 rounded px-1.5 py-0.5 focus:outline-none focus:border-blue-500"
    >
      <option value=""></option>
      {options.map((o) => <option key={o} value={o}>{o}</option>)}
    </select>
  </div>
);

// A grey tag on the left edge (matches the SpeechPanel's grouped-section style).
export const CFSectionRow = ({ tag, subtitle, children }) => (
  <div className="flex gap-2 items-stretch border border-gray-300 rounded bg-white mb-2 shadow-sm">
    <div className="w-20 flex-shrink-0 bg-gray-700 text-white text-xs font-bold flex items-center justify-center text-center py-2 rounded-sm">
      {tag}
    </div>
    <div className="flex-1 p-2 min-w-0">
      {subtitle && <div className="text-[10px] italic text-gray-500 mb-2">{subtitle}</div>}
      {children}
    </div>
  </div>
);

// A simple freq × measurement table. Each cell is a free-text input.
// Provides Right + Left ear rows.
export const CFFreqTable = ({ freqs, rowsPerEar = [{ key: '', label: '' }], fields, setField, prefix, testPrefix }) => (
  <table className="text-[11px] border border-gray-200 w-full">
    <thead className="bg-gray-50">
      <tr>
        <th className="border border-gray-200 px-1 py-0.5 text-left">Ear</th>
        {rowsPerEar.length > 1 && <th className="border border-gray-200 px-1 py-0.5 text-left">Measure</th>}
        {freqs.map((f) => (
          <th key={f} className="border border-gray-200 px-1 py-0.5 text-center">
            {typeof f === 'number' && f >= 1000 ? `${f / 1000}K` : f}
          </th>
        ))}
      </tr>
    </thead>
    <tbody>
      {['right', 'left'].map((ear) =>
        rowsPerEar.map((row) => (
          <tr key={`${ear}-${row.key}`}>
            <td className={`border border-gray-200 px-1 py-0.5 font-semibold ${ear === 'right' ? 'text-red-600' : 'text-blue-600'}`}>
              {ear === 'right' ? 'R' : 'L'}
            </td>
            {rowsPerEar.length > 1 && (
              <td className="border border-gray-200 px-1 py-0.5">{row.label}</td>
            )}
            {freqs.map((f) => {
              const k = `${prefix}_${ear}_${row.key ? row.key + '_' : ''}${f}`;
              return (
                <td key={f} className="border border-gray-200 p-0">
                  <input
                    type="text"
                    value={fields[k] ?? ''}
                    onChange={(e) => setField(k, e.target.value)}
                    data-testid={`${testPrefix}-${ear}-${row.key || 'val'}-${f}`}
                    className="w-full text-[11px] border-0 bg-transparent px-1 py-0.5 text-center focus:outline-none focus:bg-blue-50"
                  />
                </td>
              );
            })}
          </tr>
        ))
      )}
    </tbody>
  </table>
);
