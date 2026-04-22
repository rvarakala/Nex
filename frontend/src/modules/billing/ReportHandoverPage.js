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

    // For WhatsApp, try to actually attach the PDF via Web Share API (mobile/modern browsers).
    // Fall back to downloading the PDF + opening wa.me text deep-link.
    if (channel === 'whatsapp' && recipient) {
      await shareWhatsAppWithPdf(session, recipient);
    }

    try {
      await axios.post(`${API}/billing/report-deliveries`, {
        session_id: session.session_id,
        channel,
        recipient,
      });
      load();
    } catch (e) {
      alert(e?.response?.data?.detail || 'Delivery log failed');
    }
  };

  async function copyShareLink(session) {
    try {
      const r = await axios.post(`${API}/reports/${session.session_id}/share-link`, { ttl_hours: 168 });
      const fullUrl = `${process.env.REACT_APP_BACKEND_URL}${r.data.path}`;
      await navigator.clipboard.writeText(fullUrl);
      const expires = new Date(r.data.expires_at).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' });
      alert(`Share link copied.\n\nExpires: ${expires} (7 days)\n\n${fullUrl}`);
    } catch (e) {
      alert(e?.response?.data?.detail || 'Failed to create share link');
    }
  }

  async function shareWhatsAppWithPdf(session, recipient) {
    const digits = recipient.replace(/\D/g, '');
    const mobile = digits.length === 10 ? `91${digits}` : digits;
    const visitDate = session.test_date ? new Date(session.test_date).toLocaleDateString('en-IN') : 'your visit';
    const msgBase = `Hi ${session.patient_name || ''}, your audiology report from ${visitDate} is ready.`;

    // Probe once: can this browser natively share File objects via WhatsApp?
    // (Android Chrome / iOS Safari 15+). If yes, attach the real PDF.
    // If no (desktop Chrome/Firefox/etc.), mint a signed short-link and embed it
    // directly in the message body — patient taps the link, gets the PDF, no
    // manual attach step required.
    let pdfFile = null;
    try {
      const r = await axios.get(`${API}/reports/${session.session_id}/pdf`, { responseType: 'blob' });
      pdfFile = new File([r.data], `audiogram-${session.session_id}.pdf`, { type: 'application/pdf' });
    } catch {
      // Silent — we'll still try the share-link path below.
    }

    const canShareFiles = pdfFile && navigator.canShare && navigator.canShare({ files: [pdfFile] });
    if (canShareFiles && navigator.share) {
      try {
        await navigator.share({
          files: [pdfFile],
          text: `${msgBase} Please let us know if you have any questions.`,
          title: 'Audiology Report',
        });
        return;
      } catch (err) {
        if (err?.name === 'AbortError') return;
        // Fall through to share-link path.
      }
    }

    // Desktop / non-share-capable path: mint a signed share URL and embed it.
    let shareUrl = null;
    try {
      const resp = await axios.post(`${API}/reports/${session.session_id}/share-link`, { ttl_hours: 168 });
      shareUrl = `${process.env.REACT_APP_BACKEND_URL}${resp.data.path}`;
    } catch {
      // Share-link mint failed → last-ditch fallback: download + prompt to attach manually.
      if (pdfFile) {
        const url = URL.createObjectURL(pdfFile);
        const a = document.createElement('a');
        a.href = url; a.download = pdfFile.name;
        document.body.appendChild(a); a.click();
        document.body.removeChild(a);
        setTimeout(() => URL.revokeObjectURL(url), 3000);
      }
      const notice = `${msgBase}\n\n(Please attach the downloaded PDF to this chat.)`;
      window.open(`https://wa.me/${mobile}?text=${encodeURIComponent(notice)}`, '_blank');
      return;
    }

    const body = `${msgBase}\n\nView / download the report (expires in 7 days):\n${shareUrl}\n\nPlease let us know if you have any questions.`;
    window.open(`https://wa.me/${mobile}?text=${encodeURIComponent(body)}`, '_blank');
  }

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
                    <button onClick={() => copyShareLink(s)} data-testid={`pr-link-${s.session_id}`}
                      title="Create a 7-day patient-facing link and copy it"
                      className="px-2 py-0.5 text-[10px] bg-white border border-blue-300 text-blue-700 hover:bg-blue-50 font-semibold rounded">🔗 Link</button>
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
