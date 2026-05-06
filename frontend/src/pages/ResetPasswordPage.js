/**
 * ResetPasswordPage — public route /reset-password/:token
 *
 * User clicks the link from their email → enters new password (twice) →
 * POST /api/auth/reset-password → success state with "Sign in now" CTA.
 */
import React, { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import axios from 'axios';
import { ArrowLeft, CheckCircle2, Eye, EyeOff, KeyRound, Loader2 } from 'lucide-react';

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;

const STRENGTH_REGEX = {
  letter: /[A-Za-z]/,
  digit: /\d/,
  minLen: 8,
};

function checkStrength(pw) {
  return {
    minLen: pw.length >= STRENGTH_REGEX.minLen,
    letter: STRENGTH_REGEX.letter.test(pw),
    digit: STRENGTH_REGEX.digit.test(pw),
  };
}

export default function ResetPasswordPage() {
  const { token } = useParams();
  const navigate = useNavigate();
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const [done, setDone] = useState(false);
  const [emailReset, setEmailReset] = useState(null);

  const strength = checkStrength(password);
  const allOk = strength.minLen && strength.letter && strength.digit;
  const matches = password.length > 0 && password === confirm;
  const canSubmit = allOk && matches && !busy;

  const submit = async (e) => {
    e.preventDefault();
    if (!canSubmit) return;
    setBusy(true); setErr(null);
    try {
      const r = await axios.post(`${API}/auth/reset-password`, {
        token,
        new_password: password,
      });
      setEmailReset(r.data?.email);
      setDone(true);
    } catch (ex) {
      const d = ex?.response?.data?.detail;
      if (ex?.response?.status === 429) {
        setErr("Too many reset attempts. Please wait 15 minutes and try again.");
      } else {
        setErr(typeof d === 'string' ? d : (ex?.message || 'Something went wrong. Please request a new reset link.'));
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
            <KeyRound size={26} color="white" />
          </div>
          <h1 className="text-2xl font-bold text-white tracking-tight">Choose a new password</h1>
          <p className="text-sm text-slate-400 mt-1">
            {done ? "You're all set." : 'Pick something only you would know.'}
          </p>
        </div>

        {done ? (
          <div className="bg-white rounded-xl shadow-2xl p-7 text-center" data-testid="reset-success">
            <div className="w-14 h-14 mx-auto rounded-full bg-emerald-100 text-emerald-600 flex items-center justify-center mb-3">
              <CheckCircle2 size={28} strokeWidth={2.4} />
            </div>
            <h2 className="text-lg font-bold text-slate-900">Password updated</h2>
            <p className="text-sm text-slate-600 mt-2 leading-relaxed">
              Your password has been reset successfully.
              {emailReset && <> You can now sign in as <b className="text-slate-900">{emailReset}</b>.</>}
            </p>
            <button
              onClick={() => navigate('/login', { replace: true })}
              data-testid="reset-go-login"
              className="mt-6 w-full py-2.5 bg-blue-600 hover:bg-blue-700 text-white font-semibold text-sm rounded-lg shadow-md transition-colors"
            >
              Sign in now
            </button>
          </div>
        ) : (
          <form onSubmit={submit} className="bg-white rounded-xl shadow-2xl p-6 space-y-4" data-testid="reset-form">
            <div>
              <label className="block text-[11px] font-semibold text-slate-600 mb-1 uppercase tracking-wide">
                New password
              </label>
              <div className="relative">
                <input
                  type={show ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  autoFocus
                  required
                  data-testid="reset-password"
                  className="w-full px-3 py-2 pr-9 text-sm border border-slate-300 rounded-lg focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
                />
                <button
                  type="button"
                  onClick={() => setShow((s) => !s)}
                  data-testid="reset-toggle-show"
                  className="absolute right-2.5 top-2.5 text-slate-400 hover:text-slate-700"
                  aria-label={show ? 'Hide password' : 'Show password'}
                >
                  {show ? <EyeOff size={15} /> : <Eye size={15} />}
                </button>
              </div>
              <ul className="mt-2 space-y-0.5 text-[11px]">
                <Rule ok={strength.minLen} text="At least 8 characters" />
                <Rule ok={strength.letter} text="Includes a letter" />
                <Rule ok={strength.digit} text="Includes a number" />
              </ul>
            </div>

            <div>
              <label className="block text-[11px] font-semibold text-slate-600 mb-1 uppercase tracking-wide">
                Confirm new password
              </label>
              <input
                type={show ? 'text' : 'password'}
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                required
                data-testid="reset-confirm"
                className={`w-full px-3 py-2 text-sm border rounded-lg focus:outline-none focus:ring-1 ${
                  confirm.length === 0
                    ? 'border-slate-300 focus:border-blue-500 focus:ring-blue-500'
                    : matches
                    ? 'border-emerald-400 focus:border-emerald-500 focus:ring-emerald-500'
                    : 'border-rose-300 focus:border-rose-500 focus:ring-rose-500'
                }`}
              />
              {confirm.length > 0 && !matches && (
                <p className="text-[11px] text-rose-600 mt-1">Passwords don't match.</p>
              )}
            </div>

            {err && (
              <div className="text-xs text-red-700 bg-red-50 border border-red-200 rounded px-3 py-2" data-testid="reset-error">
                {err}
              </div>
            )}

            <button
              type="submit"
              disabled={!canSubmit}
              data-testid="reset-submit"
              className="w-full py-2.5 bg-blue-600 hover:bg-blue-700 disabled:bg-slate-300 text-white font-semibold text-sm rounded-lg shadow-md transition-colors inline-flex items-center justify-center gap-2"
            >
              {busy ? <><Loader2 size={14} className="animate-spin" /> Updating…</> : 'Reset password'}
            </button>

            <div className="pt-2 border-t border-slate-100 mt-2">
              <Link to="/login" className="text-[12px] font-semibold text-slate-600 hover:text-blue-700 inline-flex items-center gap-1">
                <ArrowLeft size={12} /> Back to sign in
              </Link>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}

function Rule({ ok, text }) {
  return (
    <li className={`flex items-center gap-1.5 ${ok ? 'text-emerald-700' : 'text-slate-500'}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${ok ? 'bg-emerald-500' : 'bg-slate-300'}`} />
      {text}
    </li>
  );
}
