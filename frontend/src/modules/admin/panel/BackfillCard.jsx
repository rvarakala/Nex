/**
 * BackfillCard — founder-only "Run data backfill" tool.
 *
 * Wraps `/api/admin/v2/backfill/serial-current-patient-id`. Dry-run by
 * default; explicit "Apply" needed to write. Output renders inline so
 * the founder can sanity-check before pulling the trigger on production.
 *
 * Used inside SystemHealthPage.
 */
import React, { useState } from 'react';
import axios from 'axios';
import { Hammer, Loader2, AlertTriangle, CheckCircle2 } from 'lucide-react';

const API = process.env.REACT_APP_BACKEND_URL + '/api';

export default function BackfillCard() {
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);
  const [err, setErr] = useState(null);

  const run = async (apply) => {
    if (apply) {
      const confirmed = window.confirm(
        'APPLY backfill across ALL tenants?\n\n' +
        'This will permanently stamp current_patient_id on every legacy serial_items row that has a matching paid sale.\n\n' +
        'Always run a DRY RUN first.'
      );
      if (!confirmed) return;
    }
    setBusy(true); setErr(null); setResult(null);
    try {
      const r = await axios.post(
        `${API}/admin/v2/backfill/serial-current-patient-id`,
        { apply: !!apply },
      );
      setResult(r.data);
    } catch (e) {
      setErr(e?.response?.data?.detail || e.message || 'Backfill failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="bg-white rounded-xl border border-slate-200 p-4" data-testid="backfill-card">
      <div className="flex items-center gap-2 mb-2">
        <Hammer size={16} className="text-amber-600" />
        <h3 className="font-bold text-slate-900 text-sm">Data Maintenance — Backfill serial_items.current_patient_id</h3>
      </div>
      <p className="text-[11.5px] text-slate-500 leading-relaxed">
        Legacy SOLD / AT_SERVICE serial_items rows that lost their <code className="px-1 py-0.5 bg-slate-100 rounded text-[10px]">current_patient_id</code> link
        because of a pre-2026-05-09 sale-flow bug. Re-stamps the field by looking up the matching paid/invoiced ha_sales row.
        <strong className="text-amber-700"> Always dry-run first.</strong> Idempotent — safe to re-run.
      </p>

      <div className="mt-3 flex items-center gap-2">
        <button
          type="button"
          disabled={busy}
          onClick={() => run(false)}
          data-testid="backfill-dry-run-btn"
          className="px-3 py-1.5 text-xs font-semibold rounded-lg border border-slate-300 bg-white hover:bg-slate-50 disabled:opacity-50 disabled:cursor-not-allowed text-slate-700 flex items-center gap-1.5"
        >
          {busy ? <Loader2 size={12} className="animate-spin" /> : <Hammer size={12} />}
          Dry run
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => run(true)}
          data-testid="backfill-apply-btn"
          className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-amber-600 hover:bg-amber-700 disabled:opacity-50 disabled:cursor-not-allowed text-white flex items-center gap-1.5"
        >
          {busy ? <Loader2 size={12} className="animate-spin" /> : <AlertTriangle size={12} />}
          Apply (writes)
        </button>
      </div>

      {err && (
        <div className="mt-3 p-2 bg-rose-50 border border-rose-200 rounded text-[11.5px] text-rose-700 font-mono break-all" data-testid="backfill-error">
          {err}
        </div>
      )}

      {result && (
        <div
          className={`mt-3 p-3 rounded-lg border text-[11.5px] ${
            result.dry_run ? 'bg-slate-50 border-slate-200' : 'bg-emerald-50 border-emerald-200'
          }`}
          data-testid="backfill-result"
        >
          <div className="flex items-center gap-2 font-bold text-slate-800 mb-2">
            <CheckCircle2 size={14} className={result.dry_run ? 'text-slate-500' : 'text-emerald-600'} />
            {result.dry_run ? 'Dry-run complete' : 'Applied'}
          </div>
          <div className="grid grid-cols-3 gap-2 mb-2">
            <Stat label="Candidates" value={result.candidates} />
            <Stat label={result.dry_run ? 'Would fix' : 'Fixed'} value={result.backfilled} />
            <Stat label="Skipped (no match)" value={result.skipped_no_match} />
          </div>
          {Object.keys(result.fixed_per_clinic || {}).length > 0 && (
            <div className="mt-2 pt-2 border-t border-slate-200/60">
              <div className="text-[10px] uppercase tracking-wider text-slate-500 font-bold mb-1">Per-clinic breakdown</div>
              <ul className="space-y-0.5">
                {Object.entries(result.fixed_per_clinic).map(([cid, n]) => (
                  <li key={cid} className="font-mono text-[10.5px] text-slate-700">{cid}: <strong>{n}</strong></li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function Stat({ label, value }) {
  return (
    <div>
      <div className="text-[9px] uppercase tracking-wider text-slate-500 font-bold">{label}</div>
      <div className="font-mono text-base font-bold text-slate-800 tabular-nums">{value ?? 0}</div>
    </div>
  );
}
