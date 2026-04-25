import React, { useMemo, useRef, useState } from 'react';
import { contrastOn, hexAlpha, ymdLocal, sameDay } from '../utils';

const HOUR_START = 8;
const HOUR_END = 22;
const HOUR_HEIGHT = 64;
const MIN_PER_SLOT = 15;
const TOTAL_HOURS = HOUR_END - HOUR_START;

/**
 * DayView — single-day calendar. Same drag/right-click ergonomics as WeekGrid
 * but with a roomier per-event card (more whitespace, full title + service
 * + counterparty company line if present).
 */
export default function DayView({ date, appointments, onEventClick, onSlotRightClick, onEventDrop }) {
  const colRef = useRef(null);
  const [drag, setDrag] = useState(null);

  const dayAppts = useMemo(() => {
    return appointments.filter((a) => {
      try { return sameDay(new Date(a.start_at), date); } catch { return false; }
    });
  }, [appointments, date]);

  const hours = useMemo(
    () => Array.from({ length: TOTAL_HOURS }, (_, i) => HOUR_START + i),
    [],
  );

  const today = new Date();
  const isToday = sameDay(date, today);
  const nowMins = today.getHours() * 60 + today.getMinutes();
  const nowTop = ((nowMins - HOUR_START * 60) / 60) * HOUR_HEIGHT;
  const showNow = isToday && nowMins >= HOUR_START * 60 && nowMins <= HOUR_END * 60;

  const handleColCtxMenu = (e) => {
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
    onSlotRightClick?.(start);
  };

  const beginDrag = (e, appt) => {
    if (e.button !== 0) return;
    if (appt.status === 'cancelled' || appt.status === 'completed') return;
    e.preventDefault();
    setDrag({ appt, target: null });
    const onMove = (ev) => {
      if (!colRef.current) return;
      const rect = colRef.current.getBoundingClientRect();
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
      if (!colRef.current) return setDrag(null);
      const rect = colRef.current.getBoundingClientRect();
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
      setDrag(null);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  };

  return (
    <div className="flex-1 overflow-auto bg-white" data-testid="apt-day-view">
      <div className="max-w-3xl mx-auto pb-12">
        {/* Day header */}
        <div className={`sticky top-0 z-20 bg-white border-b border-slate-200 px-4 py-3 ${isToday ? 'bg-blue-50/70' : ''}`}>
          <div className="text-[10px] uppercase tracking-wider text-slate-500 font-semibold">
            {date.toLocaleDateString('en-IN', { weekday: 'long' })}
          </div>
          <div className={`text-xl font-bold mt-0.5 ${isToday ? 'text-blue-700' : 'text-slate-800'}`}>
            {date.toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' })}
            <span className="ml-3 text-[11px] font-semibold text-slate-400">
              {dayAppts.length} appointment{dayAppts.length === 1 ? '' : 's'}
            </span>
          </div>
        </div>

        {/* Body */}
        <div className="grid grid-cols-[64px_1fr]">
          {/* Hour gutter */}
          <div className="border-r border-slate-200 bg-slate-50/50">
            {hours.map((h) => (
              <div
                key={h}
                className="text-[11px] text-slate-400 font-semibold text-right pr-3 pt-0.5"
                style={{ height: HOUR_HEIGHT }}
              >
                {String(h).padStart(2, '0')}:00
              </div>
            ))}
          </div>

          {/* Day column */}
          <div
            ref={colRef}
            className="relative"
            onContextMenu={handleColCtxMenu}
            data-testid={`apt-day-col-${ymdLocal(date)}`}
          >
            {hours.map((h) => (
              <div key={h} className="border-t border-slate-100" style={{ height: HOUR_HEIGHT }} />
            ))}
            {/* Events */}
            {dayAppts.map((a) => {
              const start = new Date(a.start_at);
              const end = new Date(a.end_at);
              const top = ((start.getHours() - HOUR_START) * 60 + start.getMinutes()) / 60 * HOUR_HEIGHT;
              const dur = Math.max(15, (end - start) / 60000);
              const height = (dur / 60) * HOUR_HEIGHT - 2;
              const color = a.staff_color || '#6B7280';
              const fg = contrastOn(color);
              const isCancelled = a.status === 'cancelled' || a.status === 'no_show';
              const timeLabel = `${start.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: false })} – ${end.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: false })}`;
              const title = a.counterparty_name || a.patient_name || 'Untitled';
              const subtitle = [a.service, a.staff_name].filter(Boolean).join(' · ');
              return (
                <div
                  key={a.appointment_id}
                  role="button"
                  tabIndex={0}
                  onClick={(e) => { e.stopPropagation(); onEventClick?.(a); }}
                  onMouseDown={(e) => beginDrag(e, a)}
                  data-testid={`apt-event-${a.appointment_id}`}
                  className={`absolute left-2 right-2 rounded-lg px-3 py-2 cursor-grab active:cursor-grabbing transition-shadow hover:shadow-md select-none ${isCancelled ? 'opacity-50 line-through' : ''} ${drag?.appt?.appointment_id === a.appointment_id ? 'opacity-70 ring-2 ring-blue-400' : ''}`}
                  style={{
                    top, height, backgroundColor: color, color: fg,
                    boxShadow: `0 2px 6px ${hexAlpha(color, 0.4)}`,
                  }}
                >
                  <div className="text-[11px] font-bold opacity-95">{timeLabel}</div>
                  <div className="text-[14px] font-bold leading-tight truncate mt-0.5">{title}</div>
                  {height > 50 && <div className="text-[11px] opacity-90 truncate mt-0.5">{subtitle}</div>}
                  {height > 80 && a.notes && <div className="text-[10px] opacity-80 truncate mt-1 italic">{a.notes}</div>}
                </div>
              );
            })}
            {/* Drop preview */}
            {drag?.target && (
              <div
                className="absolute left-2 right-2 border-2 border-dashed border-blue-500 bg-blue-100/40 rounded-lg pointer-events-none z-20 flex items-center justify-center text-[11px] font-bold text-blue-700"
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
        </div>
      </div>
    </div>
  );
}
