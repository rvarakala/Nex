import React, { useState, useMemo } from 'react';
import { Plus, ChevronLeft, ChevronRight, Check } from 'lucide-react';
import { useAuth } from '../../../AuthContext';

const DOW_HEAD = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

// =============================================================================
// MiniMonth — compact month-grid date picker that drives `anchorDate`.
// Sunday-first, six-row fixed grid (matches the screenshot reference).
// =============================================================================
function MiniMonth({ anchor, onPick }) {
  const [cursor, setCursor] = useState(() => new Date(anchor.getFullYear(), anchor.getMonth(), 1));

  const cells = useMemo(() => {
    const first = new Date(cursor.getFullYear(), cursor.getMonth(), 1);
    const startDow = first.getDay(); // 0=Sun
    // Always render 6 weeks to keep height stable.
    const out = [];
    for (let i = 0; i < 42; i++) {
      const d = new Date(first);
      d.setDate(1 - startDow + i);
      out.push(d);
    }
    return out;
  }, [cursor]);

  const monthLabel = cursor.toLocaleDateString('en-IN', { month: 'long', year: 'numeric' });
  const today = new Date();
  const isToday = (d) =>
    d.getFullYear() === today.getFullYear() &&
    d.getMonth() === today.getMonth() &&
    d.getDate() === today.getDate();
  const isAnchor = (d) =>
    d.getFullYear() === anchor.getFullYear() &&
    d.getMonth() === anchor.getMonth() &&
    d.getDate() === anchor.getDate();
  const inMonth = (d) => d.getMonth() === cursor.getMonth();

  return (
    <div className="bg-white rounded-lg p-3" data-testid="apt-mini-month">
      <div className="flex items-center justify-between mb-2">
        <button
          type="button"
          onClick={() => setCursor(new Date(cursor.getFullYear(), cursor.getMonth() - 1, 1))}
          className="p-1 rounded hover:bg-slate-100 text-slate-500"
          data-testid="apt-mini-prev"
          aria-label="Previous month"
        >
          <ChevronLeft size={14} />
        </button>
        <div className="text-[12px] font-semibold text-slate-700">{monthLabel}</div>
        <button
          type="button"
          onClick={() => setCursor(new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1))}
          className="p-1 rounded hover:bg-slate-100 text-slate-500"
          data-testid="apt-mini-next"
          aria-label="Next month"
        >
          <ChevronRight size={14} />
        </button>
      </div>
      <div className="grid grid-cols-7 gap-y-1 text-center">
        {DOW_HEAD.map((d) => (
          <div key={d} className="text-[9px] uppercase tracking-wider text-slate-400 font-semibold">
            {d}
          </div>
        ))}
        {cells.map((d) => {
          const isSelected = isAnchor(d);
          const isT = isToday(d);
          return (
            <button
              key={d.toISOString()}
              type="button"
              onClick={() => onPick(d)}
              className={`h-7 w-7 mx-auto rounded-full text-[11px] flex items-center justify-center transition-colors ${
                isSelected
                  ? 'bg-blue-600 text-white font-bold shadow-sm shadow-blue-500/30'
                  : isT
                  ? 'ring-1 ring-blue-500 text-blue-700 font-semibold'
                  : inMonth(d)
                  ? 'text-slate-700 hover:bg-slate-100'
                  : 'text-slate-300 hover:bg-slate-50'
              }`}
              data-testid={`apt-mini-day-${d.toISOString().slice(0, 10)}`}
            >
              {d.getDate()}
            </button>
          );
        })}
      </div>
    </div>
  );
}

// =============================================================================
// StaffRail — the full left column. New Appointment CTA + mini month +
// Doctors filter list with avatar + coloured tick. Read-only roles still get
// the rail (it's their primary filter mechanism).
// =============================================================================
export default function StaffRail({
  staff,
  selectedIds,
  onToggle,
  onSelectAll,
  onClearAll,
  anchor,
  onPickDate,
  onNew,
}) {
  const { user } = useAuth();
  const allSelected = staff.length > 0 && selectedIds.length === staff.length;
  const showNotAssigned = false; // No "unassigned" appointment concept yet — staff_id is required.
  const audiologistOnly = user?.role === 'audiologist';

  return (
    <aside
      className="w-full lg:w-[260px] xl:w-[280px] flex-shrink-0 lg:h-full lg:overflow-y-auto bg-slate-50 border-r border-slate-200"
      data-testid="apt-staff-rail"
    >
      <div className="p-3 lg:p-4 space-y-4">
        {/* New Appointment CTA */}
        {!audiologistOnly && (
          <button
            type="button"
            onClick={onNew}
            data-testid="apt-new-button"
            className="w-full inline-flex items-center justify-center gap-2 bg-blue-600 hover:bg-blue-700 text-white font-bold tracking-wider text-[12px] uppercase px-4 py-3 rounded-lg shadow-sm shadow-blue-500/25 transition-colors"
          >
            <Plus size={16} strokeWidth={2.5} />
            New Appointment
          </button>
        )}

        {/* Mini Month */}
        <MiniMonth anchor={anchor} onPick={onPickDate} />

        {/* Staff filter list */}
        <div>
          <div className="flex items-center justify-between px-1 mb-2">
            <div className="text-[10px] uppercase tracking-[0.18em] text-slate-500 font-bold">
              {audiologistOnly ? 'You' : 'Staff'}
            </div>
            {!audiologistOnly && staff.length > 1 && (
              <button
                type="button"
                onClick={allSelected ? onClearAll : onSelectAll}
                className="text-[10px] font-semibold text-blue-600 hover:text-blue-800 hover:underline"
                data-testid="apt-staff-toggle-all"
              >
                {allSelected ? 'Clear' : 'All'}
              </button>
            )}
          </div>
          <div className="space-y-1.5">
            {staff.map((s) => {
              const checked = selectedIds.includes(s.user_id);
              const initials = (s.name || '?')
                .split(' ')
                .map((p) => p[0])
                .filter(Boolean)
                .slice(0, 2)
                .join('')
                .toUpperCase();
              return (
                <button
                  key={s.user_id}
                  type="button"
                  onClick={() => onToggle(s.user_id)}
                  data-testid={`apt-staff-toggle-${s.user_id}`}
                  className={`w-full flex items-center gap-2.5 p-1.5 rounded-lg transition-all ${
                    checked ? 'bg-white shadow-sm ring-1 ring-slate-200' : 'hover:bg-white/60'
                  }`}
                  title={`${s.name} — ${s.role?.replace('_', ' ')}`}
                >
                  <div className="relative flex-shrink-0">
                    {s.avatar_url ? (
                      <img
                        src={s.avatar_url}
                        alt=""
                        className="w-9 h-9 rounded-full object-cover ring-2 ring-white"
                      />
                    ) : (
                      <div
                        className="w-9 h-9 rounded-full flex items-center justify-center text-white font-bold text-[11px] ring-2 ring-white"
                        style={{ backgroundColor: s.color }}
                      >
                        {initials}
                      </div>
                    )}
                    <div
                      className={`absolute -bottom-0.5 -right-0.5 w-4 h-4 rounded-full flex items-center justify-center ring-2 ring-slate-50 transition-opacity ${
                        checked ? 'opacity-100' : 'opacity-0'
                      }`}
                      style={{ backgroundColor: s.color }}
                    >
                      <Check size={10} strokeWidth={3} color="#fff" />
                    </div>
                  </div>
                  <div className="flex-1 min-w-0 text-left">
                    <div
                      className={`text-[12px] font-semibold truncate ${
                        checked ? 'text-slate-900' : 'text-slate-500'
                      }`}
                    >
                      {s.name}
                    </div>
                    <div className="text-[10px] text-slate-400 capitalize truncate">
                      {(s.role || '').replace('_', ' ')}
                    </div>
                  </div>
                </button>
              );
            })}
            {showNotAssigned && (
              <div className="flex items-center gap-2.5 p-1.5">
                <div className="w-9 h-9 rounded-full bg-slate-300 flex items-center justify-center text-white font-bold text-[12px]">
                  ?
                </div>
                <div className="text-[12px] text-slate-500">Not Assigned</div>
              </div>
            )}
          </div>
        </div>
      </div>
    </aside>
  );
}
