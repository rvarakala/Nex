import React, { useState, useEffect, useCallback } from 'react';
import axios from 'axios';
import { API, fmtDate } from './billingUtils';

export default function ReportHandoverPage() {
  const [pending, setPending] = useState([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await axios.get(`${API}/billing/pending-reports`);
      setPending(r.data || []);
    } finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const deliver = async (session, channel) => {
    const recipient = channel === 'whatsapp' || channel === 'email'
      ? window.prompt(`Recipient ${channel === 'whatsapp' ? 'mobile' : 'email'}:`, channel === 'whatsapp' ? (session.patient_mobile || '') : (session.patient_email || ''))
      : null;
    if ((channel === 'whatsapp' || channel === 'email') && !recipient) return;
    try {
      await axios.post(`${API}/billing/report-deliveries`, {
        session_id: session.session_id,
        channel,
        recipient,
      });
      if (channel === 'whatsapp' && recipient) {
        const digits = recipient.replace(/\D/g, '');
        const mobile = digits.length === 10 ? `91${digits}` : digits;
        const msg = `Your audiology report from ${session.test_date ? new Date(session.test_date).toLocaleDateString('en-IN') : 'your visit'} is ready. Please collect it from the front desk or reply to receive a PDF copy.`;
        window.open(`https://wa.me/${mobile}?text=${encodeURIComponent(msg)}`, '_blank');
      }
      load();
    } catch (e) {
      alert(e?.response?.data?.detail || 'Delivery log failed');
    }
  };

  return (
    <div className="p-4 space-y-3" data-testid="report-handover-page">
      <div className="bg-gradient-to-r from-blue-50 to-white border border-blue-200 rounded-lg p-3">
        <div className="text-sm font-bold text-blue-800">Pending Report Handover</div>
        <div className="text-[11px] text-slate-600">
          Completed test sessions that have not yet been handed over to the patient.
          Mark delivery by Print / WhatsApp / Email / In-person pickup.
        </div>
      </div>

      <div className="bg-white rounded-lg border border-slate-200 overflow-hidden">
        <table className="w-full text-xs">
          <thead className="bg-slate-50 border-b border-slate-200 text-[10px] uppercase text-slate-500">
            <tr className="text-left">
              <th className="px-3 py-2 font-semibold">Test Date</th>
              <th className="px-3 py-2 font-semibold">Patient</th>
              <th className="px-3 py-2 font-semibold">Tests</th>
              <th className="px-3 py-2 font-semibold">Status</th>
              <th className="px-3 py-2 font-semibold text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {loading && <tr><td colSpan={5} className="px-3 py-6 text-center text-slate-400 italic">Loading…</td></tr>}
            {!loading && pending.length === 0 && (
              <tr><td colSpan={5} className="px-3 py-8 text-center text-slate-400 italic">All reports have been handed over. Nothing pending.</td></tr>
            )}
            {pending.map((s) => (
              <tr key={s.session_id} data-testid={`pr-row-${s.session_id}`}
                  className="border-b border-slate-100 last:border-0 hover:bg-slate-50">
                <td className="px-3 py-2 text-slate-600">{fmtDate(s.test_date)}</td>
                <td className="px-3 py-2">
                  <div className="font-semibold text-slate-800">{s.patient_name || '—'}</div>
                  <div className="text-[10px] text-slate-500">{s.mrd || s.patient_id}{s.patient_mobile ? ` · ${s.patient_mobile}` : ''}</div>
                </td>
                <td className="px-3 py-2">
                  <div className="flex flex-wrap gap-0.5">
                    {(s.test_types || []).slice(0, 4).map((t) => (
                      <span key={t} className="text-[9px] px-1 py-0 bg-slate-100 text-slate-700 rounded font-semibold uppercase">{t}</span>
                    ))}
                    {(s.test_types || []).length === 0 && <span className="text-[10px] text-slate-400 italic">—</span>}
                  </div>
                </td>
                <td className="px-3 py-2">
                  <span className="text-[10px] font-bold uppercase px-1.5 py-0.5 bg-blue-100 text-blue-800 border border-blue-300 rounded">
                    {s.report_status || 'ready'}
                  </span>
                </td>
                <td className="px-3 py-2 text-right">
                  <div className="inline-flex gap-1">
                    <button onClick={() => deliver(s, 'print')} data-testid={`pr-print-${s.session_id}`}
                      className="px-2 py-0.5 text-[10px] bg-slate-700 hover:bg-slate-800 text-white font-semibold rounded">Print</button>
                    <button onClick={() => deliver(s, 'whatsapp')} data-testid={`pr-wa-${s.session_id}`}
                      className="px-2 py-0.5 text-[10px] bg-[#25D366] hover:bg-[#1ebe5a] text-white font-semibold rounded">WhatsApp</button>
                    <button onClick={() => deliver(s, 'email')} data-testid={`pr-email-${s.session_id}`}
                      className="px-2 py-0.5 text-[10px] bg-indigo-600 hover:bg-indigo-700 text-white font-semibold rounded">Email</button>
                    <button onClick={() => deliver(s, 'in_person')} data-testid={`pr-ip-${s.session_id}`}
                      className="px-2 py-0.5 text-[10px] bg-emerald-600 hover:bg-emerald-700 text-white font-semibold rounded">In-person</button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
