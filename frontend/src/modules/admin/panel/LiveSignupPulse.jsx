/**
 * LiveSignupPulse — real-time launch-pulse widget on the Founder Dashboard.
 *
 * Polls `GET /api/admin/v2/signups/recent?since=<server_now>` every ~20s.
 * When new clinics arrive:
 *   - fires a toast per new clinic ("🎉 New signup — Clinic Name")
 *   - bumps the "Signups today" counter with a green flash
 *   - the LIVE dot pulses on every successful poll
 *
 * Uses server-provided `server_now` as the watermark so we never miss or
 * double-count events due to client-clock drift. Fully self-contained;
 * mount it once in the dashboard header row.
 */
import React, { useEffect, useRef, useState, useCallback } from 'react';
import axios from 'axios';
import { toast } from 'sonner';
import { Link } from 'react-router-dom';

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;
const POLL_MS = 20_000;

function isToday(iso) {
  if (!iso) return false;
  const d = new Date(iso);
  const now = new Date();
  return d.getFullYear() === now.getFullYear()
    && d.getMonth() === now.getMonth()
    && d.getDate() === now.getDate();
}

export default function LiveSignupPulse() {
  const [since, setSince] = useState(null);
  const [lastPollAt, setLastPollAt] = useState(null);
  const [signupsToday, setSignupsToday] = useState(0);
  const [flash, setFlash] = useState(false);
  const [connected, setConnected] = useState(true);
  const timerRef = useRef(null);
  const boot = useRef(true);

  const poll = useCallback(async () => {
    try {
      const url = since
        ? `${API}/admin/v2/signups/recent?since=${encodeURIComponent(since)}&limit=20`
        : `${API}/admin/v2/signups/recent?limit=20`;
      const r = await axios.get(url);
      const { rows = [], server_now } = r.data || {};

      if (boot.current) {
        // First tick — seed the "signups today" counter without spamming toasts
        boot.current = false;
        setSignupsToday(rows.filter(row => isToday(row.created_at)).length);
      } else if (rows.length > 0) {
        // Real new signup(s) — celebrate!
        rows.slice(0, 5).reverse().forEach((row) => {
          toast.success(
            <div className="flex flex-col gap-0.5 min-w-0">
              <span className="text-[11px] uppercase tracking-wider font-bold text-emerald-700">🎉 New signup</span>
              <Link to={`/admin/tenants/${row.clinic_id}`} className="font-semibold text-slate-900 hover:underline truncate">
                {row.name || '(unnamed)'}
              </Link>
              <span className="text-[11px] text-slate-500 truncate">
                {[row.city, row.country].filter(Boolean).join(' · ') || 'Location unknown'} · {row.subscription_tier || 'BASIC'}
              </span>
            </div>,
            { duration: 8000, position: 'top-right' }
          );
        });
        if (rows.length > 5) {
          toast.info(`+${rows.length - 5} more signups arrived — check the Recent table`, { duration: 5000 });
        }
        setSignupsToday((n) => n + rows.filter(row => isToday(row.created_at)).length);
        setFlash(true);
        setTimeout(() => setFlash(false), 1600);
      }

      setSince(server_now);
      setLastPollAt(new Date());
      setConnected(true);
    } catch (e) {
      // Silent degrade — heartbeat dot goes amber, no scary toast on the founder
      setConnected(false);
    }
  }, [since]);

  useEffect(() => {
    poll(); // fire once immediately
    timerRef.current = setInterval(poll, POLL_MS);
    return () => timerRef.current && clearInterval(timerRef.current);
  }, [poll]);

  const dotClass = connected
    ? 'bg-emerald-500 shadow-emerald-400/50 shadow-md animate-pulse'
    : 'bg-amber-400 animate-pulse';

  return (
    <div
      className={`flex items-center gap-3 rounded-lg border px-3 py-2 transition-colors duration-500 ${flash ? 'border-emerald-400 bg-emerald-50' : 'border-slate-200 bg-white'}`}
      data-testid="live-signup-pulse"
    >
      <span className="flex items-center gap-1.5">
        <span className={`inline-block w-2 h-2 rounded-full ${dotClass}`} />
        <span className="text-[10px] font-bold uppercase tracking-wider text-slate-600">Live</span>
      </span>
      <span className="text-slate-300 select-none">|</span>
      <span className="flex items-baseline gap-1.5">
        <span
          className={`text-lg font-black tabular-nums transition-transform duration-300 ${flash ? 'text-emerald-600 scale-110' : 'text-slate-800'}`}
          data-testid="live-signups-today-count"
        >
          {signupsToday}
        </span>
        <span className="text-[11px] text-slate-500">signup{signupsToday === 1 ? '' : 's'} today</span>
      </span>
      {lastPollAt && (
        <span className="text-[10px] text-slate-400 ml-auto" title={connected ? 'Realtime feed connected' : 'Connection interrupted'}>
          {connected ? 'checked ' : 'reconnecting… '}
          {lastPollAt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
        </span>
      )}
    </div>
  );
}
