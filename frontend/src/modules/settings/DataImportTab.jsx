/**
 * Data Import — Patients (CSV).
 *
 * Three-step wizard that matches the backend /api/imports/patients/* contract:
 *   1) Download CSV template
 *   2) Upload + preview (server validates, dedupes against existing data)
 *   3) Commit (writes only `ok` rows, generates MRDs where missing)
 *
 * Restricted to clinic_owner + super_admin (gated server-side too).
 */
import React, { useEffect, useRef, useState } from 'react';
import axios from 'axios';
import { Upload, Download, FileSpreadsheet, CheckCircle2, AlertTriangle, SkipForward, Loader2, RotateCcw, History } from 'lucide-react';
import { toast } from 'sonner';

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;

const STATUS_META = {
  ok:   { Icon: CheckCircle2, text: 'text-emerald-700', bg: 'bg-emerald-50',  ring: 'ring-emerald-200', label: 'Will create' },
  skip: { Icon: SkipForward,  text: 'text-amber-700',   bg: 'bg-amber-50',    ring: 'ring-amber-200',   label: 'Skip — duplicate' },
  fail: { Icon: AlertTriangle,text: 'text-rose-700',    bg: 'bg-rose-50',     ring: 'ring-rose-200',    label: 'Validation error' },
};

export default function DataImportTab() {
  const fileRef = useRef(null);
  const [file, setFile] = useState(null);
  const [previewing, setPreviewing] = useState(false);
  const [committing, setCommitting] = useState(false);
  const [preview, setPreview] = useState(null);   // { import_id, tally, rows }
  const [commitResult, setCommitResult] = useState(null); // { tally, failure_details }
  const [filter, setFilter] = useState('all');    // all | ok | skip | fail
  const [history, setHistory] = useState([]);

  const loadHistory = async () => {
    try {
      const r = await axios.get(`${API}/imports/patients/recent`);
      setHistory(r.data || []);
    } catch (err) {
      // History is non-critical — don't surface a toast for transient blips.
      console.warn('[DataImport] history fetch failed:', err?.message);
    }
  };
  useEffect(() => { loadHistory(); }, []);

  // ---- Step 1: template -------------------------------------------------
  const handleDownloadTemplate = async () => {
    try {
      const r = await axios.get(`${API}/imports/patients/template`, { responseType: 'blob' });
      const blob = new Blob([r.data], { type: 'text/csv' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'audinexa_patients_template.csv';
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      toast.error(err?.response?.data?.detail || 'Could not download template');
    }
  };

  // ---- Step 2: preview --------------------------------------------------
  const handlePreview = async () => {
    if (!file) { toast.error('Pick a CSV file first'); return; }
    setPreviewing(true);
    setPreview(null);
    setCommitResult(null);
    try {
      const fd = new FormData();
      fd.append('file', file);
      const r = await axios.post(`${API}/imports/patients/preview`, fd, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      setPreview(r.data);
      const t = r.data.tally;
      toast.success(`Parsed ${t.total} rows — ${t.will_create} ready, ${t.will_skip} duplicates, ${t.will_fail} errors.`);
    } catch (err) {
      toast.error(err?.response?.data?.detail || 'Preview failed');
    } finally {
      setPreviewing(false);
    }
  };

  // ---- Step 3: commit ---------------------------------------------------
  const handleCommit = async () => {
    if (!preview?.import_id) return;
    if (preview.tally.will_create === 0) {
      toast.error('Nothing to import — every row was skipped or failed.');
      return;
    }
    if (!window.confirm(`Import ${preview.tally.will_create} new patient${preview.tally.will_create === 1 ? '' : 's'}? This cannot be undone.`)) return;

    setCommitting(true);
    try {
      const r = await axios.post(`${API}/imports/patients/commit`, { import_id: preview.import_id });
      setCommitResult(r.data);
      const t = r.data.tally || {};
      toast.success(`Imported ${t.created || 0} patients (${t.skipped || 0} skipped, ${t.failed || 0} failed).`);
      loadHistory();
    } catch (err) {
      toast.error(err?.response?.data?.detail || 'Import failed');
    } finally {
      setCommitting(false);
    }
  };

  const handleReset = () => {
    setFile(null);
    setPreview(null);
    setCommitResult(null);
    setFilter('all');
    if (fileRef.current) fileRef.current.value = '';
  };

  // ---------------------------------------------------------------------
  const visibleRows = preview?.rows
    ? (filter === 'all' ? preview.rows : preview.rows.filter((r) => r.status === filter))
    : [];

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-6" data-testid="data-import-tab">
      <header>
        <h1 className="text-xl font-bold text-slate-800 flex items-center gap-2">
          <FileSpreadsheet size={20} className="text-indigo-600" />
          Patient Data Import
        </h1>
        <p className="text-sm text-slate-500 mt-1">
          Migrate your existing patient records to AUDINEXA. Upload a CSV, preview the parse, then confirm.
          Mobile / MRD duplicates are skipped automatically.
        </p>
      </header>

      {/* Step 1 — Download template */}
      <Step number={1} title="Download the CSV template">
        <p className="text-[13px] text-slate-600 mb-3">
          Required columns: <code className="text-[12px] bg-slate-100 px-1.5 py-0.5 rounded">name</code>,
          {' '}<code className="text-[12px] bg-slate-100 px-1.5 py-0.5 rounded">age</code> or
          {' '}<code className="text-[12px] bg-slate-100 px-1.5 py-0.5 rounded">dob</code>,
          {' '}<code className="text-[12px] bg-slate-100 px-1.5 py-0.5 rounded">gender</code>,
          and at least one of {' '}<code className="text-[12px] bg-slate-100 px-1.5 py-0.5 rounded">mobile</code> /
          {' '}<code className="text-[12px] bg-slate-100 px-1.5 py-0.5 rounded">email</code>.
          Existing MRDs from your old system are preserved if provided in the
          {' '}<code className="text-[12px] bg-slate-100 px-1.5 py-0.5 rounded">existing_mrd</code> column.
        </p>
        <button
          type="button"
          onClick={handleDownloadTemplate}
          data-testid="import-download-template"
          className="inline-flex items-center gap-2 px-4 py-2 text-[13px] font-semibold text-indigo-700 bg-indigo-50 hover:bg-indigo-100 border border-indigo-200 rounded-lg transition-colors"
        >
          <Download size={15} />
          Download patients_template.csv
        </button>
      </Step>

      {/* Step 2 — Upload */}
      <Step number={2} title="Upload your filled CSV">
        <div className="flex flex-wrap items-center gap-3">
          <input
            ref={fileRef}
            type="file"
            accept=".csv,text/csv"
            onChange={(e) => { setFile(e.target.files?.[0] || null); setPreview(null); setCommitResult(null); }}
            data-testid="import-file-input"
            className="block text-[13px] text-slate-600 file:mr-3 file:px-4 file:py-2 file:rounded-lg file:border-0 file:text-[13px] file:font-semibold file:bg-slate-100 file:text-slate-700 hover:file:bg-slate-200"
          />
          <button
            type="button"
            onClick={handlePreview}
            disabled={!file || previewing}
            data-testid="import-preview-btn"
            className="inline-flex items-center gap-2 px-4 py-2 text-[13px] font-semibold text-white bg-indigo-600 hover:bg-indigo-700 disabled:bg-slate-300 disabled:cursor-not-allowed rounded-lg transition-colors"
          >
            {previewing ? <Loader2 size={15} className="animate-spin" /> : <Upload size={15} />}
            Preview
          </button>
          {(preview || file) && (
            <button
              type="button"
              onClick={handleReset}
              data-testid="import-reset"
              className="inline-flex items-center gap-1.5 px-3 py-2 text-[12px] font-semibold text-slate-600 hover:bg-slate-100 rounded-lg transition-colors"
            >
              <RotateCcw size={13} />
              Start over
            </button>
          )}
        </div>
        <p className="text-[11px] text-slate-400 mt-2">
          CSV only · UTF-8 · max 5 MB · up to 5,000 rows per upload.
        </p>
      </Step>

      {/* Step 3 — Preview & Commit */}
      {preview && !commitResult && (
        <Step number={3} title="Preview & confirm">
          <TallyStrip tally={preview.tally} filter={filter} setFilter={setFilter} />
          <div className="mt-4 border border-slate-200 rounded-lg overflow-hidden">
            <div className="max-h-96 overflow-auto">
              <table className="w-full text-[12.5px]">
                <thead className="bg-slate-50 sticky top-0">
                  <tr className="text-left text-[11px] uppercase tracking-wider text-slate-500">
                    <th className="px-3 py-2 font-semibold">Row</th>
                    <th className="px-3 py-2 font-semibold">Name</th>
                    <th className="px-3 py-2 font-semibold">Mobile</th>
                    <th className="px-3 py-2 font-semibold">MRD</th>
                    <th className="px-3 py-2 font-semibold">Status</th>
                    <th className="px-3 py-2 font-semibold">Notes</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100" data-testid="import-preview-rows">
                  {visibleRows.map((row) => {
                    const meta = STATUS_META[row.status] || STATUS_META.fail;
                    const Icon = meta.Icon;
                    return (
                      <tr key={row.row_num} className="hover:bg-slate-50">
                        <td className="px-3 py-2 text-slate-400 font-mono">{row.row_num}</td>
                        <td className="px-3 py-2 text-slate-800 font-medium">{row.name}</td>
                        <td className="px-3 py-2 text-slate-600">{row.mobile || '—'}</td>
                        <td className="px-3 py-2 text-slate-600 font-mono text-[11.5px]">{row.mrd || '(auto)'}</td>
                        <td className="px-3 py-2">
                          <span className={`inline-flex items-center gap-1 px-2 py-0.5 text-[11px] font-semibold rounded-full ring-1 ${meta.bg} ${meta.text} ${meta.ring}`}>
                            <Icon size={11} />
                            {meta.label}
                          </span>
                        </td>
                        <td className="px-3 py-2 text-[11.5px] text-slate-500">
                          {row.errors?.join(', ') || ''}
                        </td>
                      </tr>
                    );
                  })}
                  {visibleRows.length === 0 && (
                    <tr><td colSpan={6} className="px-3 py-6 text-center text-slate-400">No rows match this filter.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>

          <div className="mt-4 flex items-center justify-between">
            <p className="text-[12px] text-slate-500">
              Preview expires {new Date(preview.expires_at).toLocaleString()} — re-upload after that.
            </p>
            <button
              type="button"
              onClick={handleCommit}
              disabled={committing || preview.tally.will_create === 0}
              data-testid="import-commit-btn"
              className="inline-flex items-center gap-2 px-5 py-2.5 text-[13px] font-bold text-white bg-emerald-600 hover:bg-emerald-700 disabled:bg-slate-300 disabled:cursor-not-allowed rounded-lg transition-colors shadow-sm"
            >
              {committing ? <Loader2 size={15} className="animate-spin" /> : <CheckCircle2 size={15} />}
              Import {preview.tally.will_create} patient{preview.tally.will_create === 1 ? '' : 's'}
            </button>
          </div>
        </Step>
      )}

      {/* Result */}
      {commitResult && (
        <div className="border border-emerald-200 bg-emerald-50 rounded-xl p-5" data-testid="import-result">
          <div className="flex items-center gap-2 text-emerald-800 font-bold mb-1">
            <CheckCircle2 size={18} />
            Import complete
          </div>
          <p className="text-[13px] text-emerald-900">
            <b>{commitResult.tally?.created || 0}</b> patient{commitResult.tally?.created === 1 ? '' : 's'} created
            {' '}· <b>{commitResult.tally?.skipped || 0}</b> skipped (duplicates)
            {' '}· <b>{commitResult.tally?.failed || 0}</b> failed.
          </p>
          {commitResult.failure_details?.length > 0 && (
            <ul className="mt-2 text-[12px] text-rose-700 list-disc pl-5">
              {commitResult.failure_details.map((f, i) => (
                <li key={i}><b>{f.row}</b>: {f.error}</li>
              ))}
            </ul>
          )}
          <button
            type="button"
            onClick={handleReset}
            className="mt-4 inline-flex items-center gap-1.5 px-3 py-1.5 text-[12px] font-semibold text-emerald-800 hover:bg-emerald-100 rounded-lg transition-colors"
          >
            <RotateCcw size={13} />
            Import another file
          </button>
        </div>
      )}

      {/* History */}
      {history.length > 0 && (
        <div className="border border-slate-200 bg-white rounded-xl p-5">
          <div className="flex items-center gap-2 text-slate-700 font-semibold mb-3 text-[13px]">
            <History size={15} />
            Recent imports
          </div>
          <table className="w-full text-[12.5px]">
            <thead className="text-left text-[11px] uppercase tracking-wider text-slate-500">
              <tr><th className="py-1.5 pr-3 font-semibold">When</th><th className="py-1.5 pr-3 font-semibold">File</th><th className="py-1.5 pr-3 font-semibold">Created</th><th className="py-1.5 pr-3 font-semibold">Skipped</th><th className="py-1.5 pr-3 font-semibold">Failed</th><th className="py-1.5 pr-3 font-semibold">Status</th></tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {history.map((h) => (
                <tr key={h.import_id} className="text-slate-700">
                  <td className="py-1.5 pr-3 whitespace-nowrap">{h.created_at ? new Date(h.created_at).toLocaleString() : '—'}</td>
                  <td className="py-1.5 pr-3 truncate max-w-[200px]" title={h.filename}>{h.filename || '—'}</td>
                  <td className="py-1.5 pr-3">{h.commit_tally?.created ?? '—'}</td>
                  <td className="py-1.5 pr-3">{h.commit_tally?.skipped ?? h.tally?.will_skip ?? '—'}</td>
                  <td className="py-1.5 pr-3">{h.commit_tally?.failed ?? '—'}</td>
                  <td className="py-1.5 pr-3">
                    <span className={`px-1.5 py-0.5 rounded text-[10px] font-semibold uppercase tracking-wider ${
                      h.status === 'committed' ? 'bg-emerald-100 text-emerald-800' : 'bg-slate-100 text-slate-600'
                    }`}>
                      {h.status}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ---- Helper components ---------------------------------------------------

function Step({ number, title, children }) {
  return (
    <section className="border border-slate-200 bg-white rounded-xl p-5">
      <h2 className="text-[13px] font-bold text-slate-800 flex items-center gap-2 mb-3">
        <span className="w-6 h-6 rounded-full bg-indigo-600 text-white text-[11px] font-bold flex items-center justify-center">{number}</span>
        {title}
      </h2>
      {children}
    </section>
  );
}

function TallyStrip({ tally, filter, setFilter }) {
  const items = [
    { key: 'all',  label: 'Total',       value: tally.total,       color: 'text-slate-700' },
    { key: 'ok',   label: 'Will create', value: tally.will_create, color: 'text-emerald-700' },
    { key: 'skip', label: 'Skip (dupes)',value: tally.will_skip,   color: 'text-amber-700' },
    { key: 'fail', label: 'Errors',      value: tally.will_fail,   color: 'text-rose-700' },
  ];
  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
      {items.map((it) => (
        <button
          key={it.key}
          type="button"
          onClick={() => setFilter(it.key)}
          data-testid={`import-tally-${it.key}`}
          className={`text-left px-4 py-3 rounded-lg border-2 transition-colors ${
            filter === it.key ? 'border-indigo-500 bg-indigo-50' : 'border-slate-200 bg-white hover:border-slate-300'
          }`}
        >
          <div className="text-[10px] uppercase tracking-wider text-slate-500 font-bold">{it.label}</div>
          <div className={`text-2xl font-black ${it.color}`}>{it.value}</div>
        </button>
      ))}
    </div>
  );
}
