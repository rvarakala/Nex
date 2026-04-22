import React, { useState, useEffect, useCallback } from 'react';
import axios from 'axios';
import { useAuth } from '../../AuthContext';
import CollectionsSparkline from './CollectionsSparkline';

const BACKEND_URL = process.env.REACT_APP_BACKEND_URL;
const API = `${BACKEND_URL}/api`;

const fmtINR = (n) => (n == null || Number.isNaN(Number(n))) ? '—' :
  `₹${Number(n).toLocaleString('en-IN', { maximumFractionDigits: 2, minimumFractionDigits: 0 })}`;

const fmtDate = (ymd) => {
  if (!ymd) return '—';
  try {
    const [y, m, d] = ymd.split('-');
    return new Date(Date.UTC(+y, +m - 1, +d)).toLocaleDateString('en-IN',
      { weekday: 'long', day: '2-digit', month: 'long', year: 'numeric' });
  } catch { return ymd; }
};

export default function CloseoutPage() {
  const { user, clinic } = useAuth();
  const [latest, setLatest] = useState(null);
  const [history, setHistory] = useState([]);
  const [trend, setTrend] = useState(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const canGenerate = user?.role === 'super_admin' || user?.role === 'accounts';

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [lRes, hRes, tRes] = await Promise.all([
        axios.get(`${API}/closeouts/latest`).catch(() => ({ data: null })),
        axios.get(`${API}/closeouts`, { params: { limit: 14 } }).catch(() => ({ data: [] })),
        axios.get(`${API}/closeouts/trend/collections`, { params: { days: 30 } }).catch(() => ({ data: null })),
      ]);
      setLatest(lRes.data);
      setHistory(hRes.data || []);
      setTrend(tRes.data);
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  const regen = async () => {
    if (!canGenerate) return;
    setBusy(true);
    try {
      const r = await axios.post(`${API}/closeouts/generate`, {});
      setLatest(r.data);
      load();
    } catch (e) { alert(e?.response?.data?.detail || 'Regenerate failed'); }
    finally { setBusy(false); }
  };

  const markRead = async (date) => {
    try { await axios.put(`${API}/closeouts/${date}/read`); load(); } catch {}
  };

  const shareWhatsApp = (co) => {
    const lines = buildWhatsAppMessage(co, clinic);
    const digits = (clinic?.phone || '').replace(/\D/g, '');
    const mobile = digits.length === 10 ? `91${digits}` : digits.length >= 10 ? digits : '';
    const url = `https://wa.me/${mobile}?text=${encodeURIComponent(lines)}`;
    window.open(url, '_blank');
    markRead(co.date);
  };

  if (loading && !latest) {
    return <div className="p-8 text-center text-sm text-slate-400 italic">Loading close-out…</div>;
  }
  if (!latest) {
    return (
      <div className="p-6" data-testid="closeout-empty">
        <div className="max-w-xl mx-auto bg-white border border-slate-200 rounded-lg p-6 text-center">
          <div className="text-lg font-bold text-slate-700 mb-1">No close-out yet</div>
          <div className="text-xs text-slate-500 mb-4">
            Daily close-outs are generated automatically at 21:00 IST. You can also run one now.
          </div>
          {canGenerate && (
            <button onClick={regen} disabled={busy} data-testid="co-generate-empty"
              className="px-4 py-2 text-sm bg-blue-600 hover:bg-blue-700 disabled:bg-slate-300 text-white font-bold rounded shadow-sm">
              {busy ? 'Generating…' : 'Generate Close-out Now'}
            </button>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="p-4 space-y-4" data-testid="closeout-page">
      {/* 30-day sparkline trend strip */}
      {trend && <CollectionsSparkline trend={trend} />}

      {/* Primary card */}
      <div className="bg-gradient-to-br from-slate-900 via-blue-950 to-slate-900 text-white rounded-xl p-5 shadow-2xl border border-blue-700/40"
           data-testid="co-primary-card">
        <div className="flex items-start justify-between flex-wrap gap-3 mb-4">
          <div>
            <div className="text-[10px] uppercase tracking-[0.3em] font-bold text-blue-300">Day Close-out</div>
            <div className="text-2xl md:text-3xl font-bold mt-0.5">{fmtDate(latest.date)}</div>
            <div className="text-[11px] text-blue-400 mt-0.5">
              Generated {latest.generated_by === 'scheduled' ? 'automatically at 21:00 IST' : 'manually'}
            </div>
          </div>
          <div className="flex gap-2">
            {canGenerate && (
              <button onClick={regen} disabled={busy} data-testid="co-regenerate"
                className="px-3 py-1.5 text-xs bg-blue-700 hover:bg-blue-600 disabled:bg-slate-600 text-white font-semibold rounded">
                {busy ? 'Regenerating…' : '⟳ Regenerate'}
              </button>
            )}
            <button onClick={() => shareWhatsApp(latest)} data-testid="co-whatsapp"
              className="px-3 py-1.5 text-xs bg-[#25D366] hover:bg-[#1ebe5a] text-white font-bold rounded shadow-sm">
              📤 Share on WhatsApp
            </button>
          </div>
        </div>

        {/* Headline metric */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-3">
          <Metric label="Collections" value={fmtINR(latest.collections_total)} sub={`${latest.payments_count || 0} payments`} />
          <Metric label="Walk-ins" value={latest.walkins_today} sub={`${latest.tokens_served} served · ${latest.tokens_cancelled} cancelled`} />
          <Metric label="Appointments" value={latest.appointments_today} sub={`${latest.appointments_completed} done · ${latest.appointments_no_show} no-show`} />
        </div>

        {/* Split grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-3">
          <SplitCard title="Collections by method">
            {Object.keys(latest.collections_by_method || {}).length === 0 ? (
              <div className="text-[11px] text-slate-500 italic">No payments today.</div>
            ) : (
              <div className="space-y-1">
                {Object.entries(latest.collections_by_method).map(([m, amt]) => (
                  <div key={m} className="flex justify-between text-xs">
                    <span className="uppercase tracking-wide text-blue-300">{m.replace('_', ' ')}</span>
                    <span className="tabular-nums font-bold">{fmtINR(amt)}</span>
                  </div>
                ))}
              </div>
            )}
          </SplitCard>
          <SplitCard title="Outstanding ledger">
            <div className="space-y-1 text-xs">
              <div className="flex justify-between">
                <span className="text-blue-300">Invoices created today</span>
                <span className="tabular-nums font-bold">{latest.invoices_created}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-blue-300">Invoices paid today</span>
                <span className="tabular-nums font-bold text-emerald-400">{latest.invoices_paid}</span>
              </div>
              <div className="flex justify-between border-t border-blue-800/60 pt-1 mt-1">
                <span className="text-amber-300">Pending due invoices</span>
                <span className="tabular-nums font-bold text-amber-300">{latest.invoices_pending_due}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-amber-300">Total pending due</span>
                <span className="tabular-nums font-bold text-amber-300">{fmtINR(latest.pending_due_amount)}</span>
              </div>
              <div className="flex justify-between border-t border-blue-800/60 pt-1 mt-1">
                <span className="text-rose-300">Reports pending handover</span>
                <span className="tabular-nums font-bold text-rose-300">{latest.pending_reports}</span>
              </div>
            </div>
          </SplitCard>
        </div>
      </div>

      {/* History */}
      <div className="bg-white rounded-lg border border-slate-200 overflow-hidden" data-testid="co-history">
        <div className="px-3 py-2 border-b border-slate-200 bg-slate-50 flex items-center justify-between">
          <div className="text-[11px] uppercase tracking-wider font-bold text-slate-600">Previous 14 days</div>
          <div className="text-[10px] text-slate-400">Click a row to share it on WhatsApp</div>
        </div>
        <table className="w-full text-xs">
          <thead className="text-[10px] uppercase text-slate-500">
            <tr className="border-b border-slate-200">
              <th className="px-3 py-1.5 text-left">Date</th>
              <th className="px-3 py-1.5 text-right">Walk-ins</th>
              <th className="px-3 py-1.5 text-right">Appts</th>
              <th className="px-3 py-1.5 text-right">Collections</th>
              <th className="px-3 py-1.5 text-right">Pending ₹</th>
              <th className="px-3 py-1.5"></th>
            </tr>
          </thead>
          <tbody>
            {history.length === 0 && (
              <tr><td colSpan={6} className="px-3 py-6 text-center text-slate-400 italic">No previous close-outs.</td></tr>
            )}
            {history.map((co) => (
              <tr key={co.closeout_id} data-testid={`co-row-${co.date}`}
                  className="border-b border-slate-100 last:border-0 hover:bg-slate-50">
                <td className="px-3 py-1.5 text-slate-700 font-semibold">{co.date}</td>
                <td className="px-3 py-1.5 text-right tabular-nums">{co.walkins_today}</td>
                <td className="px-3 py-1.5 text-right tabular-nums">{co.appointments_today}</td>
                <td className="px-3 py-1.5 text-right tabular-nums font-semibold text-emerald-700">{fmtINR(co.collections_total)}</td>
                <td className="px-3 py-1.5 text-right tabular-nums text-rose-700">{fmtINR(co.pending_due_amount)}</td>
                <td className="px-3 py-1.5 text-right">
                  <button onClick={() => shareWhatsApp(co)} data-testid={`co-share-${co.date}`}
                    className="text-[10px] px-2 py-0.5 bg-[#25D366] hover:bg-[#1ebe5a] text-white font-semibold rounded">WA</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

const Metric = ({ label, value, sub }) => (
  <div className="bg-blue-900/50 border border-blue-700/40 rounded-lg p-3">
    <div className="text-[9px] uppercase tracking-[0.25em] text-blue-300 font-bold">{label}</div>
    <div className="text-2xl md:text-3xl font-bold tabular-nums mt-0.5">{value}</div>
    {sub && <div className="text-[10px] text-blue-400 mt-0.5">{sub}</div>}
  </div>
);

const SplitCard = ({ title, children }) => (
  <div className="bg-blue-900/40 border border-blue-700/40 rounded-lg p-3">
    <div className="text-[9px] uppercase tracking-[0.25em] text-blue-300 font-bold mb-1.5">{title}</div>
    {children}
  </div>
);

function buildWhatsAppMessage(co, clinic) {
  const name = clinic?.name || 'Clinic';
  const inr = (n) => `₹${Number(n || 0).toLocaleString('en-IN', { maximumFractionDigits: 0 })}`;
  const by = Object.entries(co.collections_by_method || {})
    .map(([m, amt]) => `  • ${m.toUpperCase()}: ${inr(amt)}`)
    .join('\n');

  return [
    `*${name} — Day Close-out*`,
    `📅 ${co.date}`,
    ``,
    `💰 *Collections:* ${inr(co.collections_total)} (${co.payments_count || 0} payments)`,
    by || '  (no payments)',
    ``,
    `👥 *Walk-ins:* ${co.walkins_today} (${co.tokens_served} served, ${co.tokens_cancelled} cancelled)`,
    `📆 *Appointments:* ${co.appointments_today} (${co.appointments_completed} done, ${co.appointments_no_show} no-show)`,
    ``,
    `🧾 *Invoices today:* ${co.invoices_created} created, ${co.invoices_paid} paid`,
    `⚠️ *Pending due:* ${co.invoices_pending_due} invoices, ${inr(co.pending_due_amount)}`,
    `📦 *Reports to hand over:* ${co.pending_reports}`,
    ``,
    `— Sent via ACS Clinic Suite`,
  ].join('\n');
}
