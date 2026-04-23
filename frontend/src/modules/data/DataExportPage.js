/**
 * Clinic Data Export page — honours the landing-page trust promise.
 *
 * Anyone with role `clinic_owner`, `accounts`, `super_admin`, or `founder`
 * can one-click download their entire clinic dataset as a ZIP of CSVs.
 *
 * This page:
 *   1. fetches /api/export/preview to show a per-collection row count (sets expectations)
 *   2. triggers /api/export/full as a blob download
 *   3. explains what's inside, what's NOT inside (passwords, etc.)
 */
import React, { useCallback, useEffect, useState } from 'react';
import axios from 'axios';
import {
  Database, Download, ShieldCheck, Lock, CheckCircle2,
  FileSpreadsheet, Info, AlertTriangle,
} from 'lucide-react';
import { useAuth } from '../../AuthContext';

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;

// Collection → friendly label (shown in the preview table)
const FRIENDLY_LABELS = {
  patients: 'Patients',
  appointments: 'Appointments',
  waitlist: 'Waitlist',
  opd_tokens: 'OPD Tokens',
  test_sessions: 'Diagnostic sessions',
  audiometry_reports: 'Audiometry reports',
  report_deliveries: 'Report deliveries',
  services: 'Billing catalogue',
  invoices: 'Invoices',
  ha_sales: 'Hearing aid sales',
  ha_trials: 'Hearing aid trials',
  ha_subscriptions: 'Consumable subscriptions',
  ha_serial_items: 'HA serial inventory',
  ha_fittings: 'HA fittings',
  ha_quotations: 'HA quotations',
  ha_purchase_orders: 'HA purchase orders',
  ha_trade_ins: 'HA trade-ins',
  service_tickets: 'Service tickets',
  repair_orders: 'Repair orders',
  amc_contracts: 'AMC contracts',
  loaner_units: 'Loaner units',
  referring_doctors: 'Referring doctors',
  referral_transactions: 'Referral transactions',
  branches: 'Branches',
  users: 'Users (no passwords)',
  audit_log: 'Audit log',
  login_events: 'Login history',
};

export default function DataExportPage() {
  const { user, clinic } = useAuth();
  const [preview, setPreview] = useState(null);
  const [loading, setLoading] = useState(true);
  const [downloading, setDownloading] = useState(false);
  const [err, setErr] = useState('');
  const [lastDownload, setLastDownload] = useState(null);

  const loadPreview = useCallback(async () => {
    setLoading(true);
    setErr('');
    try {
      const r = await axios.get(`${API}/export/preview`);
      setPreview(r.data);
    } catch (e) {
      setErr(e?.response?.data?.detail || 'Unable to load export preview.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadPreview(); }, [loadPreview]);

  const download = useCallback(async () => {
    setDownloading(true);
    setErr('');
    try {
      const r = await axios.get(`${API}/export/full`, { responseType: 'blob' });
      // Content-Disposition filename from the header
      const cd = r.headers['content-disposition'] || '';
      const m = cd.match(/filename="?([^"]+)"?/);
      const filename = m ? m[1] : `audinexa-${clinic?.clinic_id || 'clinic'}-${Date.now()}.zip`;

      const url = URL.createObjectURL(r.data);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      setLastDownload({ filename, at: new Date(), size: r.data.size });
    } catch (e) {
      setErr(e?.response?.data?.detail || 'Download failed. Please try again or contact support.');
    } finally {
      setDownloading(false);
    }
  }, [clinic]);

  const nonEmpty = preview
    ? Object.entries(preview.per_collection || {}).filter(([, v]) => v > 0)
    : [];

  return (
    <div className="max-w-5xl mx-auto p-5 md:p-8 space-y-6" data-testid="data-export-page">
      {/* Headline */}
      <header className="space-y-2">
        <div className="inline-flex items-center gap-2 px-2.5 py-1 text-[10px] font-bold tracking-wider uppercase bg-emerald-50 text-emerald-700 border border-emerald-200 rounded-full">
          <ShieldCheck size={11} />
          <span>Your data · Your rules</span>
        </div>
        <h1 className="text-2xl md:text-3xl font-black text-slate-900 leading-tight">
          Download everything.{' '}
          <span className="text-emerald-700">Anytime.</span>
        </h1>
        <p className="text-slate-600 text-sm max-w-2xl leading-relaxed">
          One click pulls every record AUDINEXA stores for <b>{clinic?.name || 'your clinic'}</b> —
          patients, audiograms, invoices, reports, inventory, audit log — as a ZIP of CSVs plus metadata.
          Open them in Excel, Numbers, or any database tool. This feature is and always will be <b>free</b>.
        </p>
      </header>

      {/* Main card */}
      <div className="rounded-2xl border border-slate-200 bg-white overflow-hidden shadow-sm">
        {/* Top action bar */}
        <div className="p-5 md:p-6 border-b border-slate-200 bg-gradient-to-br from-emerald-50 via-white to-white">
          <div className="flex flex-col md:flex-row md:items-center gap-4 justify-between">
            <div className="flex items-center gap-3">
              <div className="w-11 h-11 rounded-xl bg-emerald-600/10 border border-emerald-200 flex items-center justify-center flex-shrink-0">
                <Database size={20} className="text-emerald-700" />
              </div>
              <div>
                <div className="text-[10px] uppercase tracking-wider text-emerald-700 font-bold">Full clinic export</div>
                <div className="text-base font-bold text-slate-900">
                  {loading ? 'Counting records…' : preview
                    ? <>{preview.total_rows.toLocaleString()} records across {nonEmpty.length} collections</>
                    : 'Records count unavailable'}
                </div>
                <div className="text-[11px] text-slate-500 mt-0.5">
                  CSV + metadata.json + README · ZIP format · UTF-8
                </div>
              </div>
            </div>
            <button
              onClick={download}
              disabled={downloading || loading || !preview || preview.total_rows === 0}
              data-testid="data-export-download"
              className="inline-flex items-center justify-center gap-2 px-5 py-2.5 text-sm font-bold bg-emerald-600 hover:bg-emerald-700 disabled:bg-slate-300 text-white rounded-lg shadow-sm transition-colors min-w-[200px]"
            >
              <Download size={16} />
              {downloading ? 'Preparing ZIP…' : 'Download ZIP now'}
            </button>
          </div>
          {err && (
            <div className="mt-4 flex items-start gap-2 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700" data-testid="data-export-error">
              <AlertTriangle size={14} className="flex-shrink-0 mt-0.5" />
              <span>{err}</span>
            </div>
          )}
          {lastDownload && (
            <div className="mt-4 flex items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-800" data-testid="data-export-success">
              <CheckCircle2 size={14} className="flex-shrink-0" />
              <span>
                Downloaded <b className="font-mono">{lastDownload.filename}</b>{' '}
                ({(lastDownload.size / 1024).toFixed(0)} KB) at {lastDownload.at.toLocaleTimeString()}
              </span>
            </div>
          )}
        </div>

        {/* What's inside — preview table */}
        <div className="p-5 md:p-6">
          <div className="flex items-center gap-2 mb-3">
            <FileSpreadsheet size={14} className="text-slate-500" />
            <div className="text-[10px] uppercase tracking-[0.14em] font-black text-slate-500">What's inside</div>
            <div className="flex-1 h-px bg-slate-200" />
          </div>

          {loading ? (
            <div className="text-center py-10 text-slate-400 italic text-sm">Counting your records…</div>
          ) : nonEmpty.length === 0 ? (
            <div className="text-center py-10 text-slate-400 italic text-sm" data-testid="data-export-empty">
              Your clinic is brand new — nothing to export yet.
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-2" data-testid="data-export-preview">
              {nonEmpty.map(([coll, n]) => (
                <div
                  key={coll}
                  data-testid={`data-export-row-${coll}`}
                  className="flex items-center justify-between px-3 py-2 rounded-lg border border-slate-200 bg-slate-50/60 hover:border-emerald-300 hover:bg-emerald-50/40 transition-colors"
                >
                  <span className="text-[13px] text-slate-700 font-medium truncate">
                    {FRIENDLY_LABELS[coll] || coll}
                  </span>
                  <span className="text-[11px] font-mono font-bold text-emerald-700 tabular-nums flex-shrink-0 ml-2">
                    {n.toLocaleString()}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Trust footer: what we DO and DON'T include */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="rounded-xl border border-emerald-200 bg-emerald-50/40 p-4">
          <div className="flex items-center gap-2 mb-2">
            <CheckCircle2 size={14} className="text-emerald-600" />
            <div className="text-[11px] uppercase tracking-wider font-bold text-emerald-800">Included</div>
          </div>
          <ul className="text-[13px] text-slate-700 space-y-1.5 leading-relaxed">
            <li>• Every record scoped to your <span className="font-mono text-[11px] text-emerald-700">clinic_id</span></li>
            <li>• Timestamps in ISO-8601 UTC (import-friendly)</li>
            <li>• Metadata.json describing schema + counts</li>
            <li>• README.txt with file-by-file summary</li>
            <li>• Re-export any day · no cap · no fees</li>
          </ul>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <div className="flex items-center gap-2 mb-2">
            <Lock size={14} className="text-slate-500" />
            <div className="text-[11px] uppercase tracking-wider font-bold text-slate-600">Never included</div>
          </div>
          <ul className="text-[13px] text-slate-700 space-y-1.5 leading-relaxed">
            <li>• Password hashes (stripped from <span className="font-mono text-[11px]">users.csv</span>)</li>
            <li>• JWT session tokens</li>
            <li>• Another clinic's data — ever</li>
            <li>• Internal platform configuration</li>
          </ul>
        </div>
      </div>

      <div className="flex items-start gap-2 text-[12px] text-slate-500 px-1" data-testid="data-export-audit-note">
        <Info size={13} className="flex-shrink-0 mt-0.5" />
        <span>
          Every export is logged in your audit trail with the actor's email and row counts —
          role <span className="font-mono text-[11px]">{user?.role?.replace('_', ' ')}</span>
          &nbsp;/&nbsp;
          <span className="font-mono text-[11px]">{user?.email}</span>.
        </span>
      </div>
    </div>
  );
}
