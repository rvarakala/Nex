/**
 * Founder / internal-admin Account & Security page.
 *
 * Ships the three actions any launched-app owner needs when they suspect
 * their account is compromised — in one place, no hunting through settings.
 *
 *   1. Change password           → POST /api/settings/me/change-password
 *      (also bumps token_version → forces every other logged-in session
 *      to reauth on next request).
 *
 *   2. Sign out other sessions   → POST /api/auth/sessions/revoke-others
 *      (keeps THIS tab alive, nukes every other device).
 *
 *   3. See active sessions       → GET  /api/auth/sessions
 *      (device / IP / last-used per session, individually revokable via
 *      POST /api/auth/sessions/{sid}/revoke).
 *
 * Route: /admin/account (founder + super_admin + any internal-admin role).
 */
import React, { useEffect, useState } from 'react';
import axios from 'axios';
import { toast } from 'sonner';
import {
  ShieldAlert, KeyRound, LogOut, Loader2, Eye, EyeOff, Monitor, Smartphone,
  AlertTriangle, CheckCircle2, RefreshCw, Trash2,
} from 'lucide-react';
import { PageHeader } from './shared';

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;

export default function AccountSecurityPage() {
  return (
    <div className="p-6 space-y-6 max-w-4xl" data-testid="account-security-page">
      <PageHeader
        title="Account & Security"
        subtitle="Change your password, review active devices, and revoke sessions"
      />

      {/* Compromise-recovery guidance */}
      <div className="rounded-xl border border-rose-200 bg-rose-50 p-4 flex items-start gap-3" data-testid="compromise-panel">
        <ShieldAlert className="w-5 h-5 mt-0.5 text-rose-700 shrink-0" />
        <div className="text-sm text-rose-900">
          <div className="font-bold mb-1">Suspect this account is compromised?</div>
          <ol className="list-decimal ml-4 space-y-0.5 text-[13px]">
            <li>Click <b>&ldquo;Sign out other sessions&rdquo;</b> below — kills every device that isn&apos;t this browser tab</li>
            <li>Then <b>change your password</b> — that alone invalidates every remaining token, everywhere</li>
            <li>If you can&apos;t log in yourself, ask a super-admin to reset from Users &amp; Roles</li>
          </ol>
        </div>
      </div>

      <ChangePasswordCard />
      <ActiveSessionsCard />
    </div>
  );
}

// -----------------------------------------------------------------------------
// Change password
// -----------------------------------------------------------------------------
function ChangePasswordCard() {
  const [cur, setCur] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [show, setShow] = useState(false);
  const [saving, setSaving] = useState(false);
  const [ok, setOk] = useState(false);

  async function submit(e) {
    e.preventDefault();
    if (next.length < 8)           return toast.error('New password must be at least 8 characters');
    if (next !== confirm)          return toast.error('New passwords do not match');
    if (next === cur)              return toast.error('New password must be different from current');
    setSaving(true); setOk(false);
    try {
      await axios.post(`${API}/settings/me/change-password`, {
        current_password: cur, new_password: next,
      });
      setOk(true);
      toast.success('Password updated', {
        description: 'All other sessions have been signed out. You&apos;ll be signed out here on next request too.',
      });
      setCur(''); setNext(''); setConfirm('');
    } catch (e) {
      toast.error(e?.response?.data?.detail || 'Password change failed');
    } finally { setSaving(false); }
  }

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-5" data-testid="change-password-card">
      <div className="flex items-center gap-2 mb-3">
        <KeyRound className="w-4 h-4 text-slate-600" />
        <h3 className="text-base font-bold text-slate-900">Change password</h3>
      </div>
      <form onSubmit={submit} className="space-y-3">
        <PasswordRow label="Current password" value={cur} setValue={setCur} show={show} setShow={setShow} testid="current-password" />
        <PasswordRow label="New password"     value={next} setValue={setNext} show={show} setShow={setShow} testid="new-password" hint="At least 8 characters" />
        <PasswordRow label="Confirm new password" value={confirm} setValue={setConfirm} show={show} setShow={setShow} testid="confirm-password" />
        <div className="flex items-center gap-3 pt-1">
          <button
            type="submit" disabled={saving || !cur || !next || !confirm}
            data-testid="change-password-submit"
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-bold text-white bg-slate-900 hover:bg-slate-800 disabled:opacity-40"
          >
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <KeyRound className="w-4 h-4" />}
            Update password
          </button>
          {ok && (
            <span className="text-xs text-emerald-700 inline-flex items-center gap-1" data-testid="change-password-success">
              <CheckCircle2 className="w-3.5 h-3.5" /> Password updated — all other sessions revoked
            </span>
          )}
        </div>
        <div className="text-[11px] text-slate-500 pt-2 border-t border-slate-100">
          Changing your password automatically signs out every other logged-in device — belt and suspenders in one click.
        </div>
      </form>
    </div>
  );
}

function PasswordRow({ label, value, setValue, show, setShow, testid, hint }) {
  return (
    <label className="block">
      <span className="text-[11px] uppercase tracking-wider font-semibold text-slate-600">{label}</span>
      <div className="mt-1 relative">
        <input
          type={show ? 'text' : 'password'}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          autoComplete={testid === 'current-password' ? 'current-password' : 'new-password'}
          data-testid={testid}
          className="w-full px-3 py-2 pr-10 border border-slate-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
        />
        <button
          type="button" onClick={() => setShow(!show)}
          className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-slate-400 hover:text-slate-700"
          data-testid={`${testid}-toggle`}
        >
          {show ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
        </button>
      </div>
      {hint && <span className="text-[11px] text-slate-500 mt-1 block">{hint}</span>}
    </label>
  );
}

// -----------------------------------------------------------------------------
// Active sessions
// -----------------------------------------------------------------------------
function ActiveSessionsCard() {
  const [rows, setRows] = useState(null);
  const [err, setErr] = useState('');
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState({});
  const [revokingAll, setRevokingAll] = useState(false);

  async function load() {
    setLoading(true); setErr('');
    try {
      const r = await axios.get(`${API}/auth/sessions`);
      setRows(r.data || []);
    } catch (e) {
      setErr(e?.response?.data?.detail || 'Failed to load sessions');
    } finally { setLoading(false); }
  }
  useEffect(() => { load(); }, []);

  async function revokeOne(sid) {
    setBusy((b) => ({ ...b, [sid]: true }));
    try {
      await axios.post(`${API}/auth/sessions/${sid}/revoke`);
      setRows((rs) => rs.filter((s) => s.session_id !== sid));
      toast.success('Session revoked');
    } catch (e) {
      toast.error(e?.response?.data?.detail || 'Revoke failed');
    } finally {
      setBusy((b) => { const n = { ...b }; delete n[sid]; return n; });
    }
  }

  async function revokeOthers() {
    setRevokingAll(true);
    try {
      const r = await axios.post(`${API}/auth/sessions/revoke-others`);
      toast.success(`Signed out ${r.data?.revoked ?? 'all other'} device(s)`);
      load();
    } catch (e) {
      toast.error(e?.response?.data?.detail || 'Failed to sign out other sessions');
    } finally { setRevokingAll(false); }
  }

  return (
    <div className="rounded-2xl border border-slate-200 bg-white" data-testid="active-sessions-card">
      <div className="px-5 py-3 border-b border-slate-100 flex items-center justify-between flex-wrap gap-3">
        <div>
          <h3 className="text-base font-bold text-slate-900 flex items-center gap-2">
            <Monitor className="w-4 h-4 text-slate-500" /> Active sessions
          </h3>
          <p className="text-xs text-slate-500 mt-0.5">Every device currently signed in to this account</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={load} disabled={loading}
            data-testid="sessions-refresh"
            className="inline-flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1.5 rounded-md border border-slate-200 hover:bg-slate-50 disabled:opacity-50"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} /> Refresh
          </button>
          <button
            onClick={revokeOthers} disabled={revokingAll || !rows || rows.length <= 1}
            data-testid="revoke-other-sessions"
            className="inline-flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1.5 rounded-md bg-rose-600 text-white hover:bg-rose-700 disabled:opacity-40"
          >
            {revokingAll ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <LogOut className="w-3.5 h-3.5" />}
            Sign out other sessions
          </button>
        </div>
      </div>
      {err && (
        <div className="p-4 text-sm text-rose-800 bg-rose-50 border-b border-rose-100 flex items-start gap-2" data-testid="sessions-error">
          <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" /> {err}
        </div>
      )}
      {rows && rows.length === 0 && !loading && (
        <div className="p-8 text-center text-sm text-slate-500" data-testid="sessions-empty">No active sessions.</div>
      )}
      {rows && rows.length > 0 && (
        <div className="divide-y divide-slate-100">
          {rows.map((s) => (
            <div key={s.session_id} className="px-5 py-3 flex items-start gap-3" data-testid={`session-row-${s.session_id}`}>
              <span className="inline-flex w-8 h-8 rounded-full bg-slate-100 items-center justify-center shrink-0 mt-0.5">
                {(/mobile|android|iphone|ipad/i).test(s.device_label || s.user_agent || '')
                  ? <Smartphone className="w-4 h-4 text-slate-600" />
                  : <Monitor className="w-4 h-4 text-slate-600" />}
              </span>
              <div className="flex-1 min-w-0">
                <div className="text-sm font-semibold text-slate-900 truncate">
                  {s.device_label || s.user_agent || 'Unknown device'}
                  {s.current && (
                    <span className="ml-2 text-[10px] font-bold uppercase tracking-wider bg-emerald-100 text-emerald-800 px-1.5 py-0.5 rounded" data-testid={`session-current-${s.session_id}`}>
                      This device
                    </span>
                  )}
                </div>
                <div className="text-[11px] text-slate-500 mt-0.5">
                  IP {s.ip || '?'} · signed in {s.created_at ? new Date(s.created_at).toLocaleString() : '?'}
                  {s.last_seen_at && <> · last seen {new Date(s.last_seen_at).toLocaleString()}</>}
                </div>
              </div>
              {!s.current && (
                <button
                  onClick={() => revokeOne(s.session_id)}
                  disabled={!!busy[s.session_id]}
                  data-testid={`session-revoke-${s.session_id}`}
                  className="inline-flex items-center gap-1 text-xs font-semibold px-2 py-1 rounded-md text-rose-700 hover:bg-rose-50 disabled:opacity-40"
                >
                  {busy[s.session_id]
                    ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    : <Trash2 className="w-3.5 h-3.5" />}
                  Revoke
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
