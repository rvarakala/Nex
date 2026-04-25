import React, { useMemo, useRef, useState } from 'react';
import { contrastOn, hexAlpha, ymdLocal, sameDay } from '../utils';

const HOUR_START = 8;
const HOUR_END = 22;
const HOUR_HEIGHT = 56;
const MIN_PER_SLOT = 15;
const TOTAL_HOURS = HOUR_END - HOUR_START;

/**
 * PersonsView — resource calendar. Columns = staff members, rows = time of day.
 * Mirrors the reference design: single-day, every staff member visible (or
 * filtered by the rail), drag still rebooks within the same staff column
 * (cross-column drag is disabled to keep the model simple — staff change
 * happens via the modal instead).
 */
export default function PersonsView({
  date,
  staff,
  appointments,
  onEventClick,
  onSlotRightClick,
  onEventDrop,
}) {
  const [drag, setDrag] = useState(null);
  const colRefs = useRef({}); // staff_id -> column DOM ref

  const dayAppts = useMemo(
    () => appointments.filter((a) => {
      try { return sameDay(new Date(a.start_at), date); } catch { return false; }
    }),
    [appointments, date],
  );

  const apptsByStaff = useMemo(() => {
    const m = {};
    for (const s of staff) m[s.user_id] = [];
    for (const a of dayAppts) {
      const sid = a.staff_id || a.audiologist_id;
      if (!sid) continue;
      if (!m[sid]) m[sid] = [];
      m[sid].push(a);
    }
    return m;
  }, [dayAppts, staff]);

  const hours = useMemo(
    () => Array.from({ length: TOTAL_HOURS }, (_, i) => HOUR_START + i),
    [],
  );

  const today = new Date();
  const isToday = sameDay(date, today);
  const nowMins = today.getHours() * 60 + today.getMinutes();
  const nowTop = ((nowMins - HOUR_START * 60) / 60) * HOUR_HEIGHT;
  const showNow = isToday && nowMins >= HOUR_START * 60 && nowMins <= HOUR_END * 60;

  const handleColCtxMenu = (e, staffMember) => {
    e.preventDefault();
    const rect = e.currentTarget.getBoundingClientRect();
    const y = e.clientY - rect.top;
    const totalMins = (y / HOUR_HEIGHT) * 60 + HOUR_START * 60;
    const snapped = Math.round(totalMins / MIN_PER_SLOT) * MIN_PER_SLOT;
    const h = Math.floor(snapped / 60);
    const m = snapped % 60;
    if (h < HOUR_START || h >= HOUR_END) return;
    const start = new Date(date);
    start.setHours(h, m, 0, 0);
    onSlotRightClick?.(start, staffMember);
  };

  const beginDrag = (e, appt) => {
    if (e.button !== 0) return;
    if (appt.status === 'cancelled' || appt.status === 'completed') return;
    e.preventDefault();
    const sid = appt.staff_id || appt.audiologist_id;
    setDrag({ appt, sid, target: null });
    const onMove = (ev) => {
      const colEl = colRefs.current[sid];
      if (!colEl) return;
      const rect = colEl.getBoundingClientRect();
      const y = ev.clientY - rect.top;
      const totalMins = (y / HOUR_HEIGHT) * 60 + HOUR_START * 60;
      const snapped = Math.round(totalMins / MIN_PER_SLOT) * MIN_PER_SLOT;
      const h = Math.floor(snapped / 60);
      const m = snapped % 60;
      if (h >= HOUR_START && h < HOUR_END) {
        setDrag((cur) => (cur ? { ...cur, target: { h, m } } : cur));
      }
    };
    const onUp = (ev) => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      const colEl = colRefs.current[sid];
      if (colEl) {
        const rect = colEl.getBoundingClientRect();
        const y = ev.clientY - rect.top;
        const totalMins = (y / HOUR_HEIGHT) * 60 + HOUR_START * 60;
        const snapped = Math.round(totalMins / MIN_PER_SLOT) * MIN_PER_SLOT;
        const h = Math.floor(snapped / 60);
        const m = snapped % 60;
        if (h >= HOUR_START && h < HOUR_END) {
          const newStart = new Date(date);
          newStart.setHours(h, m, 0, 0);
          const old = new Date(appt.start_at);
          if (newStart.getTime() !== old.getTime()) onEventDrop?.(appt, newStart);
        }
      }
      setDrag(null);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  };

  if (staff.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center text-slate-400 text-sm">
        No staff selected. Pick a staff member from the rail to populate columns.
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-auto bg-white" data-testid="apt-persons-view">
      <div className="min-w-max">
        {/* Day banner */}
        <div className={`sticky top-0 z-30 px-4 py-2.5 border-b border-slate-200 bg-white ${isToday ? 'bg-blue-50/70' : ''}`}>
          <div className={`text-[13px] font-bold ${isToday ? 'text-blue-700' : 'text-slate-800'}`}>
            {date.toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}
            <span className="ml-3 text-[11px] font-semibold text-slate-400">
              {dayAppts.length} appointment{dayAppts.length === 1 ? '' : 's'} across {staff.length} staff
            </span>
          </div>
        </div>

        {/* Staff column headers (sticky) */}
        <div
          className="sticky top-[42px] z-20 grid bg-white border-b border-slate-200"
          style={{ gridTemplateColumns: `60px repeat(${staff.length}, minmax(180px, 1fr))` }}
        >
          <div />
          {staff.map((s) => {
            const initials = (s.name || '?').split(' ').map((p) => p[0]).filter(Boolean).slice(0, 2).join('').toUpperCase();
            return (
              <div
                key={s.user_id}
                className="px-3 py-2 border-l border-slate-100 flex items-center gap-2"
                data-testid={`apt-persons-head-${s.user_id}`}
              >
                <div
                  className="w-7 h-7 rounded-full flex items-center justify-center text-white font-bold text-[10px] flex-shrink-0"
                  style={{ backgroundColor: s.color }}
                >
                  {initials}
                </div>
                <div className="min-w-0">
                  <div className="text-[12px] font-semibold text-slate-800 truncate">{s.name}</div>
                  <div className="text-[9px] text-slate-400 capitalize">
                    {(s.role || '').replace('_', ' ')} · {(apptsByStaff[s.user_id] || []).length} appt
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        {/* Body */}
        <div className="grid relative" style={{ gridTemplateColumns: `60px repeat(${staff.length}, minmax(180px, 1fr))` }}>
          {/* Time gutter */}
          <div className="border-r border-slate-200 bg-slate-50/50">
            {hours.map((h) => (
              <div
                key={h}
                className="text-[10px] text-slate-400 font-semibold text-right pr-2 pt-0.5"
                style={{ height: HOUR_HEIGHT }}
              >
                {String(h).padStart(2, '0')}<sup className="text-[8px] font-normal ml-0.5">00</sup>
              </div>
            ))}
          </div>

          {/* Staff columns */}
          {staff.map((s) => {
            const sAppts = apptsByStaff[s.user_id] || [];
            return (
              <div
                key={s.user_id}
                ref={(el) => { colRefs.current[s.user_id] = el; }}
                className="relative border-l border-slate-100"
                onContextMenu={(e) => handleColCtxMenu(e, s)}
                data-testid={`apt-day-col-${ymdLocal(date)}`}
              >
                {hours.map((h) => (
                  <div key={h} className="border-t border-slate-100" style={{ height: HOUR_HEIGHT }} />
                ))}
                {sAppts.map((a) => {
                  const start = new Date(a.start_at);
                  const end = new Date(a.end_at);
                  const top = ((start.getHours() - HOUR_START) * 60 + start.getMinutes()) / 60 * HOUR_HEIGHT;
                  const dur = Math.max(15, (end - start) / 60000);
                  const height = (dur / 60) * HOUR_HEIGHT - 2;
                  const color = a.staff_color || s.color || '#6B7280';
                  const fg = contrastOn(color);
                  const isCancelled = a.status === 'cancelled' || a.status === 'no_show';
                  const timeLabel = `${start.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: false })}-${end.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: false })}`;
                  const title = a.counterparty_name || a.patient_name || 'Untitled';
                  return (
                    <div
                      key={a.appointment_id}
                      role="button"
                      tabIndex={0}
                      onClick={(e) => { e.stopPropagation(); onEventClick?.(a); }}
                      onMouseDown={(e) => beginDrag(e, a)}
                      data-testid={`apt-event-${a.appointment_id}`}
                      className={`absolute left-1 right-1 rounded-md px-2 py-1 cursor-grab active:cursor-grabbing transition-shadow hover:shadow-md select-none ${isCancelled ? 'opacity-50 line-through' : ''} ${drag?.appt?.appointment_id === a.appointment_id ? 'opacity-70 ring-2 ring-blue-400' : ''}`}
                      style={{
                        top, height, backgroundColor: color, color: fg,
                        boxShadow: `0 1px 3px ${hexAlpha(color, 0.35)}`,
                      }}
                    >
                      <div className="text-[10px] font-bold opacity-95">{timeLabel}</div>
                      <div className="text-[12px] font-semibold leading-snug truncate">{title}</div>
                      {height > 38 && <div className="text-[10px] opacity-90 truncate">{a.service}</div>}
                    </div>
                  );
                })}
                {/* drop preview within this staff column */}
                {drag?.target && drag.sid === s.user_id && (
                  <div
                    className="absolute left-1 right-1 border-2 border-dashed border-blue-500 bg-blue-100/40 rounded-md pointer-events-none z-20 flex items-center justify-center text-[10px] font-bold text-blue-700"
                    style={{
                      top: ((drag.target.h - HOUR_START) * 60 + drag.target.m) / 60 * HOUR_HEIGHT,
                      height: ((drag.appt.duration_minutes || 30) / 60) * HOUR_HEIGHT - 2,
                    }}
                    data-testid="apt-drop-preview"
                  >
                    {String(drag.target.h).padStart(2, '0')}:{String(drag.target.m).padStart(2, '0')}
                  </div>
                )}
                {/* Now line */}
                {showNow && (
                  <div className="absolute left-0 right-0 pointer-events-none z-10" style={{ top: nowTop }}>
                    <div className="h-[2px] bg-rose-500" />
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
