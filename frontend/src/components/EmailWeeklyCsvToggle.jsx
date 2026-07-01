/**
 * EmailWeeklyCsvToggle — self-contained toggle + "Send me now" button.
 *
 * Usage:
 *   <EmailWeeklyCsvToggle kind="patients" />
 *   <EmailWeeklyCsvToggle kind="invoices" />
 *
 * The toggle sends the WHOLE current-view (backend re-queries at cron time),
 * NOT the currently-loaded page — so it's always up-to-date on Monday
 * 07:00 IST when the job fires.
 *
 * Backend contract (implemented by /app/backend/routers/csv_email_exports.py):
 *   GET    /api/csv-exports/subscriptions       → list caller's subs
 *   POST   /api/csv-exports/subscribe           → { kind }
 *   DELETE /api/csv-exports/subscribe/:kind
 *   POST   /api/csv-exports/send-now            → { kind } (immediate one-off)
 */
import React, { useEffect, useState, useCallback } from 'react';
import axios from 'axios';
import { Mail, Send, Loader2, Check } from 'lucide-react';

const API = process.env.REACT_APP_BACKEND_URL + '/api';

export default function EmailWeeklyCsvToggle({ kind }) {
  const [subscribed, setSubscribed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [sendingNow, setSendingNow] = useState(false);
  const [justSaved, setJustSaved] = useState(false);
  const [err, setErr] = useState('');
  const [allowed, setAllowed] = useState(true); // 403 for non-owner roles

  // Hydrate from server on mount so the toggle reflects the true state.
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const r = await axios.get(`${API}/csv-exports/subscriptions`);
        if (!alive) return;
        const list = Array.isArray(r.data) ? r.data : [];
        setSubscribed(list.some((s) => s.kind === kind && s.active));
      } catch { /* silent — toggle stays off */ }
    })();
    return () => { alive = false; };
  }, [kind]);

  const toggle = useCallback(async (e) => {
    const next = e.target.checked;
    setBusy(true); setErr('');
    try {
      if (next) {
        await axios.post(`${API}/csv-exports/subscribe`, { kind });
      } else {
        await axios.delete(`${API}/csv-exports/subscribe/${kind}`);
      }
      setSubscribed(next);
      setJustSaved(true);
      setTimeout(() => setJustSaved(false), 1500);
    } catch (ex) {
      if (ex?.response?.status === 403) setAllowed(false);
      setErr(ex?.response?.data?.detail || 'Could not update subscription');
      // Revert the visual state on error
      setSubscribed(!next);
    } finally { setBusy(false); }
  }, [kind]);

  const sendNow = useCallback(async () => {
    setSendingNow(true); setErr('');
    try {
      const r = await axios.post(`${API}/csv-exports/send-now`, { kind });
      const status = r?.data?.status;
      if (status === 'sent' || status === 'mocked') {
        setJustSaved(true);
        setTimeout(() => setJustSaved(false), 2000);
      } else {
        setErr(`Delivery failed (provider status: ${status})`);
      }
    } catch (ex) {
      if (ex?.response?.status === 403) setAllowed(false);
      setErr(ex?.response?.data?.detail || 'Could not send export');
    } finally { setSendingNow(false); }
  }, [kind]);

  // Hide entirely for roles that aren't allowed to subscribe (front_desk, etc)
  if (!allowed) return null;

  return (
    <div
      className="inline-flex items-center gap-2 text-[11px] pl-2 pr-2 py-1 rounded-lg border border-slate-200 bg-white"
      data-testid={`csv-weekly-toggle-${kind}`}
    >
      <label
        className="inline-flex items-center gap-1.5 cursor-pointer select-none"
        title={`Every Monday 07:00 IST, we'll email you the current ${kind} export as a CSV attachment.`}
      >
        <input
          type="checkbox"
          checked={subscribed}
          disabled={busy}
          onChange={toggle}
          data-testid={`csv-weekly-checkbox-${kind}`}
          className="w-3.5 h-3.5 rounded border-slate-300 text-cyan-600 focus:ring-cyan-500"
        />
        <Mail size={12} className="text-slate-500" />
        <span className="font-semibold text-slate-700">Email me this view weekly</span>
        {busy && <Loader2 size={11} className="animate-spin text-slate-400" />}
        {justSaved && !busy && <Check size={12} className="text-emerald-600" />}
      </label>
      {subscribed && (
        <button
          type="button"
          onClick={sendNow}
          disabled={sendingNow}
          data-testid={`csv-weekly-send-now-${kind}`}
          title="Send me a copy right now"
          className="inline-flex items-center gap-1 text-[10.5px] px-1.5 py-0.5 rounded border border-cyan-200 bg-cyan-50 text-cyan-700 hover:bg-cyan-100 disabled:opacity-50"
        >
          {sendingNow ? <Loader2 size={10} className="animate-spin" /> : <Send size={10} />}
          Send now
        </button>
      )}
      {err && (
        <span className="text-[10px] text-rose-600 font-semibold ml-1" title={err}>
          {err.slice(0, 40)}{err.length > 40 ? '…' : ''}
        </span>
      )}
    </div>
  );
}
