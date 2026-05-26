/**
 * DpdpaActions — owner-only block on PatientProfile that lets a clinic owner
 * fulfil DPDPA s. 12 (export) and s. 13 (erase) requests in one click.
 *
 * Lives behind an accordion that's collapsed by default, so it doesn't
 * dominate the patient view. Export streams a ZIP from the server.
 * Forget requires typing "ERASE PATIENT DATA" — a deliberate friction so
 * nobody triggers an irreversible action by mistake.
 */
import React, { useState } from 'react';
import axios from 'axios';
import { useNavigate } from 'react-router-dom';
import {
  ShieldAlert, Download, Trash2, ChevronDown, ChevronUp, Loader2, Lock,
} from 'lucide-react';
import { useAuth } from '../../AuthContext';

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;
const ELIGIBLE = new Set(['clinic_owner', 'super_admin', 'founder']);
const PHRASE = 'ERASE PATIENT DATA';

export default function DpdpaActions({ patient }) {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [confirmPhrase, setConfirmPhrase] = useState('');
  const [reason, setReason] = useState('');
  const [showEraseDialog, setShowEraseDialog] = useState(false);
  const [ok, setOk] = useState('');

  if (!user || !ELIGIBLE.has(user.role)) return null;
  if (!patient?.patient_id) return null;

  const doExport = async () => {
    setBusy(true); setErr(''); setOk('');
    try {
      const r = await axios.get(
        `${API}/patients/${patient.patient_id}/dpdpa-export.zip`,
        { responseType: 'blob' },
      );
      const blob = new Blob([r.data], { type: 'application/zip' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `AUDINEXA-DPDPA-${patient.mrd || patient.patient_id}.zip`;
      a.click();
      URL.revokeObjectURL(url);
      setOk('Export downloaded. Audit-log entry recorded.');
    } catch (e) {
      setErr(e?.response?.data?.detail || 'Export failed');
    } finally { setBusy(false); }
  };

  const doForget = async () => {
    if (confirmPhrase.trim() !== PHRASE) {
      setErr(`You must type "${PHRASE}" exactly.`);
      return;
    }
    setBusy(true); setErr(''); setOk('');
    try {
      await axios.post(`${API}/patients/${patient.patient_id}/dpdpa-forget`, {
        confirm_phrase: confirmPhrase,
        reason: reason || null,
      });
      setOk('Patient data anonymised under DPDPA s. 13. Returning to patient list…');
      setTimeout(() => navigate('/patients'), 1800);
    } catch (e) {
      setErr(e?.response?.data?.detail || 'Erase failed');
    } finally { setBusy(false); }
  };

  return (
    <div className="bg-white border border-slate-200 rounded-xl overflow-hidden" data-testid="dpdpa-block">
      <button
        onClick={() => setOpen(!open)}
        data-testid="dpdpa-toggle"
        className="w-full flex items-center justify-between px-4 py-3 hover:bg-slate-50"
      >
        <div className="flex items-center gap-2">
          <Lock size={15} className="text-slate-600" />
          <span className="font-bold text-[13px] text-slate-900">
            DPDPA · Patient data rights
          </span>
          <span className="hidden sm:inline text-[11px] text-slate-500">
            Export · Right to be forgotten
          </span>
        </div>
        {open ? <ChevronUp size={15} /> : <ChevronDown size={15} />}
      </button>

      {open && (
        <div className="p-4 border-t border-slate-200 space-y-4">
          {/* Export */}
          <section className="flex items-start gap-3 p-3 bg-slate-50 rounded-lg">
            <Download size={18} className="text-[#0F52BA] shrink-0 mt-0.5" />
            <div className="flex-1">
              <div className="font-semibold text-[13px] text-slate-900">Export patient data (s. 12)</div>
              <p className="text-[12px] text-slate-600 mt-0.5">
                Download a ZIP with every record linked to this patient —
                demographics, appointments, hearing tests, sales, invoices,
                service tickets, communications. Audit-logged.
              </p>
              <button
                onClick={doExport} disabled={busy}
                data-testid="dpdpa-export-btn"
                className="mt-2 inline-flex items-center gap-1.5 px-3 py-1.5 bg-[#0F52BA] text-white text-[12px] font-bold rounded hover:bg-[#0C4399] disabled:opacity-50"
              >
                {busy ? <Loader2 size={13} className="animate-spin" /> : <Download size={13} />}
                Download ZIP
              </button>
            </div>
          </section>

          {/* Forget */}
          <section className="flex items-start gap-3 p-3 bg-rose-50 border border-rose-200 rounded-lg">
            <ShieldAlert size={18} className="text-rose-600 shrink-0 mt-0.5" />
            <div className="flex-1">
              <div className="font-semibold text-[13px] text-slate-900">
                Erase patient data (s. 13 · "right to be forgotten")
              </div>
              <p className="text-[12px] text-slate-700 mt-0.5">
                Irreversibly anonymises the patient: replaces name, mobile, email and
                free-text notes with one-way hashes. Numeric billing data is preserved
                for GST &amp; audit compliance. <b>This cannot be undone.</b>
              </p>

              {!showEraseDialog ? (
                <button
                  onClick={() => { setShowEraseDialog(true); setErr(''); }}
                  data-testid="dpdpa-erase-start"
                  className="mt-2 inline-flex items-center gap-1.5 px-3 py-1.5 bg-rose-600 text-white text-[12px] font-bold rounded hover:bg-rose-700"
                >
                  <Trash2 size={13} /> Start erase
                </button>
              ) : (
                <div className="mt-3 space-y-2">
                  <input
                    value={confirmPhrase}
                    onChange={(e) => setConfirmPhrase(e.target.value)}
                    placeholder={`Type "${PHRASE}" to confirm`}
                    data-testid="dpdpa-erase-phrase"
                    className="w-full px-3 py-2 border border-rose-300 rounded text-[13px] font-mono"
                  />
                  <input
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                    placeholder="Reason (optional, for audit log)"
                    data-testid="dpdpa-erase-reason"
                    className="w-full px-3 py-2 border border-slate-300 rounded text-[12px]"
                  />
                  <div className="flex gap-2">
                    <button
                      onClick={doForget}
                      disabled={busy || confirmPhrase.trim() !== PHRASE}
                      data-testid="dpdpa-erase-confirm"
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-rose-600 text-white text-[12px] font-bold rounded hover:bg-rose-700 disabled:opacity-40 disabled:cursor-not-allowed"
                    >
                      {busy ? <Loader2 size={13} className="animate-spin" /> : <Trash2 size={13} />}
                      Erase permanently
                    </button>
                    <button
                      onClick={() => { setShowEraseDialog(false); setConfirmPhrase(''); setReason(''); setErr(''); }}
                      className="px-3 py-1.5 text-[12px] text-slate-600 hover:text-slate-900"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              )}
            </div>
          </section>

          {err && (
            <div className="px-3 py-2 bg-rose-50 border border-rose-200 rounded text-[12px] text-rose-700" data-testid="dpdpa-error">
              {err}
            </div>
          )}
          {ok && (
            <div className="px-3 py-2 bg-emerald-50 border border-emerald-200 rounded text-[12px] text-emerald-800" data-testid="dpdpa-success">
              {ok}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
