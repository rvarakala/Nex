import React, { useCallback, useEffect, useMemo, useState } from 'react';
import axios from 'axios';

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;
const fmtINR = (n) => `₹${Number(n || 0).toLocaleString('en-IN', { maximumFractionDigits: 0 })}`;
const fmtPct = (n) => `${Number(n || 0).toFixed(1)}%`;


export default function OwnerAnalyticsPage() {
  const [me, setMe] = useState(null);
  const [rev, setRev] = useState(null);
  const [aud, setAud] = useState(null);
  const [inv, setInv] = useState(null);
  const [fun, setFun] = useState(null);
  const [ret, setRet] = useState(null);
  const [srev, setSrev] = useState(null);
  const [err, setErr] = useState('');
  const [loading, setLoading] = useState(true);
  const [drill, setDrill] = useState(null);   // { title, params }
  const [drillRows, setDrillRows] = useState(null);
  const [start, setStart] = useState('');
  const [end, setEnd] = useState('');

  useEffect(() => { (async () => {
    try { setMe((await axios.get(`${API}/auth/me`)).data?.user || null); } catch {/*noop*/}
  })(); }, []);

  const canRead = useMemo(() =>
    !!me && ['clinic_owner','super_admin','accounts'].includes(me.role), [me]);

  const load = useCallback(async () => {
    setLoading(true); setErr('');
    try {
      const monthsFromRange = (() => {
        if (!start) return 12;
        const s = new Date(start);
        const e = end ? new Date(end) : new Date();
        const m = Math.max(1, Math.round((e - s) / (30 * 86400000)));
        return Math.min(m, 36);
      })();
      const [r1, r2, r3, r4, r5, r6] = await Promise.all([
        axios.get(`${API}/ha/analytics/revenue`,      { params: { months: monthsFromRange } }),
        axios.get(`${API}/ha/analytics/audiologists`, { params: { days: 90 } }),
        axios.get(`${API}/ha/analytics/inventory`),
        axios.get(`${API}/ha/analytics/funnel`,       { params: { days: 90 } }),
        axios.get(`${API}/ha/analytics/retention`),
        axios.get(`${API}/ha/analytics/service-revenue`, { params: { days: 90 } }),
      ]);
      setRev(r1.data); setAud(r2.data); setInv(r3.data); setFun(r4.data); setRet(r5.data); setSrev(r6.data);
    } catch (e) {
      setErr(e?.response?.data?.detail || 'Failed to load analytics');
    } finally {
      setLoading(false);
    }
  }, [start, end]);

  useEffect(() => { if (canRead) load(); else setLoading(false); }, [canRead, load]);

  const openDrill = async (title, params) => {
    setDrill({ title });
    setDrillRows(null);
    try {
      const r = await axios.get(`${API}/ha/analytics/sales-drill`, { params });
      setDrillRows(r.data.rows);
    } catch {
      setDrillRows([]);
    }
  };

  const exportCsv = async (kind) => {
    try {
      const params = {};
      if (kind === 'sales') {
        if (start) params.start = start;
        if (end) params.end = end;
      } else if (kind === 'revenue') {
        params.months = 12;
      }
      const r = await axios.get(`${API}/ha/analytics/export/${kind}.csv`, { params, responseType: 'blob' });
      const url = URL.createObjectURL(r.data);
      const a = document.createElement('a');
      a.href = url;
      a.download = `ha_${kind}_${new Date().toISOString().slice(0,10)}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      alert('Export failed: ' + (e?.response?.status || 'error'));
    }
  };

  if (!me) return <div className="p-6 text-slate-400 italic text-sm">Loading session…</div>;
  if (!canRead) return (
    <div className="p-6" data-testid="ha-analytics-denied">
      <div className="bg-rose-50 border border-rose-200 text-rose-800 rounded-md p-4 text-sm">
        Analytics is reserved for Clinic Owner, Super Admin & Accounts roles. Your role: <b>{me.role}</b>.
      </div>
    </div>
  );

  return (
    <div className="p-5 space-y-5" data-testid="ha-analytics-page">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-xl font-bold text-slate-800">Owner Analytics</h1>
          <p className="text-[11px] text-slate-500 mt-0.5">Revenue, funnel, team performance, inventory health, retention — at a glance.</p>
        </div>
        <div className="flex items-center gap-2 text-xs">
          <label className="inline-flex items-center gap-1 text-slate-600">
            From <input type="date" value={start} onChange={(e) => setStart(e.target.value)} data-testid="ha-analytics-start" className="border border-slate-300 rounded px-1 py-0.5 text-xs" />
          </label>
          <label className="inline-flex items-center gap-1 text-slate-600">
            To <input type="date" value={end} onChange={(e) => setEnd(e.target.value)} data-testid="ha-analytics-end" className="border border-slate-300 rounded px-1 py-0.5 text-xs" />
          </label>
          {(start || end) && <button onClick={() => { setStart(''); setEnd(''); }} className="text-[10px] text-slate-500 hover:underline" data-testid="ha-analytics-range-clear">Clear</button>}
          <div className="ml-2 flex items-center gap-1 border-l border-slate-200 pl-2">
            <button onClick={() => exportCsv('sales')} data-testid="ha-analytics-csv-sales" className="px-2 py-1 text-[10px] font-semibold bg-slate-100 hover:bg-slate-200 rounded">CSV · Sales</button>
            <button onClick={() => exportCsv('revenue')} data-testid="ha-analytics-csv-revenue" className="px-2 py-1 text-[10px] font-semibold bg-slate-100 hover:bg-slate-200 rounded">CSV · Revenue</button>
            <button onClick={() => exportCsv('inventory')} data-testid="ha-analytics-csv-inventory" className="px-2 py-1 text-[10px] font-semibold bg-slate-100 hover:bg-slate-200 rounded">CSV · Inventory</button>
          </div>
          <button onClick={load} disabled={loading} className="text-[11px] text-indigo-600 font-semibold hover:underline" data-testid="ha-analytics-refresh">
            {loading ? 'Refreshing…' : '↻ Refresh'}
          </button>
        </div>
      </div>

      {err && <div className="bg-rose-50 text-rose-700 text-xs p-2 rounded" data-testid="ha-analytics-err">{err}</div>}

      {/* ========== TOP-LINE KPIs ========== */}
      {rev && (
        <div className="grid grid-cols-4 gap-3" data-testid="ha-analytics-revenue-kpis">
          <Kpi label="Total Revenue (12 mo)"    value={fmtINR(rev.total_revenue)} accent="indigo" testid="ha-analytics-kpi-revenue" />
          <Kpi label="Sales (12 mo)"             value={rev.total_sales_count}     accent="emerald" testid="ha-analytics-kpi-sales" />
          <Kpi label="Avg Ticket"                value={fmtINR(rev.avg_ticket)}   accent="blue" testid="ha-analytics-kpi-ticket" />
          <Kpi label="Active Subscriptions"      value={ret?.active_subscriptions} accent="teal" testid="ha-analytics-kpi-subs" />
        </div>
      )}

      {/* ========== MONTHLY REVENUE ========== */}
      <Card title="Monthly Revenue" subtitle="Last 12 months · paid + invoiced + reserved (cancelled excluded) · click bar to drill" testid="ha-analytics-revenue-card">
        {!rev ? <Skel /> : rev.monthly.length === 0 ? <Empty label="No sales in window." /> : (
          <RevenueChart data={rev.monthly} onDrill={(m) => openDrill(`Sales in ${m.month}`, { start: `${m.month}-01`, end: nextMonth(m.month) })} />
        )}
      </Card>

      <div className="grid grid-cols-2 gap-5">
        {/* ========== BRAND SPLIT ========== */}
        <Card title="Brand Split" subtitle="Revenue by brand · last 12 months">
          {!rev ? <Skel /> : rev.brand_split.length === 0 ? <Empty /> : (
            <table className="w-full text-xs">
              <thead className="text-[10px] uppercase tracking-wider text-slate-500">
                <tr><th className="text-left py-1">Brand</th><th className="text-right">Units</th><th className="text-right">Revenue</th><th className="text-right w-24">Share</th></tr>
              </thead>
              <tbody>
                {(() => {
                  const total = rev.brand_split.reduce((s, b) => s + b.revenue, 0) || 1;
                  return rev.brand_split.map(b => (
                    <tr key={b.brand} onClick={() => openDrill(`Sales · ${b.brand}`, { brand: b.brand })} className="border-t border-slate-100 hover:bg-indigo-50/50 cursor-pointer" data-testid={`ha-analytics-brand-${b.brand}`}>
                      <td className="py-1 font-semibold">{b.brand}</td>
                      <td className="text-right tabular-nums">{b.units}</td>
                      <td className="text-right tabular-nums font-mono">{fmtINR(b.revenue)}</td>
                      <td className="text-right">
                        <div className="flex items-center gap-1">
                          <div className="flex-1 h-1.5 bg-slate-100 rounded"><div className="h-1.5 bg-indigo-500 rounded" style={{ width: `${(100 * b.revenue / total).toFixed(0)}%` }} /></div>
                          <span className="text-[10px] text-slate-500 w-8 text-right">{fmtPct(100 * b.revenue / total)}</span>
                        </div>
                      </td>
                    </tr>
                  ));
                })()}
              </tbody>
            </table>
          )}
        </Card>

        {/* ========== AUDIOLOGIST PERFORMANCE ========== */}
        <Card title="Team Performance" subtitle="Last 90 days · sales · below-floor · WA response rate" testid="ha-analytics-team-card">
          {!aud ? <Skel /> : aud.rows.length === 0 ? <Empty /> : (
            <table className="w-full text-xs">
              <thead className="text-[10px] uppercase tracking-wider text-slate-500">
                <tr><th className="text-left py-1">Name</th><th className="text-right">Sales</th><th className="text-right">Revenue</th><th className="text-right">Below-Floor</th><th className="text-right">WA Response</th></tr>
              </thead>
              <tbody>
                {aud.rows.map(r => (
                  <tr key={r.user_id} onClick={() => openDrill(`Sales · ${r.name}`, { user_id: r.user_id })} className="border-t border-slate-100 hover:bg-indigo-50/50 cursor-pointer" data-testid={`ha-analytics-aud-${r.user_id}`}>
                    <td className="py-1">
                      <div className="font-semibold">{r.name}</div>
                      <div className="text-[10px] text-slate-500 uppercase tracking-wide">{r.role}</div>
                    </td>
                    <td className="text-right tabular-nums">{r.sales_count}</td>
                    <td className="text-right tabular-nums font-mono">{fmtINR(r.revenue)}</td>
                    <td className="text-right">
                      <span className={`text-[10px] font-bold px-1 py-0.5 rounded ${r.below_floor_pct > 25 ? 'bg-rose-100 text-rose-800' : r.below_floor_pct > 10 ? 'bg-amber-100 text-amber-800' : 'bg-emerald-100 text-emerald-800'}`}>
                        {fmtPct(r.below_floor_pct)}
                      </span>
                    </td>
                    <td className="text-right">
                      <ResponseRateBar sends={r.wa_sends} done={r.wa_done} pct={r.response_rate_pct} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>
      </div>

      {/* ========== FUNNEL ========== */}
      <Card title="Commercial Funnel" subtitle="Last 90 days · consultation → quote → trial → sale → paid" testid="ha-analytics-funnel-card">
        {!fun ? <Skel /> : <FunnelView data={fun} />}
      </Card>

      <div className="grid grid-cols-2 gap-5">
        {/* ========== INVENTORY HEALTH ========== */}
        <Card title="Inventory Health" subtitle={`Aging > ${inv?.aging_days || 90}d · Dead > ${inv?.dead_days || 180}d`} testid="ha-analytics-inventory-card">
          {!inv ? <Skel /> : (
            <>
              <div className="grid grid-cols-3 gap-2 mb-3">
                <MiniKpi label="In Stock" v={inv.totals.in_stock_total} />
                <MiniKpi label="Aging" v={inv.totals.aging_units} color={inv.totals.aging_units > 0 ? 'text-amber-700' : ''} />
                <MiniKpi label="Dead" v={inv.totals.dead_units} color={inv.totals.dead_units > 0 ? 'text-rose-700' : ''} />
              </div>
              {inv.aging_by_product.length === 0 ? <div className="text-[11px] italic text-slate-400">No aging stock — inventory is moving.</div> : (
                <table className="w-full text-xs">
                  <thead className="text-[10px] uppercase tracking-wider text-slate-500">
                    <tr><th className="text-left py-1">Product</th><th className="text-right">Stock</th><th className="text-right">Aging</th><th className="text-right">Dead</th></tr>
                  </thead>
                  <tbody>
                    {inv.aging_by_product.slice(0, 8).map(p => (
                      <tr key={p.product_id} className="border-t border-slate-100" data-testid={`ha-analytics-aging-${p.product_id}`}>
                        <td className="py-1"><span className="font-semibold">{p.brand}</span> <span className="text-slate-500">· {p.model}</span></td>
                        <td className="text-right tabular-nums">{p.in_stock}</td>
                        <td className="text-right tabular-nums text-amber-700 font-bold">{p.aging}</td>
                        <td className="text-right tabular-nums text-rose-700 font-bold">{p.dead}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </>
          )}
        </Card>

        {/* ========== RETENTION ========== */}
        <Card title="Retention Health" subtitle="CRM + subscription loyalty + upgrade pipeline" testid="ha-analytics-retention-card">
          {!ret ? <Skel /> : (
            <div className="space-y-2">
              <BigMetric label="Missed Follow-ups" value={ret.missed_followups} tone={ret.missed_followups > 0 ? 'rose' : 'slate'} hint="Pending queue overdue — action required" testid="ha-analytics-missed" />
              <BigMetric label="Active Subscriptions" value={ret.active_subscriptions} tone="emerald" hint="Patients with a recurring consumable cadence" />
              <BigMetric label="Repeat Loyalty Patients" value={ret.loyal_repeat_patients} tone="indigo" hint="≥2 consumable deliveries on record" />
              <BigMetric label="Upgrade Pipeline" value={ret.upgrade_pipeline_size} tone="amber" hint="Paid HA sales older than 3 years" testid="ha-analytics-upgrade" />
              <div className="text-[10px] text-slate-400 italic pt-1">Dismissed: {ret.dismissed_followups} ({fmtPct(ret.dismissed_pct)} of all follow-ups)</div>
            </div>
          )}
        </Card>
      </div>

      {/* ========== WA RESPONSE RATE ========== */}
      <Card title="Response Rate per Audiologist" subtitle="Follow-ups sent → marked done · last 90 days · patient-reply proxy" testid="ha-analytics-response-card">
        {!aud ? <Skel /> : (() => {
          const senders = aud.rows.filter(r => r.wa_sends > 0);
          if (senders.length === 0) return <Empty label="No follow-ups sent in window." />;
          senders.sort((a, b) => b.wa_sends - a.wa_sends);
          return (
            <div className="space-y-2">
              {senders.map(r => (
                <div key={r.user_id} className="flex items-center gap-3" data-testid={`ha-analytics-response-${r.user_id}`}>
                  <div className="w-36 truncate">
                    <div className="text-xs font-semibold text-slate-800">{r.name}</div>
                    <div className="text-[9px] text-slate-500 uppercase tracking-wide">{r.role}</div>
                  </div>
                  <div className="flex-1 h-4 bg-slate-100 rounded relative overflow-hidden" title={`${r.wa_done} done of ${r.wa_sends} sent`}>
                    <div className={`absolute inset-y-0 left-0 rounded transition ${r.response_rate_pct >= 50 ? 'bg-emerald-500' : r.response_rate_pct >= 25 ? 'bg-amber-500' : 'bg-rose-500'}`}
                         style={{ width: `${Math.min(100, r.response_rate_pct)}%` }} />
                    <div className="absolute inset-0 flex items-center px-2 text-[10px] font-bold text-slate-800">
                      {fmtPct(r.response_rate_pct)}
                    </div>
                  </div>
                  <div className="w-28 text-right text-[10px] text-slate-500">
                    <span className="font-bold text-emerald-700">{r.wa_done}</span> done · <span className="font-bold text-indigo-700">{r.wa_sends}</span> sent
                  </div>
                </div>
              ))}
              <div className="pt-2 mt-2 border-t border-slate-100 text-[10px] text-slate-500 italic">
                Bar colour: <span className="text-emerald-700 font-bold">≥50% green</span> · <span className="text-amber-700 font-bold">25-49% amber</span> · <span className="text-rose-700 font-bold">&lt;25% rose</span>. Low rates usually mean the follow-up message needs rewriting, or patients aren't replying in time.
              </div>
            </div>
          );
        })()}
      </Card>

      {/* ========== SERVICE REVENUE & WARRANTY BURDEN ========== */}
      {srev && <ServiceRevenueCard data={srev} />}

      {drill && <DrillModal title={drill.title} rows={drillRows} onClose={() => { setDrill(null); setDrillRows(null); }} />}
    </div>
  );
}


function ResponseRateBar({ sends, done, pct }) {
  if (!sends) return <span className="text-[10px] text-slate-400">—</span>;
  const color = pct >= 50 ? 'bg-emerald-500' : pct >= 25 ? 'bg-amber-500' : 'bg-rose-500';
  return (
    <div className="inline-flex items-center gap-1.5 min-w-[110px] justify-end" title={`${done} done of ${sends} sent`}>
      <div className="w-14 h-1.5 bg-slate-200 rounded">
        <div className={`h-1.5 rounded ${color}`} style={{ width: `${Math.min(100, pct)}%` }} />
      </div>
      <span className={`text-[10px] font-bold tabular-nums ${pct >= 50 ? 'text-emerald-700' : pct >= 25 ? 'text-amber-700' : 'text-rose-700'}`}>{pct.toFixed(0)}%</span>
      <span className="text-[9px] text-slate-400">({done}/{sends})</span>
    </div>
  );
}


function nextMonth(ymStr) {
  // Given 'YYYY-MM' return the first day of the next month as 'YYYY-MM-DD'
  const [y, m] = ymStr.split('-').map(Number);
  const d = new Date(y, m, 1);   // JS month is 0-based, so m here = next month
  return d.toISOString().slice(0, 10);
}


function DrillModal({ title, rows, onClose }) {
  const fmt = (n) => `₹${Number(n || 0).toLocaleString('en-IN', { maximumFractionDigits: 0 })}`;
  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }} data-testid="ha-analytics-drill-modal">
      <div className="bg-white rounded-lg shadow-2xl max-w-5xl w-full max-h-[92vh] overflow-auto" onClick={(e) => e.stopPropagation()}>
        <div className="sticky top-0 bg-white border-b border-slate-200 px-5 py-3 flex items-center justify-between">
          <div>
            <div className="text-sm font-bold text-slate-800">{title}</div>
            <div className="text-[10px] text-slate-500">{rows ? `${rows.length} sale(s)` : 'Loading…'}</div>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-700 text-xl">✕</button>
        </div>
        <div className="p-4">
          {!rows ? (
            <div className="h-32 bg-slate-100 rounded animate-pulse" />
          ) : rows.length === 0 ? (
            <div className="py-10 text-center text-slate-400 italic text-xs">No sales match.</div>
          ) : (
            <table className="w-full text-xs">
              <thead className="text-[10px] uppercase tracking-wider text-slate-500">
                <tr><th className="text-left py-1">Sale No</th><th className="text-left">Date</th><th className="text-left">Patient</th><th className="text-right">Lines</th><th className="text-right">Total</th><th className="text-left">Status</th></tr>
              </thead>
              <tbody>
                {rows.map(s => (
                  <tr key={s.sale_no} className="border-t border-slate-100" data-testid={`ha-analytics-drill-row-${s.sale_no}`}>
                    <td className="py-1 font-mono font-bold text-indigo-700">{s.sale_no}</td>
                    <td className="text-slate-500 text-[10px]">{s.created_at?.slice(0, 10)}</td>
                    <td>{s.patient_name || s.patient_id}</td>
                    <td className="text-right tabular-nums">{s.lines?.length || 0}</td>
                    <td className="text-right tabular-nums font-mono font-semibold">{fmt(s.total)}</td>
                    <td><span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${s.status === 'paid' ? 'bg-emerald-100 text-emerald-800' : s.status === 'cancelled' ? 'bg-rose-100 text-rose-800' : 'bg-slate-200 text-slate-600'}`}>{s.status}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}


// ============ SHARED SUB-COMPONENTS ============

const Card = ({ title, subtitle, children, testid }) => (
  <div className="bg-white border border-slate-200 rounded-lg p-4 shadow-sm" data-testid={testid}>
    <div className="mb-2">
      <div className="text-sm font-bold text-slate-800">{title}</div>
      {subtitle && <div className="text-[10px] text-slate-500 uppercase tracking-wider">{subtitle}</div>}
    </div>
    {children}
  </div>
);

const Kpi = ({ label, value, accent = 'indigo', testid }) => {
  const color = {
    indigo: 'bg-indigo-50 text-indigo-800 border-indigo-200',
    emerald: 'bg-emerald-50 text-emerald-800 border-emerald-200',
    blue: 'bg-blue-50 text-blue-800 border-blue-200',
    teal: 'bg-teal-50 text-teal-800 border-teal-200',
  }[accent];
  return (
    <div data-testid={testid} className={`border rounded-md px-3 py-2 ${color}`}>
      <div className="text-[9px] font-semibold uppercase tracking-wider">{label}</div>
      <div className="text-xl font-bold tabular-nums">{value ?? '—'}</div>
    </div>
  );
};

const MiniKpi = ({ label, v, color = 'text-slate-800' }) => (
  <div className="border border-slate-200 rounded px-2 py-1.5 text-center">
    <div className="text-[9px] uppercase tracking-wider text-slate-500">{label}</div>
    <div className={`text-lg font-bold tabular-nums ${color}`}>{v}</div>
  </div>
);

const BigMetric = ({ label, value, tone = 'slate', hint, testid }) => {
  const tones = {
    rose: 'text-rose-700', slate: 'text-slate-700',
    emerald: 'text-emerald-700', indigo: 'text-indigo-700', amber: 'text-amber-700',
  };
  return (
    <div className="flex items-baseline justify-between py-1.5 border-b border-slate-100 last:border-0" data-testid={testid}>
      <div>
        <div className="text-xs font-semibold text-slate-700">{label}</div>
        {hint && <div className="text-[10px] text-slate-400">{hint}</div>}
      </div>
      <div className={`text-xl font-bold tabular-nums ${tones[tone]}`}>{value}</div>
    </div>
  );
};

const Skel = () => <div className="h-24 rounded bg-slate-100 animate-pulse" />;
const Empty = ({ label = 'No data yet.' }) => <div className="text-[11px] italic text-slate-400 py-4 text-center">{label}</div>;


// ============ MINI REVENUE CHART (pure CSS bars) ============
function RevenueChart({ data, onDrill }) {
  const max = Math.max(...data.map(m => m.revenue), 1);
  return (
    <div className="flex items-end gap-2 h-32 pt-4" data-testid="ha-analytics-revenue-chart">
      {data.map(m => (
        <button
          key={m.month}
          onClick={() => onDrill && onDrill(m)}
          className="flex-1 flex flex-col items-center cursor-pointer group"
          title={`${m.month}: ₹${m.revenue.toLocaleString('en-IN')} · ${m.sales_count} sales · click to drill`}
          data-testid={`ha-analytics-revenue-bar-${m.month}`}
        >
          <div className="relative w-full flex items-end h-28">
            <div className="w-full bg-indigo-500 group-hover:bg-indigo-700 rounded-t transition"
                 style={{ height: `${(100 * m.revenue / max).toFixed(1)}%` }} />
          </div>
          <div className="text-[9px] text-slate-500 mt-1 font-mono">{m.month.slice(5)}</div>
          <div className="text-[9px] text-slate-700 font-semibold">{fmtINR(m.revenue).replace('₹', '')}</div>
        </button>
      ))}
    </div>
  );
}


// ============ FUNNEL (horizontal bars) ============
function FunnelView({ data }) {
  const { stages, rates, avg_trial_to_convert_days } = data;
  const steps = [
    ['Consultations', stages.consultations, null],
    ['Quotations',    stages.quotations,    rates.quote_per_consult_pct],
    ['Trials issued', stages.trials_issued, rates.trial_per_quote_pct],
    ['Converted',     stages.trials_converted, rates.convert_per_trial_pct],
    ['Sales (total)', stages.sales_total,   null],
    ['Sales paid',    stages.sales_paid,    rates.paid_per_sale_pct],
  ];
  const max = Math.max(...steps.map(s => s[1]), 1);
  return (
    <div className="space-y-1" data-testid="ha-analytics-funnel">
      {steps.map(([label, value, rate]) => (
        <div key={label} className="flex items-center gap-2 text-xs">
          <div className="w-32 text-slate-700">{label}</div>
          <div className="flex-1 h-5 bg-slate-100 rounded relative">
            <div className="absolute inset-y-0 left-0 bg-indigo-500 rounded" style={{ width: `${(100 * value / max).toFixed(0)}%` }} />
            <div className="absolute inset-0 flex items-center px-2 text-[10px] font-bold text-slate-800 tabular-nums">{value}</div>
          </div>
          <div className="w-16 text-right text-[10px] text-slate-500 font-semibold">{rate != null ? fmtPct(rate) : ''}</div>
        </div>
      ))}
      <div className="pt-2 text-[10px] text-slate-500">
        Avg trial-to-convert: <b className="text-slate-800">{avg_trial_to_convert_days != null ? `${avg_trial_to_convert_days} days` : '—'}</b>
        {' · '}Trials returned: <b className="text-slate-800">{stages.trials_returned}</b>
        {' · '}Trials lost: <b className="text-rose-700">{stages.trials_lost}</b>
      </div>
    </div>
  );
}


// ============ SERVICE REVENUE & WARRANTY BURDEN ============
function ServiceRevenueCard({ data }) {
  const totals = data?.totals || { paid_revenue: 0, warranty_tickets: 0, total_tickets: 0 };
  const byKind = data?.by_kind || [];
  const byTech = data?.by_technician || [];
  const windowDays = data?.window_days || 90;
  const warrantyPct = totals.total_tickets > 0
    ? (100 * totals.warranty_tickets / totals.total_tickets)
    : 0;

  return (
    <Card
      title="Service Revenue & Warranty Burden"
      subtitle={`Last ${windowDays} days · resolved + closed tickets · warranty tickets are zero-revenue cost centres`}
      testid="ha-analytics-service-revenue-card"
    >
      {/* Top-line KPIs */}
      <div className="grid grid-cols-4 gap-2 mb-4">
        <MiniKpi label="Paid Revenue" v={fmtINR(totals.paid_revenue)} color="text-emerald-700" />
        <MiniKpi label="Total Tickets" v={totals.total_tickets} />
        <MiniKpi label="Warranty-Covered" v={totals.warranty_tickets} color={totals.warranty_tickets > 0 ? 'text-amber-700' : ''} />
        <MiniKpi label="Warranty Burden" v={fmtPct(warrantyPct)} color={warrantyPct > 30 ? 'text-rose-700' : warrantyPct > 15 ? 'text-amber-700' : 'text-slate-800'} />
      </div>

      {totals.total_tickets === 0 ? (
        <Empty label="No resolved service tickets in window." />
      ) : (
        <div className="grid grid-cols-2 gap-5">
          {/* By kind */}
          <div data-testid="ha-analytics-service-by-kind">
            <div className="text-[10px] uppercase tracking-wider text-slate-500 mb-1">By Ticket Kind</div>
            <table className="w-full text-xs">
              <thead className="text-[10px] uppercase tracking-wider text-slate-500">
                <tr>
                  <th className="text-left py-1">Kind</th>
                  <th className="text-right">Tickets</th>
                  <th className="text-right">Warranty</th>
                  <th className="text-right">Paid ₹</th>
                </tr>
              </thead>
              <tbody>
                {byKind.map(r => (
                  <tr key={r.kind} className="border-t border-slate-100" data-testid={`ha-analytics-service-kind-${r.kind}`}>
                    <td className="py-1 font-semibold capitalize">{r.kind.replace(/_/g, ' ')}</td>
                    <td className="text-right tabular-nums">{r.ticket_count}</td>
                    <td className="text-right tabular-nums text-amber-700 font-bold">{r.warranty_tickets}</td>
                    <td className="text-right tabular-nums font-mono font-semibold">{fmtINR(r.paid_revenue)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* By technician */}
          <div data-testid="ha-analytics-service-by-tech">
            <div className="text-[10px] uppercase tracking-wider text-slate-500 mb-1">By Technician</div>
            {byTech.length === 0 ? (
              <div className="text-[11px] italic text-slate-400 py-4">No technician assignments yet.</div>
            ) : (
              <table className="w-full text-xs">
                <thead className="text-[10px] uppercase tracking-wider text-slate-500">
                  <tr>
                    <th className="text-left py-1">Technician</th>
                    <th className="text-right">Tickets</th>
                    <th className="text-right">Warranty</th>
                    <th className="text-right">Paid ₹</th>
                  </tr>
                </thead>
                <tbody>
                  {byTech.map(r => (
                    <tr key={r.user_id} className="border-t border-slate-100" data-testid={`ha-analytics-service-tech-${r.user_id}`}>
                      <td className="py-1">
                        <div className="font-semibold">{r.name}</div>
                        <div className="text-[10px] text-slate-500 uppercase tracking-wide">{r.role}</div>
                      </td>
                      <td className="text-right tabular-nums">{r.ticket_count}</td>
                      <td className="text-right tabular-nums text-amber-700 font-bold">{r.warranty_tickets}</td>
                      <td className="text-right tabular-nums font-mono font-semibold">{fmtINR(r.paid_revenue)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      )}

      <div className="pt-3 mt-3 border-t border-slate-100 text-[10px] text-slate-500 italic">
        Warranty burden &gt;30% often signals a product quality issue or over-promising on warranty at the point of sale. Coach technicians whose warranty share is disproportionately high.
      </div>
    </Card>
  );
}
