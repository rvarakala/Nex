/**
 * Email verification page — 6-digit OTP + magic-link auto-verify.
 *
 * Reachable at `/verify-email?email=<addr>&code=<6digit>&fresh=1`
 *   - `email`  — prefills the email field (from signup redirect or login 403)
 *   - `code`   — magic-link auto-verify (from the email button)
 *   - `fresh=1` — cosmetic "we just sent this" copy for post-signup arrivals
 *
 * Flow:
 *   1. If URL has `code`, POST /api/auth/verify-email immediately and
 *      auto-navigate on success.
 *   2. Otherwise show a 6-digit input + resend button (60s cooldown).
 *   3. On success, seed the returned access_token into AuthContext and
 *      navigate to /patients (Front Desk).
 *
 * Matches the LandingPageV3 "Modern Clinical OS" palette so the
 * pre-login journey feels one continuous brand.
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import axios from 'axios';
import { useNavigate, useSearchParams, Link } from 'react-router-dom';
import { Mail, Loader2, RefreshCw, CheckCircle2, ArrowRight, AlertTriangle } from 'lucide-react';
import { useAuth } from '../../AuthContext';

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;

const C = {
  bone: '#FDFBF7', ink: '#1A1C23', ink2: '#4A4D57',
  saffron: '#D95D39', saffronHover: '#B84A2A',
  border: '#E2DFD8', surface: '#F3F1EC', emerald: '#059669',
};
const F = {
  display: '"Cabinet Grotesk", "Inter", sans-serif',
  body: '"IBM Plex Sans", sans-serif',
  mono: '"IBM Plex Mono", ui-monospace, monospace',
};

const RESEND_COOLDOWN_S = 60;

function useFonts() {
  useEffect(() => {
    if (document.getElementById('audinexa-landing-fonts')) return;
    const l1 = document.createElement('link');
    l1.id = 'audinexa-landing-fonts';
    l1.rel = 'stylesheet';
    l1.href = 'https://api.fontshare.com/v2/css?f[]=cabinet-grotesk@700,800,500,300&display=swap';
    document.head.appendChild(l1);
    const l2 = document.createElement('link');
    l2.rel = 'stylesheet';
    l2.href = 'https://fonts.googleapis.com/css2?family=IBM+Plex+Sans:wght@400;500;600&family=IBM+Plex+Mono:wght@500;600&display=swap';
    document.head.appendChild(l2);
    document.body.style.background = C.bone;
    return () => { document.body.style.background = ''; };
  }, []);
}

// 6 individual digit boxes — auto-advance, paste-friendly, mobile-numeric
function OtpInput({ value, onChange, disabled }) {
  const refs = useRef([]);
  useEffect(() => { refs.current[0]?.focus(); }, []);

  const handle = (i, v) => {
    const digit = v.replace(/\D/g, '').slice(-1);
    const next = value.split('');
    next[i] = digit;
    const joined = next.join('').padEnd(6, '').slice(0, 6);
    onChange(joined);
    if (digit && i < 5) refs.current[i + 1]?.focus();
  };
  const handleKey = (i, e) => {
    if (e.key === 'Backspace' && !value[i] && i > 0) refs.current[i - 1]?.focus();
    if (e.key === 'ArrowLeft' && i > 0) refs.current[i - 1]?.focus();
    if (e.key === 'ArrowRight' && i < 5) refs.current[i + 1]?.focus();
  };
  const handlePaste = (e) => {
    e.preventDefault();
    const pasted = (e.clipboardData.getData('text') || '').replace(/\D/g, '').slice(0, 6);
    if (!pasted) return;
    onChange(pasted.padEnd(6, ''));
    refs.current[Math.min(pasted.length, 5)]?.focus();
  };

  return (
    <div className="flex gap-2 justify-center" onPaste={handlePaste} data-testid="otp-input-group">
      {[0, 1, 2, 3, 4, 5].map((i) => (
        <input
          key={i}
          ref={(el) => (refs.current[i] = el)}
          type="text"
          inputMode="numeric"
          maxLength={1}
          value={value[i] || ''}
          onChange={(e) => handle(i, e.target.value)}
          onKeyDown={(e) => handleKey(i, e)}
          disabled={disabled}
          data-testid={`otp-digit-${i}`}
          className="w-12 h-14 text-center text-2xl font-extrabold rounded-lg border focus:outline-none focus:ring-2 disabled:opacity-50 tabular-nums"
          style={{
            borderColor: value[i] ? C.saffron : C.border,
            fontFamily: F.display,
            color: C.ink,
            background: 'white',
          }}
        />
      ))}
    </div>
  );
}

export default function VerifyEmailPage() {
  useFonts();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const { loginWithToken } = useAuth();

  const [email, setEmail] = useState(params.get('email') || '');
  const [code, setCode] = useState(params.get('code') || '');
  const [status, setStatus] = useState('idle');   // idle | verifying | ok | error
  const [errMsg, setErrMsg] = useState('');
  const [okMsg, setOkMsg] = useState('');
  const [resendCooldown, setResendCooldown] = useState(0);
  const [resending, setResending] = useState(false);
  const [showSpamNudge, setShowSpamNudge] = useState(false);
  const isFresh = params.get('fresh') === '1';

  const handleVerify = useCallback(async (codeArg) => {
    const submitCode = codeArg || code;
    if (!email || submitCode.length !== 6) return;
    setStatus('verifying'); setErrMsg('');
    try {
      const r = await axios.post(`${API}/auth/verify-email`, { email, code: submitCode });
      setStatus('ok');
      setOkMsg('Verified — signing you in…');
      // Seed session and land on Front Desk
      if (loginWithToken && r.data?.access_token) {
        await loginWithToken(r.data.access_token);
      }
      setTimeout(() => navigate('/patients', { replace: true }), 800);
    } catch (e) {
      setStatus('error');
      const d = e?.response?.data?.detail;
      const msg = typeof d === 'string' ? d
        : (Array.isArray(d) ? d[0]?.msg : null) || 'Verification failed';
      setErrMsg(msg);
    }
  }, [email, code, loginWithToken, navigate]);

  // Auto-verify when magic-link params are present
  useEffect(() => {
    const p_email = params.get('email');
    const p_code = params.get('code');
    if (p_email && p_code && p_code.length === 6 && status === 'idle') {
      handleVerify(p_code);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Start a resend cooldown when arriving fresh from signup
  useEffect(() => {
    if (isFresh) setResendCooldown(RESEND_COOLDOWN_S);
  }, [isFresh]);

  // Cooldown countdown
  useEffect(() => {
    if (resendCooldown <= 0) return () => {};
    const t = setInterval(() => setResendCooldown((s) => s - 1), 1000);
    return () => clearInterval(t);
  }, [resendCooldown]);

  // Spam-check nudge — surfaces after 15s if the user is still on this page.
  // Prevents abandonment when the email lands in Promotions/Spam or Resend
  // is a beat slow.
  useEffect(() => {
    if (status === 'ok') return () => {};
    const t = setTimeout(() => setShowSpamNudge(true), 15_000);
    return () => clearTimeout(t);
  }, [status]);

  const handleResend = async () => {
    if (!email || resendCooldown > 0 || resending) return;
    setResending(true); setErrMsg('');
    try {
      await axios.post(`${API}/auth/resend-verification`, { email });
      setOkMsg(`New code sent to ${email}. Check your inbox (and spam).`);
      setResendCooldown(RESEND_COOLDOWN_S);
    } catch (e) {
      setErrMsg('Could not resend — please try again in a moment.');
    } finally { setResending(false); }
  };

  return (
    <div className="min-h-screen flex items-center justify-center p-6" style={{ background: C.bone, fontFamily: F.body, color: C.ink }} data-testid="verify-email-page">
      <div className="max-w-md w-full">
        <Link to="/" className="inline-flex items-center gap-2 mb-8" data-testid="verify-home-link">
          <span className="inline-flex w-8 h-8 rounded-lg items-center justify-center font-black" style={{ background: C.saffron, color: 'white', fontFamily: F.display }}>A</span>
          <span className="text-xl font-extrabold" style={{ fontFamily: F.display, color: C.ink, letterSpacing: '-0.03em' }}>audinexa</span>
        </Link>

        <div className="rounded-2xl border p-8 bg-white" style={{ borderColor: C.border, boxShadow: '0 24px 60px -30px rgba(217,93,57,0.35)' }}>
          {status === 'ok' ? (
            <div className="text-center py-8" data-testid="verify-success">
              <div className="inline-flex w-16 h-16 rounded-full items-center justify-center" style={{ background: '#DCFCE7' }}>
                <CheckCircle2 className="w-9 h-9" style={{ color: C.emerald }} strokeWidth={2.5} />
              </div>
              <h1 className="mt-5 text-3xl font-extrabold" style={{ fontFamily: F.display, letterSpacing: '-0.03em' }}>All set!</h1>
              <p className="mt-2 text-[color:var(--ink2)]" style={{ color: C.ink2 }}>{okMsg || 'Verified — signing you in…'}</p>
              <div className="mt-4">
                <Loader2 className="w-5 h-5 animate-spin inline" style={{ color: C.saffron }} />
              </div>
            </div>
          ) : (
            <>
              <div className="inline-flex w-12 h-12 rounded-lg items-center justify-center" style={{ background: '#FEF0EA' }}>
                <Mail className="w-6 h-6" style={{ color: C.saffron }} strokeWidth={2.2} />
              </div>
              <h1 className="mt-5 text-3xl font-extrabold" style={{ fontFamily: F.display, letterSpacing: '-0.03em' }}>
                Check your email
              </h1>
              <p className="mt-2 text-[15px]" style={{ color: C.ink2 }}>
                {isFresh
                  ? <>We sent a 6-digit code to <strong style={{ color: C.ink }}>{email || 'your email'}</strong> — enter it below to activate your 30-day Premium trial.</>
                  : <>Enter the 6-digit code we sent to <strong style={{ color: C.ink }}>{email || 'your email'}</strong>.</>}
              </p>

              {!params.get('email') && (
                <div className="mt-6">
                  <label className="block text-[10px] uppercase tracking-widest font-semibold mb-1.5" style={{ fontFamily: F.mono, color: C.ink2 }}>Email</label>
                  <input
                    type="email" value={email} onChange={(e) => setEmail(e.target.value)}
                    className="w-full px-3 py-2.5 rounded-lg border focus:outline-none focus:ring-2 focus:border-[color:var(--saffron)]"
                    style={{ borderColor: C.border, fontFamily: F.body }}
                    placeholder="you@clinic.com"
                    data-testid="verify-email-input"
                  />
                </div>
              )}

              <div className="mt-7">
                <label className="block text-center text-[10px] uppercase tracking-widest font-semibold mb-3" style={{ fontFamily: F.mono, color: C.ink2 }}>
                  Verification code
                </label>
                <OtpInput value={code} onChange={setCode} disabled={status === 'verifying'} />
              </div>

              {errMsg && (
                <div className="mt-4 flex items-start gap-2 rounded-lg px-3 py-2.5 text-sm" style={{ background: '#FEF2F2', color: '#B91C1C', fontFamily: F.body }} data-testid="verify-error">
                  <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
                  <span>{errMsg}</span>
                </div>
              )}
              {okMsg && status !== 'ok' && (
                <div className="mt-4 rounded-lg px-3 py-2.5 text-sm" style={{ background: '#DCFCE7', color: C.emerald, fontFamily: F.body }} data-testid="verify-info">
                  {okMsg}
                </div>
              )}

              {showSpamNudge && status === 'idle' && !errMsg && (
                <div
                  data-testid="verify-spam-nudge"
                  className="mt-4 rounded-lg px-3 py-2.5 text-[13px] flex items-start gap-2"
                  style={{ background: '#FEF3E4', color: '#8B4513', fontFamily: F.body }}
                >
                  <span className="text-lg leading-none mt-[-1px]">📬</span>
                  <span>
                    Still nothing? Emails can land in <strong>Spam</strong> or the <strong>Promotions</strong> tab.
                    If you don't see it in 60 seconds, tap <strong>Resend code</strong> below — a fresh code beats the last one.
                  </span>
                </div>
              )}

              <button
                onClick={() => handleVerify()}
                disabled={!email || code.length !== 6 || status === 'verifying'}
                data-testid="verify-submit"
                className="mt-6 w-full inline-flex items-center justify-center gap-2 rounded-full py-3.5 font-semibold text-white transition-transform hover:scale-[1.01] active:scale-[0.99] disabled:opacity-50 disabled:cursor-not-allowed"
                style={{ background: C.saffron, fontFamily: F.display, boxShadow: '0 6px 24px -6px rgba(217,93,57,0.55)' }}
              >
                {status === 'verifying' ? (
                  <><Loader2 className="w-4 h-4 animate-spin" /> Verifying…</>
                ) : (
                  <>Verify & sign in <ArrowRight className="w-4 h-4" strokeWidth={2.5} /></>
                )}
              </button>

              <div className="mt-5 flex items-center justify-between text-sm" style={{ fontFamily: F.body }}>
                <span style={{ color: C.ink2 }}>Didn&rsquo;t get it?</span>
                <button
                  onClick={handleResend}
                  disabled={resendCooldown > 0 || resending || !email}
                  data-testid="verify-resend"
                  className="inline-flex items-center gap-1.5 font-semibold hover:underline disabled:opacity-50 disabled:no-underline"
                  style={{ color: C.saffron }}
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${resending ? 'animate-spin' : ''}`} />
                  {resendCooldown > 0 ? `Resend in ${resendCooldown}s` : 'Resend code'}
                </button>
              </div>
            </>
          )}
        </div>

        <p className="mt-6 text-center text-xs" style={{ color: C.ink2, fontFamily: F.body }}>
          Wrong email? <Link to="/signup" className="font-semibold hover:underline" style={{ color: C.saffron }} data-testid="verify-back-to-signup">Sign up again →</Link>
          &nbsp;·&nbsp;
          Already verified? <Link to="/login" className="font-semibold hover:underline" style={{ color: C.saffron }} data-testid="verify-back-to-login">Sign in →</Link>
        </p>
      </div>
    </div>
  );
}
