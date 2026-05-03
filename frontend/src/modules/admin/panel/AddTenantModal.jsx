/**
 * AddTenantModal — founder-side manual clinic creation.
 *
 * Two provisioning modes:
 *   1. "Send invitation link"  — creates the clinic + mints a one-time
 *      invite URL. Owner clicks the link, sets their own password.
 *   2. "Set password now"      — creates the clinic + the clinic_owner user
 *      immediately with the provided password. Owner can log in straight
 *      away. Credentials are shown once in the success receipt.
 *
 * Submits to `POST /api/admin/v2/tenants`. Parent (`TenantsPage`) routes
 * the response to <InviteSuccessModal/> (invite mode) or to the direct-
 * credentials receipt via the same success pipe.
 */
import React, { useState } from 'react';
import axios from 'axios';
import { Building2, Plus, AlertTriangle, Send, KeyRound, Eye, EyeOff, RefreshCw } from 'lucide-react';

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;

function generatePassword() {
  // 14-char mix of upper/lower/digits/symbols (easy to read aloud on a call).
  const upper = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  const lower = 'abcdefghijkmnpqrstuvwxyz';
  const digit = '23456789';
  const sym   = '@#$%*';
  const pools = [upper, lower, digit, sym];
  let out = '';
  for (let i = 0; i < 14; i += 1) {
    const pool = pools[i % 4];
    out += pool[Math.floor(Math.random() * pool.length)];
  }
  return out.split('').sort(() => Math.random() - 0.5).join('');
}

export default function AddTenantModal({ onClose, onCreated }) {
  const [mode, setMode] = useState('invite'); // 'invite' | 'direct'
  const [form, setForm] = useState({
    clinic_name: '', owner_name: '', owner_email: '',
    city: '', state: '', phone: '', tier: 'STANDARD', trial_days: 30,
  });
  const [password, setPassword] = useState(generatePassword());
  const [showPw, setShowPw] = useState(true);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const submit = async (e) => {
    e.preventDefault();
    if (!form.clinic_name.trim() || !form.owner_name.trim() || !form.owner_email.trim()) return;
    if (mode === 'direct' && (password || '').length < 8) {
      setErr('Password must be at least 8 characters.');
      return;
    }
    setBusy(true); setErr('');
    try {
      const body = {
        ...form,
        trial_days: parseInt(form.trial_days, 10) || 30,
      };
      if (mode === 'direct') {
        body.initial_password = password;
      }
      const r = await axios.post(`${API}/admin/v2/tenants`, body);
      onCreated(r.data);
    } catch (ex) {
      const d = ex?.response?.data?.detail;
      setErr(typeof d === 'string' ? d : (d?.message || ex?.message || 'Failed to create tenant'));
    } finally { setBusy(false); }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm"
      role="dialog" aria-modal="true"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
      data-testid="add-tenant-modal"
    >
      <div className="w-full max-w-lg bg-white rounded-2xl shadow-xl border border-slate-100 p-5 sm:p-6 max-h-[90vh] overflow-y-auto">
        <div className="flex items-center gap-2 mb-1">
          <span className="w-9 h-9 rounded-xl bg-indigo-100 text-indigo-700 flex items-center justify-center">
            <Building2 size={18} />
          </span>
          <h3 className="text-base font-extrabold text-slate-900 tracking-tight">Add tenant</h3>
        </div>
        <p className="text-[12px] text-slate-500 mb-4">
          Onboard a clinic that didn&apos;t come through the website.
          Pick how to provision the owner&apos;s login below.
        </p>

        {/* Mode picker — two side-by-side cards */}
        <div className="grid grid-cols-2 gap-2 mb-4" data-testid="add-tenant-mode-picker">
          <ModeCard
            active={mode === 'invite'}
            onClick={() => setMode('invite')}
            icon={<Send size={14} />}
            title="Send invite link"
            body="Owner clicks a secure link and sets their own password."
            testid="add-tenant-mode-invite"
          />
          <ModeCard
            active={mode === 'direct'}
            onClick={() => setMode('direct')}
            icon={<KeyRound size={14} />}
            title="Set password now"
            body="You type a password — owner can log in immediately."
            testid="add-tenant-mode-direct"
          />
        </div>

        <form onSubmit={submit} className="space-y-3" data-testid="add-tenant-form">
          <Field label="Clinic name *">
            <input value={form.clinic_name} onChange={set('clinic_name')} required
              data-testid="add-tenant-name"
              placeholder="Hearing Wellness Centre, Mumbai"
              className="w-full px-3 py-2 rounded border border-slate-200 text-sm focus:ring-2 focus:ring-indigo-100 focus:border-indigo-500 outline-none" />
          </Field>

          <div className="grid grid-cols-2 gap-3">
            <Field label="Owner name *">
              <input value={form.owner_name} onChange={set('owner_name')} required
                data-testid="add-tenant-owner-name"
                placeholder="Dr. Aarti Mehta"
                className="w-full px-3 py-2 rounded border border-slate-200 text-sm focus:ring-2 focus:ring-indigo-100 focus:border-indigo-500 outline-none" />
            </Field>
            <Field label="Owner email *">
              <input type="email" value={form.owner_email} onChange={set('owner_email')} required
                data-testid="add-tenant-owner-email"
                placeholder="aarti@hearwell.com"
                className="w-full px-3 py-2 rounded border border-slate-200 text-sm focus:ring-2 focus:ring-indigo-100 focus:border-indigo-500 outline-none" />
            </Field>
          </div>

          {mode === 'direct' && (
            <Field label="Owner password *">
              <div className="flex items-center gap-1">
                <div className="relative flex-1">
                  <input
                    required minLength={8}
                    type={showPw ? 'text' : 'password'}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    data-testid="add-tenant-password"
                    className="w-full px-3 py-2 pr-9 rounded border border-slate-200 text-sm font-mono focus:ring-2 focus:ring-indigo-100 focus:border-indigo-500 outline-none"
                  />
                  <button type="button" onClick={() => setShowPw((v) => !v)}
                    title={showPw ? 'Hide' : 'Show'}
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-700"
                  >
                    {showPw ? <EyeOff size={14} /> : <Eye size={14} />}
                  </button>
                </div>
                <button type="button" onClick={() => setPassword(generatePassword())}
                  data-testid="add-tenant-password-regen"
                  className="inline-flex items-center gap-1 px-2 py-2 text-[11px] font-semibold text-indigo-700 border border-indigo-200 bg-indigo-50 hover:bg-indigo-100 rounded"
                >
                  <RefreshCw size={12} /> New
                </button>
              </div>
              <p className="text-[10.5px] text-slate-500 mt-1">
                Min 8 characters. You&apos;ll see these credentials one time — copy them before closing.
              </p>
            </Field>
          )}

          <div className="grid grid-cols-3 gap-3">
            <Field label="City">
              <input value={form.city} onChange={set('city')}
                data-testid="add-tenant-city"
                className="w-full px-3 py-2 rounded border border-slate-200 text-sm focus:ring-2 focus:ring-indigo-100 focus:border-indigo-500 outline-none" />
            </Field>
            <Field label="State">
              <input value={form.state} onChange={set('state')}
                data-testid="add-tenant-state"
                className="w-full px-3 py-2 rounded border border-slate-200 text-sm focus:ring-2 focus:ring-indigo-100 focus:border-indigo-500 outline-none" />
            </Field>
            <Field label="Phone">
              <input value={form.phone} onChange={set('phone')} placeholder="+91…"
                data-testid="add-tenant-phone"
                className="w-full px-3 py-2 rounded border border-slate-200 text-sm focus:ring-2 focus:ring-indigo-100 focus:border-indigo-500 outline-none" />
            </Field>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <Field label="Tier">
              <select value={form.tier} onChange={set('tier')} data-testid="add-tenant-tier"
                className="w-full px-3 py-2 rounded border border-slate-200 text-sm bg-white focus:ring-2 focus:ring-indigo-100 focus:border-indigo-500 outline-none">
                <option value="BASIC">Basic</option>
                <option value="STANDARD">Standard</option>
                <option value="PREMIUM">Premium</option>
              </select>
            </Field>
            <Field label="Trial days">
              <input type="number" min={0} max={180} value={form.trial_days} onChange={set('trial_days')}
                data-testid="add-tenant-trial-days"
                className="w-full px-3 py-2 rounded border border-slate-200 text-sm focus:ring-2 focus:ring-indigo-100 focus:border-indigo-500 outline-none" />
            </Field>
          </div>

          {err && (
            <div className="text-xs rounded bg-rose-50 border border-rose-200 text-rose-700 px-3 py-2 flex items-start gap-1.5">
              <AlertTriangle size={13} className="mt-0.5 shrink-0" /> {err}
            </div>
          )}

          <div className="flex justify-end gap-2 pt-2">
            <button type="button" onClick={onClose} className="px-3 py-2 text-xs font-semibold border border-slate-300 rounded">
              Cancel
            </button>
            <button type="submit" disabled={busy}
              data-testid="add-tenant-submit"
              className="px-4 py-2 text-xs font-semibold bg-indigo-600 hover:bg-indigo-700 disabled:bg-slate-300 text-white rounded inline-flex items-center gap-1">
              {busy
                ? 'Creating…'
                : mode === 'invite'
                  ? (<><Plus size={12} /> Create tenant &amp; invite</>)
                  : (<><KeyRound size={12} /> Create tenant &amp; set password</>)}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function ModeCard({ active, onClick, icon, title, body, testid }) {
  return (
    <button
      type="button"
      onClick={onClick}
      data-testid={testid}
      className={`text-left rounded-lg border-2 px-3 py-2.5 transition-colors ${
        active
          ? 'border-indigo-500 bg-indigo-50'
          : 'border-slate-200 bg-white hover:border-slate-300'
      }`}
    >
      <div className={`flex items-center gap-1.5 font-bold text-[12px] ${active ? 'text-indigo-700' : 'text-slate-800'}`}>
        <span className={active ? 'text-indigo-600' : 'text-slate-500'}>{icon}</span>
        {title}
      </div>
      <p className="text-[10.5px] text-slate-500 mt-1 leading-snug">{body}</p>
    </button>
  );
}

function Field({ label, children }) {
  return (
    <label className="block">
      <span className="block text-[10.5px] uppercase tracking-wider font-bold text-slate-500 mb-1">{label}</span>
      {children}
    </label>
  );
}
