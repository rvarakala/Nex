/**
 * InviteAcceptPage — public route at /invite/[token]
 *
 * Lifecycle states (from `state` machine):
 *   - 'loading'   : fetching invite metadata from server
 *   - 'invalid'   : 404 / token doesn't exist
 *   - 'used'      : 409 / already accepted
 *   - 'expired'   : 410 / past expires_at
 *   - 'revoked'   : 410 / owner revoked it
 *   - 'ready'     : pending — show the password form
 *   - 'submitting': accepting in progress
 *   - 'success'   : auto-redirected to dashboard after JWT issued
 *   - 'error'     : unexpected server error
 *
 * Once accepted, we drop the JWT into the same localStorage key as the
 * normal login flow ('acs.token') and hard-redirect to /dashboard so the
 * existing AuthContext picks it up cleanly.
 */
import React, { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import axios from 'axios';
import {
  Shield, ShieldCheck, ShieldOff, Eye, EyeOff, Loader2,
  AlertTriangle, KeyRound, ArrowRight, Building2,
} from 'lucide-react';

const BACKEND = process.env.REACT_APP_BACKEND_URL;
const API = `${BACKEND}/api`;

const ROLE_LABELS = {
  clinic_owner: 'Clinic Owner',
  audiologist: 'Audiologist',
  front_desk: 'Front Desk',
  accounts: 'Accounts',
};

export default function InviteAcceptPage() {
  const { token } = useParams();
  const [state, setState] = useState('loading');
  const [info, setInfo] = useState(null);
  const [error, setError] = useState('');
  const [pass1, setPass1] = useState('');
  const [pass2, setPass2] = useState('');
  const [show, setShow] = useState(false);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const r = await axios.get(`${API}/public/invitations/${token}`);
        if (!alive) return;
        setInfo(r.data);
        const map = { accepted: 'used', expired: 'expired', revoked: 'revoked', pending: 'ready' };
        setState(map[r.data.status] || 'invalid');
      } catch (ex) {
        if (!alive) return;
        const code = ex?.response?.status;
        if (code === 404) setState('invalid');
        else if (code === 410) setState('expired');
        else if (code === 409) setState('used');
        else { setError(ex?.response?.data?.detail || ex.message); setState('error'); }
      }
    })();
    return () => { alive = false; };
  }, [token]);

  const tooShort = pass1.length > 0 && pass1.length < 10;
  const mismatch = pass2.length > 0 && pass1 !== pass2;
  const canSubmit = pass1.length >= 10 && pass1 === pass2 && state === 'ready';

  const onAccept = async (e) => {
    e.preventDefault();
    if (!canSubmit) return;
    setState('submitting'); setError('');
    try {
      const r = await axios.post(
        `${API}/public/invitations/${token}/accept`,
        { password: pass1 },
      );
      // hand the JWT to the existing AuthContext (same key as normal login)
      localStorage.setItem('acs.token', r.data.access_token);
      setState('success');
      // Hard redirect so AuthProvider re-bootstraps cleanly
      setTimeout(() => { window.location.replace('/dashboard'); }, 800);
    } catch (ex) {
      const code = ex?.response?.status;
      if (code === 409) setState('used');
      else if (code === 410) setState('expired');
      else { setError(ex?.response?.data?.detail || ex.message); setState('ready'); }
    }
  };

  /* ---------------------- render switchboard ---------------------- */

  if (state === 'loading') return <Shell><LoadingState /></Shell>;
  if (state === 'success') return <Shell><SuccessState /></Shell>;

  if (state === 'invalid' || state === 'used' || state === 'expired' || state === 'revoked') {
    const messages = {
      invalid: 'This invitation link is not valid. Ask your clinic owner to send a new one.',
      used: 'This invitation has already been used. If you can\'t sign in, ask your clinic owner to invite you again.',
      expired: `This invitation expired on ${info ? new Date(info.expires_at).toLocaleDateString() : '—'}. Ask your clinic owner to send a new one.`,
      revoked: 'This invitation was cancelled by your clinic owner.',
    };
    return <Shell><ErrorState title="Cannot use this invitation" body={messages[state]} /></Shell>;
  }

  return (
    <Shell>
      <header className="text-center">
        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-bold uppercase tracking-wider bg-emerald-100 text-emerald-700">
          <ShieldCheck size={12} /> Secure invitation
        </span>
        <h1 className="mt-3 font-[Manrope,Inter,sans-serif] font-extrabold text-2xl sm:text-[28px] text-slate-900 tracking-tight">
          Welcome, {info.name.split(' ')[0]} 👋
        </h1>
        <p className="mt-2 text-[13.5px] text-slate-600 leading-relaxed">
          You&apos;ve been invited to join <strong className="text-slate-900">{info.clinic_name}</strong>{' '}
          on AUDINEXA as <strong className="text-slate-900">{ROLE_LABELS[info.role] || info.role}</strong>.
        </p>
      </header>

      <ul className="mt-5 rounded-xl bg-slate-50 border border-slate-100 p-4 space-y-2 text-[13px]">
        <li className="flex items-center gap-2.5 text-slate-700">
          <Building2 size={14} className="text-[#0B5FFF]" /><span className="font-semibold">{info.clinic_name}</span>
        </li>
        <li className="flex items-center gap-2.5 text-slate-700">
          <KeyRound size={14} className="text-[#0B5FFF]" /><span>{info.email}</span>
        </li>
      </ul>

      <form onSubmit={onAccept} className="mt-5 space-y-3" data-testid="invite-accept-form">
        <Field label="Choose your password" hint="Minimum 10 characters. You'll use this to sign in.">
          <PasswordInput value={pass1} onChange={setPass1} show={show} setShow={setShow} testid="invite-pass1" autoFocus />
        </Field>
        {tooShort && <Hint kind="warn">Use at least 10 characters.</Hint>}
        <Field label="Confirm password">
          <PasswordInput value={pass2} onChange={setPass2} show={show} setShow={setShow} testid="invite-pass2" />
        </Field>
        {mismatch && <Hint kind="warn">Passwords don&apos;t match.</Hint>}
        {error && <Hint kind="err">{error}</Hint>}

        <button
          type="submit"
          disabled={!canSubmit || state === 'submitting'}
          data-testid="invite-submit"
          className="w-full inline-flex items-center justify-center gap-2 bg-[#0B5FFF] hover:bg-[#094acf] disabled:bg-slate-300 text-white py-3 rounded-xl font-semibold shadow-md shadow-[#0B5FFF]/25 transition"
        >
          {state === 'submitting'
            ? <><Loader2 size={16} className="animate-spin" /> Creating your account…</>
            : <>Accept &amp; sign in <ArrowRight size={16} /></>}
        </button>
      </form>

      <p className="mt-5 text-center text-[11.5px] text-slate-500">
        By accepting, you agree to AUDINEXA&apos;s Terms &amp; Privacy. This invitation expires on{' '}
        <strong className="text-slate-700">{new Date(info.expires_at).toLocaleDateString()}</strong>.
      </p>
    </Shell>
  );
}

/* ============================ States ============================ */

function LoadingState() {
  return (
    <div className="text-center py-12" data-testid="invite-loading">
      <Loader2 size={28} className="mx-auto text-[#0B5FFF] animate-spin" />
      <p className="mt-3 text-[13.5px] text-slate-500">Verifying your invitation…</p>
    </div>
  );
}

function SuccessState() {
  return (
    <div className="text-center py-10" data-testid="invite-success">
      <span className="inline-flex w-14 h-14 rounded-full bg-emerald-100 text-emerald-700 items-center justify-center">
        <ShieldCheck size={28} />
      </span>
      <h2 className="mt-4 font-[Manrope,Inter,sans-serif] font-extrabold text-xl text-slate-900">You&apos;re in!</h2>
      <p className="mt-1.5 text-[13px] text-slate-500">Redirecting to your dashboard…</p>
    </div>
  );
}

function ErrorState({ title, body }) {
  return (
    <div className="text-center py-8" data-testid="invite-error">
      <span className="inline-flex w-14 h-14 rounded-full bg-rose-100 text-rose-600 items-center justify-center">
        <ShieldOff size={26} />
      </span>
      <h2 className="mt-4 font-[Manrope,Inter,sans-serif] font-extrabold text-lg text-slate-900">{title}</h2>
      <p className="mt-1.5 text-[13px] text-slate-600 leading-relaxed max-w-sm mx-auto">{body}</p>
      <a
        href="/login"
        className="mt-5 inline-flex items-center gap-2 text-[#0B5FFF] hover:text-[#094acf] font-semibold text-[13px]"
      >
        Go to sign-in page <ArrowRight size={14} />
      </a>
    </div>
  );
}

/* ============================ Shared UI ============================ */

function Shell({ children }) {
  return (
    <div className="min-h-screen flex items-center justify-center p-4 bg-gradient-to-br from-slate-50 via-blue-50/30 to-emerald-50/30" data-testid="invite-page">
      <div className="w-full max-w-md bg-white rounded-2xl shadow-xl border border-slate-100 p-6 sm:p-8">
        <div className="flex items-center gap-2 justify-center mb-4">
          <span className="w-9 h-9 rounded-xl bg-gradient-to-br from-[#0B5FFF] to-[#00C2A8] flex items-center justify-center shadow-md">
            <Shield size={17} className="text-white" />
          </span>
          <span className="font-[Manrope,Inter,sans-serif] font-extrabold text-lg tracking-tight text-slate-900">AUDINEXA</span>
        </div>
        {children}
      </div>
    </div>
  );
}

function Field({ label, hint, children }) {
  return (
    <label className="block">
      <span className="block text-[12px] uppercase tracking-wider font-bold text-slate-500 mb-1.5">{label}</span>
      {children}
      {hint && <span className="block text-[11.5px] text-slate-500 mt-1">{hint}</span>}
    </label>
  );
}

function PasswordInput({ value, onChange, show, setShow, testid, autoFocus }) {
  return (
    <div className="relative">
      <input
        autoFocus={autoFocus}
        type={show ? 'text' : 'password'}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        data-testid={testid}
        className="w-full rounded-xl border border-slate-200 px-4 py-3 pr-11 font-mono tracking-wider focus:ring-4 focus:ring-blue-100 focus:border-[#0B5FFF] outline-none transition"
        autoComplete="new-password"
      />
      <button
        type="button"
        onClick={() => setShow((s) => !s)}
        className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
        aria-label={show ? 'Hide password' : 'Show password'}
      >
        {show ? <EyeOff size={16} /> : <Eye size={16} />}
      </button>
    </div>
  );
}

function Hint({ kind, children }) {
  const map = {
    warn: 'bg-amber-50 border-amber-200 text-amber-800',
    err:  'bg-rose-50 border-rose-200 text-rose-800',
  };
  return (
    <div className={`text-[12.5px] rounded-lg border px-3 py-2 flex items-start gap-2 ${map[kind] || ''}`}>
      <AlertTriangle size={13} className="mt-0.5 shrink-0" /> <span>{children}</span>
    </div>
  );
}
