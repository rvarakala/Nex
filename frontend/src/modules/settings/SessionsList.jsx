/**
 * SessionsList — Gmail-style "Where am I signed in?" component, mounted in
 * Settings → Security & Privacy.
 *
 * Lists every active session, marks the current one, lets the user revoke
 * any one (or all-other) sessions in one click. Revoking a session
 * server-side invalidates that JWT immediately.
 */
import React, { useEffect, useState, useCallback } from 'react';
import axios from 'axios';
import {
  Monitor, Smartphone, Tablet, Globe, MapPin, Clock, Loader2,
  LogOut, RotateCcw, Check, ShieldCheck,
} from 'lucide-react';

const API = `${process.env.REACT_APP_BACKEND_URL}/api/auth/sessions`;

function pickIcon(label) {
  if (!label) return Globe;
  const l = label.toLowerCase();
  if (l.includes('iphone') || l.includes('android') && !l.includes('tab')) return Smartphone;
  if (l.includes('ipad') || l.includes('tablet')) return Tablet;
  return Monitor;
}

function timeAgo(iso) {
  if (!iso) return '—';
  const ms = Date.now() - new Date(iso).getTime();
  if (ms < 0) return 'just now';
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.round(h / 24);
  if (d < 30) return `${d}d ago`;
  return new Date(iso).toLocaleDateString();
}

export default function SessionsList() {
  const [rows, setRows] = useState(null);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(null);   // session_id being revoked, or 'all'
  const [pulse, setPulse] = useState(0);    // bump to force a refetch
  const [limit, setLimit] = useState(null); // {count, cap, tier, at_limit, enforced, unlimited}

  const refresh = useCallback(async () => {
    setErr('');
    try {
      const [rowsRes, limitRes] = await Promise.all([
        axios.get(API),
        axios.get(`${API}/device-limit`).catch(() => ({ data: null })),
      ]);
      setRows(rowsRes.data || []);
      setLimit(limitRes.data || null);
    } catch (e) {
      setErr(e?.response?.data?.detail || 'Failed to load sessions');
      setRows([]);
    }
  }, []);
  useEffect(() => { refresh(); }, [refresh, pulse]);

  const revokeOne = async (sid) => {
    setBusy(sid); setErr('');
    try {
      await axios.post(`${API}/${sid}/revoke`);
      setPulse((p) => p + 1);
    } catch (e) {
      setErr(e?.response?.data?.detail || 'Revoke failed');
    } finally { setBusy(null); }
  };

  const revokeOthers = async () => {
    setBusy('all'); setErr('');
    try {
      await axios.post(`${API}/revoke-others`);
      setPulse((p) => p + 1);
    } catch (e) {
      setErr(e?.response?.data?.detail || 'Revoke failed');
    } finally { setBusy(null); }
  };

  if (rows === null) {
    return <div className="text-sm text-slate-500 inline-flex items-center gap-2"><Loader2 className="animate-spin" size={14}/> Loading sessions…</div>;
  }

  const others = rows.filter((r) => !r.current);

  return (
    <div className="bg-white border border-slate-200 rounded-lg overflow-hidden" data-testid="sessions-card">
      <div className="px-4 py-3 border-b border-slate-100 flex items-center justify-between flex-wrap gap-2">
        <div>
          <div className="flex items-center gap-2">
            <ShieldCheck size={14} className="text-emerald-600" />
            <span className="font-bold text-slate-900 text-sm">Active sessions</span>
            <span className="text-[11px] text-slate-500">({rows.length})</span>
            {limit && !limit.unlimited && (
              <span
                data-testid="sessions-device-cap-chip"
                title={limit.enforced
                  ? `Your ${limit.tier} plan allows ${limit.cap} concurrent devices. The next login on a new device will require signing out here first.`
                  : `Your ${limit.tier} plan allows ${limit.cap} concurrent devices. We're currently in the 7-day warn-only rollout — no hard blocks yet.`}
                className={`text-[10.5px] font-bold px-2 py-0.5 rounded-full border ${
                  limit.at_limit
                    ? 'bg-amber-50 border-amber-300 text-amber-800'
                    : 'bg-slate-50 border-slate-300 text-slate-700'
                }`}
              >
                {limit.count}/{limit.cap} · {limit.tier}
              </span>
            )}
          </div>
          <p className="text-[12px] text-slate-600 mt-0.5 max-w-md">
            Devices currently signed in to your account. Revoking a session signs
            that device out immediately.
          </p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={refresh}
            data-testid="sessions-refresh"
            className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-[11.5px] font-semibold text-slate-600 hover:text-slate-900 hover:bg-slate-100 rounded"
            title="Refresh"
          >
            <RotateCcw size={12} />
            Refresh
          </button>
          {others.length > 0 && (
            <button
              onClick={revokeOthers}
              disabled={busy === 'all'}
              data-testid="sessions-revoke-others"
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-[11.5px] font-bold rounded bg-rose-600 hover:bg-rose-700 text-white disabled:opacity-50"
            >
              {busy === 'all'
                ? <Loader2 size={12} className="animate-spin" />
                : <LogOut size={12} />}
              Sign out other devices
            </button>
          )}
        </div>
      </div>

      {err && (
        <div className="px-4 py-2 bg-rose-50 border-b border-rose-200 text-[12px] text-rose-700" data-testid="sessions-err">
          {err}
        </div>
      )}

      {limit && !limit.unlimited && limit.at_limit && (
        <div
          data-testid="sessions-device-limit-banner"
          className={`px-4 py-2 border-b text-[12px] ${
            limit.enforced
              ? 'bg-rose-50 border-rose-200 text-rose-800'
              : 'bg-amber-50 border-amber-200 text-amber-900'
          }`}
        >
          {limit.enforced ? (
            <>You&apos;ve reached your device limit ({limit.count}/{limit.cap}). New sign-ins on other devices will be blocked until you sign out here.</>
          ) : (
            <>You&apos;re at your device limit ({limit.count}/{limit.cap}). Enforcement starts soon — sign out an old device to stay ahead of the change.</>
          )}
          {limit.tier !== 'PREMIUM' && (
            <> · <a href="/settings/subscription" className="font-bold underline">Upgrade for more devices</a></>
          )}
        </div>
      )}

      <ul className="divide-y divide-slate-100">
        {rows.map((s) => {
          const Icon = pickIcon(s.device_label);
          return (
            <li
              key={s.session_id}
              data-testid={`session-row${s.current ? '-current' : ''}`}
              className={`px-4 py-3 flex items-start gap-3 ${
                s.current ? 'bg-emerald-50/40' : 'bg-white hover:bg-slate-50'
              } transition-colors`}
            >
              <div className={`shrink-0 w-9 h-9 rounded-lg flex items-center justify-center ${
                s.current ? 'bg-emerald-500/15 text-emerald-700' : 'bg-slate-100 text-slate-600'
              }`}>
                <Icon size={16} />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-bold text-slate-900 text-[13px]">
                    {s.device_label}
                  </span>
                  {s.current && (
                    <span className="inline-flex items-center gap-1 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider bg-emerald-500/15 text-emerald-700 rounded">
                      <Check size={10} /> This device
                    </span>
                  )}
                  {s.remember_device === false && (
                    <span
                      data-testid={`session-ephemeral-${s.session_id}`}
                      title="Ephemeral session — signs out in 8 hours and does not count toward your device limit."
                      className="inline-flex items-center px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider bg-amber-500/15 text-amber-800 rounded"
                    >
                      Ephemeral
                    </span>
                  )}
                  {s.purpose && s.purpose !== 'login' && (
                    <span className="text-[10px] text-slate-400 font-mono uppercase">
                      via {s.purpose}
                    </span>
                  )}
                </div>
                <div className="mt-1 flex flex-wrap gap-x-4 gap-y-0.5 text-[11.5px] text-slate-500">
                  <span className="inline-flex items-center gap-1" title={s.last_seen_at}>
                    <Clock size={11} /> Last active {timeAgo(s.last_seen_at)}
                  </span>
                  {s.ip && (
                    <span className="inline-flex items-center gap-1 font-mono">
                      <MapPin size={11} /> {s.ip}
                    </span>
                  )}
                  <span className="text-slate-400">Signed in {timeAgo(s.created_at)}</span>
                </div>
              </div>
              {!s.current && (
                <button
                  onClick={() => revokeOne(s.session_id)}
                  disabled={busy === s.session_id}
                  data-testid={`session-revoke-${s.session_id}`}
                  className="px-2.5 py-1.5 text-[11.5px] font-bold text-rose-700 hover:bg-rose-100 rounded inline-flex items-center gap-1 disabled:opacity-50"
                >
                  {busy === s.session_id
                    ? <Loader2 size={12} className="animate-spin" />
                    : <LogOut size={12} />}
                  Sign out
                </button>
              )}
            </li>
          );
        })}
      </ul>

      {rows.length === 0 && (
        <div className="px-4 py-6 text-center text-[12px] text-slate-500">
          No active sessions found.
        </div>
      )}
    </div>
  );
}
