/**
 * MergePatientsModal — Owner-only tool to collapse two accidentally-created
 * duplicate patient records into a single canonical row.
 *
 * Workflow:
 *   1. The current patient (from PatientProfilePage) is the SECONDARY
 *      (will be soft-marked `merged_into=<primary>, active=false`).
 *   2. User searches for the PRIMARY (surviving) patient via
 *      `/patients/check-duplicate` + `/patients?search=`.
 *   3. On pick → POST `/patients/merge` with `dry_run=true` shows the
 *      impact preview ("this will move 8 appointments, 3 invoices…")
 *      pulled from the whitelisted collections on the backend.
 *   4. Explicit "Confirm merge" → POST with `dry_run=false` rewrites
 *      the FKs, soft-marks secondary, writes activity log, and returns.
 *   5. Success → navigate to primary patient's profile.
 *
 * UX guardrails:
 *   - Search is debounced 300ms.
 *   - The current patient never appears in its own suggestion list.
 *   - Merged patients are already filtered server-side.
 *   - The dry-run preview MUST render before the "Confirm" button
 *     enables — no way to skip the impact review.
 *   - Modal uses ModalShell-style mobile-safe max-height so the primary
 *     CTA doesn't sit behind the mobile bottom-nav.
 */
import React, { useEffect, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import axios from 'axios';
import { X, Search, GitMerge, AlertTriangle, ArrowRight, Loader2 } from 'lucide-react';

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;

// Human-friendly labels for the whitelisted collections. Kept in sync
// with `_MERGEABLE_COLLECTIONS` in backend/routers/patients.py.
const COLL_LABELS = {
  appointments: 'Appointments',
  invoices: 'Invoices',
  service_tickets: 'Service tickets',
  cancellation_logs: 'Cancellation logs',
  dpdpa_actions: 'DPDPA actions',
  reminder_logs: 'Reminder logs',
  test_sessions: 'Diagnostic sessions',
  ha_sales: 'HA sales',
  ha_fittings: 'Fittings',
  waitlist: 'Waitlist entries',
  referral_notifications: 'Referral notifications',
  quotations: 'Quotations',
  hearing_report_versions: 'Report versions',
  tokens: 'Tokens',
  ha_trials: 'Trials',
  patient_feedback: 'Feedback',
  ha_amc_contracts: 'AMC contracts',
  report_deliveries: 'Report deliveries',
  ha_quotes: 'HA quotes',
  ha_quick_sales: 'Quick sales',
  patient_notes: 'Clinical notes',
};

export default function MergePatientsModal({ secondary, onClose }) {
  const navigate = useNavigate();
  const [query, setQuery] = useState('');
  const [candidates, setCandidates] = useState([]);
  const [searching, setSearching] = useState(false);
  const [primary, setPrimary] = useState(null);
  const [preview, setPreview] = useState(null); // { preview: {coll:n}, total_rows_affected }
  const [loadingPreview, setLoadingPreview] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  // Debounced search — 300ms so the front-desk doesn't hammer the DB
  // as they type. Skips itself when the secondary's own MRD would be
  // the top hit (avoids self-merge suggestion).
  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) { setCandidates([]); return; }
    let alive = true;
    setSearching(true);
    const t = setTimeout(async () => {
      try {
        const r = await axios.get(`${API}/patients`, { params: { search: q, limit: 8 } });
        if (!alive) return;
        const rows = Array.isArray(r.data) ? r.data : (r.data?.items || []);
        // Filter out the current (secondary) patient so users can't
        // accidentally try to merge a row into itself.
        setCandidates(rows.filter((p) => p.patient_id !== secondary.patient_id));
      } catch {
        if (alive) setCandidates([]);
      } finally {
        if (alive) setSearching(false);
      }
    }, 300);
    return () => { alive = false; clearTimeout(t); };
  }, [query, secondary.patient_id]);

  // Fetch the dry-run impact whenever a primary is picked. We do this
  // eagerly (not on button-press) so the user sees the preview before
  // they have to think about clicking "Confirm merge".
  const runDryRun = useCallback(async (primaryPatient) => {
    setLoadingPreview(true); setErr('');
    try {
      const r = await axios.post(`${API}/patients/merge`, {
        primary_patient_id: primaryPatient.patient_id,
        secondary_patient_id: secondary.patient_id,
        dry_run: true,
      });
      setPreview(r.data);
    } catch (e) {
      setErr(e?.response?.data?.detail || e.message || 'Could not preview merge.');
      setPreview(null);
    } finally {
      setLoadingPreview(false);
    }
  }, [secondary.patient_id]);

  const pickPrimary = (p) => {
    setPrimary(p);
    setCandidates([]);
    setQuery('');
    runDryRun(p);
  };

  const confirmMerge = async () => {
    if (!primary || !preview) return;
    setBusy(true); setErr('');
    try {
      await axios.post(`${API}/patients/merge`, {
        primary_patient_id: primary.patient_id,
        secondary_patient_id: secondary.patient_id,
        dry_run: false,
      });
      // Bounce to the surviving primary — the secondary is now soft-
      // marked and would 404 the profile page's fetch anyway.
      navigate(`/patients/${primary.patient_id}`);
      onClose?.();
    } catch (e) {
      setErr(e?.response?.data?.detail || e.message || 'Merge failed.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4 pb-24 md:pb-4"
      onClick={(e) => { if (e.target === e.currentTarget) onClose?.(); }}
      data-testid="merge-modal"
    >
      <div className="bg-white rounded-xl shadow-2xl w-[620px] max-w-full max-h-[calc(100dvh-96px)] sm:max-h-[85vh] flex flex-col">
        <header className="px-4 py-3 border-b border-slate-200 flex items-center justify-between flex-shrink-0">
          <h3 className="text-sm font-bold text-slate-900 flex items-center gap-2">
            <GitMerge size={16} className="text-indigo-600" />
            Merge patient records
          </h3>
          <button
            onClick={onClose}
            data-testid="merge-close"
            className="p-1 hover:bg-slate-100 rounded text-slate-500"
          ><X size={16} /></button>
        </header>

        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {/* Secondary card — always visible so the user knows which record
              is going to be soft-deleted. Rose-tinted to reinforce the
              destructive nature. */}
          <div className="border border-rose-200 bg-rose-50/50 rounded-lg p-3" data-testid="merge-secondary">
            <div className="text-[10px] font-bold text-rose-700 uppercase tracking-wider mb-1">This record (will be closed & re-parented)</div>
            <div className="text-sm font-semibold text-slate-900">{secondary.name}</div>
            <div className="text-[11px] text-slate-500 mt-0.5">
              MRD <span className="font-mono">{secondary.mrd || secondary.patient_id}</span>
              {secondary.mobile && <> · 📱 {secondary.mobile}</>}
              {secondary.email && <> · ✉ {secondary.email}</>}
            </div>
          </div>

          {/* Primary picker */}
          {!primary && (
            <div data-testid="merge-search-block">
              <label className="text-[11px] font-semibold text-slate-700 mb-1 block">Search the surviving (primary) patient</label>
              <div className="relative">
                <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
                <input
                  type="text"
                  autoFocus
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Name, phone or MRD…"
                  data-testid="merge-search-input"
                  className="w-full pl-8 pr-3 py-2 text-[13px] border border-slate-300 rounded-md focus:outline-none focus:ring-2 focus:ring-indigo-400"
                />
              </div>

              <div className="mt-2 space-y-1 min-h-[40px]">
                {searching && <div className="text-[11px] text-slate-400 italic px-2 py-1.5">Searching…</div>}
                {!searching && query.length >= 2 && candidates.length === 0 && (
                  <div className="text-[11px] text-slate-500 italic px-2 py-1.5" data-testid="merge-no-results">
                    No matching patients found.
                  </div>
                )}
                {candidates.map((c) => (
                  <button
                    key={c.patient_id}
                    type="button"
                    onClick={() => pickPrimary(c)}
                    data-testid={`merge-candidate-${c.patient_id}`}
                    className="w-full text-left border border-slate-200 hover:border-emerald-400 hover:bg-emerald-50 rounded-md px-3 py-2 transition"
                  >
                    <div className="text-[13px] font-semibold text-slate-900">{c.name}</div>
                    <div className="text-[11px] text-slate-500 mt-0.5">
                      MRD <span className="font-mono">{c.mrd || c.patient_id}</span>
                      {c.mobile && <> · 📱 {c.mobile}</>}
                      {c.age && <> · {c.age}y</>}
                      {c.gender && <> · {c.gender}</>}
                    </div>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Preview */}
          {primary && (
            <div className="space-y-3" data-testid="merge-preview-block">
              <div className="flex items-center justify-center gap-3 text-slate-400">
                <div className="text-center">
                  <div className="text-[9px] font-bold text-rose-700 uppercase tracking-wider">Closes</div>
                  <div className="text-[11px] font-semibold text-slate-800">{secondary.name}</div>
                </div>
                <ArrowRight size={16} className="text-indigo-500" />
                <div className="text-center">
                  <div className="text-[9px] font-bold text-emerald-700 uppercase tracking-wider">Keeps</div>
                  <div className="text-[11px] font-semibold text-slate-800">{primary.name}</div>
                </div>
              </div>

              <div className="border border-emerald-200 bg-emerald-50/50 rounded-lg p-3" data-testid="merge-primary">
                <div className="text-[10px] font-bold text-emerald-700 uppercase tracking-wider mb-1">Surviving record</div>
                <div className="text-sm font-semibold text-slate-900">{primary.name}</div>
                <div className="text-[11px] text-slate-500 mt-0.5">
                  MRD <span className="font-mono">{primary.mrd || primary.patient_id}</span>
                  {primary.mobile && <> · 📱 {primary.mobile}</>}
                  {primary.email && <> · ✉ {primary.email}</>}
                </div>
                <button
                  type="button"
                  onClick={() => { setPrimary(null); setPreview(null); setErr(''); }}
                  data-testid="merge-change-primary"
                  className="text-[10px] font-semibold text-slate-500 hover:text-slate-800 underline mt-1.5"
                >
                  Change primary
                </button>
              </div>

              {loadingPreview && (
                <div className="flex items-center gap-2 text-[12px] text-slate-500 justify-center py-3" data-testid="merge-preview-loading">
                  <Loader2 size={13} className="animate-spin" /> Calculating impact…
                </div>
              )}

              {preview && (
                <div className="border border-slate-200 rounded-lg overflow-hidden" data-testid="merge-preview-table">
                  <div className="px-3 py-2 bg-slate-50 border-b border-slate-200 flex items-center justify-between">
                    <span className="text-[11px] font-bold text-slate-700 uppercase tracking-wider">Impact preview</span>
                    <span className="text-[11px] font-bold text-indigo-700" data-testid="merge-total-rows">
                      {preview.total_rows_affected || 0} rows will move
                    </span>
                  </div>
                  {Object.keys(preview.preview || {}).length === 0 ? (
                    <div className="px-3 py-3 text-[12px] text-slate-500 italic" data-testid="merge-preview-empty">
                      No linked records — this will simply close the duplicate record.
                    </div>
                  ) : (
                    <ul className="divide-y divide-slate-100">
                      {Object.entries(preview.preview || {})
                        .sort((a, b) => b[1] - a[1])
                        .map(([coll, n]) => (
                          <li key={coll} className="px-3 py-1.5 flex items-center justify-between text-[12px]" data-testid={`merge-row-${coll}`}>
                            <span className="text-slate-700">{COLL_LABELS[coll] || coll}</span>
                            <span className="font-semibold text-slate-900">{n}</span>
                          </li>
                        ))}
                    </ul>
                  )}
                </div>
              )}

              <div className="flex items-start gap-2 text-[11.5px] text-amber-800 bg-amber-50 border border-amber-200 rounded-md px-3 py-2" data-testid="merge-warning">
                <AlertTriangle size={13} className="flex-shrink-0 mt-0.5" />
                <span>
                  <b>This cannot be undone.</b> The secondary record will be closed and every linked appointment / invoice / note above will be re-parented to the surviving patient. Activity logs stay intact for audit.
                </span>
              </div>
            </div>
          )}

          {err && (
            <div className="text-[12px] text-rose-700 bg-rose-50 border border-rose-200 rounded-md px-3 py-2" data-testid="merge-error">
              {typeof err === 'string' ? err : JSON.stringify(err)}
            </div>
          )}
        </div>

        <footer className="px-4 py-2.5 border-t border-slate-200 bg-slate-50 flex items-center justify-between gap-2 flex-shrink-0">
          <button
            type="button"
            onClick={onClose}
            data-testid="merge-cancel"
            className="px-3 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-200 rounded"
          >Cancel</button>
          <button
            type="button"
            disabled={!primary || !preview || busy || loadingPreview}
            onClick={confirmMerge}
            data-testid="merge-confirm"
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-white bg-indigo-600 hover:bg-indigo-700 rounded disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {busy ? <Loader2 size={12} className="animate-spin" /> : <GitMerge size={12} />}
            {busy ? 'Merging…' : 'Confirm merge'}
          </button>
        </footer>
      </div>
    </div>
  );
}
