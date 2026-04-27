/**
 * Settings → Connect (WhatsApp via MSG91)
 *
 * Owner-only tab. Three concerns:
 *   1. DPA — owner ticks "I have a Data Processing Agreement with my
 *      patients covering MSG91 as a sub-processor" before any send.
 *   2. Mode + credentials — BYOG (clinic's own MSG91 account) or Hosted
 *      (Audinexa-hosted, no keys to enter).
 *   3. Test send — fire a probe message to the owner's phone to verify
 *      auth key + sender number are configured correctly.
 *
 * Auto-triggers (appointment / invoice / report-ready / pickup-ready) wire
 * in PR 2; this tab only ships the configuration surface.
 */
import React, { useEffect, useState, useCallback } from 'react';
import axios from 'axios';
import { MessageCircle, ShieldCheck, KeyRound, Phone, Send, AlertTriangle, CheckCircle2 } from 'lucide-react';
import { useAuth } from '../../AuthContext';
import ErrorToast, { describeError } from '../../components/ErrorToast';

const API = process.env.REACT_APP_BACKEND_URL + '/api';

const fmtDateTime = (iso) => {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' });
  } catch { return iso; }
};

export default function ConnectWhatsAppTab() {
  const { user } = useAuth();
  const isOwner = ['clinic_owner', 'super_admin', 'founder'].includes(user?.role);

  const [cfg, setCfg] = useState(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState(null);

  const [showDpa, setShowDpa] = useState(false);
  const [savingMode, setSavingMode] = useState(null);

  // Form state
  const [mode, setMode] = useState('byog');
  const [number, setNumber] = useState('');
  const [authKey, setAuthKey] = useState('');
  const [testPhone, setTestPhone] = useState('');
  const [testResult, setTestResult] = useState(null);

  const load = useCallback(async () => {
    setLoading(true); setErr(null);
    try {
      const r = await axios.get(`${API}/connect/whatsapp`);
      setCfg(r.data);
      setMode(r.data?.mode || 'byog');
      setNumber(r.data?.integrated_number || '');
    } catch (e) {
      setErr(describeError(e, 'Failed to load Connect settings'));
    } finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const acceptDpa = async () => {
    setErr(null);
    try {
      const r = await axios.post(`${API}/connect/whatsapp/dpa`, { accept: true });
      setCfg(r.data); setShowDpa(false);
    } catch (e) { setErr(describeError(e, 'Failed to record DPA acceptance')); }
  };

  const saveConfig = async () => {
    setErr(null); setSavingMode('save');
    try {
      const body = { enabled: true, mode };
      if (mode === 'byog') {
        body.integrated_number = number;
        if (authKey.trim()) body.auth_key = authKey.trim();
      }
      const r = await axios.put(`${API}/connect/whatsapp`, body);
      setCfg(r.data); setAuthKey('');
    } catch (e) {
      setErr(describeError(e, 'Failed to save Connect settings'));
    } finally { setSavingMode(null); }
  };

  const disable = async () => {
    if (!window.confirm('Disable AUDINEXA Connect? Outbound WhatsApp will stop sending. DPA history is preserved.')) return;
    setErr(null); setSavingMode('disable');
    try {
      const r = await axios.delete(`${API}/connect/whatsapp`);
      setCfg(r.data);
    } catch (e) { setErr(describeError(e, 'Failed to disable Connect')); }
    finally { setSavingMode(null); }
  };

  const fireTest = async () => {
    setErr(null); setTestResult(null); setSavingMode('test');
    try {
      const r = await axios.post(`${API}/connect/whatsapp/test`, { to_phone: testPhone });
      setTestResult(r.data);
      // refresh to capture last_test_at
      const c = await axios.get(`${API}/connect/whatsapp`);
      setCfg(c.data);
    } catch (e) {
      setErr(describeError(e, 'Test send failed'));
    } finally { setSavingMode(null); }
  };

  if (!isOwner) {
    return (
      <div className="p-8 max-w-2xl">
        <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 text-sm text-amber-900">
          AUDINEXA Connect can only be configured by the clinic owner.
        </div>
      </div>
    );
  }

  if (loading) return <div className="p-8 text-sm text-slate-400 italic">Loading…</div>;

  const enabled = cfg?.enabled;
  const dpa = cfg?.dpa_accepted;

  return (
    <div className="p-6 max-w-3xl space-y-5" data-testid="connect-whatsapp-tab">
      <header className="flex items-start gap-3">
        <span className="w-10 h-10 rounded-xl bg-emerald-100 flex items-center justify-center shrink-0">
          <MessageCircle size={20} className="text-emerald-600" />
        </span>
        <div>
          <h1 className="text-xl font-bold text-slate-900">AUDINEXA Connect — WhatsApp</h1>
          <p className="text-[12px] text-slate-500 leading-snug mt-0.5">
            Send appointment reminders, invoices and reports to your patients on WhatsApp via{' '}
            <b>MSG91</b>. India-first, DPDP Act 2023 compliant, opt-in only.
          </p>
        </div>
        <div className="ml-auto">
          {enabled
            ? <span className="inline-flex items-center gap-1.5 text-[11px] font-bold px-2.5 py-1 rounded-full bg-emerald-100 text-emerald-700"><span className="w-1.5 h-1.5 rounded-full bg-emerald-500" /> ENABLED</span>
            : <span className="inline-flex items-center gap-1.5 text-[11px] font-bold px-2.5 py-1 rounded-full bg-slate-100 text-slate-600">DISABLED</span>}
        </div>
      </header>

      {err && <ErrorToast err={err} testid="connect-err" />}

      {/* DPA gate */}
      <section className={`rounded-xl border p-4 ${dpa ? 'bg-emerald-50 border-emerald-200' : 'bg-amber-50 border-amber-200'}`} data-testid="connect-dpa-card">
        <div className="flex items-start gap-3">
          <ShieldCheck size={18} className={dpa ? 'text-emerald-600' : 'text-amber-600'} />
          <div className="flex-1">
            <div className="text-sm font-bold text-slate-900">Data Processing Agreement</div>
            {dpa ? (
              <p className="text-[12px] text-emerald-800 mt-0.5">
                ✓ Accepted by <b>{cfg.dpa_accepted_by_name}</b> on {fmtDateTime(cfg.dpa_accepted_at)}.
              </p>
            ) : (
              <>
                <p className="text-[12px] text-amber-800 mt-0.5 leading-relaxed">
                  Before WhatsApp can send messages on your patients' behalf, you must
                  acknowledge that you've signed a DPA with your patients covering
                  Audinexa + MSG91 + Meta as sub-processors. Required under DPDP Act 2023.
                </p>
                <button
                  onClick={() => setShowDpa(true)}
                  data-testid="connect-dpa-review"
                  className="mt-2 px-3 py-1.5 text-[12px] bg-amber-600 hover:bg-amber-700 text-white font-semibold rounded">
                  Review &amp; Accept DPA
                </button>
              </>
            )}
          </div>
        </div>
      </section>

      {/* Mode selector */}
      <section className="rounded-xl border border-slate-200 bg-white p-4 space-y-3">
        <div className="text-sm font-bold text-slate-900">Mode</div>
        <div className="grid sm:grid-cols-2 gap-3">
          <ModeCard
            label="Bring Your Own Gateway"
            sub="Use your own MSG91 account. You pay MSG91 directly. Recommended for Premium."
            active={mode === 'byog'}
            onClick={() => setMode('byog')}
            testid="connect-mode-byog"
          />
          <ModeCard
            label="Audinexa-Hosted"
            sub="Use our shared MSG91 account. Billed as part of your subscription."
            active={mode === 'hosted'}
            onClick={() => setMode('hosted')}
            testid="connect-mode-hosted"
          />
        </div>

        {mode === 'byog' && (
          <div className="space-y-3 pt-2">
            <div>
              <label className="text-[11px] font-bold text-slate-700 uppercase tracking-wider flex items-center gap-1.5"><Phone size={12} /> WhatsApp number (integrated)</label>
              <input
                type="tel"
                value={number}
                onChange={(e) => setNumber(e.target.value)}
                placeholder="+91 98765 43210"
                data-testid="connect-byog-number"
                className="mt-1 w-full px-3 py-2 text-sm border border-slate-300 rounded focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 outline-none"
              />
              <p className="text-[10px] text-slate-500 mt-1">10-digit Indian mobile, registered & verified on Meta via your MSG91 account.</p>
            </div>
            <div>
              <label className="text-[11px] font-bold text-slate-700 uppercase tracking-wider flex items-center gap-1.5"><KeyRound size={12} /> MSG91 Auth Key</label>
              <input
                type="password"
                value={authKey}
                onChange={(e) => setAuthKey(e.target.value)}
                placeholder={cfg?.auth_key_masked ? `Currently saved: ${cfg.auth_key_masked} — leave blank to keep` : 'Paste your MSG91 auth key'}
                data-testid="connect-byog-authkey"
                autoComplete="off"
                className="mt-1 w-full px-3 py-2 text-sm border border-slate-300 rounded focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 outline-none font-mono"
              />
              <p className="text-[10px] text-slate-500 mt-1">
                Stored encrypted (AES-128 / Fernet). Only the last 4 chars are ever shown back to you.
                Find it in your MSG91 dashboard → top right → AuthKey.
              </p>
            </div>
          </div>
        )}

        {mode === 'hosted' && (
          <div className="bg-sky-50 border border-sky-200 rounded p-3 text-[12px] text-sky-900 leading-relaxed">
            <b>Hosted mode</b> uses Audinexa's shared MSG91 account — no keys to enter.
            Per-message cost is billed via your subscription. Your clinic name appears as
            sender; messages still go out under DPDP-compliant patient consent.
          </div>
        )}

        <div className="flex flex-wrap items-center gap-2 pt-2">
          <button
            onClick={saveConfig}
            disabled={!dpa || savingMode === 'save'}
            data-testid="connect-save-btn"
            className="px-4 py-2 text-sm bg-emerald-600 hover:bg-emerald-700 disabled:bg-slate-300 disabled:cursor-not-allowed text-white font-semibold rounded">
            {savingMode === 'save' ? 'Saving…' : (enabled ? 'Update Settings' : 'Enable Connect')}
          </button>
          {enabled && (
            <button
              onClick={disable}
              disabled={savingMode === 'disable'}
              data-testid="connect-disable-btn"
              className="px-3 py-2 text-sm border border-rose-300 text-rose-700 hover:bg-rose-50 font-semibold rounded">
              {savingMode === 'disable' ? 'Disabling…' : 'Disable Connect'}
            </button>
          )}
          {!dpa && (
            <span className="text-[11px] text-amber-700 inline-flex items-center gap-1">
              <AlertTriangle size={12} /> Accept the DPA above first.
            </span>
          )}
        </div>
      </section>

      {/* Test send */}
      {enabled && (
        <section className="rounded-xl border border-slate-200 bg-white p-4 space-y-3" data-testid="connect-test-section">
          <div className="text-sm font-bold text-slate-900 flex items-center gap-2">
            <Send size={14} /> Send a test ping
          </div>
          <p className="text-[12px] text-slate-600">
            Sends a probe to verify your auth key + sender number end-to-end.
            Uses template <code>audinexa_test_ping</code> — once registered & approved on your MSG91 account in PR 2,
            you'll receive an actual message; until then a clear error here still proves your auth key works.
          </p>
          <div className="flex flex-wrap items-end gap-2">
            <div className="flex-1 min-w-[220px]">
              <label className="text-[10px] font-bold text-slate-600 uppercase tracking-wider">Phone (your own)</label>
              <input
                type="tel"
                value={testPhone}
                onChange={(e) => setTestPhone(e.target.value)}
                placeholder="+91 98765 43210"
                data-testid="connect-test-phone"
                className="mt-1 w-full px-3 py-2 text-sm border border-slate-300 rounded outline-none focus:border-emerald-500"
              />
            </div>
            <button
              onClick={fireTest}
              disabled={!testPhone || savingMode === 'test'}
              data-testid="connect-test-fire"
              className="px-4 py-2 text-sm bg-slate-800 hover:bg-slate-900 disabled:bg-slate-300 text-white font-semibold rounded">
              {savingMode === 'test' ? 'Sending…' : 'Send test'}
            </button>
          </div>

          {testResult && (
            <div
              data-testid="connect-test-result"
              className={`rounded p-3 text-[12px] leading-relaxed ${testResult.ok
                ? 'bg-emerald-50 border border-emerald-200 text-emerald-900'
                : 'bg-rose-50 border border-rose-200 text-rose-900'}`}>
              {testResult.ok ? (
                <div className="flex items-start gap-2">
                  <CheckCircle2 size={14} className="mt-0.5 text-emerald-600" />
                  <div>
                    <b>Sent.</b> Request id: <code>{testResult.request_id}</code>. Check your phone in a few seconds.
                  </div>
                </div>
              ) : (
                <div className="flex items-start gap-2">
                  <AlertTriangle size={14} className="mt-0.5 text-rose-600" />
                  <div>
                    <b>Failed</b> [{testResult.error_code}]: {testResult.error_message}
                    {testResult.hint && <div className="mt-1 text-[11px] italic text-rose-800">{testResult.hint}</div>}
                  </div>
                </div>
              )}
            </div>
          )}

          {cfg?.last_test_at && (
            <p className="text-[10px] text-slate-500">Last attempt: {fmtDateTime(cfg.last_test_at)} · {cfg.last_test_status}</p>
          )}
        </section>
      )}

      {/* DPA Modal */}
      {showDpa && <DpaModal onAccept={acceptDpa} onCancel={() => setShowDpa(false)} clinicName={user?.clinic?.name} />}
    </div>
  );
}

const ModeCard = ({ label, sub, active, onClick, testid }) => (
  <button
    onClick={onClick}
    data-testid={testid}
    className={`text-left p-3 rounded-lg border-2 transition ${active
      ? 'border-emerald-500 bg-emerald-50'
      : 'border-slate-200 bg-white hover:border-slate-300'}`}>
    <div className="text-[13px] font-bold text-slate-900">{label}</div>
    <div className="text-[11px] text-slate-600 mt-0.5 leading-snug">{sub}</div>
  </button>
);

const DpaModal = ({ onAccept, onCancel }) => {
  const [agreed, setAgreed] = useState(false);
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-4" data-testid="connect-dpa-modal">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-2xl max-h-[85vh] overflow-hidden flex flex-col">
        <div className="px-5 py-4 border-b border-slate-200 flex items-center gap-3">
          <ShieldCheck size={20} className="text-amber-600" />
          <div>
            <div className="text-base font-bold text-slate-900">Data Processing Agreement</div>
            <div className="text-[11px] text-slate-500">DPDP Act 2023 · Sub-processor disclosure</div>
          </div>
        </div>
        <div className="px-5 py-4 overflow-auto text-[12.5px] text-slate-700 leading-relaxed space-y-3">
          <p>By enabling AUDINEXA Connect you acknowledge that:</p>
          <ol className="list-decimal pl-5 space-y-2">
            <li><b>You are the data controller.</b> Audinexa is a data processor; MSG91 and Meta (WhatsApp) are sub-processors.</li>
            <li><b>You have a lawful basis</b> for sending WhatsApp messages to each patient — typically <i>explicit opt-in consent</i> captured at registration.</li>
            <li><b>Patients can withdraw consent</b> at any time via the "Withdraw consent" button on their profile, and you'll honour that withdrawal.</li>
            <li><b>Only Meta-approved templates</b> will be used. No promotional content without a separate marketing-template opt-in.</li>
            <li><b>Cross-border data flow</b>: WhatsApp messages transit Meta servers (USA / EU). You agree to inform patients of this in your privacy notice.</li>
            <li><b>Retention</b>: message logs are retained for 90 days for delivery debugging and audit, then auto-purged.</li>
            <li><b>Indemnity</b>: you indemnify Audinexa against claims arising from messages you send to patients without valid consent.</li>
          </ol>
          <p className="bg-amber-50 border border-amber-200 rounded p-2.5 text-[11.5px]">
            <b>You should also have</b>: (a) a Notice/Consent flow added to your patient privacy notice referencing
            "WhatsApp via MSG91"; (b) a documented procedure for honouring data-deletion requests; (c) a designated
            Grievance Officer per Section 8 of the DPDP Act 2023.
          </p>
        </div>
        <div className="px-5 py-3 bg-slate-50 border-t border-slate-200 space-y-3">
          <label className="flex items-start gap-2 text-[12px] text-slate-800">
            <input
              type="checkbox"
              checked={agreed}
              onChange={(e) => setAgreed(e.target.checked)}
              data-testid="connect-dpa-checkbox"
              className="mt-0.5"
            />
            <span>I confirm I have read, understood and agreed to the terms above on behalf of my clinic.</span>
          </label>
          <div className="flex justify-end gap-2">
            <button
              onClick={onCancel}
              data-testid="connect-dpa-cancel"
              className="px-3 py-1.5 text-xs text-slate-600 hover:bg-slate-100 font-semibold rounded">
              Cancel
            </button>
            <button
              onClick={onAccept}
              disabled={!agreed}
              data-testid="connect-dpa-accept"
              className="px-4 py-1.5 text-xs bg-emerald-600 hover:bg-emerald-700 disabled:bg-slate-300 disabled:cursor-not-allowed text-white font-semibold rounded">
              Accept &amp; Continue
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
