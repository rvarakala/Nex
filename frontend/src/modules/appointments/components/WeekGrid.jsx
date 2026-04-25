import React, { useMemo, useRef } from 'react';
import { addDays, sameDay, contrastOn, hexAlpha } from '../utils';

// Layout constants — kept out of render for clarity.
const HOUR_START = 8;
const HOUR_END = 22;
const HOUR_HEIGHT = 56;        // px per hour row
const MIN_PER_SLOT = 15;       // grid resolution for right-click-to-book
const TOTAL_HOURS = HOUR_END - HOUR_START;

// =============================================================================
// AppointmentEvent — single coloured card on the grid.
// =============================================================================
const AppointmentEvent = ({ appt, onClick }) => {
  const start = new Date(appt.start_at);
  const end = new Date(appt.end_at);
  const minutesFromTop = (start.getHours() - HOUR_START) * 60 + start.getMinutes();
  const durationMin = Math.max(15, (end - start) / 60000);
  const top = (minutesFromTop / 60) * HOUR_HEIGHT;
  const height = (durationMin / 60) * HOUR_HEIGHT - 2;

  const color = appt.staff_color || '#6B7280';
  const fg = contrastOn(color);
  const isCancelled = appt.status === 'cancelled' || appt.status === 'no_show';

  const timeLabel = `${start.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: false })}-${end.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: false })}`;
  const title =
    appt.counterparty_name ||
    appt.patient_name ||
    'Untitled';
  const subtitle = appt.service || appt.category;

  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        onClick?.(appt);
      }}
      data-testid={`apt-event-${appt.appointment_id}`}
      className={`absolute left-1 right-1 rounded-md text-left px-2 py-1 overflow-hidden transition-all hover:shadow-md hover:scale-[1.01] focus:outline-none focus:ring-2 focus:ring-offset-1 focus:ring-blue-400 ${
        isCancelled ? 'opacity-50 line-through' : ''
      }`}
      style={{
        top,
        height,
        backgroundColor: color,
        color: fg,
        boxShadow: `0 1px 3px ${hexAlpha(color, 0.35)}`,
      }}
      title={`${title} — ${timeLabel}\n${appt.staff_name || ''}`}
    >
      <div className="text-[10px] font-bold leading-tight opacity-95">{timeLabel}</div>
      <div className="text-[12px] font-semibold leading-snug truncate">{title}</div>
      {height > 38 && (
        <div className="text-[10px] opacity-90 truncate mt-0.5">{subtitle}</div>
      )}
    </button>
  );
};

// =============================================================================
// WeekGrid — 7-day Mon→Sun grid, hour rows from 08:00 → 22:00.
// Right-click anywhere on a column opens the booking modal pre-filled with
// that 15-min slot.
// =============================================================================
export default function WeekGrid({
  weekStart,
  appointments,
  onEventClick,
  onSlotRightClick,
}) {
  const gridRef = useRef(null);

  const days = useMemo(() => Array.from({ length: 7 }, (_, i) => addDays(weekStart, i)), [weekStart]);
  const hours = useMemo(
    () => Array.from({ length: TOTAL_HOURS }, (_, i) => HOUR_START + i),
    [],
  );

  // Bucket appointments by yyyy-mm-dd of start_at for O(1) day lookup.
  const byDay = useMemo(() => {
    const m = {};
    for (const a of appointments) {
      try {
        const d = new Date(a.start_at);
        const k = `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
        (m[k] = m[k] || []).push(a);
      } catch {
        // Defensive: skip rows with malformed timestamps.
      }
    }
    return m;
  }, [appointments]);

  const today = new Date();
  // The single red "current time" indicator only renders on today's column.
  const nowMins = today.getHours() * 60 + today.getMinutes();
  const nowTop = ((nowMins - HOUR_START * 60) / 60) * HOUR_HEIGHT;
  const showNow = nowMins >= HOUR_START * 60 && nowMins <= HOUR_END * 60;

  const handleColumnContextMenu = (e, day) => {
    e.preventDefault();
    if (!gridRef.current) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const y = e.clientY - rect.top;
    const totalMins = (y / HOUR_HEIGHT) * 60 + HOUR_START * 60;
    const snapped = Math.round(totalMins / MIN_PER_SLOT) * MIN_PER_SLOT;
    const h = Math.floor(snapped / 60);
    const m = snapped % 60;
    if (h < HOUR_START || h >= HOUR_END) return;
    const start = new Date(day);
    start.setHours(h, m, 0, 0);
    onSlotRightClick?.(start);
  };

  return (
    <div className="flex-1 overflow-auto bg-white" data-testid="apt-week-grid">
      <div ref={gridRef} className="relative min-w-[840px]">
        {/* Day headers */}
        <div className="sticky top-0 z-20 grid grid-cols-[60px_repeat(7,1fr)] bg-white border-b border-slate-200">
          <div />
          {days.map((d) => {
            const isT = sameDay(d, today);
            return (
              <div
                key={d.toISOString()}
                className={`px-3 py-2 text-center border-l border-slate-100 ${
                  isT ? 'bg-blue-50/70' : ''
                }`}
              >
                <div className="text-[10px] uppercase tracking-wider text-slate-500 font-semibold">
                  {d.toLocaleDateString('en-IN', { weekday: 'short' })}
                </div>
                <div
                  className={`text-[15px] font-bold mt-0.5 ${
                    isT ? 'text-blue-700' : 'text-slate-700'
                  }`}
                >
                  {d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}
                </div>
              </div>
            );
          })}
        </div>

        {/* Body grid */}
        <div className="grid grid-cols-[60px_repeat(7,1fr)] relative">
          {/* Time gutter */}
          <div className="border-r border-slate-200 bg-slate-50/50">
            {hours.map((h) => (
              <div
                key={h}
                className="text-[10px] text-slate-400 font-semibold text-right pr-2 pt-0.5"
                style={{ height: HOUR_HEIGHT }}
              >
                {String(h).padStart(2, '0')}
                <sup className="text-[8px] font-normal ml-0.5">00</sup>
              </div>
            ))}
          </div>

          {/* Day columns */}
          {days.map((d) => {
            const k = `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
            const dayAppts = byDay[k] || [];
            const isT = sameDay(d, today);
            return (
              <div
                key={d.toISOString()}
                className={`relative border-l border-slate-100 ${isT ? 'bg-blue-50/30' : ''}`}
                onContextMenu={(e) => handleColumnContextMenu(e, d)}
                data-testid={`apt-day-col-${d.toISOString().slice(0, 10)}`}
              >
                {/* hour ruler */}
                {hours.map((h) => (
                  <div
                    key={h}
                    className="border-t border-slate-100"
                    style={{ height: HOUR_HEIGHT }}
                  />
                ))}
                {/* events */}
                {dayAppts.map((a) => (
                  <AppointmentEvent key={a.appointment_id} appt={a} onClick={onEventClick} />
                ))}
                {/* now indicator */}
                {isT && showNow && (
                  <div
                    className="absolute left-0 right-0 pointer-events-none z-10"
                    style={{ top: nowTop }}
                    data-testid="apt-now-indicator"
                  >
                    <div className="h-[2px] bg-rose-500" />
                    <div className="absolute -left-1 -top-1 w-2 h-2 rounded-full bg-rose-500" />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
