/**
 * Live Activity page — Super Admin → Growth → Live Activity
 *
 * Shows:
 *   1. Activation funnel (6 stages, bar + counts)
 *   2. Latest login feed (who just logged in, from where)
 *   3. Inactive tenants (no login in > 7 days) — proactive outreach list
 *   4. Per-tenant activation breakdown
 */
import React, { useEffect, useState, useCallback, useMemo } from 'react';
import axios from 'axios';
import {
  Activity, Clock, AlertTriangle, TrendingUp, Users, RefreshCw, Search,
} from 'lucide-react';

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;

// Stage palette — matches activation ladder low → high
const STAGE_COLOR = {
  registered:       { bar: 'bg-slate-500',   text: 'text-slate-300',   bg: 'bg-slate-500/10',   ring: 'ring-slate-500/40'   },
  first_login:      { bar: 'bg-sky-500',     text: 'text-sky-300',     bg: 'bg-sky-500/10',     ring: 'ring-sky-500/40'     },
  first_patient:    { bar: 'bg-violet-500',  text: 'text-violet-300',  bg: 'bg-violet-500/10',  ring: 'ring-violet-500/40'  },
  first_diagnostic: { bar: 'bg-amber-500',   text: 'text-amber-300',   bg: 'bg-amber-500/10',   ring: 'ring-amber-500/40'   },
  first_invoice:    { bar: 'bg-orange-500',  text: 'text-orange-300',  bg: 'bg-orange-500/10',  ring: 'ring-orange-500/40'  },
  active:           { bar: 'bg-emerald-500', text: 'text-emerald-300', bg: 'bg-emerald-500/10', ring: 'ring-emerald-500/40' },
};

const fmtRelative = (iso) => {
  if (!iso) return '—';
  const then = new Date(iso);
  if (isNaN(then)) return '—';
  const diff = Math.max(0, (Date.now() - then.getTime()) / 1000);
  if (diff < 60) return `${Math.round(diff)}s ago`;
  if (diff < 3600) return `${Math.round(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.round(diff / 3600)}h ago`;
  return `${Math.round(diff / 86400)}d ago`;
};

const prettyUA = (ua) => {
  if (!ua) return 'Unknown';
  if (/iphone|android/i.test(ua)) return 'Mobile';
  if (/ipad|tablet/i.test(ua)) return 'Tablet';
  if (/curl|python|postman/i.test(ua)) return 'API';
  if (/chrome|safari|firefox|edge/i.test(ua)) {
    const m = ua.match(/(chrome|firefox|safari|edge)\/[\d.]+/i);
    return m ? m[0].charAt(0).toUpperCase() + m[0].slice(1).split('/')[0] : 'Browser';
  }
  return 'Other';
};

// =================== FUNNEL BAR ===================
const Funnel = ({ data }) => {
  if (!data) return null;
  const { counts, total, labels, stages } = data;
  const maxV = Math.max(1, ...stages.map((s) => counts[s] || 0));

  return (
    <div className="bg-white border border-slate-200 rounded-xl p-5" data-testid="activity-funnel">
      <div className="flex items-center justify-between mb-4">
        <div>
          <div className="text-[10px] uppercase tracking-wider font-bold text-slate-500 mb-1">Activation Funnel</div>
          <div className="text-lg font-bold text-slate-900">{total} clinics · ladder progress</div>
        </div>
        <TrendingUp size={22} className="text-orange-500" />
      </div>
      <div className="space-y-2">
        {stages.map((s, i) => {
          const n = counts[s] || 0;
          const pct = total ? Math.round((n / total) * 100) : 0;
          const color = STAGE_COLOR[s] || STAGE_COLOR.registered;
          return (
            <div key={s} data-testid={`funnel-row-${s}`}>
              <div className="flex items-center justify-between text-xs mb-1">
                <div className="flex items-center gap-2">
                  <span className="font-mono text-[10px] text-slate-400 w-4 text-right">{i + 1}.</span>
                  <span className={`font-semibold ${color.text}`}>{labels[s]}</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-slate-500 text-[11px]">{pct}%</span>
                  <span className="text-slate-900 font-bold min-w-[2rem] text-right">{n}</span>
                </div>
              </div>
              <div className="h-2 bg-slate-100 rounded-full overflow-hidden">
                <div
                  className={`h-full ${color.bar} transition-all duration-500`}
                  style={{ width: `${(n / maxV) * 100}%` }}
                />
              </div>
            </div>
          );
        })}
      </div>
      <div className="mt-4 pt-3 border-t border-slate-100 text-[10px] text-slate-500">
        Stages are strict ladders — each clinic counts in exactly one (their highest reached). "Active" = logged in &lt; 7 days ago AND has ≥ 1 invoice.
      </div>
    </div>
  );
};

// =================== LIVE LOGIN FEED ===================
const LoginFeed = ({ logins, loading }) => (
  <div className="bg-white border border-slate-200 rounded-xl p-5" data-testid="activity-login-feed">
    <div className="flex items-center justify-between mb-4">
      <div>
        <div className="text-[10px] uppercase tracking-wider font-bold text-slate-500 mb-1">Live Logins</div>
        <div className="text-lg font-bold text-slate-900">Latest {logins.length} sign-ins</div>
      </div>
      <Activity size={22} className="text-sky-500" />
    </div>
    {loading ? (
      <div className="text-xs text-slate-400 py-6 text-center">Loading…</div>
    ) : logins.length === 0 ? (
      <div className="text-xs text-slate-400 italic py-6 text-center">No logins recorded yet. They start accumulating on the next sign-in.</div>
    ) : (
      <div className="divide-y divide-slate-100 max-h-[420px] overflow-auto -mx-5">
        {logins.map((l, i) => (
          <div key={`${l.user_id}-${l.at}-${i}`} className="px-5 py-2.5 flex items-center gap-3 hover:bg-slate-50">
            <div className="w-8 h-8 rounded-full bg-gradient-to-br from-sky-400 to-indigo-500 flex items-center justify-center text-white text-xs font-bold flex-shrink-0">
              {(l.name || l.email || '?').charAt(0).toUpperCase()}
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-sm font-semibold text-slate-800 truncate">{l.name || l.email}</div>
              <div className="text-[11px] text-slate-500 truncate">
                {l.clinic_name || l.clinic_id} · <span className="uppercase font-semibold">{(l.role || '').replace('_', ' ')}</span>
              </div>
            </div>
            <div className="text-right flex-shrink-0">
              <div className="text-[11px] font-semibold text-slate-700">{fmtRelative(l.at)}</div>
              <div className="text-[10px] text-slate-400">{prettyUA(l.user_agent)} · {l.ip || '—'}</div>
            </div>
          </div>
        ))}
      </div>
    )}
  </div>
);

// =================== INACTIVE TENANTS ===================
const InactiveTenants = ({ rows, days, onDays }) => (
  <div className="bg-white border border-slate-200 rounded-xl p-5" data-testid="activity-inactive">
    <div className="flex items-center justify-between mb-4">
      <div>
        <div className="text-[10px] uppercase tracking-wider font-bold text-slate-500 mb-1">At-risk Tenants</div>
        <div className="text-lg font-bold text-slate-900">
          {rows.length} silent clinic{rows.length === 1 ? '' : 's'}
        </div>
      </div>
      <div className="flex items-center gap-2 text-[11px] text-slate-500">
        <span>Inactive &gt;</span>
        <select
          value={days}
          onChange={(e) => onDays(Number(e.target.value))}
          className="bg-slate-50 border border-slate-300 rounded px-2 py-0.5"
          data-testid="inactive-days-filter"
        >
          {[3, 7, 14, 30].map((d) => <option key={d} value={d}>{d} days</option>)}
        </select>
        <AlertTriangle size={16} className="text-amber-500" />
      </div>
    </div>
    {rows.length === 0 ? (
      <div className="text-xs text-emerald-500 italic py-6 text-center">
        🎉 Every tenant has logged in within {days} days. Beautiful.
      </div>
    ) : (
      <div className="max-h-[420px] overflow-auto -mx-5">
        <table className="w-full text-xs">
          <thead className="text-[10px] uppercase tracking-wider text-slate-500 border-b border-slate-100">
            <tr className="text-left">
              <th className="px-5 py-2 font-bold">Clinic</th>
              <th className="px-3 py-2 font-bold">Tier</th>
              <th className="px-3 py-2 font-bold text-right">Days silent</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {rows.map((r) => (
              <tr key={r.clinic_id} className="hover:bg-slate-50">
                <td className="px-5 py-2">
                  <div className="font-semibold text-slate-800 truncate max-w-[220px]">{r.name || r.clinic_id}</div>
                  {r.city && <div className="text-[10px] text-slate-500">{r.city}</div>}
                </td>
                <td className="px-3 py-2">
                  <span className="text-[10px] uppercase tracking-wider font-bold text-slate-500">
                    {r.tier || '—'}
                  </span>
                </td>
                <td className="px-3 py-2 text-right">
                  {r.days_since_login === null ? (
                    <span className="inline-block text-[10px] font-bold px-2 py-0.5 bg-rose-100 text-rose-700 rounded-full uppercase">Never</span>
                  ) : (
                    <span className="font-mono font-bold text-amber-700">{r.days_since_login}d</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    )}
  </div>
);

// =================== PER-TENANT FUNNEL TABLE ===================
const TenantFunnelTable = ({ rows }) => {
  const [stageFilter, setStageFilter] = useState('all');
  const [q, setQ] = useState('');
  const filtered = useMemo(() => {
    return rows.filter((r) => {
      if (stageFilter !== 'all' && r.stage !== stageFilter) return false;
      if (q && !(r.name || '').toLowerCase().includes(q.toLowerCase())
        && !(r.clinic_id || '').toLowerCase().includes(q.toLowerCase())) return false;
      return true;
    });
  }, [rows, stageFilter, q]);

  return (
    <div className="bg-white border border-slate-200 rounded-xl p-5" data-testid="activity-tenant-table">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
        <div>
          <div className="text-[10px] uppercase tracking-wider font-bold text-slate-500 mb-1">Per-Tenant Breakdown</div>
          <div className="text-lg font-bold text-slate-900">{filtered.length} of {rows.length} clinics</div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative">
            <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search clinic…"
              data-testid="tenant-search"
              className="pl-7 pr-3 py-1.5 text-xs border border-slate-300 rounded w-[180px] focus:border-sky-400 outline-none"
            />
          </div>
          <select
            value={stageFilter}
            onChange={(e) => setStageFilter(e.target.value)}
            data-testid="stage-filter"
            className="text-xs border border-slate-300 rounded px-2 py-1.5 bg-white"
          >
            <option value="all">All stages</option>
            <option value="registered">Registered only</option>
            <option value="first_login">First Login</option>
            <option value="first_patient">First Patient</option>
            <option value="first_diagnostic">First Diagnostic</option>
            <option value="first_invoice">First Invoice</option>
            <option value="active">Active</option>
          </select>
        </div>
      </div>
      <div className="max-h-[500px] overflow-auto -mx-5">
        <table className="w-full text-xs">
          <thead className="sticky top-0 bg-white text-[10px] uppercase tracking-wider text-slate-500 border-b border-slate-200">
            <tr className="text-left">
              <th className="px-5 py-2 font-bold">Clinic</th>
              <th className="px-3 py-2 font-bold">Tier</th>
              <th className="px-3 py-2 font-bold">Stage</th>
              <th className="px-3 py-2 font-bold">Last login</th>
              <th className="px-3 py-2 font-bold">By</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {filtered.map((r) => {
              const color = STAGE_COLOR[r.stage] || STAGE_COLOR.registered;
              return (
                <tr key={r.clinic_id} className="hover:bg-slate-50">
                  <td className="px-5 py-2">
                    <div className="font-semibold text-slate-800 truncate max-w-[230px]">{r.name || r.clinic_id}</div>
                    {r.city && <div className="text-[10px] text-slate-500">{r.city}</div>}
                  </td>
                  <td className="px-3 py-2 text-[10px] uppercase tracking-wider font-bold text-slate-500">{r.tier || '—'}</td>
                  <td className="px-3 py-2">
                    <span className={`inline-block text-[10px] uppercase tracking-wider font-bold px-2 py-0.5 rounded ${color.bg} ${color.text} ring-1 ${color.ring}`}>
                      {r.stage_label}
                    </span>
                  </td>
                  <td className="px-3 py-2 font-mono text-[11px] text-slate-700">
                    {r.last_login_at ? fmtRelative(r.last_login_at) : <span className="italic text-slate-400">Never</span>}
                  </td>
                  <td className="px-3 py-2 text-[11px] text-slate-600 truncate max-w-[160px]">{r.last_login_by || '—'}</td>
                </tr>
              );
            })}
            {filtered.length === 0 && (
              <tr><td colSpan={5} className="px-5 py-8 text-center text-slate-400 italic">No clinics match.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
};

// =================== PAGE ===================
export default function ActivityPage() {
  const [funnel, setFunnel] = useState(null);
  const [logins, setLogins] = useState([]);
  const [loginsLoading, setLoginsLoading] = useState(true);
  const [inactive, setInactive] = useState([]);
  const [inactiveDays, setInactiveDays] = useState(7);
  const [tenants, setTenants] = useState([]);
  const [err, setErr] = useState(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    setRefreshing(true);
    setErr(null);
    try {
      const [f, l, i, t] = await Promise.all([
        axios.get(`${API}/admin/v2/activity/funnel`),
        axios.get(`${API}/admin/v2/activity/logins`, { params: { limit: 30 } }),
        axios.get(`${API}/admin/v2/activity/inactive`, { params: { days: inactiveDays } }),
        axios.get(`${API}/admin/v2/activity/funnel/by-tenant`, { params: { limit: 200 } }),
      ]);
      setFunnel(f.data);
      setLogins(l.data || []);
      setInactive(i.data || []);
      setTenants(t.data || []);
    } catch (ex) {
      setErr(ex?.response?.data?.detail || 'Failed to load activity data');
    } finally {
      setLoginsLoading(false);
      setRefreshing(false);
    }
  }, [inactiveDays]);

  useEffect(() => { load(); }, [load]);

  // Auto-refresh login feed every 30s (lightweight, only the feed endpoint)
  useEffect(() => {
    const iv = setInterval(async () => {
      try {
        const r = await axios.get(`${API}/admin/v2/activity/logins`, { params: { limit: 30 } });
        setLogins(r.data || []);
      } catch { /* ignore polling errors */ }
    }, 30_000);
    return () => clearInterval(iv);
  }, []);

  // Quick stats from funnel
  const stats = useMemo(() => {
    if (!funnel) return null;
    const c = funnel.counts || {};
    const total = funnel.total || 0;
    const engaged = (c.first_login || 0) + (c.first_patient || 0) + (c.first_diagnostic || 0) + (c.first_invoice || 0) + (c.active || 0);
    const registeredPct = total ? Math.round(((total - (c.registered || 0)) / total) * 100) : 0;
    return {
      total,
      engaged,
      active: c.active || 0,
      ghost: c.registered || 0,
      engagedPct: registeredPct,
    };
  }, [funnel]);

  return (
    <div className="p-4 sm:p-6 space-y-5" data-testid="activity-page">
      {/* Header */}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="text-[10px] uppercase tracking-[0.2em] font-bold text-orange-500 mb-1">Growth</div>
          <h1 className="text-2xl font-black text-slate-900 flex items-center gap-2">
            <Activity size={22} className="text-orange-500" /> Live Activity
          </h1>
          <p className="text-xs text-slate-500 mt-0.5">
            Real-time login feed + activation funnel. Auto-refreshes every 30s.
          </p>
        </div>
        <button
          onClick={load}
          disabled={refreshing}
          data-testid="activity-refresh"
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-slate-600 hover:text-slate-900 bg-white border border-slate-200 hover:border-slate-300 rounded-lg shadow-sm disabled:opacity-40 transition-colors"
        >
          <RefreshCw size={13} className={refreshing ? 'animate-spin' : ''} />
          Refresh
        </button>
      </div>

      {err && (
        <div className="bg-rose-50 border border-rose-200 text-rose-700 text-xs px-3 py-2 rounded-lg">{err}</div>
      )}

      {/* KPI strip */}
      {stats && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <div className="bg-white border border-slate-200 rounded-xl p-4" data-testid="kpi-total">
            <div className="text-[10px] uppercase tracking-wider font-bold text-slate-500">Total Clinics</div>
            <div className="text-2xl font-black text-slate-900 mt-1">{stats.total}</div>
            <div className="text-[10px] text-slate-400">tracked in system</div>
          </div>
          <div className="bg-white border border-slate-200 rounded-xl p-4" data-testid="kpi-engaged">
            <div className="text-[10px] uppercase tracking-wider font-bold text-sky-500">Engaged</div>
            <div className="text-2xl font-black text-slate-900 mt-1">{stats.engaged}</div>
            <div className="text-[10px] text-slate-400">{stats.engagedPct}% activation rate</div>
          </div>
          <div className="bg-white border border-slate-200 rounded-xl p-4" data-testid="kpi-active">
            <div className="text-[10px] uppercase tracking-wider font-bold text-emerald-500">Active Trials</div>
            <div className="text-2xl font-black text-slate-900 mt-1">{stats.active}</div>
            <div className="text-[10px] text-slate-400">logged in &lt; 7 days AND billing</div>
          </div>
          <div className="bg-white border border-slate-200 rounded-xl p-4" data-testid="kpi-ghost">
            <div className="text-[10px] uppercase tracking-wider font-bold text-rose-500">Ghost Clinics</div>
            <div className="text-2xl font-black text-slate-900 mt-1">{stats.ghost}</div>
            <div className="text-[10px] text-slate-400">registered but never logged in</div>
          </div>
        </div>
      )}

      {/* Funnel + Login Feed */}
      <div className="grid lg:grid-cols-2 gap-4">
        <Funnel data={funnel} />
        <LoginFeed logins={logins} loading={loginsLoading} />
      </div>

      {/* Inactive + Tenant table */}
      <div className="grid lg:grid-cols-5 gap-4">
        <div className="lg:col-span-2">
          <InactiveTenants rows={inactive} days={inactiveDays} onDays={setInactiveDays} />
        </div>
        <div className="lg:col-span-3">
          <TenantFunnelTable rows={tenants} />
        </div>
      </div>
    </div>
  );
}
