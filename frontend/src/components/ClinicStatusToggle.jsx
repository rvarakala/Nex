/**
 * Clinic Status Toggle — small "Clinic: Close ⏺ Open" pill placed in the
 * topbar (matches the 7Health.Pro reference). Hits /api/clinic/status.
 *
 * Visual feedback only — backend doesn't enforce; product decision is for
 * the UI to soft-block walk-ins / token issuance when closed and let owners
 * override if needed.
 */
import React, { useEffect, useState, useCallback } from 'react';
import axios from 'axios';

const API = process.env.REACT_APP_BACKEND_URL + '/api';

export default function ClinicStatusToggle() {
  const [open, setOpen] = useState(true);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const r = await axios.get(`${API}/clinic/status`);
      setOpen(!!r.data?.is_open);
    } catch { /* ignore */ }
  }, []);
  useEffect(() => { load(); }, [load]);

  const toggle = async () => {
    if (busy) return;
    const next = !open;
    setBusy(true); setOpen(next);
    try {
      await axios.put(`${API}/clinic/status`, { is_open: next });
    } catch {
      // revert on failure
      setOpen(!next);
    } finally { setBusy(false); }
  };

  return (
    <button
      onClick={toggle}
      data-testid="clinic-status-toggle"
      title={open ? 'Clinic is open. Click to close.' : 'Clinic is closed. Click to open.'}
      className={`inline-flex items-center gap-2 px-2.5 py-1 rounded-full border text-[11px] font-semibold transition select-none ${
        open
          ? 'bg-white border-slate-200 text-slate-700 hover:border-indigo-300'
          : 'bg-rose-50 border-rose-200 text-rose-700 hover:bg-rose-100'
      }`}>
      <span className="text-slate-500 text-[10.5px]">Clinic:</span>
      <span className={open ? 'text-slate-400' : 'font-bold'}>Close</span>
      <span
        className={`relative inline-block w-7 h-3.5 rounded-full transition ${open ? 'bg-indigo-600' : 'bg-slate-300'}`}>
        <span
          className={`absolute top-0.5 w-2.5 h-2.5 rounded-full bg-white shadow transition-all ${open ? 'left-3.5' : 'left-0.5'}`}
        />
      </span>
      <span className={open ? 'font-bold text-indigo-700' : 'text-slate-400'}>Open</span>
    </button>
  );
}
