import React, { useRef, useState } from 'react';
import axios from 'axios';
import { X, Truck, AlertCircle, CheckCircle2 } from 'lucide-react';
import SignaturePad from '../../../components/SignaturePad';

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;

const RECEIVER_ROLES = [
  { value: 'front_desk',   label: 'Front desk' },
  { value: 'audiologist',  label: 'Audiologist' },
  { value: 'technician',   label: 'Technician' },
  { value: 'clinic_owner', label: 'Clinic owner' },
  { value: 'other',        label: 'Other' },
];

/**
 * ReceiveTransferModal — destination clinic confirms receipt of a dispatched
 * stock transfer. Shows the challan, captures receiver name + role + drawn
 * signature, then POSTs the signature to GridFS and finalises the receive.
 */
export default function ReceiveTransferModal({ transfer, onClose, onReceived }) {
  const sigRef = useRef(null);
  const [name, setName] = useState('');
  const [role, setRole] = useState('front_desk');
  const [shortShipNote, setShortShipNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  const submit = async () => {
    setErr('');
    if (!name.trim()) { setErr('Receiver name is required'); return; }
    if (!sigRef.current || sigRef.current.isEmpty()) { setErr('Please sign before confirming'); return; }
    setBusy(true);
    try {
      // 1. Upload the drawn signature → GridFS, returns fs_id
      const dataUrl = sigRef.current.getDataUrl();
      const sigForm = new FormData();
      const blob = await (await fetch(dataUrl)).blob();
      sigForm.append('file', blob, `sig-${transfer.transfer_id}.png`);
      const sigRes = await axios.post(
        `${API}/stock-transfers/${transfer.transfer_id}/signature`,
        sigForm,
        { headers: { 'Content-Type': 'multipart/form-data' } },
      );
      const fsId = sigRes.data?.signature_image_fs_id;

      // 2. Confirm receive — atomically flips inventory + audit row
      await axios.post(`${API}/stock-transfers/${transfer.transfer_id}/receive`, {
        received_by_name: name.trim(),
        received_by_role: role,
        signature_image_fs_id: fsId,
        short_shipment_notes: shortShipNote.trim() || null,
      });
      onReceived?.();
    } catch (e) {
      setErr(e?.response?.data?.detail || e?.message || 'Receive failed');
      setBusy(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4"
      onClick={(e) => { if (e.target === e.currentTarget) onClose?.(); }}
      data-testid="transfer-receive-modal"
    >
      <div className="bg-white rounded-xl shadow-2xl w-[640px] max-w-full max-h-[92vh] flex flex-col">
        {/* Header */}
        <div className="px-5 py-3 border-b border-slate-200 flex items-center justify-between bg-gradient-to-r from-amber-50 to-white">
          <div className="flex items-center gap-2">
            <Truck size={18} className="text-amber-600" />
            <div>
              <h3 className="text-[15px] font-bold text-slate-900">
                Receive {transfer.challan_no}
              </h3>
              <p className="text-[11px] text-slate-500 mt-0.5">
                from <span className="font-semibold">{transfer.from_clinic_name}</span>
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="w-7 h-7 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded-md flex items-center justify-center"
            data-testid="transfer-receive-close"
            aria-label="Close"
          >
            <X size={16} />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-auto p-4 space-y-4">
          {/* Items being received */}
          <div className="bg-slate-50 border border-slate-200 rounded-lg p-3">
            <div className="text-[10px] font-bold uppercase tracking-wider text-slate-600 mb-2">
              Items in this delivery ({transfer.lines?.length || 0})
            </div>
            <ul className="space-y-1">
              {transfer.lines?.map((ln) => (
                <li key={ln.serial_id} className="flex items-center justify-between text-[12px]">
                  <div>
                    <span className="font-semibold text-slate-800">{ln.product_label}</span>
                    <span className="ml-2 text-[10px] text-slate-500 font-mono">S/N {ln.serial_no}</span>
                  </div>
                  <span className="text-[10px] text-slate-400">qty {ln.qty}</span>
                </li>
              ))}
            </ul>
            {transfer.courier_name && (
              <div className="mt-2 pt-2 border-t border-slate-200 text-[10px] text-slate-500">
                Courier: <span className="font-semibold">{transfer.courier_name}</span>
                {transfer.tracking_no && <span className="ml-1 font-mono">· {transfer.tracking_no}</span>}
              </div>
            )}
          </div>

          {/* Receiver name + role */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-[10px] font-bold uppercase tracking-wider text-slate-600 mb-1 block">
                Received by *
              </label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Full name as per ID"
                autoFocus
                data-testid="transfer-receive-name"
                className="w-full px-2 py-1.5 text-xs border border-slate-300 rounded focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-200"
              />
            </div>
            <div>
              <label className="text-[10px] font-bold uppercase tracking-wider text-slate-600 mb-1 block">
                Role *
              </label>
              <select
                value={role}
                onChange={(e) => setRole(e.target.value)}
                data-testid="transfer-receive-role"
                className="w-full px-2 py-1.5 text-xs border border-slate-300 rounded focus:outline-none focus:border-indigo-500 bg-white"
              >
                {RECEIVER_ROLES.map((r) => (
                  <option key={r.value} value={r.value}>{r.label}</option>
                ))}
              </select>
            </div>
          </div>

          {/* Signature pad */}
          <div>
            <label className="text-[10px] font-bold uppercase tracking-wider text-slate-600 mb-1.5 block">
              Sign to confirm receipt *
            </label>
            <SignaturePad ref={sigRef} width={580} height={150} testid="transfer-receive-sig" />
          </div>

          {/* Optional short-shipment notes */}
          <div>
            <label className="text-[10px] font-bold uppercase tracking-wider text-slate-600 mb-1 block">
              Anything missing or damaged? (optional)
            </label>
            <textarea
              value={shortShipNote}
              onChange={(e) => setShortShipNote(e.target.value)}
              rows={2}
              placeholder="e.g. Box A intact; Box B receiver tip cracked; 1 of 2 domes missing"
              data-testid="transfer-receive-shortship"
              className="w-full px-2 py-1.5 text-xs border border-slate-300 rounded focus:outline-none focus:border-indigo-500 resize-none"
            />
          </div>

          {err && (
            <div className="flex items-start gap-2 bg-rose-50 border border-rose-200 text-rose-700 text-[12px] px-3 py-2 rounded" data-testid="transfer-receive-err">
              <AlertCircle size={13} className="flex-shrink-0 mt-0.5" />
              <div>{err}</div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-4 py-2.5 border-t border-slate-200 flex items-center justify-between bg-slate-50">
          <div className="text-[10px] text-slate-500">
            On confirm: serials move to your clinic's inventory + an audit row is recorded.
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="px-3 py-1.5 text-[11px] font-semibold text-slate-600 hover:bg-slate-200 rounded"
              data-testid="transfer-receive-cancel"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={submit}
              disabled={busy}
              data-testid="transfer-receive-submit"
              className="inline-flex items-center gap-1.5 px-4 py-1.5 text-[11px] font-bold uppercase tracking-wider text-white bg-emerald-600 hover:bg-emerald-700 rounded disabled:bg-slate-300 disabled:cursor-not-allowed"
            >
              <CheckCircle2 size={13} />
              {busy ? 'Confirming…' : 'Confirm receipt'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
