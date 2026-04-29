import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../AuthContext';
import OpenInAppLink from '../connectivity/OpenInAppLink';

export default function LoginPage() {
  const { user, login } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);

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
      navigate(roleHome(u.role), { replace: true });
    } catch (ex) {
      const d = ex?.response?.data?.detail;
      setErr(typeof d === 'string' ? d : (ex?.message || 'Login failed'));
    } finally {
      setBusy(false);
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

        <form onSubmit={submit} className="bg-white rounded-xl shadow-2xl p-6 space-y-4" data-testid="login-form">
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
            <label className="block text-[11px] font-semibold text-slate-600 mb-1 uppercase tracking-wide">Password</label>
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
        </form>

        <div className="text-center mt-4 text-[10px] text-slate-500 flex items-center justify-center gap-2">
          <span>v0.1 MVP · ACS Labs · Mumbai</span>
          <span className="text-slate-700" aria-hidden="true">·</span>
          <OpenInAppLink />
        </div>
      </div>
    </div>
  );
}
