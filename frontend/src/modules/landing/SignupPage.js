/**
 * Public clinic self-signup — 2-step form that creates clinic+owner and
 * auto-logs the user in, landing them on the Front Desk module with a
 * 30-day Premium trial banner.
 */
import React, { useState } from 'react';
import axios from 'axios';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../AuthContext';

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;

export default function SignupPage() {
  const [step, setStep] = useState(1);
  const [clinicName, setClinicName] = useState('');
  const [city, setCity] = useState('');
  const [state, setState] = useState('');
  const [phone, setPhone] = useState('');
  const [ownerName, setOwnerName] = useState('');
  const [ownerEmail, setOwnerEmail] = useState('');
  const [ownerPassword, setOwnerPassword] = useState('');
  const [companyUrl, setCompanyUrl] = useState(''); // honeypot
  const [agree, setAgree] = useState(false);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const { loginWithToken } = useAuth();
  const navigate = useNavigate();

  const canNext1 = clinicName.trim().length >= 2 && city.trim().length > 0;
  const canSubmit = ownerName.trim().length >= 2
    && /\S+@\S+\.\S+/.test(ownerEmail)
    && ownerPassword.length >= 8
    && agree;

  const submit = async (e) => {
    e.preventDefault();
    if (!canSubmit) return;
    setErr(''); setBusy(true);
    try {
      const r = await axios.post(`${API}/public/clinic-signup`, {
        clinic_name: clinicName, city, state, phone,
        owner_name: ownerName, owner_email: ownerEmail,
        owner_password: ownerPassword, company_url: companyUrl,
      });
      // Auto-login by seeding the token + user into AuthContext
      if (loginWithToken) {
        await loginWithToken(r.data.access_token);
      } else {
        // Fallback: persist and hard-reload
        localStorage.setItem('acs_token', r.data.access_token);
      }
      navigate('/patients', { replace: true });
    } catch (e) {
      const d = e?.response?.data?.detail;
      setErr(typeof d === 'string' ? d : (Array.isArray(d) ? d[0]?.msg : null) || 'Signup failed');
    } finally { setBusy(false); }
  };

  return (
    <div className="min-h-screen bg-slate-950 text-white flex items-center justify-center p-6" data-testid="signup-page">
      <div className="max-w-md w-full">
        <div className="mb-6">
          <a href="/" className="inline-flex items-center gap-2 text-slate-400 hover:text-white text-sm">
            <span className="w-7 h-7 bg-gradient-to-br from-orange-500 to-rose-600 rounded flex items-center justify-center font-black text-xs">A</span>
            AUDINEXA
          </a>
        </div>

        <h1 className="text-3xl font-black mb-1">Start your free trial</h1>
        <p className="text-sm text-slate-400 mb-6">
          30-day Premium trial · no card required · cancel anytime.
        </p>

        <form onSubmit={submit} className="bg-slate-900 border border-slate-800 rounded-lg p-6 space-y-4">
          {/* Honeypot — hidden from real users */}
          <input type="text" value={companyUrl} onChange={(e) => setCompanyUrl(e.target.value)}
                 tabIndex={-1} autoComplete="off" style={{ position: 'absolute', left: '-9999px' }} />

          {/* Stepper */}
          <div className="flex gap-2 mb-2">
            {[1, 2].map(n => (
              <div key={n} className={`flex-1 h-1 rounded ${step >= n ? 'bg-orange-500' : 'bg-slate-800'}`} />
            ))}
          </div>

          {step === 1 && (
            <>
              <div className="text-[11px] uppercase tracking-widest text-orange-400 font-bold mb-1">Step 1 · Your clinic</div>
              <Field label="Clinic name" required>
                <input type="text" required value={clinicName}
                       onChange={(e) => setClinicName(e.target.value)}
                       data-testid="signup-clinic-name"
                       placeholder="Dr. Sharma's Hearing Care"
                       className="w-full bg-slate-800 border border-slate-700 rounded px-3 py-2 text-sm focus:border-orange-500 outline-none" />
              </Field>
              <div className="grid grid-cols-2 gap-3">
                <Field label="City" required>
                  <input type="text" required value={city}
                         onChange={(e) => setCity(e.target.value)}
                         data-testid="signup-city"
                         placeholder="Mumbai"
                         className="w-full bg-slate-800 border border-slate-700 rounded px-3 py-2 text-sm focus:border-orange-500 outline-none" />
                </Field>
                <Field label="State">
                  <input type="text" value={state}
                         onChange={(e) => setState(e.target.value)}
                         data-testid="signup-state"
                         placeholder="Maharashtra"
                         className="w-full bg-slate-800 border border-slate-700 rounded px-3 py-2 text-sm focus:border-orange-500 outline-none" />
                </Field>
              </div>
              <Field label="Clinic phone (optional)">
                <input type="tel" value={phone}
                       onChange={(e) => setPhone(e.target.value)}
                       data-testid="signup-phone"
                       placeholder="+91 98765 43210"
                       className="w-full bg-slate-800 border border-slate-700 rounded px-3 py-2 text-sm focus:border-orange-500 outline-none" />
              </Field>
              <button type="button" onClick={() => setStep(2)} disabled={!canNext1}
                      data-testid="signup-step1-next"
                      className="w-full bg-orange-500 hover:bg-orange-600 disabled:bg-slate-700 disabled:text-slate-500 text-white font-bold py-2.5 rounded transition">
                Next — owner details →
              </button>
            </>
          )}

          {step === 2 && (
            <>
              <button type="button" onClick={() => setStep(1)} className="text-[11px] text-slate-400 hover:text-white mb-1">
                ← back
              </button>
              <div className="text-[11px] uppercase tracking-widest text-orange-400 font-bold mb-1">Step 2 · Your account</div>
              <Field label="Your full name" required>
                <input type="text" required value={ownerName}
                       onChange={(e) => setOwnerName(e.target.value)}
                       data-testid="signup-owner-name"
                       placeholder="Dr. Ravi Sharma"
                       className="w-full bg-slate-800 border border-slate-700 rounded px-3 py-2 text-sm focus:border-orange-500 outline-none" />
              </Field>
              <Field label="Work email" required>
                <input type="email" required value={ownerEmail}
                       onChange={(e) => setOwnerEmail(e.target.value)}
                       data-testid="signup-owner-email"
                       placeholder="ravi@drsharma.in"
                       autoComplete="email"
                       className="w-full bg-slate-800 border border-slate-700 rounded px-3 py-2 text-sm focus:border-orange-500 outline-none" />
              </Field>
              <Field label="Choose a password" required hint="Minimum 8 characters">
                <input type="password" required value={ownerPassword}
                       onChange={(e) => setOwnerPassword(e.target.value)}
                       data-testid="signup-owner-password"
                       placeholder="••••••••"
                       autoComplete="new-password"
                       className="w-full bg-slate-800 border border-slate-700 rounded px-3 py-2 text-sm focus:border-orange-500 outline-none" />
              </Field>
              <label className="flex items-start gap-2 text-xs text-slate-400 cursor-pointer">
                <input type="checkbox" checked={agree}
                       onChange={(e) => setAgree(e.target.checked)}
                       data-testid="signup-agree"
                       className="mt-0.5" />
                <span>I agree to start a 30-day Premium trial. My clinic will continue on the Basic plan after the trial — no card required.</span>
              </label>
              {err && <div className="bg-rose-500/10 text-rose-300 text-xs p-2 rounded" data-testid="signup-err">{err}</div>}
              <button type="submit" disabled={!canSubmit || busy}
                      data-testid="signup-submit"
                      className="w-full bg-gradient-to-r from-orange-500 to-rose-600 hover:from-orange-600 hover:to-rose-700 disabled:from-slate-700 disabled:to-slate-800 disabled:text-slate-500 text-white font-bold py-2.5 rounded transition">
                {busy ? 'Creating your clinic…' : 'Start free trial →'}
              </button>
            </>
          )}
        </form>

        <div className="text-center text-xs text-slate-500 mt-6">
          Already have a clinic? <a href="/login" className="text-orange-400 hover:underline">Sign in</a>
        </div>
      </div>
    </div>
  );
}

function Field({ label, required, hint, children }) {
  return (
    <label className="block">
      <span className="block text-[10px] uppercase tracking-wider text-slate-400 font-semibold mb-1">
        {label} {required && <span className="text-orange-400">*</span>}
        {hint && <span className="ml-1 text-slate-500 normal-case font-normal">· {hint}</span>}
      </span>
      {children}
    </label>
  );
}
