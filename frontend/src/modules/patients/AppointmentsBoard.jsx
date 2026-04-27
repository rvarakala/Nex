/**
 * Appointments Board — 7Health.Pro card-grid layout.
 * Cards show patient avatar + age + gender + contact + time + date + complaint
 * + status pill + kebab menu (View Profile · Attend Now · Add to Queue · Edit · Cancel).
 *
 * Loads today's appointments from /api/appointments?date=today.
 */
import React, { useEffect, useState, useCallback } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import axios from 'axios';
import { Plus, Search, MoreVertical, ArrowRight, X, Edit2, ListPlus, User } from 'lucide-react';
import { useAuth } from '../../AuthContext';

const API = process.env.REACT_APP_BACKEND_URL + '/api';

const todayISO = () => new Date().toISOString().slice(0, 10);
const fmtTime = (iso) => { try { return new Date(iso).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' }); } catch { return iso; } };
const fmtDate = (iso) => { try { return new Date(iso).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }); } catch { return iso; } };
const initials = (name) => (name || '?').trim().split(/\s+/).slice(0, 2).map(s => s[0] || '').join('').toUpperCase();

const STATUS_STYLES = {
  scheduled: { bg: 'bg-violet-100',  text: 'text-violet-700',  label: 'Scheduled' },
  booked:    { bg: 'bg-violet-100',  text: 'text-violet-700',  label: 'Scheduled' },
  in_queue:  { bg: 'bg-amber-100',   text: 'text-amber-800',   label: 'In Queue' },
  checked_in:{ bg: 'bg-amber-100',   text: 'text-amber-800',   label: 'In Queue' },
  attending: { bg: 'bg-emerald-100', text: 'text-emerald-700', label: 'Attending Now' },
  in_progress:{bg: 'bg-emerald-100', text: 'text-emerald-700', label: 'Attending Now' },
  complete:  { bg: 'bg-emerald-100', text: 'text-emerald-800', label: 'Complete' },
  completed: { bg: 'bg-emerald-100', text: 'text-emerald-800', label: 'Complete' },
  cancelled: { bg: 'bg-rose-100',    text: 'text-rose-700',    label: 'Cancelled' },
  no_show:   { bg: 'bg-rose-100',    text: 'text-rose-700',    label: 'No-show' },
};

export default function AppointmentsBoard() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const firstName = (user?.name || user?.email || 'there').split(/[ @]/)[0];

  const [date, setDate]   = useState(todayISO());
  const [q, setQ]         = useState('');
  const [rows, setRows]   = useState([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await axios.get(`${API}/appointments?date=${date}`);
      setRows(Array.isArray(r.data) ? r.data : (r.data?.items || []));
    } catch { setRows([]); }
    finally { setLoading(false); }
  }, [date]);
  useEffect(() => { load(); }, [load]);

  const filtered = rows.filter((a) => {
    if (!q.trim()) return true;
    const term = q.toLowerCase();
    return (a.patient_name || '').toLowerCase().includes(term)
      || (a.mobile || '').includes(term);
  });

  return (
    <div className="p-4 sm:p-6 space-y-4" data-testid="appointments-board">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold text-slate-900">Hey! {firstName} <span className="inline-block">👋</span></h1>
          <p className="text-[12.5px] text-slate-500 mt-0.5">Here are list of all your appointments!</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <input
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            data-testid="appts-date"
            className="text-[12px] px-3 py-2 border border-slate-200 rounded-lg bg-white text-slate-700"
          />
          <div className="relative">
            <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search"
              data-testid="appts-search"
              className="text-[12px] pl-8 pr-3 py-2 border border-slate-200 rounded-lg bg-white text-slate-700 outline-none focus:border-indigo-500 w-44"
            />
          </div>
          <Link
            to="/frontdesk/appointments"
            data-testid="appts-add"
            className="inline-flex items-center gap-1.5 text-[12px] px-3 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg font-semibold shadow-sm shadow-indigo-600/20">
            <Plus size={13} /> Add Appointment
          </Link>
        </div>
      </header>

      {loading ? (
        <div className="py-16 text-center italic text-slate-400 text-sm">Loading appointments…</div>
      ) : filtered.length === 0 ? (
        <div className="bg-white border border-dashed border-slate-200 rounded-xl py-16 text-center">
          <div className="text-sm font-semibold text-slate-700">No appointments {q ? 'match this filter' : 'on this date'}.</div>
          <Link to="/frontdesk/appointments" className="mt-3 inline-flex items-center gap-1.5 text-[12px] px-3 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg font-semibold">
            <Plus size={13} /> Book Appointment
          </Link>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5 gap-3">
          {filtered.map((a) => (
            <ApptCard key={a.appointment_id} a={a} onView={() => navigate(`/patients/${a.patient_id}`)} />
          ))}
        </div>
      )}
    </div>
  );
}

function ApptCard({ a, onView }) {
  const s = STATUS_STYLES[String(a.status || '').toLowerCase()] || { bg: 'bg-slate-100', text: 'text-slate-700', label: a.status || '—' };
  const [menuOpen, setMenuOpen] = useState(false);
  return (
    <div
      className="bg-white border border-slate-200 rounded-xl p-3.5 shadow-sm hover:shadow-md transition-shadow flex flex-col gap-3"
      data-testid={`appt-card-${a.appointment_id}`}>
      {/* Header */}
      <div className="flex items-center gap-2.5">
        <span className="w-9 h-9 rounded-full bg-indigo-100 text-indigo-700 flex items-center justify-center font-bold text-[12px] flex-shrink-0">
          {initials(a.patient_name)}
        </span>
        <div className="flex-1 min-w-0">
          <div className="text-[13px] font-bold text-slate-900 truncate">{a.patient_name || '—'}</div>
          <div className="text-[11px] text-slate-500 truncate">{a.age ? `${a.age} Years` : ''}{a.gender ? ` · ${a.gender}` : ''}</div>
        </div>
      </div>

      {/* Body */}
      <div className="text-[11.5px] text-slate-700 space-y-1">
        <Row k="Contact No." v={a.mobile || a.patient_mobile || '—'} />
        <Row k="Time" v={fmtTime(a.start_at)} />
        <Row k="Date" v={fmtDate(a.start_at)} />
      </div>

      {/* Note bubble */}
      <div className="bg-slate-50 border border-slate-100 rounded-md px-2.5 py-2 text-[11.5px] text-slate-700 italic min-h-[42px] line-clamp-2">
        {a.complaint || a.notes || a.service || '—'}
      </div>

      {/* Footer: status + kebab */}
      <div className="flex items-center justify-between mt-auto relative">
        <span className={`px-2.5 py-1 rounded-full text-[10.5px] font-semibold ${s.bg} ${s.text}`}>{s.label}</span>
        <button
          onClick={() => setMenuOpen((o) => !o)}
          data-testid={`appt-menu-${a.appointment_id}`}
          className="w-7 h-7 rounded-full bg-indigo-600 hover:bg-indigo-700 text-white flex items-center justify-center">
          <MoreVertical size={13} />
        </button>
        {menuOpen && (
          <div className="absolute right-0 bottom-9 z-10 bg-white border border-slate-200 rounded-lg shadow-lg py-1 min-w-[150px]" data-testid={`appt-menu-open-${a.appointment_id}`}>
            <MenuItem icon={User}     label="View Profile" onClick={() => { setMenuOpen(false); onView(); }} />
            <MenuItem icon={ArrowRight} label="Attend Now"  onClick={() => { setMenuOpen(false); window.location.href = `/test`; }} />
            <MenuItem icon={ListPlus} label="Add to Queue" onClick={() => setMenuOpen(false)} />
            <MenuItem icon={Edit2}    label="Edit"         onClick={() => { setMenuOpen(false); window.location.href = `/frontdesk/appointments`; }} />
            <MenuItem icon={X}        label="Cancel"       danger onClick={() => setMenuOpen(false)} />
          </div>
        )}
      </div>
    </div>
  );
}

const Row = ({ k, v }) => (
  <div className="flex items-center justify-between gap-2">
    <span className="text-slate-500">{k}</span>
    <span className="font-semibold text-slate-800 truncate">{v}</span>
  </div>
);

const MenuItem = ({ icon: Icon, label, onClick, danger }) => (
  <button
    onClick={onClick}
    className={`w-full flex items-center gap-2 px-3 py-1.5 text-[12px] hover:bg-slate-50 ${danger ? 'text-rose-600' : 'text-slate-700'}`}>
    <Icon size={12} /> {label}
  </button>
);
