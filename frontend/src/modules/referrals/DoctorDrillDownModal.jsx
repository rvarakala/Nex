/**
 * DoctorDrillDownModal — deep-dive on a single referring doctor for the
 * chosen date range. Shows their referred patients, per-test counts,
 * revenue split, closed HA sales, and payout owed.
 *
 * Fed by GET /api/referrals/doctors/{doctor_id}/detail (see referrals.py).
 */
import React, { useEffect, useState } from 'react';
import axios from 'axios';
import {
  X, Loader2, User, Stethoscope, IndianRupee, Package, Activity,
  Phone, Mail, Building, TrendingUp,
} from 'lucide-react';

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;
const fmtINR = (n) => `₹${Number(n || 0).toLocaleString('en-IN', { maximumFractionDigits: 0 })}`;

export default function DoctorDrillDownModal({ doctorId, range, onClose }) {
  const [data, setData] = useState(null);
  const [err, setErr] = useState('');
  useEffect(() => {
    if (!doctorId) return;
    let alive = true;
    (async () => {
      try {
        const r = await axios.get(
          `${API}/referrals/doctors/${doctorId}/detail`,
          { params: range },
        );
        if (alive) setData(r.data);
      } catch (e) {
        if (alive) setErr(e?.response?.data?.detail || 'Could not load drill-down');
      }
    })();
    return () => { alive = false; };
  }, [doctorId, range?.start, range?.end]);

  if (!doctorId) return null;

  return (
    <div
      className="fixed inset-0 z-50 bg-black/55 flex items-center justify-center p-4"
      onClick={onClose}
      data-testid="doctor-drilldown-modal"
    >
      <div
        className="bg-white rounded-xl shadow-2xl w-full max-w-4xl max-h-[92vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <header className="flex items-start justify-between px-6 py-4 border-b border-slate-200">
          <div className="min-w-0">
            <div className="text-[10px] font-bold tracking-[0.2em] uppercase text-slate-500 mb-1">Referral drill-down</div>
            <h2 className="text-lg font-bold text-slate-900 flex items-center gap-2">
              <Stethoscope size={17} className="text-indigo-500" />
              {data?.doctor?.name || 'Loading…'}
            </h2>
            {data?.doctor && (
              <div className="text-[11px] text-slate-500 mt-1 flex items-center gap-3 flex-wrap">
                {data.doctor.specialty && <span>{data.doctor.specialty}</span>}
                {data.doctor.clinic && <span className="flex items-center gap-1"><Building size={10} /> {data.doctor.clinic}</span>}
                {data.doctor.phone && <span className="flex items-center gap-1"><Phone size={10} /> {data.doctor.phone}</span>}
                {data.doctor.email && <span className="flex items-center gap-1"><Mail size={10} /> {data.doctor.email}</span>}
              </div>
            )}
            {data?.window && (
              <div className="mt-1 text-[10.5px] text-slate-500">
                Window: <b>{data.window.start}</b> → <b>{data.window.end}</b>
              </div>
            )}
          </div>
          <button
            onClick={onClose}
            data-testid="doctor-drilldown-close"
            className="w-8 h-8 rounded hover:bg-slate-100 flex items-center justify-center text-slate-500"
          >
            <X size={16} />
          </button>
        </header>

        {/* Body */}
        <div className="flex-1 overflow-auto p-6">
          {!data && !err && (
            <div className="py-16 flex items-center justify-center">
              <Loader2 size={20} className="animate-spin text-slate-400" />
            </div>
          )}
          {err && <div className="p-6 text-sm text-rose-600 font-semibold">{err}</div>}

          {data && (
            <div className="space-y-6">
              {/* KPI row */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3" data-testid="drilldown-kpis">
                <MiniKpi label="Referred patients" value={data.patient_total} icon={User} accent="indigo" testid="drilldown-kpi-patients" />
                <MiniKpi label="Diagnostics revenue" value={fmtINR(data.revenue.diagnostics)} icon={Stethoscope} accent="emerald" testid="drilldown-kpi-diag" />
                <MiniKpi label="HA sales revenue" value={fmtINR(data.revenue.ha_sales)} icon={Package} accent="violet" testid="drilldown-kpi-ha" />
                <MiniKpi label="Total payout owed" value={fmtINR(data.payout.total)} icon={IndianRupee} accent="amber" highlight testid="drilldown-kpi-payout" />
              </div>

              {/* Payout breakdown */}
              <section>
                <SectionHeading icon={TrendingUp} title="Payout breakdown" />
                <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
                  <table className="w-full text-xs">
                    <tbody>
                      <tr className="border-b border-slate-100">
                        <td className="px-4 py-2 font-semibold text-slate-700">Diagnostics</td>
                        <td className="px-4 py-2 text-right text-slate-500">
                          {data.doctor.diag_cut_mode
                            ? (data.doctor.diag_cut_mode === 'percent' ? `${data.doctor.diag_cut_value}% of revenue` : `₹${data.doctor.diag_cut_value}/patient`)
                            : 'no payout configured'}
                        </td>
                        <td className="px-4 py-2 text-right font-bold tabular-nums text-emerald-700">{fmtINR(data.payout.diagnostics)}</td>
                      </tr>
                      <tr className="border-b border-slate-100">
                        <td className="px-4 py-2 font-semibold text-slate-700">Hearing Aids</td>
                        <td className="px-4 py-2 text-right text-slate-500">
                          {data.doctor.ha_cut_mode
                            ? (data.doctor.ha_cut_mode === 'percent' ? `${data.doctor.ha_cut_value}% of revenue` : `₹${data.doctor.ha_cut_value}/patient`)
                            : 'no payout configured'}
                        </td>
                        <td className="px-4 py-2 text-right font-bold tabular-nums text-violet-700">{fmtINR(data.payout.ha)}</td>
                      </tr>
                      <tr className="bg-amber-50/60">
                        <td className="px-4 py-2 font-bold text-amber-800">Total owed</td>
                        <td className="px-4 py-2"></td>
                        <td className="px-4 py-2 text-right text-lg font-black tabular-nums text-amber-800">{fmtINR(data.payout.total)}</td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </section>

              {/* Test breakdown */}
              <section>
                <SectionHeading
                  icon={Activity}
                  title="Tests conducted"
                  hint={data.test_breakdown.length === 0 ? 'No tests in this window' : `${data.test_breakdown.length} test types`}
                />
                {data.test_breakdown.length > 0 && (
                  <div className="flex flex-wrap gap-2" data-testid="drilldown-test-chips">
                    {data.test_breakdown.map((t) => (
                      <div key={t.test} className="inline-flex items-center gap-1.5 px-2.5 py-1 bg-indigo-50 border border-indigo-100 rounded-full text-[11.5px]">
                        <span className="font-semibold text-indigo-900">{t.test}</span>
                        <span className="text-[10px] font-black tabular-nums bg-indigo-600 text-white rounded-full px-1.5">{t.count}</span>
                      </div>
                    ))}
                  </div>
                )}
              </section>

              {/* HA fittings */}
              <section>
                <SectionHeading
                  icon={Package}
                  title="Hearing-aid fittings"
                  hint={data.ha_fittings.length === 0 ? 'No closed HA sales in this window' : `${data.ha_fittings.length} closed sales`}
                />
                {data.ha_fittings.length > 0 && (
                  <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
                    <table className="w-full text-xs" data-testid="drilldown-ha-table">
                      <thead className="bg-slate-50 border-b border-slate-200 text-[10px] uppercase tracking-wider text-slate-500">
                        <tr>
                          <th className="text-left px-3 py-2">Date</th>
                          <th className="text-left px-3 py-2">Patient</th>
                          <th className="text-left px-3 py-2">Product</th>
                          <th className="text-left px-3 py-2">Status</th>
                          <th className="text-right px-3 py-2">Amount</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {data.ha_fittings.map((f, i) => {
                          const pName = data.patients.find((p) => p.patient_id === f.patient_id)?.name || f.patient_id;
                          return (
                            <tr key={`${f.sale_id}-${i}`} className="hover:bg-slate-50">
                              <td className="px-3 py-2 text-slate-600 tabular-nums">{f.date || '—'}</td>
                              <td className="px-3 py-2 font-semibold text-slate-800">{pName}</td>
                              <td className="px-3 py-2 text-slate-700">{f.product || '—'}</td>
                              <td className="px-3 py-2">
                                <span className="text-[9px] uppercase tracking-wide px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-800 font-bold">
                                  {f.status}
                                </span>
                              </td>
                              <td className="px-3 py-2 text-right font-mono tabular-nums text-slate-800">{fmtINR(f.amount)}</td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </section>

              {/* Patients */}
              <section>
                <SectionHeading
                  icon={User}
                  title="Referred patients (all-time)"
                  hint={`${data.patient_total} patients`}
                />
                {data.patients.length > 0 && (
                  <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
                    <table className="w-full text-xs" data-testid="drilldown-patients-table">
                      <thead className="bg-slate-50 border-b border-slate-200 text-[10px] uppercase tracking-wider text-slate-500">
                        <tr>
                          <th className="text-left px-3 py-2">Patient</th>
                          <th className="text-left px-3 py-2">MRD</th>
                          <th className="text-left px-3 py-2">Contact</th>
                          <th className="text-left px-3 py-2">First visit</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {data.patients.map((p) => (
                          <tr key={p.patient_id} className="hover:bg-slate-50">
                            <td className="px-3 py-2">
                              <div className="font-semibold text-slate-800">{p.name}</div>
                              {p.age && p.gender && (
                                <div className="text-[10px] text-slate-500">{p.age}y · {p.gender}</div>
                              )}
                            </td>
                            <td className="px-3 py-2 font-mono text-[11px] text-slate-600">{p.mrd || '—'}</td>
                            <td className="px-3 py-2 text-slate-600">{p.mobile || '—'}</td>
                            <td className="px-3 py-2 text-slate-600 tabular-nums">{p.first_visit || '—'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </section>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function SectionHeading({ icon: Icon, title, hint }) {
  return (
    <div className="mb-2.5 flex items-baseline gap-2">
      <Icon size={13} className="text-indigo-500" />
      <div className="text-xs font-bold text-slate-800">{title}</div>
      {hint && <div className="text-[10.5px] text-slate-500 italic">— {hint}</div>}
    </div>
  );
}

function MiniKpi({ label, value, icon: Icon, accent = 'indigo', highlight, testid }) {
  const map = {
    indigo:  { border: 'border-indigo-100',  text: 'text-indigo-700',  icon: 'text-indigo-500' },
    emerald: { border: 'border-emerald-100', text: 'text-emerald-700', icon: 'text-emerald-500' },
    violet:  { border: 'border-violet-100',  text: 'text-violet-700',  icon: 'text-violet-500' },
    amber:   { border: 'border-amber-200',   text: 'text-amber-800',   icon: 'text-amber-500' },
  };
  const c = map[accent] || map.indigo;
  return (
    <div
      data-testid={testid}
      className={`bg-white border ${c.border} rounded-xl p-3 shadow-sm ${highlight ? `ring-1 ring-${accent}-200` : ''}`}
    >
      <div className="flex items-center justify-between mb-1">
        <div className="text-[9px] font-bold uppercase tracking-wider text-slate-500">{label}</div>
        <Icon size={12} className={c.icon} />
      </div>
      <div className={`text-xl font-extrabold ${c.text} tabular-nums`}>{value ?? '—'}</div>
    </div>
  );
}
