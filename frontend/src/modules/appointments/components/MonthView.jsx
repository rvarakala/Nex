import React, { useMemo } from 'react';
import { ymdLocal, sameDay, contrastOn, hexAlpha } from '../utils';

/**
 * MonthView — 6-week × 7-day grid. Each day cell shows up to MAX_VISIBLE
 * appointment chips, with a "+N more" indicator when there are extras.
 * Clicking a chip opens that appointment; clicking an empty area on a day
 * jumps to Day view for that date.
 */
const MAX_VISIBLE = 3;
const DOW_HEAD = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export default function MonthView({ anchor, appointments, onEventClick, onPickDate }) {
  const today = new Date();

  const cells = useMemo(() => {
    const first = new Date(anchor.getFullYear(), anchor.getMonth(), 1);
    const startDow = first.getDay();
    const out = [];
    for (let i = 0; i < 42; i++) {
      const d = new Date(first);
      d.setDate(1 - startDow + i);
      out.push(d);
    }
    return out;
  }, [anchor]);

  const byDay = useMemo(() => {
    const m = {};
    for (const a of appointments) {
      try {
        const d = new Date(a.start_at);
        const k = `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
        (m[k] = m[k] || []).push(a);
      } catch { /* skip */ }
    }
    // Sort each day's events by start time
    for (const k of Object.keys(m)) m[k].sort((a, b) => a.start_at.localeCompare(b.start_at));
    return m;
  }, [appointments]);

  return (
    <div className="flex-1 flex flex-col bg-white" data-testid="apt-month-view">
      {/* Day-of-week header */}
      <div className="grid grid-cols-7 border-b border-slate-200 bg-slate-50/50">
        {DOW_HEAD.map((d) => (
          <div key={d} className="text-[10px] uppercase tracking-wider font-bold text-slate-500 px-3 py-2 text-center">
            {d}
          </div>
        ))}
      </div>

      {/* 6 × 7 grid */}
      <div className="flex-1 grid grid-cols-7 grid-rows-6 gap-px bg-slate-200 overflow-auto">
        {cells.map((d) => {
          const k = `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
          const dayAppts = byDay[k] || [];
          const visible = dayAppts.slice(0, MAX_VISIBLE);
          const hidden = dayAppts.length - visible.length;
          const inMonth = d.getMonth() === anchor.getMonth();
          const isT = sameDay(d, today);
          return (
            <div
              key={d.toISOString()}
              onClick={() => onPickDate?.(d)}
              data-testid={`apt-month-cell-${ymdLocal(d)}`}
              className={`min-h-[110px] flex flex-col p-1.5 cursor-pointer transition-colors ${
                inMonth ? 'bg-white hover:bg-blue-50/40' : 'bg-slate-50 hover:bg-slate-100'
              } ${isT ? 'ring-2 ring-blue-500 ring-inset' : ''}`}
            >
              <div className="flex items-center justify-between mb-1">
                <span
                  className={`text-[11px] font-bold ${
                    isT ? 'bg-blue-600 text-white rounded-full w-5 h-5 flex items-center justify-center'
                        : inMonth ? 'text-slate-700' : 'text-slate-400'
                  }`}
                >
                  {d.getDate()}
                </span>
                {dayAppts.length > 0 && (
                  <span className="text-[9px] text-slate-400 font-semibold">{dayAppts.length}</span>
                )}
              </div>
              <div className="flex-1 space-y-0.5 overflow-hidden">
                {visible.map((a) => {
                  const color = a.staff_color || '#6B7280';
                  const fg = contrastOn(color);
                  const start = new Date(a.start_at);
                  const time = start.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: false });
                  const title = a.counterparty_name || a.patient_name || 'Untitled';
                  const isCancelled = a.status === 'cancelled' || a.status === 'no_show';
                  return (
                    <button
                      key={a.appointment_id}
                      type="button"
                      onClick={(e) => { e.stopPropagation(); onEventClick?.(a); }}
                      data-testid={`apt-event-${a.appointment_id}`}
                      className={`w-full text-left rounded-sm px-1.5 py-0.5 text-[10px] font-semibold truncate transition-shadow hover:shadow ${
                        isCancelled ? 'opacity-50 line-through' : ''
                      }`}
                      style={{
                        backgroundColor: hexAlpha(color, 0.18),
                        borderLeft: `3px solid ${color}`,
                        color: fg === '#FFFFFF' ? '#0F172A' : '#0F172A',
                      }}
                      title={`${title} · ${time} · ${a.staff_name || ''}`}
                    >
                      <span className="font-bold opacity-70 mr-1">{time}</span>
                      {title}
                    </button>
                  );
                })}
                {hidden > 0 && (
                  <button
                    type="button"
                    onClick={(e) => { e.stopPropagation(); onPickDate?.(d); }}
                    className="w-full text-left text-[10px] font-bold text-blue-600 hover:text-blue-800 hover:underline px-1.5"
                    data-testid={`apt-month-more-${ymdLocal(d)}`}
                  >
                    +{hidden} more
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
