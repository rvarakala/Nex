/**
 * ClinicSwitcher — top-nav dropdown for multi-clinic owners.
 *
 * Hidden if the signed-in user only has a single clinic. Otherwise renders
 * a compact clinic-name + chevron button that opens a list of all clinics
 * the user can sign into. Selecting one calls `/auth/switch-clinic` via
 * AuthContext.switchClinic, then reloads the page to reset any module-level
 * caches that were scoped to the previous tenant.
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import axios from 'axios';
import { ChevronDown, Building2, Check } from 'lucide-react';
import { useAuth } from '../AuthContext';

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;

export default function ClinicSwitcher({ collapsed = false }) {
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

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    const onClickAway = (e) => {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener('mousedown', onClickAway);
    return () => document.removeEventListener('mousedown', onClickAway);
  }, [open]);

  const onSwitch = async (cid) => {
    if (cid === clinic?.clinic_id) { setOpen(false); return; }
    setBusy(true); setErr('');
    try {
      await switchClinic(cid);
      // Hard-reload so every module discards its in-memory cache and
      // re-fetches for the newly-active tenant. We land on /app so the
      // PostLoginRedirect routes to the user's role-default page
      // (e.g. /frontdesk, /test, /admin/dashboard) — routing to "/"
      // would drop the user on the public landing page.
      window.location.href = '/app';
    } catch (e) {
      setErr(e?.response?.data?.detail || 'Switch failed');
      setBusy(false);
    }
  };

  // Single-clinic owners don't need this UI.
  if (rows.length <= 1) return null;

  return (
    <div className="relative" ref={ref} data-testid="clinic-switcher">
      <button
        onClick={() => setOpen((o) => !o)}
        className={`w-full flex items-center gap-2 px-2 py-1.5 text-[12px] font-semibold text-slate-200 hover:bg-white/10 rounded transition ${collapsed ? 'justify-center' : ''}`}
        title={clinic?.name || 'Switch clinic'}
        data-testid="clinic-switcher-btn"
      >
        <Building2 size={13} className="text-indigo-300 flex-shrink-0" />
        {!collapsed && (
          <>
            <span className="flex-1 text-left truncate">{clinic?.name || '—'}</span>
            <ChevronDown size={13} className={`text-slate-400 transition-transform ${open ? 'rotate-180' : ''}`} />
          </>
        )}
      </button>

      {open && !collapsed && (
        <div className="absolute left-0 right-0 top-full mt-1 bg-slate-900 border border-slate-700 rounded shadow-lg z-50 max-h-64 overflow-auto" data-testid="clinic-switcher-menu">
          <div className="px-3 py-1.5 text-[9px] uppercase tracking-wider text-slate-500 font-bold border-b border-slate-700">
            Switch Clinic · {rows.length}
          </div>
          {err && <div className="px-3 py-2 text-[11px] text-rose-300">{err}</div>}
          {rows.map((c) => {
            const active = c.clinic_id === clinic?.clinic_id;
            return (
              <button
                key={c.clinic_id}
                onClick={() => onSwitch(c.clinic_id)}
                disabled={busy}
                data-testid={`clinic-switch-${c.clinic_id}`}
                className={`w-full flex items-center gap-2 px-3 py-2 text-left text-[12px] ${active ? 'bg-indigo-500/15 text-indigo-200' : 'text-slate-200 hover:bg-white/5'}`}
              >
                <div className="flex-1 min-w-0">
                  <div className="font-semibold truncate">{c.name}</div>
                  <div className="text-[10px] text-slate-400 truncate">
                    {[c.city, c.state].filter(Boolean).join(', ')}
                    {c.subscription_tier && ` · ${c.subscription_tier}`}
                  </div>
                </div>
                {active && <Check size={12} className="text-emerald-400 flex-shrink-0" />}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
