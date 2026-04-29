/**
 * WeeklyHoursEditor — reusable weekly schedule grid used by Clinic Hours and
 * per-staff Schedule. 7 day rows × 0..N shift windows each. The user can
 * toggle a day open/closed, add or remove shift windows, and set start/end
 * times for each.
 *
 * Shape (matches backend):
 *   {
 *     mon: { open: true, windows: [{ start: "09:00", end: "13:30", label?: "Morning" }, ...] },
 *     ...
 *   }
 */
import React from 'react';
import { Plus, X } from 'lucide-react';

const WEEKDAYS = [
  { key: 'mon', label: 'Monday' },
  { key: 'tue', label: 'Tuesday' },
  { key: 'wed', label: 'Wednesday' },
  { key: 'thu', label: 'Thursday' },
  { key: 'fri', label: 'Friday' },
  { key: 'sat', label: 'Saturday' },
  { key: 'sun', label: 'Sunday' },
];

const EMPTY_DAY = { open: false, windows: [] };

const labelGuess = (idx) => (idx === 0 ? 'Morning' : idx === 1 ? 'Evening' : idx === 2 ? 'Late' : '');

export default function WeeklyHoursEditor({ value, onChange, testidPrefix = 'wh' }) {
  const safe = value || {};

  const set = (dayKey, patch) => {
    onChange({ ...safe, [dayKey]: { ...EMPTY_DAY, ...(safe[dayKey] || {}), ...patch } });
  };
  const setWindow = (dayKey, idx, patch) => {
    const day = safe[dayKey] || EMPTY_DAY;
    const windows = day.windows.map((w, i) => (i === idx ? { ...w, ...patch } : w));
    set(dayKey, { windows });
  };
  const addWindow = (dayKey) => {
    const day = safe[dayKey] || EMPTY_DAY;
    const newWindow = day.windows.length === 0
      ? { start: '09:00', end: '13:30', label: 'Morning' }
      : { start: '14:30', end: '19:00', label: labelGuess(day.windows.length) };
    set(dayKey, { open: true, windows: [...day.windows, newWindow] });
  };
  const removeWindow = (dayKey, idx) => {
    const day = safe[dayKey] || EMPTY_DAY;
    const windows = day.windows.filter((_, i) => i !== idx);
    set(dayKey, { windows });
  };

  return (
    <div className="space-y-2" data-testid={`${testidPrefix}-editor`}>
      {WEEKDAYS.map((d) => {
        const day = safe[d.key] || EMPTY_DAY;
        return (
          <div
            key={d.key}
            className={`border rounded-lg px-3 py-2.5 flex items-start gap-3 ${
              day.open ? 'bg-white border-slate-200' : 'bg-slate-50 border-slate-200'
            }`}
            data-testid={`${testidPrefix}-row-${d.key}`}
          >
            <div className="w-32 pt-1">
              <label className="flex items-center gap-2 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={day.open}
                  onChange={(e) => set(d.key, { open: e.target.checked, windows: e.target.checked && day.windows.length === 0
                    ? [{ start: '09:00', end: '13:30', label: 'Morning' }, { start: '14:30', end: '19:00', label: 'Evening' }]
                    : day.windows })}
                  data-testid={`${testidPrefix}-${d.key}-open`}
                  className="rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                />
                <span className={`text-[12.5px] font-semibold ${day.open ? 'text-slate-800' : 'text-slate-400'}`}>
                  {d.label}
                </span>
              </label>
              <span className="block text-[10px] text-slate-400 mt-0.5 ml-6">
                {day.open ? 'Open' : 'Closed'}
              </span>
            </div>

            <div className="flex-1 space-y-1.5">
              {!day.open && (
                <div className="text-[11px] text-slate-400 italic pt-1.5">
                  Closed — no appointments will be bookable on this day.
                </div>
              )}
              {day.open && day.windows.length === 0 && (
                <div className="text-[11px] text-amber-700 pt-1.5">
                  Marked open but no shift windows — nothing will be bookable. Add at least one.
                </div>
              )}
              {day.open && day.windows.map((w, idx) => (
                <div key={idx} className="flex items-center gap-2" data-testid={`${testidPrefix}-${d.key}-win-${idx}`}>
                  <input
                    type="text"
                    value={w.label || ''}
                    onChange={(e) => setWindow(d.key, idx, { label: e.target.value })}
                    placeholder="Label"
                    className="text-[11px] px-2 py-1 border border-slate-200 rounded w-24 focus:outline-none focus:border-indigo-500"
                    data-testid={`${testidPrefix}-${d.key}-win-${idx}-label`}
                  />
                  <input
                    type="time"
                    value={w.start}
                    onChange={(e) => setWindow(d.key, idx, { start: e.target.value })}
                    className="text-[11px] px-2 py-1 border border-slate-200 rounded focus:outline-none focus:border-indigo-500"
                    data-testid={`${testidPrefix}-${d.key}-win-${idx}-start`}
                  />
                  <span className="text-slate-400 text-[11px]">→</span>
                  <input
                    type="time"
                    value={w.end}
                    onChange={(e) => setWindow(d.key, idx, { end: e.target.value })}
                    className="text-[11px] px-2 py-1 border border-slate-200 rounded focus:outline-none focus:border-indigo-500"
                    data-testid={`${testidPrefix}-${d.key}-win-${idx}-end`}
                  />
                  <button
                    type="button"
                    onClick={() => removeWindow(d.key, idx)}
                    className="text-rose-500 hover:bg-rose-50 rounded p-1"
                    aria-label="Remove window"
                    data-testid={`${testidPrefix}-${d.key}-win-${idx}-remove`}
                  >
                    <X size={13} />
                  </button>
                </div>
              ))}
              {day.open && (
                <button
                  type="button"
                  onClick={() => addWindow(d.key)}
                  className="inline-flex items-center gap-1 text-[11px] px-2 py-1 text-indigo-600 hover:bg-indigo-50 rounded font-semibold mt-1"
                  data-testid={`${testidPrefix}-${d.key}-add-window`}
                >
                  <Plus size={11} /> Add shift window
                </button>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
