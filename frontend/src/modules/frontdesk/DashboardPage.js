import React, { useEffect, useState, useCallback } from 'react';
import axios from 'axios';
import { useNavigate } from 'react-router-dom';
import ClinicPulse from './ClinicPulse';

const BACKEND_URL = process.env.REACT_APP_BACKEND_URL;
const API = `${BACKEND_URL}/api`;

const KpiCard = ({ label, value, accent, testid }) => (
  <div className={`bg-white rounded-lg border border-slate-200 p-3 shadow-sm`} data-testid={testid}>
    <div className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider">{label}</div>
    <div className={`text-2xl font-bold mt-0.5 ${accent || 'text-slate-800'}`}>{value}</div>
  </div>
);

const statusBadge = (s) => {
  const map = {
    waiting: 'bg-amber-100 text-amber-800 border-amber-300',
    in_consultation: 'bg-blue-100 text-blue-800 border-blue-300',
    in_testing: 'bg-purple-100 text-purple-800 border-purple-300',
    billing: 'bg-emerald-100 text-emerald-800 border-emerald-300',
    completed: 'bg-slate-100 text-slate-600 border-slate-300',
    cancelled: 'bg-red-100 text-red-700 border-red-300',
  };
  return map[s] || 'bg-slate-100 text-slate-700 border-slate-300';
};

export default function DashboardPage() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();

  const load = useCallback(async () => {
    try {
      const r = await axios.get(`${API}/dashboard/frontdesk`);
      setData(r.data);
    } catch (e) {
      console.error('Dashboard load failed', e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
    const iv = setInterval(load, 15000);  // refresh every 15s
    return () => clearInterval(iv);
  }, [load]);

  const advanceToken = async (token_id, status) => {
    try {
      await axios.put(`${API}/tokens/${token_id}/status`, { status });
      await load();
    } catch (e) { console.error(e); }
  };

  const k = data?.kpis || {};

  return (
    <div className="p-4 space-y-3">
      {/* Clinic Pulse — at-a-glance premium tile */}
      <ClinicPulse kpis={k} />

      {/* KPI cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-8 gap-2" data-testid="dashboard-kpis">
        <KpiCard testid="kpi-walkins" label="Walk-ins Today" value={loading ? '—' : k.walkins_today ?? 0} accent="text-blue-700" />
        <KpiCard testid="kpi-returning" label="Returning Today" value={loading ? '—' : k.returning_today ?? 0} accent="text-indigo-700" />
        <KpiCard testid="kpi-appointments" label="Appointments" value={loading ? '—' : k.appointments_today ?? 0} accent="text-slate-500" />
        <KpiCard testid="kpi-waiting" label="Waiting" value={loading ? '—' : k.waiting_now ?? 0} accent="text-amber-700" />
        <KpiCard testid="kpi-checked-in" label="Checked In" value={loading ? '—' : k.checked_in_now ?? 0} accent="text-indigo-700" />
        <KpiCard testid="kpi-in-progress" label="In Progress" value={loading ? '—' : k.in_progress ?? 0} accent="text-purple-700" />
        <KpiCard testid="kpi-completed-today" label="Completed Today" value={loading ? '—' : k.completed_today ?? 0} accent="text-emerald-700" />
        <KpiCard testid="kpi-collections" label="Collections" value={loading ? '—' : `₹${k.collections_today ?? 0}`} accent="text-slate-500" />
      </div>

      {/* Quick actions */}
      <div className="flex gap-2">
        <button
          onClick={() => navigate('/frontdesk/new')}
          data-testid="quick-new-patient"
          className="px-3 py-2 bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold rounded shadow-sm"
        >+ New Patient Walk-in</button>
        <button
          onClick={() => navigate('/frontdesk/returning')}
          data-testid="quick-returning"
          className="px-3 py-2 bg-white border border-slate-300 hover:bg-slate-50 text-slate-700 text-xs font-semibold rounded shadow-sm"
        >Search Returning Patient</button>
      </div>

      {/* Live queue */}
      <div className="bg-white border border-slate-200 rounded-lg shadow-sm overflow-hidden" data-testid="dashboard-queue">
        <div className="px-3 py-2 bg-slate-50 border-b border-slate-200 flex items-center justify-between">
          <h3 className="text-xs font-bold text-slate-700">Live Queue</h3>
          <span className="text-[10px] text-slate-500">{data?.queue?.length || 0} waiting</span>
        </div>
        <div className="max-h-[420px] overflow-auto">
          <table className="w-full text-xs">
            <thead className="bg-slate-50 border-b border-slate-200 sticky top-0">
              <tr>
                <th className="text-left px-3 py-1.5 font-semibold text-slate-600 w-12">Token</th>
                <th className="text-left px-3 py-1.5 font-semibold text-slate-600">Patient</th>
                <th className="text-left px-3 py-1.5 font-semibold text-slate-600">Service</th>
                <th className="text-left px-3 py-1.5 font-semibold text-slate-600">Status</th>
                <th className="text-left px-3 py-1.5 font-semibold text-slate-600">Issued</th>
                <th className="text-right px-3 py-1.5 font-semibold text-slate-600">Actions</th>
              </tr>
            </thead>
            <tbody>
              {(data?.queue || []).length === 0 && (
                <tr><td colSpan={6} className="text-center text-slate-400 italic py-6">Queue is empty — all caught up.</td></tr>
              )}
              {(data?.queue || []).map((t) => (
                <tr key={t.token_id} className="border-b border-slate-100 hover:bg-slate-50" data-testid={`queue-row-${t.token_id}`}>
                  <td className="px-3 py-1.5 font-bold text-blue-700">#{t.token_no}</td>
                  <td className="px-3 py-1.5">
                    <div className="font-medium text-slate-800">{t.patient_name}</div>
                    <div className="text-[10px] text-slate-500">{t.mrd}{t.patient_mobile ? ` · ${t.patient_mobile}` : ''}</div>
                  </td>
                  <td className="px-3 py-1.5 text-slate-600">{t.service || '—'}</td>
                  <td className="px-3 py-1.5">
                    <span className={`text-[10px] font-semibold px-1.5 py-0.5 border rounded ${statusBadge(t.status)}`}>
                      {t.status.replace('_', ' ')}
                    </span>
                  </td>
                  <td className="px-3 py-1.5 text-[10px] text-slate-500">
                    {new Date(t.issued_at).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}
                  </td>
                  <td className="px-3 py-1.5 text-right space-x-1">
                    {t.status === 'waiting' && (
                      <button
                        onClick={() => advanceToken(t.token_id, 'in_testing')}
                        data-testid={`queue-call-${t.token_id}`}
                        className="px-2 py-0.5 text-[10px] bg-purple-600 hover:bg-purple-700 text-white font-semibold rounded"
                      >Call → Testing</button>
                    )}
                    {['in_consultation', 'in_testing'].includes(t.status) && (
                      <button
                        onClick={() => advanceToken(t.token_id, 'completed')}
                        data-testid={`queue-complete-${t.token_id}`}
                        className="px-2 py-0.5 text-[10px] bg-emerald-600 hover:bg-emerald-700 text-white font-semibold rounded"
                      >Complete</button>
                    )}
                    {t.status !== 'cancelled' && (
                      <button
                        onClick={() => navigate('/billing/new', { state: { patient: { patient_id: t.patient_id, name: t.patient_name, mrd: t.mrd, mobile: t.patient_mobile } } })}
                        data-testid={`queue-invoice-${t.token_id}`}
                        title="Create invoice for this patient"
                        className="px-2 py-0.5 text-[10px] bg-emerald-50 border border-emerald-300 text-emerald-700 hover:bg-emerald-100 font-semibold rounded"
                      >₹ Invoice</button>
                    )}
                    {t.status !== 'cancelled' && t.status !== 'completed' && (
                      <button
                        onClick={() => advanceToken(t.token_id, 'cancelled')}
                        data-testid={`queue-cancel-${t.token_id}`}
                        className="px-2 py-0.5 text-[10px] border border-red-300 text-red-600 hover:bg-red-50 font-semibold rounded"
                      >✕</button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
