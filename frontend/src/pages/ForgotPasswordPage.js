/**
 * ForgotPasswordPage — public route /forgot-password
 *
 * User enters their email → POST /api/auth/forgot-password → success state
 * (anti-enum: same message regardless of whether the email exists).
 */
import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import axios from 'axios';
import { ArrowLeft, CheckCircle2, Loader2, Mail } from 'lucide-react';

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const [done, setDone] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true); setErr(null);
    try {
      await axios.post(`${API}/auth/forgot-password`, { email: email.trim().toLowerCase() });
      setDone(true);
    } catch (ex) {
      const d = ex?.response?.data?.detail;
      if (ex?.response?.status === 429) {
        setErr("Too many reset requests. Please wait 15 minutes before trying again.");
      } else {
        setErr(typeof d === 'string' ? d : (ex?.message || 'Something went wrong. Please try again.'));
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        <div className="text-center mb-6">
          <div className="inline-flex items-center justify-center w-14 h-14 rounded-xl bg-gradient-to-br from-blue-500 to-blue-700 shadow-lg mb-3">
            <Mail size={26} color="white" />
          </div>
          <h1 className="text-2xl font-bold text-white tracking-tight">Reset your password</h1>
          <p className="text-sm text-slate-400 mt-1">We'll email you a secure link to choose a new one.</p>
        </div>

        {done ? (
          <div className="bg-white rounded-xl shadow-2xl p-7 text-center" data-testid="forgot-success">
            <div className="w-14 h-14 mx-auto rounded-full bg-emerald-100 text-emerald-600 flex items-center justify-center mb-3">
              <CheckCircle2 size={28} strokeWidth={2.4} />
            </div>
            <h2 className="text-lg font-bold text-slate-900">Check your inbox</h2>
            <p className="text-sm text-slate-600 mt-2 leading-relaxed">
              If an account exists for <span className="font-semibold text-slate-900">{email}</span>,
              we've sent a password reset link. It expires in <b>1 hour</b>.
            </p>
            <p className="text-[12px] text-slate-500 mt-3">
              Didn't get it? Check your spam folder or try again in a few minutes.
            </p>
            <Link
              to="/login"
              data-testid="back-to-login"
              className="mt-6 inline-flex items-center gap-1.5 text-sm font-semibold text-blue-600 hover:underline"
            >
              <ArrowLeft size={14} /> Back to sign in
            </Link>
          </div>
        ) : (
          <form onSubmit={submit} className="bg-white rounded-xl shadow-2xl p-6 space-y-4" data-testid="forgot-form">
            <div>
              <label className="block text-[11px] font-semibold text-slate-600 mb-1 uppercase tracking-wide">
                Email address
              </label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                autoFocus
                required
                placeholder="you@yourclinic.in"
                data-testid="forgot-email"
                className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
              />
              <p className="text-[11px] text-slate-500 mt-1.5">
                Use the email you sign in with. We'll send the reset link there.
              </p>
            </div>

            {err && (
              <div className="text-xs text-red-700 bg-red-50 border border-red-200 rounded px-3 py-2" data-testid="forgot-error">
                {err}
              </div>
            )}

            <button
              type="submit"
              disabled={busy || !email.trim()}
              data-testid="forgot-submit"
              className="w-full py-2.5 bg-blue-600 hover:bg-blue-700 disabled:bg-slate-300 text-white font-semibold text-sm rounded-lg shadow-md transition-colors inline-flex items-center justify-center gap-2"
            >
              {busy ? <><Loader2 size={14} className="animate-spin" /> Sending…</> : 'Send reset link'}
            </button>

            <div className="pt-2 border-t border-slate-100 mt-2">
              <Link
                to="/login"
                data-testid="back-to-login"
                className="text-[12px] font-semibold text-slate-600 hover:text-blue-700 inline-flex items-center gap-1"
              >
                <ArrowLeft size={12} /> Back to sign in
              </Link>
            </div>

            <div className="text-[11px] text-slate-500 bg-slate-50 border border-slate-200 rounded-md px-3 py-2 leading-relaxed">
              <b className="text-slate-700">Forgot your email/username?</b><br />
              Your sign-in email is the one your clinic registered with AUDINEXA. Ask your clinic owner — they can see staff emails in <i>Settings → Staff</i>.
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
