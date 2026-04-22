/**
 * Super-admin-only — manage clinic tiers + view waitlist signups.
 */
import React, { useEffect, useState } from 'react';
import axios from 'axios';

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;
const fmtINR = (n) => `₹${Number(n || 0).toLocaleString('en-IN')}`;

export default function AdminClinicsPage() {
  const [clinics, setClinics] = useState([]);
  const [waitlist, setWaitlist] = useState([]);
  const [busy, setBusy] = useState('');
  const [tab, setTab] = useState('clinics');

  const load = async () => {
    const [c, w] = await Promise.all([
      axios.get(`${API}/admin/clinics`),
      axios.get(`${API}/admin/waitlist`),
    ]);
    setClinics(c.data || []);
    setWaitlist(w.data || []);
  };
  useEffect(() => { load(); }, []);

  const flip = async (cid, tier) => {
    setBusy(cid);
    try {
      await axios.patch(`${API}/admin/clinics/${cid}/tier`, { subscription_tier: tier });
      await load();
    } finally { setBusy(''); }
  };
  const extendTrial = async (cid) => {
    setBusy(cid);
    try {
      await axios.post(`${API}/admin/clinics/${cid}/extend-trial?days=30`);
      await load();
    } finally { setBusy(''); }
  };

  const tierBadge = (t) => {
    const colors = { BASIC: 'bg-slate-200 text-slate-800', STANDARD: 'bg-indigo-200 text-indigo-900', PREMIUM: 'bg-orange-200 text-orange-900' };
    return <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${colors[t] || 'bg-slate-100'}`}>{t}</span>;
  };

  return (
    <div className="p-6 max-w-7xl mx-auto" data-testid="admin-clinics-page">
      <div className="mb-5 flex items-center justify-between">
        <h1 className="text-2xl font-bold">Super Admin · Clinics + Waitlist</h1>
        <div className="flex gap-2">
          <button onClick={() => setTab('clinics')} data-testid="admin-tab-clinics"
                  className={`px-3 py-1 text-xs font-bold rounded ${tab === 'clinics' ? 'bg-slate-800 text-white' : 'bg-slate-100'}`}>
            Clinics ({clinics.length})
          </button>
          <button onClick={() => setTab('waitlist')} data-testid="admin-tab-waitlist"
                  className={`px-3 py-1 text-xs font-bold rounded ${tab === 'waitlist' ? 'bg-slate-800 text-white' : 'bg-slate-100'}`}>
            Waitlist ({waitlist.length})
          </button>
        </div>
      </div>

      {tab === 'clinics' && (
        <div className="bg-white border border-slate-200 rounded-lg overflow-hidden" data-testid="admin-clinics-table">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-[10px] uppercase tracking-wider text-slate-600">
              <tr>
                <th className="text-left px-3 py-2">Clinic</th>
                <th className="text-left">City</th>
                <th>Stored tier</th>
                <th>Effective tier</th>
                <th>Trial ends</th>
                <th className="text-left px-3">Actions</th>
              </tr>
            </thead>
            <tbody>
              {clinics.map(c => (
                <tr key={c.clinic_id} className="border-t border-slate-100 hover:bg-slate-50" data-testid={`admin-clinic-row-${c.clinic_id}`}>
                  <td className="px-3 py-2">
                    <div className="font-bold">{c.name}</div>
                    <div className="text-[10px] text-slate-500 font-mono">{c.clinic_id}</div>
                  </td>
                  <td>{c.city || '—'}</td>
                  <td className="text-center">{tierBadge(c.subscription_tier || 'BASIC')}</td>
                  <td className="text-center">{tierBadge(c.effective_tier)}</td>
                  <td className="text-[11px] text-slate-600">{c.trial_ends_at ? String(c.trial_ends_at).slice(0, 10) : '—'}</td>
                  <td className="px-3 py-2">
                    <div className="flex flex-wrap gap-1">
                      {['BASIC', 'STANDARD', 'PREMIUM'].map(t => (
                        <button key={t} onClick={() => flip(c.clinic_id, t)}
                                disabled={busy === c.clinic_id || c.subscription_tier === t}
                                data-testid={`admin-flip-${c.clinic_id}-${t}`}
                                className={`px-2 py-0.5 text-[10px] font-bold rounded border ${c.subscription_tier === t ? 'bg-slate-800 text-white' : 'border-slate-300 hover:bg-slate-100'}`}>
                          → {t}
                        </button>
                      ))}
                      <button onClick={() => extendTrial(c.clinic_id)}
                              disabled={busy === c.clinic_id}
                              data-testid={`admin-extend-trial-${c.clinic_id}`}
                              className="px-2 py-0.5 text-[10px] font-bold rounded border border-orange-300 text-orange-700 hover:bg-orange-50">
                        +30d Trial
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {tab === 'waitlist' && (
        <div>
          <div className="mb-3 flex justify-end">
            <a href={`${API}/admin/waitlist/export.csv`}
               data-testid="admin-waitlist-csv"
               className="px-3 py-1.5 text-xs font-bold bg-emerald-600 text-white rounded hover:bg-emerald-700">
              ↓ Export CSV
            </a>
          </div>
          <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-[10px] uppercase tracking-wider text-slate-600">
                <tr>
                  <th className="text-left px-3 py-2">Email</th>
                  <th className="text-left">Clinic</th>
                  <th className="text-left">City</th>
                  <th>Interest</th>
                  <th className="text-left">Signed up</th>
                </tr>
              </thead>
              <tbody>
                {waitlist.length === 0 && (
                  <tr><td colSpan={5} className="text-center text-slate-400 italic py-6">No signups yet.</td></tr>
                )}
                {waitlist.map(w => (
                  <tr key={w.email} className="border-t border-slate-100 hover:bg-slate-50" data-testid={`admin-waitlist-row-${w.email}`}>
                    <td className="px-3 py-2 font-mono text-xs">{w.email}</td>
                    <td>{w.clinic_name || '—'}</td>
                    <td>{w.city || '—'}</td>
                    <td className="text-center">{w.tier_interest ? tierBadge(w.tier_interest) : '—'}</td>
                    <td className="text-[11px] text-slate-600">{String(w.created_at || '').slice(0, 16).replace('T', ' ')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {fmtINR /* silence unused */ && null}
        </div>
      )}
    </div>
  );
}
