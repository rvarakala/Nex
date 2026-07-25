/**
 * ReferralCornerPage — owner-grade dashboard for tracking referring
 * doctors, their generated revenue, and the commission payouts owed.
 *
 * Two key flows on one screen:
 *   1. Owner sets the "cut" per doctor — either % of revenue or ₹ flat
 *      per referred patient, configured INDEPENDENTLY for Diagnostics
 *      and HA Sales (commission economics differ between the two).
 *   2. Anyone with referral access (Owner + delegated staff) sees the
 *      live rollup and downloads end-of-month payout reports as CSV.
 *
 * Access is enforced on both the API (`_require_referral_access`) and
 * here (we gate render on /api/referrals/access response) — defence in
 * depth so a delegated user can't accidentally see, or worse edit,
 * payout terms they shouldn't.
 */
import React, { useEffect, useMemo, useState } from 'react';
import axios from 'axios';
import {
  Users, IndianRupee, Stethoscope, ShoppingBag, Download, Save,
  AlertCircle, Loader2, ChevronDown, Lock, Settings, Route as RouteIcon,
} from 'lucide-react';
import DoctorDrillDownModal from './DoctorDrillDownModal';

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;
const fmtINR = (n) => `₹${Number(n || 0).toLocaleString('en-IN', { maximumFractionDigits: 0 })}`;

// ─── Date range preset helpers ───────────────────────────────────────
// Each preset returns { start, end } as YYYY-MM-DD strings, inclusive.
// Presets appear as chips right of the date pickers so owners can jump
// between "Today / 3d / 7d / This week / This month" in one click.
const isoDate = (d) => d.toISOString().slice(0, 10);
const daysAgo = (n) => { const d = new Date(); d.setDate(d.getDate() - n); return d; };

const PRESETS = [
  { id: 'today',      label: 'Today',    range: () => { const t = new Date(); return { start: isoDate(t), end: isoDate(t) }; } },
  { id: 'last3',      label: 'Last 3d',  range: () => ({ start: isoDate(daysAgo(2)),  end: isoDate(new Date()) }) },
  { id: 'last7',      label: 'Last 7d',  range: () => ({ start: isoDate(daysAgo(6)),  end: isoDate(new Date()) }) },
  { id: 'week',       label: 'This week', range: () => {
      const t = new Date(); const dow = (t.getDay() + 6) % 7; // Mon=0
      const start = new Date(t); start.setDate(t.getDate() - dow);
      return { start: isoDate(start), end: isoDate(t) };
    } },
  { id: 'month',      label: 'This month', range: () => {
      const t = new Date();
      return { start: isoDate(new Date(t.getFullYear(), t.getMonth(), 1)), end: isoDate(t) };
    } },
];

// Default to the current calendar month. The owner can override with the
// date pickers at the top, but month-to-date is the most common framing
// for payout discussions ("how much do I owe this month?").
function defaultMonth() {
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0, 10);
  return { start, end: now.toISOString().slice(0, 10) };
}

export default function ReferralCornerPage() {
  const [access, setAccess] = useState(null); // null = unknown
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');
  const [range, setRange] = useState(defaultMonth);
  const [editing, setEditing] = useState(null); // doctor_id being edited
  // Pathway breakdown (Doctor · Walk-in · Self · ...) and active filter
  const [pathways, setPathways] = useState([]);
  const [activePathway, setActivePathway] = useState('all');
  // Drill-down modal
  const [drillDoctorId, setDrillDoctorId] = useState(null);

  useEffect(() => {
    (async () => {
      try {
        const r = await axios.get(`${API}/referrals/access`);
        setAccess(r.data);
      } catch {
        setAccess({ has_access: false });
      }
    })();
  }, []);

  const load = async () => {
    setLoading(true); setErr('');
    try {
      const [dashR, pathR] = await Promise.all([
        axios.get(`${API}/referrals/dashboard`, { params: range }),
        axios.get(`${API}/referrals/pathways`, { params: range }).catch(() => ({ data: { pathways: [] } })),
      ]);
      setData(dashR.data);
      setPathways(pathR.data.pathways || []);
    } catch (e) {
      setErr(e?.response?.data?.detail || e.message || 'Could not load referrals dashboard');
    } finally { setLoading(false); }
  };

  useEffect(() => { if (access?.has_access) load(); }, [access, range]);

  // When "Doctor" pathway is active, rows are already all doctors so no
  // client-side filter needed. Non-Doctor pathways collapse the doctor
  // rollup table (there are no doctors for Walk-in / Self / etc.).
  const visibleRows = useMemo(() => {
    if (!data) return [];
    if (activePathway === 'all' || activePathway === 'Doctor') return data.rows;
    return []; // pathway isn't Doctor → hide doctor list
  }, [data, activePathway]);

  const activePathwayRow = useMemo(
    () => pathways.find((p) => p.pathway === activePathway),
    [pathways, activePathway],
  );

  const downloadCsv = async (kind) => {
    try {
      const r = await axios.get(`${API}/referrals/payout-report.csv`, {
        params: { ...range, report_type: kind },
        responseType: 'blob',
      });
      const url = URL.createObjectURL(r.data);
      const a = document.createElement('a');
      a.href = url;
      a.download = `referral_payout_${kind}_${range.start}_${range.end}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      alert(`Export failed: ${e?.response?.data?.detail || 'error'}`);
    }
  };

  // Access denied view — clean, not alarming. Most staff won't have this.
  if (access && !access.has_access) {
    return (
      <div className="p-8 max-w-2xl mx-auto" data-testid="referral-corner-denied">
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-6 flex items-start gap-4">
          <div className="w-12 h-12 rounded-full bg-amber-100 flex items-center justify-center flex-shrink-0">
            <Lock size={20} className="text-amber-700" />
          </div>
          <div>
            <h2 className="font-bold text-slate-900 text-lg">Referral Corner is owner-only</h2>
            <p className="text-[13px] text-slate-600 mt-1">
              This is where the clinic configures referral commission for
              external doctors. Ask your clinic owner to grant access from{' '}
              <b>Settings → Staff</b> if you handle marketing or accounts.
            </p>
          </div>
        </div>
      </div>
    );
  }

  if (!access) {
    return <div className="p-6 text-slate-400 italic text-sm">Loading…</div>;
  }

  return (
    <div className="p-5 space-y-5 max-w-7xl mx-auto" data-testid="referral-corner-page">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-xl font-bold text-slate-800 flex items-center gap-2">
            Referral Corner
            {!access.is_owner && (
              <span className="text-[10px] uppercase tracking-wider px-2 py-0.5 rounded bg-indigo-50 text-indigo-700 border border-indigo-200 font-bold">
                View-only
              </span>
            )}
          </h1>
          <p className="text-[12px] text-slate-500 mt-0.5">
            Track which doctors are referring patients and the commission you owe each month. Closed paid invoices only.
          </p>
        </div>
        <div className="flex items-center gap-2 text-xs">
          <label className="inline-flex items-center gap-1 text-slate-600">
            From{' '}
            <input
              type="date" value={range.start}
              onChange={(e) => setRange({ ...range, start: e.target.value })}
              data-testid="ref-corner-start"
              className="border border-slate-300 rounded px-1 py-0.5 text-xs"
            />
          </label>
          <label className="inline-flex items-center gap-1 text-slate-600">
            To{' '}
            <input
              type="date" value={range.end}
              onChange={(e) => setRange({ ...range, end: e.target.value })}
              data-testid="ref-corner-end"
              className="border border-slate-300 rounded px-1 py-0.5 text-xs"
            />
          </label>
          <button
            onClick={() => setRange(defaultMonth())}
            className="text-[10px] text-slate-500 hover:underline"
            data-testid="ref-corner-reset-month"
          >
            This month
          </button>
        </div>
      </div>

      {/* Date range preset chips */}
      <div className="flex items-center gap-1.5 flex-wrap" data-testid="ref-corner-presets">
        <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500 mr-1">Quick range</span>
        {PRESETS.map((p) => {
          const preset = p.range();
          const active = preset.start === range.start && preset.end === range.end;
          return (
            <button
              key={p.id}
              onClick={() => setRange(preset)}
              data-testid={`ref-corner-preset-${p.id}`}
              className={`text-[10.5px] font-semibold px-2 py-0.5 rounded-full border transition ${
                active
                  ? 'bg-indigo-600 border-indigo-600 text-white'
                  : 'bg-white border-slate-200 text-slate-600 hover:border-slate-300'
              }`}
            >
              {p.label}
            </button>
          );
        })}
      </div>

      {/* Pathway chip row — Doctor / Walk-in / Self / Camp / etc. */}
      {pathways.length > 0 && (
        <div className="flex items-center gap-2 flex-wrap" data-testid="ref-corner-pathways">
          <div className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-slate-500 mr-1">
            <RouteIcon size={11} /> Pathway
          </div>
          <button
            onClick={() => setActivePathway('all')}
            data-testid="ref-pathway-all"
            className={`text-[11px] font-semibold px-2.5 py-1 rounded-full border transition ${
              activePathway === 'all'
                ? 'bg-slate-900 border-slate-900 text-white'
                : 'bg-white border-slate-200 text-slate-600 hover:border-slate-300'
            }`}
          >
            All <span className="tabular-nums text-[10px] font-bold ml-1 opacity-70">
              {pathways.reduce((a, b) => a + b.patient_count, 0)}
            </span>
          </button>
          {pathways.filter((p) => p.patient_count > 0 || p.pathway === 'Doctor').map((p) => {
            const active = activePathway === p.pathway;
            const isDoctor = p.pathway === 'Doctor';
            return (
              <button
                key={p.pathway}
                onClick={() => setActivePathway(active ? 'all' : p.pathway)}
                data-testid={`ref-pathway-${p.pathway}`}
                className={`text-[11px] font-semibold px-2.5 py-1 rounded-full border transition inline-flex items-center gap-1.5 ${
                  active
                    ? 'bg-indigo-600 border-indigo-600 text-white'
                    : isDoctor
                      ? 'bg-indigo-50 border-indigo-200 text-indigo-800 hover:border-indigo-300'
                      : 'bg-white border-slate-200 text-slate-600 hover:border-slate-300'
                }`}
                title={`${p.patient_count} patients · ${fmtINR(p.total_revenue)} revenue`}
              >
                {p.pathway}
                <span className={`tabular-nums text-[10px] font-black rounded-full px-1.5 ${
                  active ? 'bg-white/25 text-white' : 'bg-slate-100 text-slate-700'
                }`}>{p.patient_count}</span>
              </button>
            );
          })}
        </div>
      )}

      {/* Active pathway summary — shown when a non-Doctor pathway is selected */}
      {activePathwayRow && activePathway !== 'all' && activePathway !== 'Doctor' && (
        <div className="bg-indigo-50/50 border border-indigo-100 rounded-lg p-4" data-testid="ref-pathway-summary">
          <div className="text-[10px] font-bold tracking-[0.15em] uppercase text-indigo-800 mb-2">
            {activePathway} pathway — {range.start} to {range.end}
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <MiniStat label="Patients" value={activePathwayRow.patient_count} />
            <MiniStat label="Diagnostics" value={fmtINR(activePathwayRow.diagnostics_revenue)} />
            <MiniStat label="HA sales" value={fmtINR(activePathwayRow.ha_sales_revenue)} />
            <MiniStat label="Total revenue" value={fmtINR(activePathwayRow.total_revenue)} highlight />
          </div>
          <p className="mt-2 text-[10.5px] text-indigo-700 italic">
            This pathway has no named referring doctor, so payout tracking + drill-down don&apos;t apply.
            Switch to <b>Doctor</b> to see individual referrers.
          </p>
        </div>
      )}

      {err && (
        <div className="bg-rose-50 text-rose-700 text-xs p-2 rounded flex items-center gap-1.5">
          <AlertCircle size={12} /> {err}
        </div>
      )}

      {/* KPI strip */}
      {data && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3" data-testid="ref-corner-kpis">
          <Kpi
            label="Referred patients"
            value={data.totals.patient_count}
            icon={Users}
            accent="indigo"
            testid="ref-kpi-patients"
          />
          <Kpi
            label="Diagnostics revenue"
            value={fmtINR(data.totals.diagnostics_revenue)}
            icon={Stethoscope}
            accent="emerald"
            testid="ref-kpi-diag-rev"
          />
          <Kpi
            label="HA sales revenue"
            value={fmtINR(data.totals.ha_sales_revenue)}
            icon={ShoppingBag}
            accent="violet"
            testid="ref-kpi-ha-rev"
          />
          <Kpi
            label="Total payout owed"
            value={fmtINR(data.totals.total_payout)}
            icon={IndianRupee}
            accent="amber"
            highlight
            testid="ref-kpi-payout"
          />
        </div>
      )}

      {/* Export controls */}
      <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-sm">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div>
            <div className="text-[12px] font-bold text-slate-800">End-of-month payout reports</div>
            <div className="text-[11px] text-slate-500">
              CSVs are filtered to doctors with non-zero payouts. Print, attach, or hand to accounts.
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              onClick={() => downloadCsv('diagnostics')}
              data-testid="ref-export-diag"
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-[11px] font-semibold bg-emerald-600 hover:bg-emerald-700 text-white rounded shadow-sm"
            >
              <Download size={11} /> Diagnostics CSV
            </button>
            <button
              onClick={() => downloadCsv('ha')}
              data-testid="ref-export-ha"
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-[11px] font-semibold bg-violet-600 hover:bg-violet-700 text-white rounded shadow-sm"
            >
              <Download size={11} /> HA Sales CSV
            </button>
            <button
              onClick={() => downloadCsv('both')}
              data-testid="ref-export-both"
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-[11px] font-semibold bg-slate-700 hover:bg-slate-800 text-white rounded shadow-sm"
            >
              <Download size={11} /> Combined CSV
            </button>
          </div>
        </div>
      </div>

      {/* Doctor rollup table */}
      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden shadow-sm">
        {loading ? (
          <div className="p-8 text-center text-[12px] text-slate-500 flex items-center justify-center gap-2">
            <Loader2 size={14} className="animate-spin" /> Loading referrals…
          </div>
        ) : data && visibleRows.length === 0 ? (
          <div className="p-8 text-center text-[12px] text-slate-500 italic">
            {activePathway !== 'all' && activePathway !== 'Doctor'
              ? <>Non-doctor pathway selected. Only Doctor referrals have per-doctor tracking. Click <b>All</b> or <b>Doctor</b> to see the doctor list.</>
              : <>No referring doctors set up yet. Add one from{' '}
                  <a href="/settings/referral-doctors" className="text-indigo-600 hover:underline">Settings → Referral Doctors</a> to start tracking.
                </>}
          </div>
        ) : data ? (
          <table className="w-full text-xs" data-testid="ref-doctors-table">
            <thead className="bg-slate-50 border-b border-slate-200">
              <tr className="text-left text-[10px] uppercase tracking-wide text-slate-600">
                <th className="px-3 py-2">Doctor</th>
                <th className="px-3 py-2 text-right">Patients</th>
                <th className="px-3 py-2 text-right">Diag. Revenue</th>
                <th className="px-3 py-2 text-right">Diag. Payout</th>
                <th className="px-3 py-2 text-right">HA Revenue</th>
                <th className="px-3 py-2 text-right">HA Payout</th>
                <th className="px-3 py-2 text-right">Total Owed</th>
                {access.is_owner && <th className="px-3 py-2 text-center">Cut config</th>}
              </tr>
            </thead>
            <tbody>
              {visibleRows.map((r) => (
                <DoctorRow
                  key={r.doctor_id}
                  row={r}
                  canEdit={access.is_owner}
                  isEditing={editing === r.doctor_id}
                  onEdit={() => setEditing(r.doctor_id)}
                  onClose={() => setEditing(null)}
                  onSaved={load}
                  onDrilldown={() => setDrillDoctorId(r.doctor_id)}
                />
              ))}
            </tbody>
          </table>
        ) : null}
      </div>

      {/* Doctor drill-down modal — mounted lazily */}
      {drillDoctorId && (
        <DoctorDrillDownModal
          doctorId={drillDoctorId}
          range={range}
          onClose={() => setDrillDoctorId(null)}
        />
      )}
    </div>
  );
}

// ─── Sub-components ────────────────────────────────────────────────────
const MiniStat = ({ label, value, highlight }) => (
  <div className={`bg-white rounded p-2 ${highlight ? 'ring-1 ring-indigo-300' : ''}`}>
    <div className="text-[9px] font-bold tracking-wider uppercase text-slate-500">{label}</div>
    <div className="text-sm font-extrabold text-slate-800 tabular-nums">{value}</div>
  </div>
);
const Kpi = ({ label, value, icon: Icon, accent = 'indigo', highlight, testid }) => (
  <div
    data-testid={testid}
    className={`bg-white border rounded-xl p-3 shadow-sm ${
      highlight ? `border-${accent}-300 ring-1 ring-${accent}-200` : `border-${accent}-100`
    }`}
  >
    <div className="flex items-center justify-between mb-1">
      <div className="text-[9px] font-bold uppercase tracking-wider text-slate-500">{label}</div>
      <Icon size={12} className={`text-${accent}-500`} />
    </div>
    <div className={`text-xl font-extrabold text-${accent}-700 tabular-nums`}>{value ?? '—'}</div>
  </div>
);

function DoctorRow({ row, canEdit, isEditing, onEdit, onClose, onSaved, onDrilldown }) {
  const zero = (row.total_revenue || 0) === 0;
  return (
    <>
      <tr className={`border-b border-slate-100 hover:bg-slate-50 ${zero ? 'opacity-60' : ''}`} data-testid={`ref-doc-row-${row.doctor_id}`}>
        <td className="px-3 py-2">
          <button
            type="button"
            onClick={onDrilldown}
            data-testid={`ref-doc-drilldown-${row.doctor_id}`}
            className="text-left hover:underline decoration-indigo-400 underline-offset-2"
            title="Click to see referred patients, tests, HA fittings, and payout details"
          >
            <div className="font-semibold text-slate-800">{row.name}</div>
            <div className="text-[10px] text-slate-500">
              {[row.specialty, row.clinic].filter(Boolean).join(' · ') || '—'}
            </div>
          </button>
        </td>
        <td className="px-3 py-2 text-right tabular-nums">{row.patient_count}</td>
        <td className="px-3 py-2 text-right tabular-nums font-mono">{fmtINR(row.diagnostics_revenue)}</td>
        <td className="px-3 py-2 text-right tabular-nums font-mono text-emerald-700">
          <CutBadge mode={row.diag_cut_mode} value={row.diag_cut_value} payout={row.diagnostics_payout} />
        </td>
        <td className="px-3 py-2 text-right tabular-nums font-mono">{fmtINR(row.ha_sales_revenue)}</td>
        <td className="px-3 py-2 text-right tabular-nums font-mono text-violet-700">
          <CutBadge mode={row.ha_cut_mode} value={row.ha_cut_value} payout={row.ha_payout} />
        </td>
        <td className="px-3 py-2 text-right tabular-nums font-mono font-bold text-amber-700">
          {fmtINR(row.total_payout)}
        </td>
        {canEdit && (
          <td className="px-3 py-2 text-center">
            <button
              onClick={isEditing ? onClose : onEdit}
              data-testid={`ref-doc-edit-${row.doctor_id}`}
              className="inline-flex items-center gap-1 text-[10px] font-semibold text-indigo-600 hover:text-indigo-800 px-2 py-1 rounded hover:bg-indigo-50"
            >
              <Settings size={11} />
              {isEditing ? 'Cancel' : 'Configure'}
              <ChevronDown size={10} className={`transition-transform ${isEditing ? 'rotate-180' : ''}`} />
            </button>
          </td>
        )}
      </tr>
      {isEditing && canEdit && (
        <tr className="bg-indigo-50/40" data-testid={`ref-doc-cut-editor-${row.doctor_id}`}>
          <td colSpan={8} className="px-4 py-3">
            <CutEditor row={row} onClose={onClose} onSaved={onSaved} />
          </td>
        </tr>
      )}
    </>
  );
}

const CutBadge = ({ mode, value, payout }) => {
  if (!mode || !value) {
    return <span className="text-slate-300">—</span>;
  }
  const label = mode === 'percent' ? `${value}%` : `₹${value}/pt`;
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className="text-[9px] uppercase tracking-wide px-1.5 py-0.5 rounded bg-slate-100 text-slate-600 font-bold">{label}</span>
      <span>{fmtINR(payout)}</span>
    </span>
  );
};

function CutEditor({ row, onClose, onSaved }) {
  const [diagMode, setDiagMode] = useState(row.diag_cut_mode || '');
  const [diagValue, setDiagValue] = useState(row.diag_cut_value || 0);
  const [haMode, setHaMode] = useState(row.ha_cut_mode || '');
  const [haValue, setHaValue] = useState(row.ha_cut_value || 0);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  const save = async () => {
    setBusy(true); setErr('');
    try {
      await axios.patch(`${API}/referrals/doctors/${row.doctor_id}/cut-config`, {
        diag_cut_mode: diagMode || null,
        diag_cut_value: parseFloat(diagValue) || 0,
        ha_cut_mode: haMode || null,
        ha_cut_value: parseFloat(haValue) || 0,
      });
      onSaved();
      onClose();
    } catch (e) {
      setErr(e?.response?.data?.detail || 'Save failed');
    } finally { setBusy(false); }
  };

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
      <CategoryEditor
        title="Diagnostics cut"
        hint="Applied to paid invoices for diagnostic services."
        mode={diagMode} setMode={setDiagMode}
        value={diagValue} setValue={setDiagValue}
        accent="emerald"
        testidPrefix="diag"
      />
      <CategoryEditor
        title="HA Sales cut"
        hint="Applied to closed, paid HA sales only (trials excluded)."
        mode={haMode} setMode={setHaMode}
        value={haValue} setValue={setHaValue}
        accent="violet"
        testidPrefix="ha"
      />
      <div className="md:col-span-2 flex items-center justify-end gap-2">
        {err && (
          <span className="text-[11px] text-rose-700 mr-auto flex items-center gap-1">
            <AlertCircle size={11} /> {err}
          </span>
        )}
        <button
          onClick={onClose}
          className="px-3 py-1.5 text-[11px] text-slate-600 hover:bg-slate-100 rounded"
          data-testid={`cut-cancel-${row.doctor_id}`}
        >
          Cancel
        </button>
        <button
          onClick={save}
          disabled={busy}
          data-testid={`cut-save-${row.doctor_id}`}
          className="inline-flex items-center gap-1 px-4 py-1.5 text-[11px] font-bold bg-indigo-600 hover:bg-indigo-700 text-white rounded shadow-sm disabled:opacity-50"
        >
          <Save size={11} /> {busy ? 'Saving…' : 'Save cut'}
        </button>
      </div>
    </div>
  );
}

function CategoryEditor({ title, hint, mode, setMode, value, setValue, accent, testidPrefix }) {
  return (
    <div className={`bg-white border border-${accent}-200 rounded-lg p-3`}>
      <div className="text-[12px] font-bold text-slate-800">{title}</div>
      <p className="text-[10.5px] text-slate-500 mt-0.5 mb-2">{hint}</p>
      <div className="flex items-center gap-3 flex-wrap">
        <label className="flex items-center gap-1.5 text-[11px] cursor-pointer">
          <input
            type="radio" name={`${testidPrefix}-mode`}
            checked={mode === ''} onChange={() => { setMode(''); setValue(0); }}
            data-testid={`${testidPrefix}-mode-none`}
          />
          None
        </label>
        <label className="flex items-center gap-1.5 text-[11px] cursor-pointer">
          <input
            type="radio" name={`${testidPrefix}-mode`}
            checked={mode === 'percent'} onChange={() => setMode('percent')}
            data-testid={`${testidPrefix}-mode-percent`}
          />
          % of revenue
        </label>
        <label className="flex items-center gap-1.5 text-[11px] cursor-pointer">
          <input
            type="radio" name={`${testidPrefix}-mode`}
            checked={mode === 'flat'} onChange={() => setMode('flat')}
            data-testid={`${testidPrefix}-mode-flat`}
          />
          ₹ flat per patient
        </label>
      </div>
      {mode && (
        <div className="mt-2 flex items-center gap-2">
          <input
            type="number"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            data-testid={`${testidPrefix}-value`}
            className="w-32 border border-slate-300 rounded px-2 py-1 text-[12px] tabular-nums"
            min="0"
            max={mode === 'percent' ? 100 : undefined}
            step={mode === 'percent' ? 0.5 : 50}
          />
          <span className="text-[11px] text-slate-500">
            {mode === 'percent' ? '% of revenue' : '₹ per referred patient'}
          </span>
        </div>
      )}
    </div>
  );
}
