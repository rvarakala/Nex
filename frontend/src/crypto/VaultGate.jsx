/**
 * VaultGate — combined Setup / Unlock UX.
 *
 * Decides at render time whether to:
 *   - show nothing (vault disabled, or already unlocked)
 *   - show <SetupForm /> (vault not yet initialised)
 *   - show <UnlockForm /> (vault initialised, waiting for passphrase)
 *
 * Only renders for routes that opt-in by passing `required`. Ungated areas
 * (login, public pages) aren't blocked.
 */
import React, { useState } from 'react';
import { Shield, ShieldCheck, KeyRound, Eye, EyeOff, AlertTriangle, Copy, Download, Check } from 'lucide-react';
import { useVault } from './VaultContext';

export default function VaultGate({ children, required = false }) {
  const v = useVault();

  if (v.loading) return null;
  if (!required) return children;
  if (!v.enabled) return <SetupForm />;
  if (v.locked)  return <UnlockForm />;
  return children;
}

/* ============================== Setup ===================================== */

function SetupForm() {
  const v = useVault();
  const [pass1, setPass1] = useState('');
  const [pass2, setPass2] = useState('');
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [recovery, setRecovery] = useState(null);

  const tooShort = pass1.length > 0 && pass1.length < 12;
  const mismatch = pass2.length > 0 && pass1 !== pass2;
  const canSubmit = pass1.length >= 12 && pass1 === pass2 && !busy;

  const handleSetup = async (e) => {
    e.preventDefault();
    if (!canSubmit) return;
    setBusy(true); setErr('');
    try {
      const { recoveryCodes } = await v.setupVault(pass1);
      setRecovery(recoveryCodes);
    } catch (ex) {
      setErr(ex?.response?.data?.detail || ex?.message || 'Setup failed');
    } finally {
      setBusy(false);
    }
  };

  if (recovery) return <RecoveryCodesScreen codes={recovery} />;

  return (
    <Shell title="Set up your Clinic Vault" subtitle="One-time setup. The passphrase you enter never leaves this browser.">
      <form onSubmit={handleSetup} className="space-y-4" data-testid="vault-setup-form">
        <Field label="Master passphrase" hint="Min 12 characters. Use a memorable sentence — not a single word.">
          <PasswordInput value={pass1} onChange={setPass1} show={show} setShow={setShow} testid="vault-setup-pass1" />
        </Field>
        {tooShort && <Hint kind="warn">Use at least 12 characters.</Hint>}
        <Field label="Confirm passphrase">
          <PasswordInput value={pass2} onChange={setPass2} show={show} setShow={setShow} testid="vault-setup-pass2" />
        </Field>
        {mismatch && <Hint kind="warn">Passphrases don&apos;t match.</Hint>}

        <div className="rounded-xl bg-amber-50 border border-amber-200 p-4 text-[13px] text-amber-900 flex gap-3">
          <AlertTriangle size={18} className="shrink-0 mt-0.5" />
          <div>
            <strong>This is your only key.</strong> AUDINEXA cannot recover it. After setup, you&apos;ll receive 12 one-time recovery codes — print and store them safely.
          </div>
        </div>

        {err && <Hint kind="err">{err}</Hint>}

        <button
          type="submit"
          disabled={!canSubmit}
          data-testid="vault-setup-submit"
          className="w-full bg-[#0B5FFF] hover:bg-[#094acf] disabled:bg-slate-300 text-white py-3 rounded-xl font-semibold shadow-md transition"
        >
          {busy ? 'Generating keys…' : 'Create vault'}
        </button>
      </form>
    </Shell>
  );
}

function RecoveryCodesScreen({ codes }) {
  const [copied, setCopied] = useState(false);
  const text = codes.join('\n');
  const onCopy = async () => {
    await navigator.clipboard.writeText(text);
    setCopied(true); setTimeout(() => setCopied(false), 1800);
  };
  const onDownload = () => {
    const blob = new Blob(
      [`AUDINEXA — Clinic Vault Recovery Codes\nGenerated: ${new Date().toISOString()}\n\n${text}\n\nKeep these somewhere safe. Each code can be used once.\n`],
      { type: 'text/plain' },
    );
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'audinexa-recovery-codes.txt';
    a.click();
    URL.revokeObjectURL(a.href);
  };

  return (
    <Shell title="Save these recovery codes" subtitle="Each code can unlock your vault once. Keep them offline." iconBg="bg-amber-100 text-amber-700" Icon={KeyRound}>
      <div className="rounded-xl bg-slate-900 text-emerald-200 font-mono text-[13px] p-5 grid grid-cols-2 gap-y-2 gap-x-6" data-testid="vault-recovery-codes">
        {codes.map((c, i) => (
          <div key={c} className="flex items-center gap-3">
            <span className="text-slate-500 w-5 text-right">{i + 1}.</span>
            <span>{c}</span>
          </div>
        ))}
      </div>
      <div className="flex flex-col sm:flex-row gap-3 mt-5">
        <button
          onClick={onCopy}
          data-testid="vault-recovery-copy"
          className="flex-1 inline-flex items-center justify-center gap-2 bg-white border border-slate-200 hover:border-slate-300 text-slate-700 font-medium py-3 rounded-xl transition"
        >
          {copied ? <Check size={16} className="text-emerald-600" /> : <Copy size={16} />} {copied ? 'Copied' : 'Copy all'}
        </button>
        <button
          onClick={onDownload}
          data-testid="vault-recovery-download"
          className="flex-1 inline-flex items-center justify-center gap-2 bg-white border border-slate-200 hover:border-slate-300 text-slate-700 font-medium py-3 rounded-xl transition"
        >
          <Download size={16} /> Download .txt
        </button>
      </div>
      <button
        onClick={() => window.location.reload()}
        data-testid="vault-recovery-done"
        className="mt-4 w-full bg-[#0B5FFF] hover:bg-[#094acf] text-white py-3 rounded-xl font-semibold shadow-md transition"
      >
        I&apos;ve saved my codes — continue
      </button>
    </Shell>
  );
}

/* ============================== Unlock ==================================== */

function UnlockForm() {
  const v = useVault();
  const [pass, setPass] = useState('');
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  const handleUnlock = async (e) => {
    e.preventDefault();
    if (!pass) return;
    setBusy(true); setErr('');
    try {
      await v.unlockVault(pass);
    } catch (ex) {
      setErr(ex?.code === 'WRONG_PASSPHRASE' || ex?.response?.status === 401
        ? 'Wrong passphrase'
        : (ex?.message || 'Unlock failed'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Shell title="Unlock your Clinic Vault" subtitle="Enter the master passphrase to decrypt this session." Icon={KeyRound} iconBg="bg-emerald-100 text-emerald-700">
      <form onSubmit={handleUnlock} className="space-y-4" data-testid="vault-unlock-form">
        <Field label="Master passphrase">
          <PasswordInput value={pass} onChange={setPass} show={show} setShow={setShow} testid="vault-unlock-pass" autoFocus />
        </Field>
        {err && <Hint kind="err">{err}</Hint>}
        <button
          type="submit"
          disabled={!pass || busy}
          data-testid="vault-unlock-submit"
          className="w-full bg-[#0B5FFF] hover:bg-[#094acf] disabled:bg-slate-300 text-white py-3 rounded-xl font-semibold shadow-md transition"
        >
          {busy ? 'Deriving key…' : 'Unlock'}
        </button>
        <div className="text-center text-[12.5px] text-slate-500">
          Forgot it? <button type="button" className="text-[#0B5FFF] font-semibold hover:underline">Use a recovery code</button> (coming soon)
        </div>
      </form>
    </Shell>
  );
}

/* ============================== Shared UI ================================= */

function Shell({ title, subtitle, children, Icon = Shield, iconBg = 'bg-[#0B5FFF]/10 text-[#0B5FFF]' }) {
  return (
    <div className="min-h-[calc(100vh-3rem)] flex items-center justify-center p-4 bg-slate-50">
      <div className="w-full max-w-md bg-white rounded-2xl shadow-xl border border-slate-100 p-6 sm:p-8" data-testid="vault-gate-shell">
        <div className="flex items-center gap-3">
          <span className={`w-12 h-12 rounded-xl flex items-center justify-center ${iconBg}`}>
            <Icon size={22} />
          </span>
          <div>
            <h2 className="font-[Manrope,Inter,sans-serif] font-extrabold text-slate-900 text-lg leading-tight">{title}</h2>
            <p className="text-[12.5px] text-slate-500 mt-0.5">{subtitle}</p>
          </div>
        </div>
        <div className="mt-6">{children}</div>
        <div className="mt-6 pt-4 border-t border-slate-100 flex items-center gap-2 text-[11px] text-slate-500">
          <ShieldCheck size={13} className="text-emerald-600" /> Decryption happens in your browser. Server never sees the key.
        </div>
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
        autoComplete="off"
      />
      <button
        type="button"
        onClick={() => setShow((s) => !s)}
        className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
        aria-label={show ? 'Hide passphrase' : 'Show passphrase'}
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
    <div className={`text-[12.5px] rounded-lg border px-3 py-2 ${map[kind] || ''}`}>{children}</div>
  );
}
