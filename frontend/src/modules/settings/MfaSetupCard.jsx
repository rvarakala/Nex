/**
 * MfaSetupCard — embedded inside Settings → Security & Privacy.
 *
 * 3-step setup wizard:
 *   1. Not enabled        → "Enable 2FA" button calls /api/mfa/setup/init
 *   2. Pending             → QR code + 6-digit code input → /api/mfa/setup/verify
 *   3. Enabled             → status + "View recovery codes" + "Disable 2FA"
 *
 * Recovery codes shown ONCE on successful setup. User MUST tick "I've saved
 * these codes" to finish — they cannot be retrieved again later.
 */
import React, { useEffect, useState, useCallback } from 'react';
import axios from 'axios';
import { QRCodeSVG } from 'qrcode.react';
import {
  ShieldCheck, ShieldAlert, KeyRound, Copy, Download, AlertTriangle,
  Loader2, Check, Lock,
} from 'lucide-react';

const API = `${process.env.REACT_APP_BACKEND_URL}/api/mfa`;

export default function MfaSetupCard() {
  const [status, setStatus] = useState(null);          // { mfa_enabled, mfa_eligible, ... }
  const [phase, setPhase] = useState('idle');          // idle | setup | verifying | done | disable
  const [setupData, setSetup] = useState(null);        // { secret_base32, provisioning_uri }
  const [code, setCode] = useState('');
  const [recoveryCodes, setRecoveryCodes] = useState(null);
  const [savedConfirm, setSavedConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  const refresh = useCallback(async () => {
    try {
      const r = await axios.get(`${API}/status`);
      setStatus(r.data);
    } catch { /* keep last */ }
  }, []);
  useEffect(() => { refresh(); }, [refresh]);

  if (!status) {
    return <div className="bg-white border border-slate-200 rounded-lg p-5 text-sm text-slate-500">Loading 2FA status…</div>;
  }
  if (!status.mfa_eligible) {
    return null; // Hide entirely for non-eligible roles
  }

  const startSetup = async () => {
    setBusy(true); setErr(''); setCode('');
    try {
      const r = await axios.post(`${API}/setup/init`);
      setSetup(r.data);
      setPhase('setup');
    } catch (e) {
      setErr(e?.response?.data?.detail || 'Failed to start setup');
    } finally { setBusy(false); }
  };

  const verifySetup = async () => {
    if (!/^\d{6}$/.test(code)) { setErr('Enter the 6-digit code from your authenticator app'); return; }
    setBusy(true); setErr('');
    try {
      const r = await axios.post(`${API}/setup/verify`, { code });
      setRecoveryCodes(r.data.recovery_codes || []);
      setPhase('done');
      await refresh();
    } catch (e) {
      setErr(e?.response?.data?.detail || 'Invalid code — try a fresh one');
    } finally { setBusy(false); }
  };

  const disableMfa = async () => {
    if (!/^\d{6,12}$/.test(code)) { setErr('Enter a 6-digit code or a recovery code'); return; }
    setBusy(true); setErr('');
    try {
      await axios.post(`${API}/disable`, { code, use_recovery_code: code.length > 6 });
      setPhase('idle');
      setCode('');
      setSetup(null);
      setRecoveryCodes(null);
      setSavedConfirm(false);
      await refresh();
    } catch (e) {
      setErr(e?.response?.data?.detail || 'Invalid code');
    } finally { setBusy(false); }
  };

  const downloadRecovery = () => {
    const blob = new Blob([
      `AUDINEXA — 2FA Recovery Codes\n`,
      `Generated: ${new Date().toISOString()}\n`,
      `Each code can be used ONCE.\n`,
      `Keep these in a password manager or printed safe.\n\n`,
      ...recoveryCodes.map((c, i) => `${String(i + 1).padStart(2, '0')}. ${c}\n`),
    ], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = 'audinexa-2fa-recovery-codes.txt';
    a.click();
    URL.revokeObjectURL(url);
  };

  // ── ENABLED state ──
  if (status.mfa_enabled && phase !== 'disable' && phase !== 'done') {
    return (
      <div className="bg-white border border-emerald-200 rounded-lg p-5" data-testid="mfa-card-enabled">
        <div className="flex items-start gap-3">
          <ShieldCheck size={20} className="text-emerald-600 mt-0.5 shrink-0" />
          <div className="flex-1">
            <h3 className="font-bold text-slate-900 text-sm">Two-factor authentication is ON</h3>
            <p className="text-[12.5px] text-slate-600 mt-1">
              You'll be asked for a 6-digit code from your authenticator app on every sign-in.
              Recovery codes available: <b>{status.unused_recovery_codes}</b> / 10.
            </p>
            <button
              onClick={() => { setPhase('disable'); setCode(''); setErr(''); }}
              data-testid="mfa-disable-start"
              className="mt-3 text-[12px] font-semibold text-rose-700 hover:text-rose-800 underline-offset-2 hover:underline"
            >
              Disable 2FA
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ── DISABLE flow ──
  if (phase === 'disable') {
    return (
      <div className="bg-white border border-rose-200 rounded-lg p-5" data-testid="mfa-card-disable">
        <div className="flex items-start gap-3 mb-3">
          <ShieldAlert size={20} className="text-rose-600 mt-0.5 shrink-0" />
          <div>
            <h3 className="font-bold text-slate-900 text-sm">Disable 2FA?</h3>
            <p className="text-[12.5px] text-slate-600 mt-1">
              Enter a current 6-digit code from your authenticator (or a recovery code) to confirm.
            </p>
          </div>
        </div>
        <input
          value={code}
          onChange={(e) => setCode(e.target.value.replace(/\s/g, ''))}
          placeholder="6-digit code or recovery code"
          maxLength={12}
          autoFocus
          data-testid="mfa-disable-code"
          className="w-full px-3 py-2 border border-slate-300 rounded text-sm font-mono tracking-wider"
        />
        {err && <div className="mt-2 text-[12px] text-rose-600">{err}</div>}
        <div className="mt-3 flex gap-2">
          <button
            onClick={disableMfa} disabled={busy}
            data-testid="mfa-disable-confirm"
            className="px-3 py-1.5 text-[12px] font-semibold bg-rose-600 text-white rounded hover:bg-rose-700 disabled:opacity-50"
          >
            {busy ? <Loader2 className="animate-spin" size={14} /> : 'Disable 2FA'}
          </button>
          <button
            onClick={() => { setPhase('idle'); setErr(''); }}
            className="px-3 py-1.5 text-[12px] font-semibold text-slate-600 hover:text-slate-900"
          >
            Cancel
          </button>
        </div>
      </div>
    );
  }

  // ── RECOVERY CODES (just-enabled) ──
  if (phase === 'done' && recoveryCodes) {
    return (
      <div className="bg-white border border-amber-300 rounded-lg p-5" data-testid="mfa-card-recovery">
        <div className="flex items-start gap-3 mb-3">
          <AlertTriangle size={20} className="text-amber-600 mt-0.5 shrink-0" />
          <div>
            <h3 className="font-bold text-slate-900 text-sm">Save your recovery codes</h3>
            <p className="text-[12.5px] text-slate-600 mt-1">
              You'll need one of these if you lose access to your authenticator app.
              Each code can be used <b>only once</b>. We can't show them again.
            </p>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-1.5 bg-slate-50 border border-slate-200 rounded p-3 font-mono text-[12px]" data-testid="mfa-recovery-list">
          {recoveryCodes.map((c, i) => (
            <div key={c} className="flex items-baseline gap-2 text-slate-800">
              <span className="text-slate-400 text-[10px]">{String(i + 1).padStart(2, '0')}.</span>
              {c}
            </div>
          ))}
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          <button
            onClick={downloadRecovery}
            data-testid="mfa-recovery-download"
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-[12px] font-semibold bg-slate-900 text-white rounded hover:bg-slate-700"
          >
            <Download size={13} /> Download .txt
          </button>
          <button
            onClick={() => navigator.clipboard?.writeText(recoveryCodes.join('\n'))}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-[12px] font-semibold bg-white border border-slate-300 text-slate-700 rounded hover:bg-slate-50"
          >
            <Copy size={13} /> Copy all
          </button>
        </div>
        <label className="mt-3 flex items-start gap-2 text-[12px] text-slate-700">
          <input
            type="checkbox"
            checked={savedConfirm}
            onChange={(e) => setSavedConfirm(e.target.checked)}
            data-testid="mfa-recovery-confirm"
            className="mt-0.5"
          />
          <span>I've saved these recovery codes somewhere safe.</span>
        </label>
        <button
          onClick={() => { setPhase('idle'); setRecoveryCodes(null); }}
          disabled={!savedConfirm}
          data-testid="mfa-recovery-finish"
          className="mt-3 px-4 py-2 text-[13px] font-bold bg-[#0F52BA] text-white rounded hover:bg-[#0C4399] disabled:opacity-40 disabled:cursor-not-allowed"
        >
          Finish setup
        </button>
      </div>
    );
  }

  // ── SETUP wizard ──
  if (phase === 'setup' && setupData) {
    return (
      <div className="bg-white border border-slate-200 rounded-lg p-5" data-testid="mfa-card-setup">
        <h3 className="font-bold text-slate-900 text-sm flex items-center gap-2">
          <KeyRound size={16} className="text-[#0F52BA]" />
          Step 1 — Scan this QR code in your authenticator app
        </h3>
        <p className="text-[12.5px] text-slate-600 mt-1">
          Compatible with Google Authenticator, Microsoft Authenticator, Authy, 1Password, Bitwarden, etc.
        </p>
        <div className="mt-4 flex flex-col sm:flex-row gap-5 items-start">
          <div className="bg-white p-3 border border-slate-300 rounded">
            <QRCodeSVG value={setupData.provisioning_uri} size={180} level="M" includeMargin={false} data-testid="mfa-qr" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-[11px] font-bold uppercase tracking-wider text-slate-500 mb-1">
              Can't scan? Enter this key manually:
            </div>
            <div className="font-mono text-[12px] bg-slate-50 border border-slate-200 rounded px-3 py-2 break-all select-all" data-testid="mfa-secret-manual">
              {setupData.secret_base32}
            </div>
            <div className="mt-4 text-[11px] font-bold uppercase tracking-wider text-slate-500 mb-1">
              Step 2 — Enter the 6-digit code from the app
            </div>
            <input
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
              maxLength={6}
              inputMode="numeric"
              autoFocus
              placeholder="123 456"
              data-testid="mfa-setup-code"
              className="w-full px-3 py-2 border border-slate-300 rounded text-lg font-mono tracking-widest text-center"
            />
            {err && <div className="mt-2 text-[12px] text-rose-600">{err}</div>}
            <div className="mt-3 flex gap-2">
              <button
                onClick={verifySetup} disabled={busy || code.length !== 6}
                data-testid="mfa-setup-verify"
                className="inline-flex items-center gap-1.5 px-4 py-2 text-[13px] font-bold bg-[#0F52BA] text-white rounded hover:bg-[#0C4399] disabled:opacity-40"
              >
                {busy ? <Loader2 className="animate-spin" size={14} /> : <Check size={14} />}
                Verify and enable
              </button>
              <button
                onClick={() => { setPhase('idle'); setSetup(null); setCode(''); setErr(''); }}
                className="px-3 py-2 text-[13px] font-semibold text-slate-600 hover:text-slate-900"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // ── IDLE (not enabled, no setup in progress) ──
  return (
    <div className="bg-white border border-slate-200 rounded-lg p-5" data-testid="mfa-card-idle">
      <div className="flex items-start gap-3">
        <Lock size={20} className="text-slate-500 mt-0.5 shrink-0" />
        <div className="flex-1">
          <h3 className="font-bold text-slate-900 text-sm">Two-factor authentication (2FA)</h3>
          <p className="text-[12.5px] text-slate-600 mt-1 leading-relaxed">
            Add an extra layer of security to your owner account. We'll ask for a 6-digit code
            from your authenticator app every time you sign in — stops anyone with just your
            password from getting in.
          </p>
          {err && <div className="mt-2 text-[12px] text-rose-600">{err}</div>}
          <button
            onClick={startSetup} disabled={busy}
            data-testid="mfa-setup-start"
            className="mt-3 inline-flex items-center gap-1.5 px-4 py-2 text-[13px] font-bold bg-[#0F52BA] text-white rounded hover:bg-[#0C4399] disabled:opacity-50"
          >
            {busy ? <Loader2 className="animate-spin" size={14} /> : <KeyRound size={14} />}
            Enable 2FA
          </button>
        </div>
      </div>
    </div>
  );
}
