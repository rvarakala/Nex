/**
 * Service Ticket — Phase 14 action panels (loaner issue / loaner return /
 * mark-return-unrepaired / print service note). Mounted inside
 * TicketDetailDrawer when the ticket is in the appropriate state.
 */
import React, { useEffect, useState } from 'react';
import axios from 'axios';
import { Package, ArrowDownLeft, Ban, Printer } from 'lucide-react';

const API = process.env.REACT_APP_BACKEND_URL + '/api';

export function ServiceTicketActions({ ticket, onChanged, hasVendorEstimate }) {
  const [open, setOpen] = useState(null); // 'issue' | 'return' | null
  const isVendor = ticket.repair_location === 'VENDOR';
  const hasLoaner = !!ticket.loaner_serial_id;
  const loanerActive = hasLoaner && !ticket.loaner_returned_at;

  const printServiceNote = () => {
    // Cookie auth carries through the <a> click; PDF opens inline in a new tab.
    const url = `${API}/ha/service-tickets/${ticket.ticket_no}/service-note.pdf`;
    window.open(url, '_blank', 'noopener');
  };

  const markReturnUnrepaired = async () => {
    if (!window.confirm(
      'Mark this ticket as RETURN UN-REPAIRED?\n\n'
      + '• Cost to patient → ₹0\n'
      + '• Inbound courier shell will be auto-created (PENDING_AWB).\n'
      + '• Reception will stamp the vendor\'s AWB later.\n\n'
      + 'This action is for "patient declined the estimate" cases only.'
    )) return;
    try {
      await axios.post(`${API}/ha/service-tickets/${ticket.ticket_no}/mark-return-unrepaired`);
      onChanged();
    } catch (e) {
      alert(e?.response?.data?.detail || 'Failed to mark return un-repaired');
    }
  };

  return (
    <div className="pt-4 border-t border-slate-200 space-y-2" data-testid="ha-tix-phase14-actions">
      {/* Print Service Note — always available for any vendor-route ticket */}
      {isVendor && (
        <button
          type="button" onClick={printServiceNote}
          data-testid="ha-tix-print-service-note"
          className="w-full px-3 py-1.5 text-[11px] font-bold bg-slate-700 hover:bg-slate-800 text-white rounded inline-flex items-center justify-center gap-1.5">
          <Printer size={12} /> Print Service Note (Acknowledgement)
        </button>
      )}

      {/* Loaner actions — issue if not yet, return if active */}
      {!loanerActive ? (
        <button
          type="button" onClick={() => setOpen('issue')}
          data-testid="ha-tix-loaner-issue-btn"
          className="w-full px-3 py-1.5 text-[11px] font-bold bg-amber-600 hover:bg-amber-700 text-white rounded inline-flex items-center justify-center gap-1.5">
          <Package size={12} /> {hasLoaner ? 'Loaner returned — issue new?' : 'Issue Loaner HA'}
        </button>
      ) : (
        <button
          type="button" onClick={() => setOpen('return')}
          data-testid="ha-tix-loaner-return-btn"
          className="w-full px-3 py-1.5 text-[11px] font-bold bg-emerald-600 hover:bg-emerald-700 text-white rounded inline-flex items-center justify-center gap-1.5">
          <ArrowDownLeft size={12} /> Return Loaner
          {ticket.loaner_deposit_amount ? ` · Refund ₹${ticket.loaner_deposit_amount.toFixed(0)}` : ''}
        </button>
      )}

      {/* Return-unrepaired — only available once a vendor estimate exists +
          ticket is on the vendor route + not already flagged. */}
      {isVendor && hasVendorEstimate && !ticket.return_unrepaired && (
        <button
          type="button" onClick={markReturnUnrepaired}
          data-testid="ha-tix-mark-return-unrepaired"
          className="w-full px-3 py-1.5 text-[11px] font-bold bg-rose-600 hover:bg-rose-700 text-white rounded inline-flex items-center justify-center gap-1.5">
          <Ban size={12} /> Patient Declined — Mark Return Un-Repaired
        </button>
      )}

      {/* Already flagged — show status */}
      {ticket.return_unrepaired && (
        <div className="text-[10.5px] bg-rose-50 border border-rose-200 text-rose-700 rounded p-2">
          <b>Return un-repaired</b> · ₹0 to patient · Inbound courier
          {ticket.inbound_shipment_id ? ` ${ticket.inbound_shipment_id}` : ''} (PENDING_AWB) awaiting vendor's AWB.
        </div>
      )}

      {open === 'issue' && (
        <LoanerIssueModal
          ticket={ticket}
          onClose={() => setOpen(null)}
          onDone={() => { setOpen(null); onChanged(); }}
        />
      )}
      {open === 'return' && (
        <LoanerReturnModal
          ticket={ticket}
          onClose={() => setOpen(null)}
          onDone={() => { setOpen(null); onChanged(); }}
        />
      )}
    </div>
  );
}


function LoanerIssueModal({ ticket, onClose, onDone }) {
  const [serials, setSerials] = useState([]);
  const [sid, setSid] = useState('');
  const [deposit, setDeposit] = useState(''); // blank by default
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    (async () => {
      const r = await axios.get(`${API}/ha/serial-items`, { params: { state: 'IN_STOCK', limit: 200 } });
      setSerials(Array.isArray(r.data) ? r.data : []);
    })();
  }, []);

  const submit = async () => {
    if (!sid) { setErr('Pick a loaner serial'); return; }
    setBusy(true); setErr('');
    try {
      const body = { loaner_serial_id: sid };
      if (deposit && Number(deposit) > 0) body.deposit_amount = Number(deposit);
      await axios.post(`${API}/ha/service-tickets/${ticket.ticket_no}/loaner/issue`, body);
      onDone();
    } catch (e) {
      setErr(e?.response?.data?.detail || 'Issue failed');
    } finally { setBusy(false); }
  };

  return (
    <Backdrop onClose={onClose}>
      <div className="bg-white rounded-lg shadow-2xl max-w-md w-full p-5" onClick={(e) => e.stopPropagation()}
           data-testid="ha-tix-loaner-issue-modal">
        <h3 className="text-base font-bold mb-3">Issue Loaner Hearing Aid</h3>
        {err && <div className="bg-rose-50 text-rose-700 text-xs p-2 rounded mb-3">{err}</div>}
        <label className="block text-[10px] uppercase tracking-wider text-slate-500 mb-1 font-semibold">Loaner Serial *</label>
        <select value={sid} onChange={(e) => setSid(e.target.value)}
                data-testid="ha-tix-loaner-issue-serial"
                className="w-full border border-slate-300 rounded px-2 py-1 text-sm mb-3">
          <option value="">— Pick an IN_STOCK unit ({serials.length} available)</option>
          {serials.map(s => (
            <option key={s.serial_id} value={s.serial_id}>
              {s.serial_no} {s.product_id ? `· ${s.product_id}` : ''}
            </option>
          ))}
        </select>
        <label className="block text-[10px] uppercase tracking-wider text-slate-500 mb-1 font-semibold">
          Refundable Deposit (₹) — leave blank if none
        </label>
        <input
          type="number" value={deposit} onChange={(e) => setDeposit(e.target.value)}
          placeholder="e.g. 2000"
          data-testid="ha-tix-loaner-issue-deposit"
          className="w-full border border-slate-300 rounded px-2 py-1 text-sm mb-1"
        />
        <p className="text-[10px] italic text-slate-500 mb-3">
          Loaner will be programmed for ~7 days. Deposit refunded on return.
        </p>
        <div className="flex justify-end gap-2 pt-2 border-t border-slate-100">
          <button onClick={onClose} className="px-3 py-1.5 text-xs text-slate-600">Cancel</button>
          <button onClick={submit} disabled={busy}
                  data-testid="ha-tix-loaner-issue-submit"
                  className="px-4 py-1.5 text-xs font-bold bg-amber-600 hover:bg-amber-700 disabled:bg-slate-300 text-white rounded">
            {busy ? 'Issuing…' : 'Issue Loaner'}
          </button>
        </div>
      </div>
    </Backdrop>
  );
}


function LoanerReturnModal({ ticket, onClose, onDone }) {
  const [forfeit, setForfeit] = useState(false);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  const hasDeposit = !!ticket.loaner_deposit_amount;

  const submit = async () => {
    setBusy(true); setErr('');
    try {
      await axios.post(`${API}/ha/service-tickets/${ticket.ticket_no}/loaner/return`,
        { forfeit_deposit: forfeit });
      onDone();
    } catch (e) {
      setErr(e?.response?.data?.detail || 'Return failed');
    } finally { setBusy(false); }
  };

  return (
    <Backdrop onClose={onClose}>
      <div className="bg-white rounded-lg shadow-2xl max-w-md w-full p-5" onClick={(e) => e.stopPropagation()}
           data-testid="ha-tix-loaner-return-modal">
        <h3 className="text-base font-bold mb-3">Return Loaner Hearing Aid</h3>
        {err && <div className="bg-rose-50 text-rose-700 text-xs p-2 rounded mb-3">{err}</div>}
        <div className="text-xs text-slate-700 space-y-1 mb-3">
          <div>Loaner serial: <b>{ticket.loaner_serial_id}</b></div>
          {hasDeposit && <div>Deposit collected: <b>₹{ticket.loaner_deposit_amount.toFixed(2)}</b></div>}
          {ticket.loaner_issued_at && (
            <div>Issued: {new Date(ticket.loaner_issued_at).toLocaleDateString('en-IN')}</div>
          )}
        </div>

        {hasDeposit && (
          <label className="text-xs inline-flex items-center gap-2 cursor-pointer p-2 bg-rose-50 border border-rose-200 rounded w-full mb-3">
            <input type="checkbox" checked={forfeit} onChange={(e) => setForfeit(e.target.checked)}
                   data-testid="ha-tix-loaner-return-forfeit" />
            <span>
              <b>Forfeit deposit</b> — patient walked off / never returned.
              <br />
              <span className="text-[10px] italic text-rose-600">Use only after exhausting 7-day reminders.</span>
            </span>
          </label>
        )}

        <div className="flex justify-end gap-2 pt-2 border-t border-slate-100">
          <button onClick={onClose} className="px-3 py-1.5 text-xs text-slate-600">Cancel</button>
          <button onClick={submit} disabled={busy}
                  data-testid="ha-tix-loaner-return-submit"
                  className={`px-4 py-1.5 text-xs font-bold ${forfeit ? 'bg-rose-600 hover:bg-rose-700' : 'bg-emerald-600 hover:bg-emerald-700'} disabled:bg-slate-300 text-white rounded`}>
            {busy ? 'Saving…' : forfeit ? 'Forfeit & Return' : (hasDeposit ? 'Refund & Return' : 'Mark Returned')}
          </button>
        </div>
      </div>
    </Backdrop>
  );
}


function Backdrop({ children, onClose }) {
  return (
    <div className="fixed inset-0 bg-black/40 z-[60] flex items-center justify-center p-4"
         onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      {children}
    </div>
  );
}
