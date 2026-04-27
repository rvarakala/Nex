/**
 * AudinexaPipelineDrawer — full 13-state service-job UI.
 *
 * Opens when the user clicks a row in ServiceTicketsPage.
 * Provides:
 *   • Visual pipeline timeline with stamped-at dates
 *   • State transition buttons (only shows legal next states)
 *   • Book Courier form (OUTBOUND + INBOUND)
 *   • Record Estimate form (auto-creates pending CustomerApproval)
 *   • Approve / Reject CTA for front-desk
 *   • Job Card PDF download
 *   • "Send WhatsApp" link using the per-status template
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import axios from 'axios';

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;
const fmtINR = (n) => `₹${Number(n || 0).toLocaleString('en-IN', { maximumFractionDigits: 0 })}`;

const PIPELINE_ORDER = [
  'RECEIVED', 'INSPECTED', 'AWAITING_DISPATCH', 'DISPATCHED', 'IN_TRANSIT',
  'DELIVERED_TO_COMPANY', 'ESTIMATE_PENDING', 'CLIENT_APPROVED',
  'REPAIR_IN_PROGRESS', 'RETURN_SHIPPED', 'READY_FOR_PICKUP',
  'DELIVERED_TO_CLIENT', 'CLOSED',
];
const PIPELINE_LABELS = {
  RECEIVED: 'Received', INSPECTED: 'Inspected', AWAITING_DISPATCH: 'Awaiting Dispatch',
  DISPATCHED: 'Dispatched', IN_TRANSIT: 'In Transit',
  DELIVERED_TO_COMPANY: 'At Service Centre', ESTIMATE_PENDING: 'Estimate Pending',
  CLIENT_APPROVED: 'Client Approved', CLIENT_REJECTED: 'Client Rejected',
  REPAIR_IN_PROGRESS: 'Repair in Progress', RETURN_SHIPPED: 'Return Shipped',
  READY_FOR_PICKUP: 'Ready for Pickup', DELIVERED_TO_CLIENT: 'Delivered',
  CLOSED: 'Closed', CANCELLED: 'Cancelled',
};

// Legal next states mirror backend JOB_TRANSITIONS. Duplicated here so the UI
// doesn't have to round-trip to discover legal actions.
const NEXT_STATES = {
  RECEIVED:             ['INSPECTED', 'AWAITING_DISPATCH', 'READY_FOR_PICKUP', 'CANCELLED'],
  INSPECTED:            ['AWAITING_DISPATCH', 'READY_FOR_PICKUP', 'CANCELLED'],
  AWAITING_DISPATCH:    ['DISPATCHED', 'CANCELLED'],
  DISPATCHED:           ['IN_TRANSIT', 'CANCELLED'],
  IN_TRANSIT:           ['DELIVERED_TO_COMPANY', 'CANCELLED'],
  DELIVERED_TO_COMPANY: ['ESTIMATE_PENDING', 'REPAIR_IN_PROGRESS', 'CANCELLED'],
  ESTIMATE_PENDING:     ['CLIENT_APPROVED', 'CLIENT_REJECTED', 'CANCELLED'],
  CLIENT_APPROVED:      ['REPAIR_IN_PROGRESS', 'CANCELLED'],
  CLIENT_REJECTED:      ['RETURN_SHIPPED', 'CANCELLED'],
  REPAIR_IN_PROGRESS:   ['RETURN_SHIPPED', 'CANCELLED'],
  RETURN_SHIPPED:       ['READY_FOR_PICKUP', 'CANCELLED'],
  READY_FOR_PICKUP:     ['DELIVERED_TO_CLIENT', 'CANCELLED'],
  DELIVERED_TO_CLIENT:  ['CLOSED'],
  CLOSED:               [],
  CANCELLED:            [],
};

export default function AudinexaPipelineDrawer({ ticketNo, onClose, onChanged }) {
  const [pipe, setPipe] = useState(null);
  const [err, setErr] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [waMessage, setWaMessage] = useState(null);

  // Sub-forms
  const [showCourier, setShowCourier] = useState(false);
  const [showEstimate, setShowEstimate] = useState(false);

  const load = useCallback(async () => {
    setErr(''); setLoading(true);
    try {
      const r = await axios.get(`${API}/ha/service-jobs/${ticketNo}/pipeline`);
      setPipe(r.data);
    } catch (e) { setErr(e?.response?.data?.detail || 'Failed to load pipeline'); }
    finally { setLoading(false); }
  }, [ticketNo]);

  useEffect(() => { load(); }, [load]);

  const curStatus = pipe?.normalised_status;
  const legalNext = useMemo(() => NEXT_STATES[curStatus] || [], [curStatus]);

  const transition = async (to_status, opts = {}) => {
    if (!opts.skipConfirm) {
      if (!window.confirm(`Move Job ${ticketNo} → ${PIPELINE_LABELS[to_status] || to_status}?`)) return;
    }
    setBusy(true);
    try {
      await axios.post(`${API}/ha/service-tickets/${ticketNo}/transition`, {
        to_status, note: opts.note || undefined,
      });
      await load();
      onChanged && onChanged();
    } catch (e) { setErr(e?.response?.data?.detail || 'Transition failed'); }
    finally { setBusy(false); }
  };

  const loadWhatsApp = async (forceStatus) => {
    try {
      const r = await axios.get(`${API}/ha/service-tickets/${ticketNo}/whatsapp`, {
        params: forceStatus ? { status: forceStatus } : {},
      });
      setWaMessage(r.data);
    } catch (e) { setErr(e?.response?.data?.detail || 'WhatsApp render failed'); }
  };

  if (loading && !pipe) return <DrawerShell onClose={onClose}><Skel /></DrawerShell>;
  if (!pipe) return <DrawerShell onClose={onClose}><div className="p-6 text-rose-700 text-sm">{err || 'No data'}</div></DrawerShell>;

  const t = pipe.ticket;
  const stampedAt = {
    RECEIVED: t.created_at, INSPECTED: null, AWAITING_DISPATCH: null,
    DISPATCHED: t.dispatched_at, IN_TRANSIT: null,
    DELIVERED_TO_COMPANY: t.delivered_to_company_at,
    ESTIMATE_PENDING: t.estimate_received_at,
    CLIENT_APPROVED: t.client_decided_at, CLIENT_REJECTED: t.client_decided_at,
    REPAIR_IN_PROGRESS: null, RETURN_SHIPPED: t.return_shipped_at,
    READY_FOR_PICKUP: t.ready_at, DELIVERED_TO_CLIENT: t.delivered_to_client_at,
    CLOSED: t.closed_at,
  };
  const curIdx = PIPELINE_ORDER.indexOf(curStatus);

  return (
    <DrawerShell onClose={onClose} title={`Service Job · ${ticketNo}`}>
      {err && <div className="bg-rose-50 text-rose-800 text-xs p-2 rounded mb-3">{err}</div>}

      {/* ===== HEADER ===== */}
      <div className="flex items-start justify-between mb-5 pb-4 border-b border-slate-200">
        <div>
          <div className="text-[10px] uppercase tracking-wider text-slate-500 font-semibold">Patient · Device</div>
          <div className="font-bold text-slate-800 mt-0.5">
            {t.patient_name} <span className="text-slate-400 font-normal">· {t.patient_mobile || '—'}</span>
          </div>
          <div className="text-xs text-slate-500 font-mono">{t.serial_no || t.serial_id || 'No device linked'}</div>
        </div>
        <div className="flex gap-2">
          <a href={`${API}/ha/service-tickets/${ticketNo}/job-card.pdf`}
             target="_blank" rel="noreferrer"
             data-testid="audinexa-job-card-pdf"
             className="px-3 py-1.5 text-xs font-bold border border-slate-300 rounded hover:bg-slate-100">
            📄 Job Card PDF
          </a>
          <button onClick={() => loadWhatsApp()}
                  data-testid="audinexa-whatsapp-btn"
                  className="px-3 py-1.5 text-xs font-bold bg-emerald-600 hover:bg-emerald-700 text-white rounded">
            WhatsApp
          </button>
        </div>
      </div>

      {/* ===== TIMELINE ===== */}
      <div className="mb-6" data-testid="audinexa-pipeline-timeline">
        <div className="text-[10px] uppercase tracking-wider text-slate-500 font-semibold mb-2">Pipeline</div>
        <div className="flex overflow-x-auto gap-1 pb-2">
          {PIPELINE_ORDER.map((st, idx) => {
            const done = idx <= curIdx && curIdx >= 0;
            const active = idx === curIdx;
            const stamp = stampedAt[st];
            return (
              <div key={st}
                   data-testid={`audinexa-pipeline-step-${st}`}
                   className={`flex-shrink-0 min-w-[95px] rounded p-2 text-center border ${
                     active ? 'bg-indigo-600 text-white border-indigo-700 font-bold' :
                     done   ? 'bg-emerald-50 text-emerald-800 border-emerald-300' :
                              'bg-slate-50 text-slate-400 border-slate-200'
                   }`}>
                <div className="text-[10px] font-semibold">{idx + 1}</div>
                <div className="text-[10px] leading-tight font-bold">{PIPELINE_LABELS[st]}</div>
                {stamp && (
                  <div className={`text-[9px] ${active ? 'text-indigo-100' : 'text-slate-500'}`}>
                    {new Date(stamp).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' })}
                  </div>
                )}
              </div>
            );
          })}
        </div>
        <div className="text-[10px] text-slate-500 mt-1">
          Current: <b className="text-slate-800">{PIPELINE_LABELS[curStatus] || curStatus}</b>
        </div>
      </div>

      {/* ===== ACTIONS ===== */}
      {legalNext.length > 0 && (
        <div className="mb-5">
          <div className="text-[10px] uppercase tracking-wider text-slate-500 font-semibold mb-2">
            Next step
          </div>
          <div className="flex flex-wrap gap-2">
            {legalNext.map(st => (
              <button key={st} onClick={() => transition(st)} disabled={busy}
                      data-testid={`audinexa-next-${st}`}
                      className={`px-3 py-1.5 text-xs font-bold rounded ${
                        st === 'CANCELLED'
                          ? 'bg-rose-100 hover:bg-rose-200 text-rose-800'
                          : 'bg-indigo-600 hover:bg-indigo-700 text-white'
                      } disabled:opacity-50`}>
                → {PIPELINE_LABELS[st]}
              </button>
            ))}
          </div>
        </div>
      )}

      {pipe.is_terminal && (
        <div className="bg-slate-50 border border-slate-200 rounded p-3 mb-4 text-center text-sm text-slate-600">
          Job is in a terminal state. No further transitions allowed.
        </div>
      )}

      {/* ===== INSPECTION NOTES (shown at RECEIVED) ===== */}
      {curStatus === 'RECEIVED' && (
        <InspectionNotesForm
          ticketNo={ticketNo}
          onDone={() => { load(); onChanged && onChanged(); }}
          existing={t.inspection_notes}
        />
      )}

      {/* ===== INSPECTION SUMMARY (read-only, after RECEIVED) ===== */}
      {curStatus !== 'RECEIVED' && t.inspection_notes && (
        <div className="mb-5 bg-blue-50 border border-blue-200 rounded p-3 text-xs"
             data-testid="audinexa-inspection-summary">
          <div className="text-[10px] uppercase tracking-wider font-bold text-blue-900 mb-1">
            Inspection Notes
          </div>
          <div className="text-slate-700 whitespace-pre-wrap">{t.inspection_notes}</div>
        </div>
      )}

      {/* ===== END-OF-PIPELINE: Print Service Report ===== */}
      {(curStatus === 'READY_FOR_PICKUP' ||
        curStatus === 'DELIVERED_TO_CLIENT' ||
        curStatus === 'CLOSED') && (
        <div className="mb-5 bg-emerald-50 border border-emerald-200 rounded p-3 flex items-center justify-between"
             data-testid="audinexa-final-report-banner">
          <div>
            <div className="text-xs font-bold text-emerald-900">Service complete</div>
            <div className="text-[11px] text-emerald-800">Print the full Service Report with timeline, shipments, estimates &amp; resolution.</div>
          </div>
          <a href={`${API}/ha/service-tickets/${ticketNo}/job-card.pdf`}
             target="_blank" rel="noreferrer"
             data-testid="audinexa-print-service-report"
             className="px-4 py-2 text-xs font-bold bg-emerald-600 hover:bg-emerald-700 text-white rounded shadow">
            🖨️ Print Service Report
          </a>
        </div>
      )}

      {/* ===== COURIER SECTION ===== */}
      <Section title="Couriers" count={pipe.shipments.length}
               action={!pipe.is_terminal && (
                 <button onClick={() => setShowCourier(s => !s)}
                         data-testid="audinexa-book-courier-toggle"
                         className="text-[11px] font-semibold text-indigo-600 hover:underline">
                   + Book shipment
                 </button>
               )}>
        {pipe.shipments.length === 0 ? <Empty label="No shipments yet." /> : (
          <table className="w-full text-xs">
            <thead className="text-[10px] uppercase text-slate-500">
              <tr><th className="text-left">ID</th><th>Dir</th><th className="text-left">Partner</th><th className="text-left">AWB</th><th>Status</th></tr>
            </thead>
            <tbody>
              {pipe.shipments.map(s => (
                <tr key={s.shipment_id} className="border-t border-slate-100"
                    data-testid={`audinexa-shipment-${s.shipment_id}`}>
                  <td className="py-1 font-mono text-[10px]">{s.shipment_id}</td>
                  <td className="text-center text-[10px]">{s.direction === 'OUTBOUND' ? '📤' : '📥'}</td>
                  <td>{s.courier_partner}</td>
                  <td className="font-mono text-[10px]">{s.awb_number}</td>
                  <td className="text-center">
                    <span className="bg-slate-100 text-slate-700 px-1 py-0.5 rounded text-[10px] font-bold">{s.status}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {showCourier && <CourierForm ticketNo={ticketNo} curStatus={curStatus} onDone={() => { setShowCourier(false); load(); }} />}
      </Section>

      {/* ===== ESTIMATES ===== */}
      <Section title="Vendor Estimates" count={pipe.estimates.length}
               action={curStatus === 'DELIVERED_TO_COMPANY' && (
                 <button onClick={() => setShowEstimate(s => !s)}
                         data-testid="audinexa-record-estimate-toggle"
                         className="text-[11px] font-semibold text-indigo-600 hover:underline">
                   + Record estimate
                 </button>
               )}>
        {pipe.estimates.length === 0 ? <Empty label="No estimates received yet." /> : (
          <div className="space-y-2">
            {pipe.estimates.map(e => (
              <div key={e.estimate_id}
                   className="border border-slate-200 rounded p-2 text-xs"
                   data-testid={`audinexa-estimate-${e.estimate_id}`}>
                <div className="flex justify-between mb-1">
                  <div className="font-mono text-[10px] font-bold">{e.estimate_id}</div>
                  <div>
                    {e.warranty_covered
                      ? <span className="bg-emerald-100 text-emerald-800 px-1 py-0.5 rounded text-[10px] font-bold">WARRANTY</span>
                      : <span className="font-mono font-bold text-slate-800">{fmtINR(e.amount)}</span>}
                  </div>
                </div>
                <div className="text-[11px]">{e.vendor_name || '—'} · ETA {e.eta_days || '?'}d</div>
                {e.repair_notes && <div className="text-[10px] text-slate-600 italic mt-0.5">{e.repair_notes}</div>}
              </div>
            ))}
          </div>
        )}
        {showEstimate && <EstimateForm ticketNo={ticketNo} onDone={() => { setShowEstimate(false); load(); }} />}
      </Section>

      {/* ===== APPROVALS ===== */}
      <Section title="Customer Approvals" count={pipe.approvals.length}>
        {pipe.approvals.length === 0 ? <Empty label="No approvals yet." /> : (
          <div className="space-y-2">
            {pipe.approvals.map(a => (
              <ApprovalRow key={a.approval_id} approval={a} onChanged={load} />
            ))}
          </div>
        )}
      </Section>

      {/* ===== WHATSAPP PREVIEW ===== */}
      {waMessage && (
        <div className="fixed bottom-4 right-4 z-60 max-w-sm bg-white border-2 border-emerald-400 rounded-lg shadow-2xl p-4"
             data-testid="audinexa-whatsapp-preview">
          <div className="flex justify-between mb-2">
            <div className="text-xs font-bold text-emerald-800">WhatsApp · {waMessage.status || 'message'}</div>
            <button onClick={() => setWaMessage(null)} className="text-slate-400 hover:text-slate-700">×</button>
          </div>
          {waMessage.message ? (
            <>
              <div className="bg-emerald-50 text-xs p-2 rounded mb-2">{waMessage.message}</div>
              {waMessage.url ? (
                <a href={waMessage.url} target="_blank" rel="noreferrer"
                   data-testid="audinexa-whatsapp-open"
                   className="block text-center py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold rounded">
                  Open in WhatsApp →
                </a>
              ) : (
                <div className="text-[10px] text-slate-500 italic">No patient mobile on file — copy message manually.</div>
              )}
            </>
          ) : (
            <div className="text-xs italic text-slate-500">
              {waMessage.note || 'No template configured for this status.'}
            </div>
          )}
        </div>
      )}
    </DrawerShell>
  );
}


/* ============ SUB-COMPONENTS ============ */

function DrawerShell({ children, onClose, title }) {
  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex justify-end" onClick={onClose}>
      <div className="bg-white w-full max-w-2xl h-full overflow-y-auto p-6"
           onClick={(e) => e.stopPropagation()}
           data-testid="audinexa-pipeline-drawer">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-bold">{title || 'Service Job'}</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-700 text-xl">×</button>
        </div>
        {children}
      </div>
    </div>
  );
}

function Section({ title, count, action, children }) {
  return (
    <div className="mb-5 border-t border-slate-100 pt-4">
      <div className="flex items-center justify-between mb-2">
        <div className="text-[11px] uppercase tracking-wider text-slate-600 font-bold">
          {title} <span className="text-slate-400">({count})</span>
        </div>
        {action}
      </div>
      {children}
    </div>
  );
}

const Skel = () => <div className="space-y-3 p-4"><div className="h-8 bg-slate-100 rounded animate-pulse" /><div className="h-24 bg-slate-100 rounded animate-pulse" /></div>;
const Empty = ({ label }) => <div className="text-[11px] italic text-slate-400 text-center py-3">{label}</div>;


function InspectionNotesForm({ ticketNo, onDone, existing }) {
  const [note, setNote] = useState(existing || '');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  const submit = async (toStatus) => {
    if (toStatus === 'INSPECTED' && (!note || note.trim().length < 5)) {
      setErr('Add inspection notes (at least 5 characters) before marking inspected.');
      return;
    }
    setBusy(true); setErr('');
    try {
      await axios.post(`${API}/ha/service-tickets/${ticketNo}/transition`, {
        to_status: toStatus, note: note.trim() || undefined,
      });
      onDone();
    } catch (e) { setErr(e?.response?.data?.detail || 'Failed'); }
    finally { setBusy(false); }
  };

  return (
    <div className="mb-5 bg-blue-50 border border-blue-200 rounded p-3"
         data-testid="audinexa-inspection-form">
      <div className="text-[10px] uppercase tracking-wider font-bold text-blue-900 mb-2">
        Inspection notes
      </div>
      {err && <div className="bg-rose-100 text-rose-800 p-1.5 rounded text-[11px] mb-2">{err}</div>}
      <textarea
        value={note}
        onChange={(e) => setNote(e.target.value)}
        rows={3}
        placeholder="What did you find? (e.g., receiver crackling, mic dead, water damage to shell, no power on battery swap…)"
        data-testid="audinexa-inspection-input"
        className="w-full border border-slate-300 rounded px-2 py-1.5 text-xs"
      />
      <div className="flex gap-2 mt-2">
        <button onClick={() => submit('INSPECTED')} disabled={busy}
                data-testid="audinexa-inspection-save"
                className="px-3 py-1.5 text-xs font-bold bg-blue-600 hover:bg-blue-700 disabled:bg-slate-300 text-white rounded">
          Save &amp; mark Inspected →
        </button>
        <span className="text-[10px] text-slate-500 self-center italic">
          You can also pick a state directly above; notes will be attached to this job.
        </span>
      </div>
    </div>
  );
}


function CourierForm({ ticketNo, curStatus, onDone }) {
  const [partner, setPartner] = useState('Bluedart');
  const [awb, setAwb] = useState('');
  const [dispatchDate, setDispatchDate] = useState(new Date().toISOString().slice(0, 10));
  const [etaDate, setEtaDate] = useState('');
  const [toAddr, setToAddr] = useState('');
  const [direction, setDirection] = useState(curStatus === 'RETURN_SHIPPED' || curStatus === 'CLIENT_APPROVED' ? 'INBOUND' : 'OUTBOUND');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [success, setSuccess] = useState(null);

  const willAutoAdvance =
    (direction === 'OUTBOUND' && curStatus === 'AWAITING_DISPATCH') ||
    (direction === 'INBOUND' && (curStatus === 'REPAIR_IN_PROGRESS' || curStatus === 'CLIENT_REJECTED'));
  const autoNext = willAutoAdvance
    ? (direction === 'OUTBOUND' ? 'Dispatched' : 'Return Shipped')
    : null;

  const submit = async () => {
    setErr(''); setSuccess(null);
    if (!awb || awb.trim().length < 4) { setErr('AWB number is required (min 4 chars)'); return; }
    setBusy(true);
    try {
      const body = {
        ticket_no: ticketNo, direction, courier_partner: partner,
        awb_number: awb.trim(), dispatch_date: dispatchDate || undefined,
        to_address: toAddr || undefined,
      };
      if (etaDate) body.eta_date = etaDate;
      const r = await axios.post(`${API}/ha/couriers`, body);
      setSuccess({ shipment_id: r.data.shipment_id, advanced: !!autoNext, advancedTo: autoNext });
      // Brief delay to let the user see the confirmation, then close + reload
      setTimeout(() => onDone(), 900);
    } catch (e) { setErr(e?.response?.data?.detail || 'Failed to book shipment'); }
    finally { setBusy(false); }
  };

  return (
    <div className="mt-2 bg-slate-50 border border-slate-200 rounded p-3 text-xs space-y-2"
         data-testid="audinexa-courier-form">
      {err && <div className="bg-rose-100 text-rose-800 p-1.5 rounded text-[11px]" data-testid="audinexa-courier-err">{err}</div>}
      {success && (
        <div className="bg-emerald-100 text-emerald-900 p-2 rounded text-[11px] font-bold"
             data-testid="audinexa-courier-success">
          ✓ Shipment {success.shipment_id} booked.
          {success.advanced && <> Pipeline auto-advanced to <b>{success.advancedTo}</b>.</>}
        </div>
      )}
      {autoNext && !success && (
        <div className="bg-amber-50 text-amber-800 p-1.5 rounded text-[10px] italic" data-testid="audinexa-courier-hint">
          Booking this shipment will move the job to <b>{autoNext}</b>.
        </div>
      )}
      <div className="grid grid-cols-2 gap-2">
        <select value={direction} onChange={(e) => setDirection(e.target.value)}
                data-testid="audinexa-courier-direction"
                className="border border-slate-300 rounded px-2 py-1 text-xs">
          <option value="OUTBOUND">Outbound (to company)</option>
          <option value="INBOUND">Inbound (from company)</option>
        </select>
        <select value={partner} onChange={(e) => setPartner(e.target.value)}
                className="border border-slate-300 rounded px-2 py-1 text-xs">
          {['Bluedart', 'DTDC', 'Delhivery', 'Shiprocket', 'Custom'].map(p =>
            <option key={p} value={p}>{p}</option>,
          )}
        </select>
      </div>
      <input value={awb} onChange={(e) => setAwb(e.target.value)}
             placeholder="AWB Number"
             data-testid="audinexa-courier-awb"
             className="w-full border border-slate-300 rounded px-2 py-1 text-xs font-mono" />
      <div className="grid grid-cols-2 gap-2">
        <input type="date" value={dispatchDate} onChange={(e) => setDispatchDate(e.target.value)}
               className="border border-slate-300 rounded px-2 py-1 text-xs" />
        <input type="date" value={etaDate} onChange={(e) => setEtaDate(e.target.value)}
               className="border border-slate-300 rounded px-2 py-1 text-xs" placeholder="ETA" />
      </div>
      <input value={toAddr} onChange={(e) => setToAddr(e.target.value)}
             placeholder="Destination address" className="w-full border border-slate-300 rounded px-2 py-1 text-xs" />
      <button onClick={submit} disabled={busy || !awb}
              data-testid="audinexa-courier-submit"
              className="w-full bg-indigo-600 hover:bg-indigo-700 disabled:bg-slate-300 text-white font-bold py-1.5 rounded text-xs">
        Book shipment
      </button>
    </div>
  );
}

function EstimateForm({ ticketNo, onDone }) {
  const [vendor, setVendor] = useState('');
  const [amount, setAmount] = useState(0);
  const [warranty, setWarranty] = useState(false);
  const [eta, setEta] = useState(4);
  const [notes, setNotes] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setErr(''); setBusy(true);
    try {
      await axios.post(`${API}/ha/service-estimates`, {
        ticket_no: ticketNo, vendor_name: vendor,
        amount: Number(amount), warranty_covered: warranty,
        eta_days: Number(eta), repair_notes: notes,
      });
      onDone();
    } catch (e) { setErr(e?.response?.data?.detail || 'Failed'); }
    finally { setBusy(false); }
  };

  return (
    <div className="mt-2 bg-amber-50 border border-amber-200 rounded p-3 text-xs space-y-2"
         data-testid="audinexa-estimate-form">
      {err && <div className="bg-rose-100 text-rose-800 p-1.5 rounded text-[11px]">{err}</div>}
      <input value={vendor} onChange={(e) => setVendor(e.target.value)}
             placeholder="Vendor / Service centre name"
             data-testid="audinexa-estimate-vendor"
             className="w-full border border-slate-300 rounded px-2 py-1 text-xs" />
      <div className="grid grid-cols-2 gap-2">
        <input type="number" value={amount} onChange={(e) => setAmount(e.target.value)}
               disabled={warranty}
               placeholder="Amount (₹)"
               data-testid="audinexa-estimate-amount"
               className="border border-slate-300 rounded px-2 py-1 text-xs" />
        <label className="inline-flex items-center gap-1 text-[11px]">
          <input type="checkbox" checked={warranty} onChange={(e) => setWarranty(e.target.checked)}
                 data-testid="audinexa-estimate-warranty" />
          Warranty covered
        </label>
      </div>
      <input type="number" value={eta} onChange={(e) => setEta(e.target.value)}
             placeholder="ETA days" className="w-full border border-slate-300 rounded px-2 py-1 text-xs" />
      <textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)}
                placeholder="Repair notes"
                className="w-full border border-slate-300 rounded px-2 py-1 text-xs" />
      <button onClick={submit} disabled={busy}
              data-testid="audinexa-estimate-submit"
              className="w-full bg-amber-600 hover:bg-amber-700 disabled:bg-slate-300 text-white font-bold py-1.5 rounded text-xs">
        Record estimate + request patient approval
      </button>
    </div>
  );
}

function ApprovalRow({ approval, onChanged }) {
  const [busy, setBusy] = useState(false);
  const [notes, setNotes] = useState('');
  const decide = async (decision) => {
    if (!window.confirm(`Confirm ${decision}?`)) return;
    setBusy(true);
    try {
      await axios.post(`${API}/ha/customer-approvals/${approval.approval_id}/decide`, {
        decision, notes: notes || undefined,
      });
      onChanged();
    } finally { setBusy(false); }
  };
  const colors = {
    PENDING: 'bg-amber-100 text-amber-900',
    APPROVED: 'bg-emerald-100 text-emerald-900',
    REJECTED: 'bg-rose-100 text-rose-900',
  };
  return (
    <div className={`rounded p-2 text-xs ${colors[approval.decision]}`}
         data-testid={`audinexa-approval-${approval.approval_id}`}>
      <div className="flex justify-between items-center mb-1">
        <div className="font-mono text-[10px] font-bold">{approval.approval_id}</div>
        <div className="text-[10px] font-bold">{approval.decision}</div>
      </div>
      {approval.decision === 'PENDING' ? (
        <div className="space-y-1 mt-2">
          <input value={notes} onChange={(e) => setNotes(e.target.value)}
                 placeholder="Reason (rejections only)" className="w-full border border-slate-300 rounded px-2 py-1 text-[11px] bg-white" />
          <div className="flex gap-1">
            <button onClick={() => decide('APPROVED')} disabled={busy}
                    data-testid={`audinexa-approve-${approval.approval_id}`}
                    className="flex-1 bg-emerald-600 hover:bg-emerald-700 text-white font-bold py-1 rounded text-[11px]">
              ✓ Patient Approved
            </button>
            <button onClick={() => decide('REJECTED')} disabled={busy}
                    data-testid={`audinexa-reject-${approval.approval_id}`}
                    className="flex-1 bg-rose-600 hover:bg-rose-700 text-white font-bold py-1 rounded text-[11px]">
              ✗ Rejected
            </button>
          </div>
        </div>
      ) : (
        <div className="text-[10px] mt-1">
          {approval.decided_by_name && <>by {approval.decided_by_name} · </>}
          {approval.decided_at && new Date(approval.decided_at).toLocaleString('en-GB').slice(0, -3)}
          {approval.notes && <div className="italic mt-0.5">"{approval.notes}"</div>}
        </div>
      )}
    </div>
  );
}
