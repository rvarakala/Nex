/**
 * SecurityPrivacyTab — Settings → Security & Privacy.
 *
 * Path A opt-in flow. Three states:
 *   1. mode = "standard"        → show comparison cards, "Upgrade to Vault Mode" CTA
 *   2. mode = "vault_pending"   → show in-progress card, "Continue setup" CTA
 *   3. mode = "vault_enabled"   → show vault status + lock + "Disable" footer
 *
 * Owner / super_admin only — gated upstream by SettingsModule.
 */
import React, { useCallback, useEffect, useState } from 'react';
import axios from 'axios';
import {
  Shield, ShieldCheck, ShieldOff, KeyRound, Lock, Unlock, Sparkles,
  Check, AlertTriangle, ChevronRight, RefreshCw, Loader2,
} from 'lucide-react';
import { useVault } from '../../crypto/VaultContext';
import { buildVaultSetupPayload } from '../../crypto/clinicVault';
import MfaSetupCard from './MfaSetupCard';
import SessionsList from './SessionsList';

const BACKEND = process.env.REACT_APP_BACKEND_URL;
const API = `${BACKEND}/api/vault`;

export default function SecurityPrivacyTab() {
  const v = useVault();
  const [mode, setMode] = useState('standard');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  const refreshMode = useCallback(async () => {
    try {
      const r = await axios.get(`${API}/status`);
      setMode(r.data.mode || 'standard');
    } catch { /* keep last value */ }
  }, []);

  useEffect(() => { refreshMode(); }, [refreshMode]);

  const moveTo = async (target, confirm = false) => {
    setBusy(true); setErr('');
    try {
      await axios.post(`${API}/mode`, { mode: target, confirm_disable: confirm });
      await refreshMode();
      await v.refreshStatus();
    } catch (e) {
      setErr(e?.response?.data?.detail || e?.message || 'Update failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="max-w-4xl mx-auto px-5 sm:px-6 py-8" data-testid="settings-security-tab">
      <header>
        <div className="text-[11px] uppercase tracking-wider font-bold text-slate-500">Security & Privacy</div>
        <h1 className="mt-1 font-[Manrope,Inter,sans-serif] font-extrabold text-2xl sm:text-3xl text-slate-900 tracking-tight">
          Choose your security model
        </h1>
        <p className="mt-2 text-[14px] text-slate-600 leading-relaxed max-w-2xl">
          Standard security is enabled by default and matches what most clinic software offers. <strong>Vault Mode</strong> is an optional upgrade where even AUDINEXA cannot read your data — only your clinic holds the key.
        </p>
      </header>

      {err && (
        <div className="mt-4 rounded-lg bg-rose-50 border border-rose-200 text-rose-700 px-3 py-2 text-sm flex items-center gap-2">
          <AlertTriangle size={14} /> {err}
        </div>
      )}

      <section className="mt-8 grid md:grid-cols-2 gap-5">
        <Card
          tone="standard"
          active={mode === 'standard'}
          title="Standard"
          tag="Recommended"
          description="Encrypted at rest, encrypted backups, role-based access, audit logs. Same protection used by most healthcare SaaS."
          features={[
            'Encrypted at rest (AES-256)',
            'Encrypted daily backups',
            'Role-based access control',
            'Tamper-evident audit logs',
            'AUDINEXA support can assist with troubleshooting',
          ]}
          footer={
            mode === 'standard' ? (
              <Pill kind="emerald"><Check size={12} /> Currently active</Pill>
            ) : null
          }
        />
        <Card
          tone="vault"
          active={mode !== 'standard'}
          title="Vault Mode"
          tag="Premium upgrade"
          description="Standard plus zero-knowledge encryption — your clinic alone holds the key. Even we cannot read your records."
          features={[
            'Everything in Standard, PLUS:',
            'Master passphrase set by your clinic',
            'Per-session unlock + auto-lock',
            '12 one-time recovery codes',
            'AUDINEXA staff cannot read clinical records',
          ]}
          footer={<VaultModeFooter mode={mode} busy={busy} onMove={moveTo} />}
        />
      </section>

      <section className="mt-10 text-[12.5px] text-slate-500">
        <p className="leading-relaxed">
          You can switch security models at any time. Switching <em>off</em> Vault Mode permanently destroys data encrypted under it. We recommend running Vault Mode for 1-2 weeks before deciding to expand to all your clinic data.
        </p>
      </section>

      {/* ── Two-factor authentication (TOTP) ── */}
      <section className="mt-10">
        <div className="text-[11px] uppercase tracking-wider font-bold text-slate-500 mb-3">
          Sign-in protection
        </div>
        <MfaSetupCard />
      </section>

      {/* ── Sessions & devices (Gmail-style) ── */}
      <section className="mt-10">
        <div className="text-[11px] uppercase tracking-wider font-bold text-slate-500 mb-3">
          Sessions &amp; devices
        </div>
        <SessionsList />
      </section>
    </div>
  );
}

/* ============================ Card ======================================== */

function Card({ tone, active, title, tag, description, features, footer }) {
  const isVault = tone === 'vault';
  return (
    <div
      className={`relative rounded-2xl border p-6 md:p-7 transition-all ${
        active
          ? (isVault
              ? 'bg-gradient-to-br from-[#0B5FFF]/5 to-[#00C2A8]/5 border-[#0B5FFF]/30 shadow-md'
              : 'bg-emerald-50/40 border-emerald-200 shadow-md')
          : 'bg-white border-slate-200'
      }`}
      data-testid={`security-card-${tone}`}
    >
      <div className="flex items-start gap-3">
        <span className={`w-11 h-11 shrink-0 rounded-xl flex items-center justify-center ${
          isVault ? 'bg-gradient-to-br from-[#0B5FFF] to-[#00C2A8] text-white shadow-md' : 'bg-emerald-100 text-emerald-700'
        }`}>
          {isVault ? <KeyRound size={20} /> : <ShieldCheck size={20} />}
        </span>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h3 className="font-[Manrope,Inter,sans-serif] font-extrabold text-lg text-slate-900 tracking-tight">{title}</h3>
            {tag && (
              <span className={`text-[10px] uppercase tracking-wider font-bold px-2 py-0.5 rounded-full ${
                isVault ? 'bg-[#0B5FFF]/10 text-[#0B5FFF]' : 'bg-emerald-100 text-emerald-700'
              }`}>
                {tag}
              </span>
            )}
          </div>
          <p className="mt-1.5 text-[13px] text-slate-600 leading-relaxed">{description}</p>
        </div>
      </div>

      <ul className="mt-5 space-y-2.5">
        {features.map((f) => (
          <li key={f} className="flex items-start gap-2.5 text-[13px] text-slate-700">
            <Check size={15} strokeWidth={2.6} className="mt-0.5 shrink-0 text-emerald-600" />
            <span>{f}</span>
          </li>
        ))}
      </ul>

      {footer && <div className="mt-6 pt-5 border-t border-slate-100">{footer}</div>}
    </div>
  );
}

/* =================== Vault footer (state-machine UI) ==================== */

function VaultModeFooter({ mode, busy, onMove }) {
  if (mode === 'standard') {
    return (
      <button
        onClick={() => onMove('vault_pending')}
        disabled={busy}
        data-testid="vault-mode-upgrade"
        className="w-full inline-flex items-center justify-center gap-2 bg-[#0B5FFF] hover:bg-[#094acf] disabled:bg-slate-300 text-white py-2.5 rounded-lg font-semibold text-[13.5px] shadow-sm transition"
      >
        <Sparkles size={14} /> Upgrade to Vault Mode <ChevronRight size={15} />
      </button>
    );
  }

  if (mode === 'vault_pending') {
    return (
      <PendingSetup busy={busy} onCancel={() => onMove('standard')} />
    );
  }

  // mode === 'vault_enabled'
  return <EnabledFooter busy={busy} onDisable={() => onMove('standard', true)} />;
}

/* ---- Pending: shows passphrase setup inline ---- */

function PendingSetup({ busy, onCancel }) {
  const v = useVault();
  const [pass1, setPass1] = useState('');
  const [pass2, setPass2] = useState('');
  const [working, setWorking] = useState(false);
  const [err, setErr] = useState('');
  const [recoveryCodes, setRecoveryCodes] = useState(null);

  const canSubmit = pass1.length >= 12 && pass1 === pass2 && !working && !busy;

  const submit = async (e) => {
    e.preventDefault();
    if (!canSubmit) return;
    setWorking(true); setErr('');
    try {
      const { recoveryCodes: codes } = await v.setupVault(pass1);
      setRecoveryCodes(codes);
    } catch (ex) {
      setErr(ex?.response?.data?.detail || ex?.message || 'Setup failed');
    } finally {
      setWorking(false);
    }
  };

  if (recoveryCodes) {
    return <InlineRecoveryCodes codes={recoveryCodes} onDone={() => window.location.reload()} />;
  }

  return (
    <form onSubmit={submit} className="space-y-3" data-testid="vault-pending-setup-form">
      <div className="rounded-lg bg-amber-50 border border-amber-200 px-3 py-2 text-[12.5px] text-amber-900 flex items-start gap-2">
        <AlertTriangle size={14} className="mt-0.5 shrink-0" />
        <div>You&apos;re about to set your master passphrase. AUDINEXA cannot recover this for you — choose carefully.</div>
      </div>
      <input
        type="password"
        value={pass1}
        onChange={(e) => setPass1(e.target.value)}
        placeholder="Master passphrase (min 12 chars)"
        data-testid="vault-pending-pass1"
        className="w-full px-3 py-2.5 rounded-lg border border-slate-200 text-sm focus:ring-2 focus:ring-blue-100 focus:border-[#0B5FFF] outline-none font-mono tracking-wider"
        autoComplete="new-password"
      />
      <input
        type="password"
        value={pass2}
        onChange={(e) => setPass2(e.target.value)}
        placeholder="Confirm passphrase"
        data-testid="vault-pending-pass2"
        className="w-full px-3 py-2.5 rounded-lg border border-slate-200 text-sm focus:ring-2 focus:ring-blue-100 focus:border-[#0B5FFF] outline-none font-mono tracking-wider"
        autoComplete="new-password"
      />
      {err && <div className="text-[12.5px] rounded-lg bg-rose-50 border border-rose-200 text-rose-700 px-3 py-2">{err}</div>}
      <div className="flex gap-2">
        <button
          type="button"
          onClick={onCancel}
          disabled={working}
          data-testid="vault-pending-cancel"
          className="flex-1 bg-white border border-slate-200 hover:border-slate-300 text-slate-700 py-2.5 rounded-lg font-medium text-[13px] transition"
        >
          Cancel
        </button>
        <button
          type="submit"
          disabled={!canSubmit}
          data-testid="vault-pending-submit"
          className="flex-1 inline-flex items-center justify-center gap-2 bg-[#0B5FFF] hover:bg-[#094acf] disabled:bg-slate-300 text-white py-2.5 rounded-lg font-semibold text-[13px] shadow-sm transition"
        >
          {working ? <><Loader2 size={14} className="animate-spin" /> Generating keys…</> : <>Create vault</>}
        </button>
      </div>
    </form>
  );
}

function InlineRecoveryCodes({ codes, onDone }) {
  return (
    <div data-testid="vault-pending-recovery">
      <div className="rounded-lg bg-amber-50 border border-amber-200 px-3 py-2 text-[12.5px] text-amber-900 flex items-start gap-2">
        <AlertTriangle size={14} className="mt-0.5 shrink-0" />
        <div><strong>Save these codes now.</strong> Each can unlock your vault once if you forget the passphrase. We will never show them again.</div>
      </div>
      <div className="mt-3 rounded-lg bg-slate-900 text-emerald-200 font-mono text-[12px] p-4 grid grid-cols-2 gap-y-1.5 gap-x-4 max-h-56 overflow-auto">
        {codes.map((c, i) => (
          <div key={c} className="flex items-center gap-2">
            <span className="text-slate-500 w-4 text-right">{i + 1}.</span>
            <span className="truncate">{c}</span>
          </div>
        ))}
      </div>
      <div className="mt-3 flex gap-2">
        <button
          onClick={() => navigator.clipboard.writeText(codes.join('\n'))}
          className="flex-1 bg-white border border-slate-200 hover:border-slate-300 text-slate-700 py-2 rounded-lg text-[13px] font-medium"
          data-testid="vault-pending-copy-codes"
        >
          Copy all
        </button>
        <button
          onClick={() => {
            const blob = new Blob([codes.join('\n')], { type: 'text/plain' });
            const a = document.createElement('a');
            a.href = URL.createObjectURL(blob);
            a.download = 'audinexa-recovery-codes.txt';
            a.click();
            URL.revokeObjectURL(a.href);
          }}
          className="flex-1 bg-white border border-slate-200 hover:border-slate-300 text-slate-700 py-2 rounded-lg text-[13px] font-medium"
          data-testid="vault-pending-download-codes"
        >
          Download .txt
        </button>
      </div>
      <button
        onClick={onDone}
        className="mt-3 w-full bg-[#0B5FFF] hover:bg-[#094acf] text-white py-2.5 rounded-lg font-semibold text-[13px]"
        data-testid="vault-pending-done"
      >
        I&apos;ve saved my codes — finish
      </button>
    </div>
  );
}

/* ---- Enabled state ---- */

function EnabledFooter({ busy, onDisable }) {
  const v = useVault();
  const [confirming, setConfirming] = useState(false);
  return (
    <div className="space-y-3" data-testid="vault-enabled-footer">
      <div className="grid grid-cols-2 gap-3">
        <Stat label="Vault status" value={v.locked ? 'Locked' : 'Unlocked'} icon={v.locked ? Lock : Unlock} tone={v.locked ? 'muted' : 'good'} />
        <Stat label="Recovery codes" value={`${v.recoverySlotsRemaining ?? '—'} unused`} icon={KeyRound} tone="muted" />
      </div>
      <div className="flex flex-wrap gap-2">
        {!v.locked && (
          <button
            onClick={v.lock}
            data-testid="vault-enabled-lock"
            className="inline-flex items-center gap-2 px-3 py-2 rounded-lg border border-slate-200 hover:border-slate-300 text-slate-700 text-[13px] font-medium"
          >
            <Lock size={13} /> Lock now
          </button>
        )}
        <button
          onClick={() => v.refreshStatus()}
          data-testid="vault-enabled-refresh"
          className="inline-flex items-center gap-2 px-3 py-2 rounded-lg border border-slate-200 hover:border-slate-300 text-slate-700 text-[13px] font-medium"
        >
          <RefreshCw size={13} /> Refresh status
        </button>
      </div>

      {!confirming ? (
        <button
          onClick={() => setConfirming(true)}
          data-testid="vault-enabled-disable"
          className="text-[12.5px] text-rose-600 hover:text-rose-700 font-semibold"
        >
          Disable Vault Mode (advanced)
        </button>
      ) : (
        <div className="rounded-lg bg-rose-50 border border-rose-200 p-3" data-testid="vault-enabled-disable-confirm">
          <div className="flex items-start gap-2 text-[12.5px] text-rose-800">
            <ShieldOff size={14} className="mt-0.5 shrink-0" />
            <div>
              <strong>This permanently destroys all encrypted records</strong> for this clinic. Existing vault entries cannot be recovered. Continue?
            </div>
          </div>
          <div className="mt-3 flex gap-2">
            <button
              onClick={() => setConfirming(false)}
              className="flex-1 bg-white border border-rose-200 text-rose-700 py-2 rounded-lg text-[13px] font-medium"
              data-testid="vault-enabled-disable-cancel"
            >
              Cancel
            </button>
            <button
              onClick={onDisable}
              disabled={busy}
              className="flex-1 bg-rose-600 hover:bg-rose-700 disabled:bg-rose-300 text-white py-2 rounded-lg text-[13px] font-semibold"
              data-testid="vault-enabled-disable-confirm-button"
            >
              {busy ? 'Disabling…' : 'Yes, disable & destroy data'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function Stat({ label, value, icon: Icon, tone }) {
  const map = {
    good:  'bg-emerald-50 text-emerald-700 border-emerald-200',
    muted: 'bg-slate-50 text-slate-700 border-slate-200',
  };
  return (
    <div className={`rounded-lg border ${map[tone]} px-3 py-2`}>
      <div className="flex items-center gap-1.5 text-[10.5px] uppercase tracking-wider font-bold opacity-75">
        <Icon size={11} /> {label}
      </div>
      <div className="mt-0.5 text-[14px] font-extrabold">{value}</div>
    </div>
  );
}

function Pill({ kind, children }) {
  const map = {
    emerald: 'bg-emerald-100 text-emerald-700',
    blue:    'bg-[#0B5FFF]/10 text-[#0B5FFF]',
  };
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-bold uppercase tracking-wider ${map[kind] || ''}`}>
      {children}
    </span>
  );
}
