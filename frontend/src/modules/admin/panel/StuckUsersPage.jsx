/**
 * Founder Dashboard — Stuck Users (email verification recovery)
 *
 * Surfaces the 3 founder-only endpoints built after the Zepto→Resend
 * migration incident:
 *   - GET  /api/admin/v2/users/stuck-verification    → table of unverified users
 *   - POST /api/admin/v2/users/force-verify          → skip OTP, mark verified
 *   - POST /api/admin/v2/users/resend-verification   → send a fresh OTP now
 *
 * Every action is audit-logged server-side. This is a founder-fire-drill
 * tool, not a day-to-day admin surface.
 */
import React, { useEffect, useState } from 'react';
import axios from 'axios';
import { toast } from 'sonner';
import { Users, RefreshCw, ShieldCheck, MailCheck, AlertTriangle } from 'lucide-react';
import { PageHeader } from './shared';

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;

function fmt(dt) {
  if (!dt) return '—';
  try { return new Date(dt).toLocaleString(); } catch { return String(dt); }
}

export default function StuckUsersPage() {
  const [rows, setRows] = useState(null);
  const [err, setErr] = useState('');
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState({});    // { [email]: 'verify' | 'resend' }
  const [confirmEmail, setConfirmEmail] = useState('');

  async function load() {
    setLoading(true); setErr('');
    try {
      const r = await axios.get(`${API}/admin/v2/users/stuck-verification`);
      setRows(r.data.users || []);
    } catch (e) {
      setErr(e?.response?.data?.detail || 'Failed to load stuck users');
    } finally { setLoading(false); }
  }

  useEffect(() => { load(); }, []);

  async function forceVerify(email) {
    setBusy((b) => ({ ...b, [email]: 'verify' }));
    try {
      await axios.post(`${API}/admin/v2/users/force-verify`, { email });
      toast.success(`Verified: ${email}`, { description: 'User can log in now.' });
      setRows((rs) => rs.filter((u) => u.email !== email));
    } catch (e) {
      toast.error('Force verify failed', { description: e?.response?.data?.detail || String(e) });
    } finally {
      setBusy((b) => { const n = { ...b }; delete n[email]; return n; });
      setConfirmEmail('');
    }
  }

  async function resendCode(email) {
    setBusy((b) => ({ ...b, [email]: 'resend' }));
    try {
      const r = await axios.post(`${API}/admin/v2/users/resend-verification`, { email });
      toast.success(`OTP re-sent to ${email}`, { description: r.data?.message || 'Delivered via current email provider' });
    } catch (e) {
      toast.error('Resend failed', { description: e?.response?.data?.detail || String(e) });
    } finally {
      setBusy((b) => { const n = { ...b }; delete n[email]; return n; });
    }
  }

  return (
    <div className="p-6 space-y-6" data-testid="stuck-users-page">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <PageHeader
          title="Stuck Users"
          subtitle="Signups that never completed the 6-digit email verification"
        />
        <button
          onClick={load} disabled={loading}
          data-testid="stuck-users-refresh"
          className="inline-flex items-center gap-2 text-sm font-semibold px-3 py-2 rounded-lg border border-slate-200 hover:bg-slate-50 disabled:opacity-50"
        >
          <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} /> Refresh
        </button>
      </div>

      {err && (
        <div className="rounded-lg border border-rose-200 bg-rose-50 text-rose-800 text-sm p-3 flex items-start gap-2" data-testid="stuck-users-error">
          <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" /> <span>{err}</span>
        </div>
      )}

      <div className="rounded-2xl border border-slate-200 bg-white overflow-hidden">
        <div className="px-5 py-3 border-b border-slate-100 flex items-center justify-between">
          <h3 className="text-sm font-semibold text-slate-900 flex items-center gap-2">
            <Users className="w-4 h-4 text-slate-500" />
            {rows == null ? 'Loading…' : `${rows.length} user${rows.length === 1 ? '' : 's'} stuck at verification`}
          </h3>
          <div className="text-xs text-slate-500">
            <ShieldCheck className="w-3.5 h-3.5 inline mr-1 text-emerald-600" />
            Every action is audit-logged
          </div>
        </div>

        {rows && rows.length === 0 && !loading && (
          <div className="p-10 text-center text-sm text-slate-500" data-testid="stuck-users-empty">
            🎉 No stuck users — every signup has completed verification.
          </div>
        )}

        {rows && rows.length > 0 && (
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="bg-slate-50 text-slate-600">
                <tr>
                  <th className="text-left px-4 py-2 text-[11px] uppercase tracking-wider font-semibold">Email / Name</th>
                  <th className="text-left px-4 py-2 text-[11px] uppercase tracking-wider font-semibold">Clinic / Role</th>
                  <th className="text-left px-4 py-2 text-[11px] uppercase tracking-wider font-semibold">Signed up</th>
                  <th className="text-right px-4 py-2 text-[11px] uppercase tracking-wider font-semibold">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {rows.map((u) => (
                  <tr key={u.user_id || u.email} data-testid={`stuck-user-row-${u.email}`} className="hover:bg-slate-50">
                    <td className="px-4 py-2.5">
                      <div className="font-mono text-slate-900 truncate max-w-[240px]">{u.email}</div>
                      {u.name && <div className="text-xs text-slate-500 truncate max-w-[240px]">{u.name}</div>}
                    </td>
                    <td className="px-4 py-2.5">
                      <div className="text-slate-900 truncate max-w-[220px]">{u.clinic_id || '—'}</div>
                      <div className="text-xs text-slate-500">{u.role}</div>
                    </td>
                    <td className="px-4 py-2.5 text-xs text-slate-600">{fmt(u.created_at)}</td>
                    <td className="px-4 py-2.5 text-right space-x-2 whitespace-nowrap">
                      <button
                        onClick={() => resendCode(u.email)}
                        disabled={!!busy[u.email]}
                        data-testid={`stuck-resend-${u.email}`}
                        className="inline-flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1.5 rounded-md border border-slate-200 text-slate-700 hover:bg-white hover:border-slate-300 disabled:opacity-50"
                      >
                        <MailCheck className="w-3.5 h-3.5" />
                        {busy[u.email] === 'resend' ? 'Sending…' : 'Resend OTP'}
                      </button>
                      <button
                        onClick={() => setConfirmEmail(u.email)}
                        disabled={!!busy[u.email]}
                        data-testid={`stuck-verify-${u.email}`}
                        className="inline-flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1.5 rounded-md bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-50"
                      >
                        <ShieldCheck className="w-3.5 h-3.5" />
                        Force verify
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Confirm modal — force verify is a serious override, worth one click */}
      {confirmEmail && (
        <div
          className="fixed inset-0 z-40 bg-slate-900/50 backdrop-blur-sm flex items-center justify-center p-4"
          data-testid="force-verify-confirm"
          onClick={(e) => { if (e.target === e.currentTarget) setConfirmEmail(''); }}
        >
          <div className="bg-white rounded-2xl border border-slate-200 max-w-md w-full p-6 shadow-2xl">
            <div className="flex items-start gap-3">
              <span className="inline-flex w-10 h-10 rounded-full bg-amber-100 items-center justify-center shrink-0">
                <AlertTriangle className="w-5 h-5 text-amber-700" />
              </span>
              <div>
                <h4 className="text-lg font-bold text-slate-900">Skip email verification?</h4>
                <p className="text-sm text-slate-600 mt-1">
                  This will mark <span className="font-mono text-slate-900">{confirmEmail}</span> as verified without any OTP.
                  They'll be able to log in immediately. Every override is audit-logged under your name.
                </p>
              </div>
            </div>
            <div className="flex justify-end gap-2 mt-5">
              <button
                onClick={() => setConfirmEmail('')}
                data-testid="force-verify-cancel"
                className="text-sm font-semibold px-3 py-2 rounded-md text-slate-700 hover:bg-slate-100"
              >
                Cancel
              </button>
              <button
                onClick={() => forceVerify(confirmEmail)}
                disabled={busy[confirmEmail] === 'verify'}
                data-testid="force-verify-confirm-yes"
                className="text-sm font-semibold px-3 py-2 rounded-md bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-50"
              >
                {busy[confirmEmail] === 'verify' ? 'Verifying…' : 'Yes, force verify'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
