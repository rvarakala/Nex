import React, { useCallback, useEffect, useRef, useState } from 'react';
import axios from 'axios';
import { ChevronDown, Building2, Check } from 'lucide-react';
import { useAuth } from '../../../AuthContext';

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;

/**
 * CalendarClinicSwitcher — light-themed inline variant for the calendar toolbar.
 * Hidden when the user only has access to one clinic. After switch, hard-reloads
 * back to `/appointments` so the calendar re-fetches against the new tenant.
 */
export default function CalendarClinicSwitcher() {
  const { clinic, switchClinic } = useAuth();
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const ref = useRef(null);

  const load = useCallback(async () => {
    try {
      const r = await axios.get(`${API}/auth/my-clinics`);
      setRows(r.data?.clinics || []);
    } catch { setRows([]); }
  }, []);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    if (!open) return;
    const onAway = (e) => {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener('mousedown', onAway);
    return () => document.removeEventListener('mousedown', onAway);
  }, [open]);

  const onPick = async (cid) => {
    if (cid === clinic?.clinic_id) { setOpen(false); return; }
    setBusy(true); setErr('');
    try {
      await switchClinic(cid);
      // Stay on the calendar after switching so the user keeps screenshotting / scheduling.
      window.location.href = '/appointments';
    } catch (e) {
      setErr(e?.response?.data?.detail || 'Switch failed');
      setBusy(false);
    }
  };

  if (rows.length <= 1) return null;

  return (
    <div className="relative" ref={ref} data-testid="calendar-clinic-switcher">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        title={clinic?.name || 'Switch clinic'}
        data-testid="calendar-clinic-switcher-btn"
        className="flex items-center gap-1.5 text-[11px] font-semibold text-slate-700 hover:bg-slate-100 border border-slate-200 rounded px-2.5 py-1 transition-colors max-w-[200px]"
      >
        <Building2 size={12} className="text-indigo-500 flex-shrink-0" />
        <span className="truncate flex-1 text-left">{clinic?.name || '—'}</span>
        <ChevronDown size={12} className={`text-slate-400 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        <div
          className="absolute right-0 top-full mt-1 w-[280px] bg-white border border-slate-200 rounded-lg shadow-lg z-50 max-h-72 overflow-auto"
          data-testid="calendar-clinic-switcher-menu"
        >
          <div className="px-3 py-1.5 text-[9px] uppercase tracking-wider text-slate-500 font-bold border-b border-slate-100 bg-slate-50">
            Switch clinic · {rows.length}
          </div>
          {err && (
            <div className="px-3 py-2 text-[11px] text-rose-700 bg-rose-50 border-b border-rose-100">
              {err}
            </div>
          )}
          {rows.map((c) => {
            const active = c.clinic_id === clinic?.clinic_id;
            return (
              <button
                key={c.clinic_id}
                type="button"
                onClick={() => onPick(c.clinic_id)}
                disabled={busy}
                data-testid={`calendar-clinic-switch-${c.clinic_id}`}
                className={`w-full flex items-center gap-2 px-3 py-2 text-left transition-colors ${
                  active ? 'bg-indigo-50' : 'hover:bg-slate-50'
                }`}
              >
                <div className="flex-1 min-w-0">
                  <div className={`text-[12px] font-semibold truncate ${active ? 'text-indigo-800' : 'text-slate-900'}`}>
                    {c.name}
                  </div>
                  <div className="text-[10px] text-slate-500 truncate">
                    {[c.city, c.state].filter(Boolean).join(', ')}
                    {c.subscription_tier && ` · ${c.subscription_tier}`}
                  </div>
                </div>
                {active && <Check size={13} className="text-emerald-500 flex-shrink-0" />}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
