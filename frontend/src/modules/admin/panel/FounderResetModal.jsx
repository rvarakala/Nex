/**
 * FounderResetModal — one-click UI for the /api/admin/v2/founder/reset endpoint.
 *
 * Flow:
 *   1. User clicks the parent "Reset Test Data" button (opens this modal in
 *      "preview" mode).
 *   2. Modal calls the endpoint with `dry_run: true` and renders:
 *        • Counts of what WILL be deleted (leads / invoices / clinics)
 *        • The full preserved list with a reason chip per clinic
 *        • A scrollable sample of the first 30 clinics that will be purged
 *        • The subscription_status distribution so the founder can spot a
 *          real customer that isn't tagged yet.
 *   3. User types the confirmation phrase → Wipe button unlocks.
 *   4. Wipe button hits the endpoint with `dry_run: false` and shows the
 *      final receipt.
 */
import React, { useEffect, useState } from 'react';
import axios from 'axios';
import { X, AlertTriangle, ShieldCheck, Loader2, CheckCircle2 } from 'lucide-react';

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;
const CONFIRM_PHRASE = 'WIPE-EVERYTHING-EXCEPT-PLATFORM';

export default function FounderResetModal({ onClose, onDone }) {
  const [phase, setPhase] = useState('loading');     // loading | preview | wiping | done | error
  const [preview, setPreview] = useState(null);
  const [result, setResult]   = useState(null);
  const [error, setError]     = useState('');
  const [typed, setTyped]     = useState('');

  useEffect(() => {
    (async () => {
      try {
        const r = await axios.post(`${API}/admin/v2/founder/reset`, {
          confirm: CONFIRM_PHRASE, dry_run: true,
        });
        setPreview(r.data);
        setPhase('preview');
      } catch (e) {
        setError(e?.response?.data?.detail || 'Preview failed');
        setPhase('error');
      }
    })();
  }, []);

  const executeWipe = async () => {
    if (typed !== CONFIRM_PHRASE) return;
    setPhase('wiping');
    try {
      const r = await axios.post(`${API}/admin/v2/founder/reset`, {
        confirm: CONFIRM_PHRASE, dry_run: false,
      });
      setResult(r.data);
      setPhase('done');
      onDone && onDone(r.data);
    } catch (e) {
      setError(e?.response?.data?.detail || 'Wipe failed');
      setPhase('error');
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/70 backdrop-blur-sm flex items-center justify-center p-4" data-testid="founder-reset-modal">
      <div className="bg-white rounded-lg shadow-2xl w-full max-w-3xl max-h-[92vh] flex flex-col overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-rose-100 bg-rose-50">
          <div className="flex items-center gap-2">
            <AlertTriangle className="text-rose-600" size={18} />
            <h2 className="text-base font-bold text-rose-900">Founder Danger Zone · Reset Test Data</h2>
          </div>
          <button onClick={onClose} className="p-1 hover:bg-rose-100 rounded" data-testid="reset-modal-close">
            <X size={16} className="text-rose-700" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          {phase === 'loading' && (
            <div className="flex items-center gap-2 text-slate-600 text-sm py-8 justify-center">
              <Loader2 className="animate-spin" size={16} /> Loading preview…
            </div>
          )}

          {phase === 'error' && (
            <div className="bg-rose-100 border border-rose-300 rounded p-4 text-sm text-rose-800" data-testid="reset-modal-error">
              <div className="font-semibold mb-1">Something went wrong</div>
              <div>{error}</div>
            </div>
          )}

          {phase === 'preview' && preview && (
            <PreviewBody preview={preview} typed={typed} setTyped={setTyped} />
          )}

          {phase === 'wiping' && (
            <div className="flex items-center gap-2 text-slate-700 text-sm py-8 justify-center">
              <Loader2 className="animate-spin" size={16} /> Wiping data… this takes 1-3 seconds.
            </div>
          )}

          {phase === 'done' && result && (
            <DoneBody result={result} />
          )}
        </div>

        {/* Footer actions */}
        {phase === 'preview' && (
          <div className="border-t border-slate-200 px-5 py-3 flex justify-between items-center gap-3 bg-slate-50">
            <div className="text-[11px] text-slate-500">
              Type <span className="font-mono bg-rose-100 px-1 py-0.5 rounded text-rose-800">{CONFIRM_PHRASE}</span> above to unlock.
            </div>
            <div className="flex gap-2">
              <button
                onClick={onClose}
                className="px-3 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-100 rounded"
                data-testid="reset-modal-cancel"
              >
                Cancel
              </button>
              <button
                disabled={typed !== CONFIRM_PHRASE}
                onClick={executeWipe}
                data-testid="reset-modal-wipe-btn"
                className="px-4 py-1.5 text-xs font-semibold text-white bg-rose-600 hover:bg-rose-700 disabled:opacity-40 disabled:cursor-not-allowed rounded inline-flex items-center gap-1.5"
              >
                <AlertTriangle size={12} /> Wipe {preview?.would_delete?.clinics_to_delete || 0} clinic(s) &amp; {preview?.would_delete?.leads || 0} lead(s)
              </button>
            </div>
          </div>
        )}
        {phase === 'done' && (
          <div className="border-t border-slate-200 px-5 py-3 flex justify-end bg-slate-50">
            <button
              onClick={onClose}
              className="px-4 py-1.5 text-xs font-semibold text-white bg-emerald-600 hover:bg-emerald-700 rounded"
              data-testid="reset-modal-done-close"
            >
              Close &amp; refresh dashboard
            </button>
          </div>
        )}
        {(phase === 'loading' || phase === 'error' || phase === 'wiping') && (
          <div className="border-t border-slate-200 px-5 py-3 flex justify-end bg-slate-50">
            <button onClick={onClose} className="px-3 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-100 rounded">Close</button>
          </div>
        )}
      </div>
    </div>
  );
}

// ---- Sub-components -----------------------------------------------------

function PreviewBody({ preview, typed, setTyped }) {
  const w = preview.would_delete;
  const stats = preview.subscription_status_distribution || {};
  const preserved = preview.preserved_clinics || [];
  const sample = preview.sample_clinics_to_delete || [];
  const hasRealCustomerWarning = stats.active === 0 && w.clinics_to_delete > 0;

  return (
    <>
      {/* Big counts */}
      <div className="grid grid-cols-3 gap-3">
        <Tile label="Leads to delete" value={w.leads} testid="preview-leads-count" />
        <Tile label="Tenant invoices to delete" value={w.tenant_invoices} testid="preview-invoices-count" />
        <Tile label="Clinics to delete" value={w.clinics_to_delete} accent="rose" testid="preview-clinics-count" />
      </div>

      {/* Preserved */}
      <div>
        <div className="text-[11px] uppercase tracking-wider font-semibold text-emerald-700 mb-1.5 flex items-center gap-1">
          <ShieldCheck size={12} /> Preserved ({preserved.length})
        </div>
        <div className="bg-emerald-50 border border-emerald-200 rounded max-h-40 overflow-y-auto text-xs">
          {preserved.length === 0
            ? <div className="p-3 text-slate-500">Nothing to preserve.</div>
            : preserved.map((c) => (
              <div key={c.clinic_id} className="flex items-center justify-between px-3 py-1.5 border-b border-emerald-100 last:border-0">
                <div className="min-w-0">
                  <div className="font-semibold text-slate-800 truncate">{c.name || c.clinic_id}</div>
                  <div className="text-[10.5px] text-slate-500 font-mono truncate">{c.clinic_id}{c.owner_email ? ` · ${c.owner_email}` : ''}</div>
                </div>
                <span className="text-[10px] uppercase font-semibold px-1.5 py-0.5 rounded bg-emerald-200 text-emerald-800 shrink-0 ml-2">{c.reason}</span>
              </div>
            ))}
        </div>
      </div>

      {/* Subscription-status warning */}
      {hasRealCustomerWarning && (
        <div className="bg-amber-50 border border-amber-300 rounded p-3 text-xs text-amber-900" data-testid="reset-modal-warning">
          <div className="font-semibold flex items-center gap-1 mb-1">
            <AlertTriangle size={12} /> No paying customers detected
          </div>
          <div>
            None of your clinics have <span className="font-mono bg-amber-100 px-1 rounded">subscription_status=&quot;active&quot;</span> set.
            If any of the {w.clinics_to_delete} clinics below are real paying customers,
            cancel this wipe and tag them first.
          </div>
        </div>
      )}

      {/* Sample delete list */}
      <div>
        <div className="text-[11px] uppercase tracking-wider font-semibold text-rose-700 mb-1.5">
          Sample of clinics that will be DELETED (first 30 of {w.clinics_to_delete})
        </div>
        <div className="bg-rose-50 border border-rose-200 rounded max-h-52 overflow-y-auto text-xs" data-testid="reset-modal-sample-list">
          {sample.length === 0
            ? <div className="p-3 text-slate-500">Nothing queued for deletion. You&apos;re already clean.</div>
            : sample.map((c) => (
              <div key={c.clinic_id} className="flex items-center justify-between px-3 py-1.5 border-b border-rose-100 last:border-0">
                <div className="min-w-0">
                  <div className="font-semibold text-slate-800 truncate">{c.name || c.clinic_id}</div>
                  <div className="text-[10.5px] text-slate-500 font-mono truncate">{c.clinic_id}{c.owner_email ? ` · ${c.owner_email}` : ''}</div>
                </div>
                <div className="text-[10px] uppercase font-semibold text-slate-500 shrink-0 ml-2">
                  {c.subscription_tier} · {c.subscription_status}
                </div>
              </div>
            ))}
        </div>
      </div>

      {/* Confirmation input */}
      {w.clinics_to_delete > 0 || w.leads > 0 || w.tenant_invoices > 0 ? (
        <div>
          <label className="text-[11px] uppercase tracking-wider font-semibold text-slate-700 block mb-1.5">
            Type <span className="font-mono bg-rose-100 text-rose-800 px-1 py-0.5 rounded">{CONFIRM_PHRASE}</span> to unlock the Wipe button
          </label>
          <input
            type="text"
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            placeholder="Type the phrase exactly…"
            data-testid="reset-modal-confirm-input"
            className="w-full px-3 py-2 text-sm font-mono border border-slate-300 rounded focus:outline-none focus:border-rose-500 focus:ring-1 focus:ring-rose-500"
            autoComplete="off"
            spellCheck="false"
          />
        </div>
      ) : (
        <div className="bg-emerald-50 border border-emerald-200 rounded p-3 text-sm text-emerald-800 flex items-center gap-2" data-testid="reset-modal-already-clean">
          <CheckCircle2 size={16} /> Database is already clean — nothing to wipe.
        </div>
      )}
    </>
  );
}

function DoneBody({ result }) {
  const w = result.wiped;
  return (
    <div className="space-y-3" data-testid="reset-modal-done">
      <div className="bg-emerald-50 border border-emerald-200 rounded p-4 flex items-start gap-3">
        <CheckCircle2 className="text-emerald-600 shrink-0 mt-0.5" size={18} />
        <div className="text-sm">
          <div className="font-bold text-emerald-900">Wipe complete</div>
          <div className="text-emerald-800 mt-1">Your platform is now clean. The dashboard will refresh once you close this modal.</div>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <Tile label="Leads removed" value={w.leads} />
        <Tile label="Invoices removed" value={w.tenant_invoices} />
        <Tile label="Clinics purged" value={w.clinics_deleted} />
        <Tile label="Orphan users reaped" value={w.orphan_users_reaped} />
      </div>
      {result.preserved_clinic_ids && result.preserved_clinic_ids.length > 0 && (
        <div className="text-xs text-slate-500">
          <span className="font-semibold text-slate-700">Kept safe:</span> {result.preserved_clinic_ids.join(', ')}
        </div>
      )}
    </div>
  );
}

function Tile({ label, value, accent, testid }) {
  const tone = accent === 'rose'
    ? 'bg-rose-100 border-rose-300 text-rose-900'
    : 'bg-slate-50 border-slate-200 text-slate-900';
  return (
    <div className={`border rounded p-3 ${tone}`} data-testid={testid}>
      <div className="text-[10px] uppercase tracking-wider font-semibold opacity-70">{label}</div>
      <div className="text-2xl font-bold tabular-nums mt-0.5">{value}</div>
    </div>
  );
}
