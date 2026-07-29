import React, { useState, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../AuthContext';
import OpenInAppLink from '../connectivity/OpenInAppLink';
import DeviceLimitModal from '../components/DeviceLimitModal';

export default function LoginPage() {
  const { user, login, loginVerifyMfa } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);

  // ── 2FA step state ──
  const [mfaToken, setMfaToken] = useState(null);   // when set, render the OTP form
  const [mfaCode, setMfaCode] = useState('');
  const [useRecovery, setUseRecovery] = useState(false);

  // ── Device-limit modal state ──
  // When the server returns 409 DEVICE_LIMIT_EXCEEDED, we surface a picker
  // so the user chooses which of their existing devices to sign out. The
  // retry then goes through the same code path with `replace_session_id`.
  const [deviceLimit, setDeviceLimit] = useState(null); // {cap, count, devices, path: 'login'|'mfa'}
  const [kickingSid, setKickingSid] = useState(null);

const roleHome = (role) => {
  if (['founder', 'super_admin', 'sales_manager', 'support_agent', 'finance_manager', 'product_ops', 'read_only'].includes(role)) return '/admin/dashboard';
  if (role === 'referral_partner') return '/partner';
  if (role === 'audiologist') return '/test';
  return '/patients';
};

  // Redirect if already authenticated (page reload scenario)
  useEffect(() => {
    if (user) {
      navigate(roleHome(user.role), { replace: true });
    }
  }, [user, navigate]);

  const submit = async (e) => {
    e?.preventDefault();
    setBusy(true); setErr(null);
    try {
      const u = await login(email.trim(), password);
      if (u && u.requiresMfa) {
        setMfaToken(u.mfaToken);
        return;
      }
      navigate(roleHome(u.role), { replace: true });
    } catch (ex) {
      // Email verification gate — hard-block redirect to /verify-email
      if (ex?.emailNotVerified) {
        navigate(`/verify-email?email=${encodeURIComponent(ex.email || email)}`, { replace: true });
        return;
      }
      // Device-limit — show the picker modal.
      if (ex?.deviceLimitExceeded) {
        setDeviceLimit({
          cap: ex.cap, count: ex.count, devices: ex.devices, path: 'login',
        });
        return;
      }
      const d = ex?.response?.data?.detail;
      setErr(typeof d === 'string' ? d : (ex?.message || 'Login failed'));
    } finally {
      setBusy(false);
    }
  };

  const submitMfa = async (e) => {
    e?.preventDefault();
    setBusy(true); setErr(null);
    try {
      const u = await loginVerifyMfa(mfaToken, mfaCode.trim(), useRecovery);
      navigate(roleHome(u.role), { replace: true });
    } catch (ex) {
      if (ex?.deviceLimitExceeded) {
        setDeviceLimit({
          cap: ex.cap, count: ex.count, devices: ex.devices, path: 'mfa',
        });
        return;
      }
      const d = ex?.response?.data?.detail;
      setErr(typeof d === 'string' ? d : (ex?.message || 'Invalid code'));
    } finally {
      setBusy(false);
    }
  };

  // Handler invoked by DeviceLimitModal when the user picks a device to kick.
  // We retry the ORIGINAL login (or MFA) path with `replaceSessionId` set.
  const handleDeviceLimitPick = async (sessionId) => {
    setKickingSid(sessionId); setErr(null);
    try {
      let u;
      if (deviceLimit?.path === 'mfa') {
        u = await loginVerifyMfa(mfaToken, mfaCode.trim(), useRecovery, { replaceSessionId: sessionId });
      } else {
        u = await login(email.trim(), password, { replaceSessionId: sessionId });
        if (u && u.requiresMfa) {
          setMfaToken(u.mfaToken);
          setDeviceLimit(null);
          return;
        }
      }
      navigate(roleHome(u.role), { replace: true });
    } catch (ex) {
      if (ex?.deviceLimitExceeded) {
        // Server rejected the replace (session was already revoked etc)
        // — refresh the modal with the fresh device list.
        setDeviceLimit({
          cap: ex.cap, count: ex.count, devices: ex.devices,
          path: deviceLimit?.path || 'login',
        });
      } else {
        const d = ex?.response?.data?.detail;
        setErr(typeof d === 'string' ? d : (ex?.message || 'Sign out failed'));
        setDeviceLimit(null);
      }
    } finally {
      setKickingSid(null);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        {/* Logo / Brand */}
        <div className="text-center mb-6">
          <div className="inline-flex items-center justify-center w-14 h-14 rounded-xl bg-gradient-to-br from-blue-500 to-blue-700 shadow-lg mb-3">
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M3 12 A9 9 0 0 1 21 12 V17 A3 3 0 0 1 18 20 H17 V13 H21" />
              <path d="M3 12 V17 A3 3 0 0 0 6 20 H7 V13 H3" />
            </svg>
          </div>
          <h1 className="text-2xl font-bold text-white tracking-tight">ACS Clinic Suite</h1>
          <p className="text-sm text-slate-400 mt-1">Audiology practice management · India</p>
        </div>

        <form onSubmit={mfaToken ? submitMfa : submit} className="bg-white rounded-xl shadow-2xl p-6 space-y-4" data-testid="login-form">
          {mfaToken ? (
            <>
              <div>
                <div className="text-[11px] font-semibold text-slate-600 uppercase tracking-wide mb-2">
                  Two-factor authentication
                </div>
                <p className="text-[12.5px] text-slate-600">
                  Enter the 6-digit code from your authenticator app.
                </p>
              </div>
              <div>
                <input
                  type="text"
                  inputMode={useRecovery ? 'text' : 'numeric'}
                  value={mfaCode}
                  onChange={(e) => setMfaCode(
                    useRecovery
                      ? e.target.value.replace(/\s/g, '').slice(0, 12).toUpperCase()
                      : e.target.value.replace(/\D/g, '').slice(0, 6)
                  )}
                  autoFocus
                  maxLength={useRecovery ? 12 : 6}
                  placeholder={useRecovery ? 'Recovery code (e.g. M6TJ8QT36D)' : '123 456'}
                  data-testid="login-mfa-code"
                  className="w-full px-3 py-3 text-lg font-mono tracking-widest text-center border border-slate-300 rounded-lg focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
                />
              </div>

              {err && (
                <div className="text-xs text-red-700 bg-red-50 border border-red-200 rounded px-3 py-2" data-testid="login-error">{err}</div>
              )}

              <button
                type="submit"
                disabled={busy || mfaCode.length < (useRecovery ? 8 : 6)}
                data-testid="login-mfa-submit"
                className="w-full py-2.5 bg-blue-600 hover:bg-blue-700 disabled:bg-slate-300 text-white font-semibold text-sm rounded-lg shadow-md transition-colors"
              >
                {busy ? 'Verifying…' : 'Verify and sign in'}
              </button>

              <div className="text-center text-[12px]">
                <button
                  type="button"
                  onClick={() => { setUseRecovery(!useRecovery); setMfaCode(''); setErr(null); }}
                  data-testid="login-mfa-toggle-recovery"
                  className="text-blue-600 hover:text-blue-800 hover:underline"
                >
                  {useRecovery ? 'Use authenticator code instead' : 'Use a recovery code instead'}
                </button>
              </div>
              <div className="text-center text-[11px] text-slate-500">
                <button
                  type="button"
                  onClick={() => { setMfaToken(null); setMfaCode(''); setErr(null); setUseRecovery(false); }}
                  className="text-slate-500 hover:text-slate-700 hover:underline"
                >
                  ← Back to sign-in
                </button>
              </div>
            </>
          ) : (
            <>
          <div>
            <label className="block text-[11px] font-semibold text-slate-600 mb-1 uppercase tracking-wide">Email</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoFocus
              required
              data-testid="login-email"
              className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
            />
          </div>
          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="block text-[11px] font-semibold text-slate-600 uppercase tracking-wide">Password</label>
              <Link
                to="/forgot-password"
                data-testid="login-forgot-link"
                className="text-[11px] font-semibold text-blue-600 hover:text-blue-800 hover:underline"
              >
                Forgot password?
              </Link>
            </div>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              data-testid="login-password"
              className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
            />
          </div>

          {err && (
            <div className="text-xs text-red-700 bg-red-50 border border-red-200 rounded px-3 py-2" data-testid="login-error">{err}</div>
          )}

          <button
            type="submit"
            disabled={busy}
            data-testid="login-submit"
            className="w-full py-2.5 bg-blue-600 hover:bg-blue-700 disabled:bg-slate-300 text-white font-semibold text-sm rounded-lg shadow-md transition-colors"
          >
            {busy ? 'Signing in…' : 'Sign in'}
          </button>

          <p className="text-center text-[11px] text-slate-500 pt-1" data-testid="login-forgot-username-hint">
            Forgot your email? Ask your clinic owner — they can see staff emails in <i>Settings → Staff</i>.
          </p>
            </>
          )}
        </form>

        <div className="text-center mt-4 text-[10px] text-slate-500 flex items-center justify-center gap-2">
          <span>v0.1 MVP · ACS Labs · Mumbai</span>
          <span className="text-slate-700" aria-hidden="true">·</span>
          <OpenInAppLink />
        </div>
      </div>

      {deviceLimit && (
        <DeviceLimitModal
          devices={deviceLimit.devices}
          cap={deviceLimit.cap}
          count={deviceLimit.count}
          busySid={kickingSid}
          onPick={handleDeviceLimitPick}
          onCancel={() => setDeviceLimit(null)}
        />
      )}
    </div>
  );
}
