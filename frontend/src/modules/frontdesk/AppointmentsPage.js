import React, { useState, useEffect, useMemo, useCallback } from 'react';
import axios from 'axios';
import { useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../../AuthContext';
import BookAppointmentModal from './appointments/BookAppointmentModal';
import WaitlistPanel from './appointments/WaitlistPanel';

const BACKEND_URL = process.env.REACT_APP_BACKEND_URL;
const API = `${BACKEND_URL}/api`;

const SERVICES = [
  'Consultation', 'PTA', 'Immittance', 'OAE', 'ABR/BERA', 'ASSR',
  'Vestibular Tests', 'Follow-up', 'Speech Audiometry', 'Hearing Aid Fitting',
];
const STATUS_STYLES = {
  scheduled:   'bg-slate-100 text-slate-700 border-slate-300',
  confirmed:   'bg-blue-100 text-blue-800 border-blue-300',
  checked_in:  'bg-amber-100 text-amber-800 border-amber-300',
  in_progress: 'bg-purple-100 text-purple-800 border-purple-300',
  completed:   'bg-emerald-100 text-emerald-800 border-emerald-300',
  no_show:     'bg-rose-100 text-rose-700 border-rose-300',
  cancelled:   'bg-slate-200 text-slate-500 border-slate-300 line-through',
};

const fmtTime = (iso) => { try { return new Date(iso).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' }); } catch { return iso; } };
const fmtDate = (iso) => { try { return new Date(iso).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' }); } catch { return iso; } };
const toYMD = (d) => d.toISOString().slice(0, 10);
const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
const startOfWeek = (d) => { const x = new Date(d); x.setDate(x.getDate() - x.getDay() + 1); return x; }; // Monday

export default function AppointmentsPage() {
  const [view, setView] = useState('today'); // 'today' | 'week'
  const [anchorDate, setAnchorDate] = useState(new Date());
  const [audiologists, setAudiologists] = useState([]);
  const [filter, setFilter] = useState({ audiologist_id: '', service: '', priority: '', status: '' });
  const [appointments, setAppointments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [modalInitial, setModalInitial] = useState(null);
  const [waitlistOpen, setWaitlistOpen] = useState(false);
  const navigate = useNavigate();
  const location = useLocation();
  const { clinic } = useAuth();

  // Auto-open Book modal if navigated here with a patient to pre-fill (from paid invoice CTA or Cmd+K)
  useEffect(() => {
    const pre = location.state?.bookForPatient;
    if (pre && !modalOpen) {
      const suggestedDate = location.state?.suggestedDate
        ? new Date(location.state.suggestedDate)
        : new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);  // default +30 days
      setAnchorDate(suggestedDate);
      setModalInitial({
        patient_id: pre.patient_id,
        patient_name: pre.name,
      });
      setModalOpen(true);
      // Clear state so we don't reopen on subsequent renders
      window.history.replaceState({}, document.title);
    }
     
  }, [location.state]);

  useEffect(() => {
    axios.get(`${API}/users?role=audiologist`).then((r) => setAudiologists(r.data || [])).catch(() => {});
  }, []);

  const range = useMemo(() => {
    if (view === 'today') {
      const ymd = toYMD(anchorDate);
      return { from_date: ymd, to_date: ymd };
    }
    const start = startOfWeek(anchorDate);
    return { from_date: toYMD(start), to_date: toYMD(addDays(start, 6)) };
  }, [view, anchorDate]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await axios.get(`${API}/appointments`, {
        params: { ...range, ...Object.fromEntries(Object.entries(filter).filter(([, v]) => v)) },
      });
      setAppointments(r.data || []);
    } finally { setLoading(false); }
  }, [range, filter]);

  useEffect(() => { load(); }, [load]);

  const onDrop = async (appt, newStartIso) => {
    try {
      await axios.put(`${API}/appointments/${appt.appointment_id}`, { start_at: newStartIso });
      load();
    } catch (e) {
      alert(e?.response?.data?.detail?.message || e?.response?.data?.detail || 'Reschedule failed');
    }
  };

  const onStatusChange = async (appt, status) => {
    try { await axios.put(`${API}/appointments/${appt.appointment_id}`, { status }); load(); }
    catch (e) { alert(e?.message || 'Update failed'); }
  };

  const onCancel = async (appt) => {
    const reason = window.prompt('Cancellation reason:');
    if (reason === null) return;
    try { await axios.post(`${API}/appointments/${appt.appointment_id}/cancel`, { reason }); load(); }
    catch (e) { alert(e?.message || 'Cancel failed'); }
  };

  const sendReminder = async (appt, channel) => {
    // wa.me deep-link — user's own WhatsApp client composes the message.
    // Backend `POST /api/reminders/send` is still called so we have an audit trail.
    if (channel !== 'whatsapp') return;
    const digits = (appt.patient_mobile || '').replace(/\D/g, '');
    if (!digits) { alert('Patient has no mobile number on record.'); return; }
    const mobile = digits.length === 10 ? `91${digits}` : digits;
    const when = new Date(appt.start_at);
    const dateStr = when.toLocaleDateString('en-IN', { weekday: 'short', day: '2-digit', month: 'short', year: 'numeric' });
    const timeStr = when.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });
    const body =
      `Hi ${appt.patient_name}, this is a reminder for your appointment at *${clinic?.name || 'our clinic'}*.\n\n` +
      `🗓 ${dateStr} at ${timeStr}\n` +
      `🩺 ${appt.service}${appt.audiologist_name ? ` with ${appt.audiologist_name}` : ''}${appt.room ? ` · ${appt.room}` : ''}\n\n` +
      `Please reply to confirm or reschedule. See you soon!`;
    window.open(`https://wa.me/${mobile}?text=${encodeURIComponent(body)}`, '_blank');
    // Fire-and-forget audit log (non-blocking).
    try {
      await axios.post(`${API}/reminders/send`, {
        appointment_id: appt.appointment_id, patient_id: appt.patient_id, channel: 'whatsapp',
      });
      load();
    } catch { /* audit log is best-effort */ }
  };

  const goToInvoice = (appt) => {
    navigate('/billing/new', {
      state: {
        patient: {
          patient_id: appt.patient_id,
          name: appt.patient_name,
          mrd: appt.mrd,
          mobile: appt.patient_mobile,
        },
      },
    });
  };

  return (
    <div className="h-full flex flex-col" data-testid="appointments-page">
      {/* Toolbar */}
      <div className="bg-white border-b border-slate-200 px-3 py-2 flex items-center gap-2 flex-wrap">
        <div className="flex bg-slate-100 rounded overflow-hidden">
          <button onClick={() => setView('today')} data-testid="apt-view-today"
            className={`px-3 py-1 text-xs font-semibold ${view === 'today' ? 'bg-blue-600 text-white' : 'text-slate-700 hover:bg-slate-200'}`}>Today</button>
          <button onClick={() => setView('week')} data-testid="apt-view-week"
            className={`px-3 py-1 text-xs font-semibold ${view === 'week' ? 'bg-blue-600 text-white' : 'text-slate-700 hover:bg-slate-200'}`}>Week</button>
        </div>

        <div className="flex items-center gap-1">
          <button onClick={() => setAnchorDate((d) => addDays(d, view === 'today' ? -1 : -7))} data-testid="apt-prev" className="w-6 h-6 border border-slate-300 rounded hover:bg-slate-50 text-slate-700">‹</button>
          <button onClick={() => setAnchorDate(new Date())} data-testid="apt-today" className="px-2 py-0.5 text-[10px] border border-slate-300 rounded hover:bg-slate-50 font-semibold">Today</button>
          <button onClick={() => setAnchorDate((d) => addDays(d, view === 'today' ? 1 : 7))} data-testid="apt-next" className="w-6 h-6 border border-slate-300 rounded hover:bg-slate-50 text-slate-700">›</button>
          <span className="ml-1 text-xs font-semibold text-slate-700 min-w-[100px]">
            {view === 'today' ? anchorDate.toLocaleDateString('en-IN', { weekday: 'short', day: '2-digit', month: 'short', year: 'numeric' })
              : `${fmtDate(startOfWeek(anchorDate))} – ${fmtDate(addDays(startOfWeek(anchorDate), 6))}`}
          </span>
        </div>

        <div className="flex-1" />

        <select value={filter.audiologist_id} onChange={(e) => setFilter({ ...filter, audiologist_id: e.target.value })}
          data-testid="apt-filter-audiologist" className="text-xs border border-slate-300 rounded px-1.5 py-0.5 bg-white">
          <option value="">All audiologists</option>
          {audiologists.map((a) => <option key={a.user_id} value={a.user_id}>{a.name}</option>)}
        </select>
        <select value={filter.service} onChange={(e) => setFilter({ ...filter, service: e.target.value })}
          data-testid="apt-filter-service" className="text-xs border border-slate-300 rounded px-1.5 py-0.5 bg-white">
          <option value="">All services</option>
          {SERVICES.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        <select value={filter.priority} onChange={(e) => setFilter({ ...filter, priority: e.target.value })}
          data-testid="apt-filter-priority" className="text-xs border border-slate-300 rounded px-1.5 py-0.5 bg-white">
          <option value="">All priorities</option>
          <option value="normal">Normal</option><option value="urgent">Urgent</option><option value="vip">VIP</option>
        </select>
        <select value={filter.status} onChange={(e) => setFilter({ ...filter, status: e.target.value })}
          data-testid="apt-filter-status" className="text-xs border border-slate-300 rounded px-1.5 py-0.5 bg-white">
          <option value="">All statuses</option>
          {['scheduled', 'confirmed', 'checked_in', 'in_progress', 'completed', 'no_show', 'cancelled'].map((s) => (
            <option key={s} value={s}>{s.replace('_', ' ')}</option>
          ))}
        </select>

        <button onClick={() => setWaitlistOpen(true)} data-testid="apt-waitlist-btn"
          className="px-2.5 py-1 text-xs bg-white border border-slate-300 hover:bg-slate-50 text-slate-700 font-semibold rounded">Waitlist</button>
        <button onClick={() => { setModalInitial(null); setModalOpen(true); }} data-testid="apt-book-btn"
          className="px-2.5 py-1 text-xs bg-blue-600 hover:bg-blue-700 text-white font-semibold rounded shadow-sm">+ Book Appointment</button>
      </div>

      {/* View body */}
      <div className="flex-1 overflow-auto bg-slate-50 p-3">
        {loading ? (
          <div className="text-center text-xs text-slate-400 italic py-8">Loading…</div>
        ) : view === 'today' ? (
          <DayList
            date={anchorDate}
            appointments={appointments}
            audiologists={audiologists.length ? audiologists : [{ user_id: 'solo', name: 'Scheduled' }]}
            onDrop={onDrop}
            onStatusChange={onStatusChange}
            onCancel={onCancel}
            onSendReminder={sendReminder}
            onInvoice={goToInvoice}
            onEdit={(a) => { setModalInitial(a); setModalOpen(true); }}
          />
        ) : (
          <WeekGrid
            anchor={anchorDate}
            appointments={appointments}
            audiologists={audiologists}
            onDrop={onDrop}
            onEdit={(a) => { setModalInitial(a); setModalOpen(true); }}
          />
        )}
      </div>

      {modalOpen && (
        <BookAppointmentModal
          audiologists={audiologists}
          initialDate={anchorDate}
          existing={modalInitial}
          onClose={() => setModalOpen(false)}
          onSaved={() => { setModalOpen(false); load(); }}
        />
      )}
      {waitlistOpen && (
        <WaitlistPanel audiologists={audiologists} onClose={() => setWaitlistOpen(false)} onBook={(w) => {
          setWaitlistOpen(false);
          setModalInitial({ patient_id: w.patient_id, patient_name: w.patient_name, audiologist_id: w.preferred_audiologist_id, service: w.preferred_service, _waitlist_entry_id: w.entry_id });
          setModalOpen(true);
        }} />
      )}
    </div>
  );
}

// ===================== DAY LIST (time-sorted cards) =====================
const DayList = ({ appointments, audiologists, onDrop, onStatusChange, onCancel, onSendReminder, onInvoice, onEdit, date }) => {
  // Drop target = hour slot (8am-8pm)
  const hours = Array.from({ length: 13 }, (_, i) => 8 + i);
  const apptByHour = {};
  appointments.forEach((a) => {
    const h = new Date(a.start_at).getHours();
    (apptByHour[h] = apptByHour[h] || []).push(a);
  });

  const dragData = React.useRef(null);
  const onDragStart = (a) => { dragData.current = a; };
  const onSlotDrop = (hour) => {
    if (!dragData.current) return;
    const newStart = new Date(date); newStart.setHours(hour, 0, 0, 0);
    const iso = new Date(newStart.getTime() - newStart.getTimezoneOffset() * 60000).toISOString().slice(0, 19);
    onDrop(dragData.current, iso);
    dragData.current = null;
  };

  if (appointments.length === 0) {
    return (
      <div className="bg-white rounded-lg border border-slate-200 p-8 text-center">
        <div className="text-sm text-slate-500 mb-2">No appointments on this day</div>
        <div className="text-[11px] text-slate-400">Use "+ Book Appointment" to schedule one.</div>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-lg border border-slate-200 overflow-hidden">
      {hours.map((h) => (
        <div key={h} className="flex border-b border-slate-100 last:border-0 min-h-[56px]"
          onDragOver={(e) => e.preventDefault()}
          onDrop={() => onSlotDrop(h)}
          data-testid={`slot-hour-${h}`}>
          <div className="w-16 flex-shrink-0 text-[10px] font-semibold text-slate-400 px-2 py-1.5 border-r border-slate-100 tabular-nums">
            {String(h).padStart(2, '0')}:00
          </div>
          <div className="flex-1 p-1.5 space-y-1">
            {(apptByHour[h] || []).map((a) => (
              <ApptCard key={a.appointment_id} a={a} onStatusChange={onStatusChange} onCancel={onCancel} onSendReminder={onSendReminder} onInvoice={onInvoice} onEdit={onEdit} onDragStart={onDragStart} />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
};

// ===================== APPT CARD =====================
const ApptCard = ({ a, onStatusChange, onCancel, onSendReminder, onInvoice, onEdit, onDragStart, compact = false }) => {
  const s = STATUS_STYLES[a.status] || STATUS_STYLES.scheduled;
  return (
    <div
      draggable
      onDragStart={() => onDragStart?.(a)}
      data-testid={`appt-${a.appointment_id}`}
      className={`border rounded px-2 py-1 text-xs bg-white hover:border-blue-400 transition-colors cursor-grab ${compact ? 'text-[10px]' : ''}`}
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5 min-w-0">
          <span className="font-mono text-slate-600 text-[10px] tabular-nums flex-shrink-0">{fmtTime(a.start_at)}</span>
          <span className="font-semibold text-slate-800 truncate">{a.patient_name}</span>
          {a.priority !== 'normal' && (
            <span className={`text-[9px] px-1 rounded font-bold ${a.priority === 'vip' ? 'bg-amber-500 text-white' : 'bg-red-500 text-white'}`}>{a.priority.toUpperCase()}</span>
          )}
        </div>
        <span className={`text-[9px] font-semibold px-1.5 py-0 border rounded ${s} flex-shrink-0`}>{a.status.replace('_', ' ')}</span>
      </div>
      {!compact && (
        <div className="flex items-center justify-between mt-0.5">
          <div className="text-[10px] text-slate-500 truncate flex-1">
            {a.service} · {a.audiologist_name}{a.room ? ` · ${a.room}` : ''}{a.mrd ? ` · ${a.mrd}` : ''}
          </div>
          <div className="flex gap-0.5 flex-shrink-0 ml-1">
            {a.status !== 'completed' && a.status !== 'cancelled' && (
              <select
                value={a.status}
                onChange={(e) => onStatusChange(a, e.target.value)}
                data-testid={`appt-status-${a.appointment_id}`}
                className="text-[9px] border border-slate-300 rounded px-0.5 py-0 bg-white"
                onClick={(e) => e.stopPropagation()}
              >
                {['scheduled', 'confirmed', 'checked_in', 'in_progress', 'completed', 'no_show'].map((s) => (
                  <option key={s} value={s}>{s.replace('_', ' ')}</option>
                ))}
              </select>
            )}
            <button onClick={() => onSendReminder(a, 'whatsapp')} data-testid={`appt-wa-${a.appointment_id}`} title="WhatsApp reminder (opens wa.me)" className="px-1 text-[9px] bg-[#25D366] hover:bg-[#1ebe5a] text-white font-bold rounded">WA</button>
            <button onClick={() => onInvoice?.(a)} data-testid={`appt-invoice-${a.appointment_id}`} title="Create invoice for this patient" className="px-1 text-[9px] bg-emerald-50 border border-emerald-300 text-emerald-700 hover:bg-emerald-100 font-bold rounded">₹</button>
            <button onClick={() => onEdit(a)} title="Edit" className="px-1 text-[9px] bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold rounded">Edit</button>
            {a.status !== 'cancelled' && (
              <button onClick={() => onCancel(a)} data-testid={`appt-cancel-${a.appointment_id}`} title="Cancel" className="px-1 text-[9px] border border-red-300 text-red-600 hover:bg-red-50 font-bold rounded">✕</button>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

// ===================== WEEK GRID =====================
const WeekGrid = ({ anchor, appointments, audiologists, onDrop, onEdit }) => {
  const monday = startOfWeek(anchor);
  const days = Array.from({ length: 7 }, (_, i) => addDays(monday, i));
  const dragData = React.useRef(null);
  const onDragStart = (a) => { dragData.current = a; };
  const onDayDrop = (date) => {
    if (!dragData.current) return;
    const oldStart = new Date(dragData.current.start_at);
    const newStart = new Date(date); newStart.setHours(oldStart.getHours(), oldStart.getMinutes(), 0, 0);
    const iso = new Date(newStart.getTime() - newStart.getTimezoneOffset() * 60000).toISOString().slice(0, 19);
    onDrop(dragData.current, iso);
    dragData.current = null;
  };

  const apptByDay = {};
  appointments.forEach((a) => {
    const k = a.start_at.slice(0, 10);
    (apptByDay[k] = apptByDay[k] || []).push(a);
  });

  return (
    <div className="grid grid-cols-7 gap-1 h-full" data-testid="week-grid">
      {days.map((d) => {
        const k = toYMD(d);
        const list = apptByDay[k] || [];
        const isToday = k === toYMD(new Date());
        return (
          <div
            key={k}
            onDragOver={(e) => e.preventDefault()}
            onDrop={() => onDayDrop(d)}
            data-testid={`week-day-${k}`}
            className={`bg-white rounded border ${isToday ? 'border-blue-400' : 'border-slate-200'} overflow-hidden flex flex-col`}
          >
            <div className={`px-2 py-1 text-[10px] font-bold border-b ${isToday ? 'bg-blue-50 text-blue-700 border-blue-200' : 'bg-slate-50 text-slate-600 border-slate-200'}`}>
              {d.toLocaleDateString('en-IN', { weekday: 'short' })} · {d.getDate()}
            </div>
            <div className="flex-1 p-1 space-y-0.5 overflow-auto min-h-[180px]">
              {list.length === 0 && <div className="text-[9px] text-slate-300 italic text-center py-2">—</div>}
              {list.map((a) => (
                <ApptCard key={a.appointment_id} a={a} onStatusChange={() => {}} onCancel={() => {}} onSendReminder={() => {}} onEdit={onEdit} onDragStart={onDragStart} compact />
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
};
