/**
 * StockRequestsPage — the "Branch asks Head for stock" queue.
 *
 * Roles:
 *   - **Branch users**: see their own requests + "Raise a request" button.
 *   - **Head owner**: sees all requests across every branch in the group,
 *     with Fulfil / Decline / Mark Awaiting PO actions.
 *
 * Fulfil auto-creates a `stock_transfers` draft doc from the chosen
 * source clinic to the requester — head then finishes it (picks serials,
 * courier) on the Transfers page.
 */
import React, { useEffect, useState, useCallback } from 'react';
import axios from 'axios';
import { Link } from 'react-router-dom';
import { Package, Plus, X, Loader2, Send, Ban, AlertTriangle, ArrowRight, Crown } from 'lucide-react';
import { useAuth } from '../../AuthContext';

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;

const STATUS_TONES = {
  pending:       'bg-amber-100 text-amber-800 border-amber-200',
  awaiting_po:   'bg-orange-100 text-orange-800 border-orange-200',
  fulfilled:     'bg-emerald-100 text-emerald-800 border-emerald-200',
  declined:      'bg-slate-200 text-slate-600 border-slate-300',
  cancelled:     'bg-slate-100 text-slate-500 border-slate-200',
};
const URGENCY_TONES = {
  urgent: 'bg-rose-100 text-rose-800 border-rose-200',
  normal: 'bg-slate-100 text-slate-600 border-slate-200',
};

export default function StockRequestsPage() {
  const { user } = useAuth();
  const [group, setGroup] = useState(null);
  const [rows, setRows] = useState([]);
  const [tab, setTab] = useState('pending');
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [g, r] = await Promise.all([
        axios.get(`${API}/clinic-groups/mine`).catch(() => ({ data: { group: null } })),
        axios.get(`${API}/stock-requests`, { params: tab === 'all' ? {} : { status: tab } }),
      ]);
      setGroup(g.data);
      setRows(Array.isArray(r.data) ? r.data : []);
    } finally {
      setLoading(false);
    }
  }, [tab]);

  useEffect(() => { load(); }, [load]);

  const viewerIsHead = !!group?.viewer_is_head;
  const noGroup = !group?.group;

  if (noGroup) {
    return (
      <div className="p-6 max-w-3xl">
        <div className="border-2 border-dashed border-slate-200 rounded-lg p-6 text-center">
          <Package size={22} className="mx-auto text-slate-400 mb-2" />
          <h2 className="text-sm font-bold text-slate-900">Stock Requests are for multi-clinic groups</h2>
          <p className="text-[12.5px] text-slate-500 mt-1">
            Create a Clinic Group first, then branches can request stock from the head.
          </p>
          <Link
            to="/settings/clinic-group"
            className="inline-flex items-center gap-1.5 mt-3 px-3 py-1.5 text-xs font-semibold text-white bg-indigo-600 hover:bg-indigo-700 rounded"
            data-testid="stock-requests-goto-group"
          >
            <Crown size={12} /> Set up Clinic Group
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="p-4 sm:p-6 space-y-4" data-testid="stock-requests-page">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Stock Requests</div>
          <h2 className="text-lg font-bold text-slate-900">
            {viewerIsHead ? 'Requests from your branches' : 'Your stock requests'}
          </h2>
          <p className="text-[11.5px] text-slate-500 mt-0.5">
            {viewerIsHead
              ? 'Fulfil from head stock, route from another branch, or mark for PO.'
              : 'Ask the head clinic for items your branch is running out of.'}
          </p>
        </div>
        <button
          type="button"
          onClick={() => setShowCreate(true)}
          data-testid="stock-request-new-btn"
          className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-semibold text-white bg-indigo-600 hover:bg-indigo-700 rounded shadow-sm shadow-indigo-600/20"
        >
          <Plus size={13} /> New request
        </button>
      </div>

      {/* Tab bar */}
      <div className="flex flex-wrap items-center gap-1 border-b border-slate-200">
        {['pending', 'awaiting_po', 'fulfilled', 'declined', 'all'].map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setTab(t)}
            data-testid={`stock-request-tab-${t}`}
            className={`px-3 py-1.5 text-[11.5px] font-semibold border-b-2 -mb-px capitalize transition ${
              tab === t
                ? 'border-indigo-600 text-indigo-700'
                : 'border-transparent text-slate-500 hover:text-slate-800'
            }`}
          >
            {t.replace('_', ' ')}
          </button>
        ))}
      </div>

      {showCreate && (
        <CreateRequestModal
          onClose={() => setShowCreate(false)}
          onCreated={async () => { setShowCreate(false); await load(); }}
        />
      )}

      {loading ? (
        <div className="text-slate-400 italic text-[13px] py-6">Loading requests…</div>
      ) : rows.length === 0 ? (
        <div className="border-2 border-dashed border-slate-200 rounded-lg py-8 text-center text-slate-500 text-[13px]" data-testid="stock-requests-empty">
          No {tab === 'all' ? '' : tab.replace('_', ' ') + ' '}requests.
        </div>
      ) : (
        <div className="space-y-2">
          {rows.map((r) => (
            <RequestCard
              key={r.request_id}
              request={r}
              viewerIsHead={viewerIsHead}
              headClinicId={group?.head?.clinic_id}
              branches={group?.branches || []}
              onChanged={load}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Request card ────────────────────────────────────────────────
function RequestCard({ request, viewerIsHead, headClinicId, branches, onChanged }) {
  const [showFulfil, setShowFulfil] = useState(false);
  const [showPo, setShowPo] = useState(false);
  const canAct = viewerIsHead && (request.status === 'pending' || request.status === 'awaiting_po');

  const decline = async () => {
    const reason = window.prompt('Reason for declining?');
    if (!reason) return;
    try {
      await axios.post(`${API}/stock-requests/${request.request_id}/decline`, { reason });
      await onChanged?.();
    } catch (e) { alert(e?.response?.data?.detail || 'Decline failed'); }
  };

  const cancel = async () => {
    if (!window.confirm('Cancel this request?')) return;
    try {
      await axios.post(`${API}/stock-requests/${request.request_id}/cancel`);
      await onChanged?.();
    } catch (e) { alert(e?.response?.data?.detail || 'Cancel failed'); }
  };

  return (
    <div className="border border-slate-200 rounded-lg bg-white p-3 space-y-2" data-testid={`stock-request-${request.request_id}`}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="font-mono text-[11px] text-slate-400">{request.request_id}</span>
            <span className={`text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded border ${STATUS_TONES[request.status] || STATUS_TONES.pending}`}>
              {(request.status || 'pending').replace('_', ' ')}
            </span>
            {request.urgency === 'urgent' && (
              <span className={`text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded border ${URGENCY_TONES.urgent} inline-flex items-center gap-1`}>
                <AlertTriangle size={9} /> Urgent
              </span>
            )}
          </div>
          <div className="text-[13px] font-semibold text-slate-900 mt-0.5">
            {request.clinic_name}
            {request.needed_by && <span className="text-slate-500 font-normal ml-2">needed by {new Date(request.needed_by).toLocaleDateString()}</span>}
          </div>
          {request.reason && <p className="text-[11.5px] text-slate-500 italic">&ldquo;{request.reason}&rdquo;</p>}
        </div>
      </div>

      <ul className="space-y-0.5">
        {(request.lines || []).map((ln, i) => (
          <li key={i} className="text-[12px] text-slate-700 flex items-center gap-2" data-testid={`stock-request-line-${i}`}>
            <span className="text-slate-400 font-mono w-4 text-right">{ln.qty}×</span>
            <span className="font-semibold">{ln.product_label}</span>
            {ln.variant && <span className="text-slate-500 text-[11px]">· {ln.variant}</span>}
            <span className="text-[9.5px] uppercase tracking-wider text-slate-400 border border-slate-200 rounded px-1 py-0.5">{ln.kind || 'other'}</span>
          </li>
        ))}
      </ul>

      {request.status === 'fulfilled' && request.linked_transfer_id && (
        <Link
          to={`/inventory/transfers`}
          className="inline-flex items-center gap-1 text-[11px] font-semibold text-indigo-700 hover:text-indigo-900"
        >
          <ArrowRight size={11} /> Linked transfer {request.linked_transfer_id}
        </Link>
      )}
      {request.status === 'declined' && request.decline_reason && (
        <p className="text-[11px] text-slate-600 border border-slate-200 rounded bg-slate-50 px-2 py-1">
          <b>Declined:</b> {request.decline_reason}
        </p>
      )}
      {request.status === 'awaiting_po' && request.po_details && (
        <div className="text-[11px] text-orange-800 border border-orange-200 bg-orange-50 rounded px-2 py-1">
          <b>Awaiting PO</b> — {request.po_details.vendor_name || 'vendor pending'}
          {request.po_details.po_no && <> · PO {request.po_details.po_no}</>}
          {request.po_details.expected_at && <> · expected {request.po_details.expected_at}</>}
        </div>
      )}

      {/* Actions */}
      {canAct && (
        <div className="flex flex-wrap items-center gap-2 pt-1">
          <button
            type="button"
            onClick={() => setShowFulfil(true)}
            data-testid={`stock-request-fulfill-${request.request_id}`}
            className="inline-flex items-center gap-1 px-2.5 py-1 text-[11px] font-bold text-white bg-emerald-600 hover:bg-emerald-700 rounded"
          >
            <Send size={11} /> Fulfil
          </button>
          <button
            type="button"
            onClick={() => setShowPo(true)}
            data-testid={`stock-request-po-${request.request_id}`}
            className="inline-flex items-center gap-1 px-2.5 py-1 text-[11px] font-bold text-orange-800 bg-orange-100 hover:bg-orange-200 rounded"
          >
            Mark for PO
          </button>
          <button
            type="button"
            onClick={decline}
            data-testid={`stock-request-decline-${request.request_id}`}
            className="inline-flex items-center gap-1 px-2.5 py-1 text-[11px] font-bold text-rose-700 bg-rose-50 hover:bg-rose-100 rounded"
          >
            <Ban size={11} /> Decline
          </button>
        </div>
      )}
      {!viewerIsHead && (request.status === 'pending' || request.status === 'awaiting_po') && (
        <button
          type="button"
          onClick={cancel}
          data-testid={`stock-request-cancel-${request.request_id}`}
          className="text-[11px] text-slate-500 hover:text-rose-700 underline underline-offset-2"
        >Cancel this request</button>
      )}

      {showFulfil && (
        <FulfilModal
          request={request}
          headClinicId={headClinicId}
          branches={branches}
          onClose={() => setShowFulfil(false)}
          onDone={async () => { setShowFulfil(false); await onChanged?.(); }}
        />
      )}
      {showPo && (
        <MarkPoModal
          request={request}
          onClose={() => setShowPo(false)}
          onDone={async () => { setShowPo(false); await onChanged?.(); }}
        />
      )}
    </div>
  );
}

// ─── Modals ──────────────────────────────────────────────────────
function CreateRequestModal({ onClose, onCreated }) {
  const [lines, setLines] = useState([{ product_label: '', kind: 'accessory', qty: 1 }]);
  const [urgency, setUrgency] = useState('normal');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  const updateLine = (i, patch) => setLines(lines.map((l, idx) => (idx === i ? { ...l, ...patch } : l)));
  const removeLine = (i) => setLines(lines.filter((_, idx) => idx !== i));
  const addLine = () => setLines([...lines, { product_label: '', kind: 'accessory', qty: 1 }]);

  const submit = async () => {
    const filtered = lines.filter((l) => l.product_label.trim() && l.qty > 0);
    if (!filtered.length) { setErr('Add at least one item'); return; }
    setBusy(true); setErr('');
    try {
      await axios.post(`${API}/stock-requests`, { lines: filtered, urgency, reason: reason || null });
      onCreated?.();
    } catch (e) {
      const d = e?.response?.data?.detail;
      setErr(typeof d === 'string' ? d : (d?.message || 'Failed'));
    } finally { setBusy(false); }
  };

  return (
    <div
      className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4 pb-24 md:pb-4"
      onClick={(e) => { if (e.target === e.currentTarget) onClose?.(); }}
      data-testid="stock-request-create-modal"
    >
      <div className="bg-white rounded-xl shadow-2xl w-[640px] max-w-full max-h-[calc(100dvh-96px)] sm:max-h-[85vh] flex flex-col">
        <header className="px-4 py-3 border-b border-slate-200 flex items-center justify-between flex-shrink-0">
          <h3 className="text-sm font-bold text-slate-900 flex items-center gap-2">
            <Package size={16} className="text-indigo-600" /> Request stock
          </h3>
          <button onClick={onClose} className="p-1 hover:bg-slate-100 rounded text-slate-500" data-testid="stock-request-create-close"><X size={16} /></button>
        </header>
        <div className="flex-1 overflow-y-auto p-4 space-y-3">
          <div>
            <div className="text-[10.5px] font-semibold text-slate-700 uppercase tracking-wider mb-1.5">Items</div>
            {lines.map((ln, i) => (
              <div key={i} className="grid grid-cols-12 gap-2 mb-1.5" data-testid={`stock-request-create-line-${i}`}>
                <input
                  type="text"
                  value={ln.product_label}
                  onChange={(e) => updateLine(i, { product_label: e.target.value })}
                  placeholder="e.g. Phonak Audeo P90 RIC"
                  data-testid={`stock-request-create-label-${i}`}
                  className="col-span-6 px-2 py-1 text-[12.5px] border border-slate-300 rounded"
                />
                <select
                  value={ln.kind}
                  onChange={(e) => updateLine(i, { kind: e.target.value })}
                  data-testid={`stock-request-create-kind-${i}`}
                  className="col-span-3 px-2 py-1 text-[12.5px] border border-slate-300 rounded"
                >
                  <option value="accessory">Accessory</option>
                  <option value="ha">Hearing aid</option>
                  <option value="tool">Tool</option>
                  <option value="other">Other</option>
                </select>
                <input
                  type="number"
                  min="1"
                  value={ln.qty}
                  onChange={(e) => updateLine(i, { qty: Number(e.target.value) || 1 })}
                  data-testid={`stock-request-create-qty-${i}`}
                  className="col-span-2 px-2 py-1 text-[12.5px] border border-slate-300 rounded text-right"
                />
                {lines.length > 1 && (
                  <button type="button" onClick={() => removeLine(i)} className="col-span-1 text-slate-400 hover:text-rose-600" data-testid={`stock-request-create-remove-${i}`}>
                    <X size={14} />
                  </button>
                )}
              </div>
            ))}
            <button type="button" onClick={addLine} data-testid="stock-request-create-add-line" className="text-[11.5px] font-semibold text-indigo-600 hover:text-indigo-800 mt-1">
              + Add another item
            </button>
          </div>

          <div>
            <div className="text-[10.5px] font-semibold text-slate-700 uppercase tracking-wider mb-1">Urgency</div>
            <div className="flex gap-2">
              {['normal', 'urgent'].map((u) => (
                <button
                  key={u}
                  type="button"
                  onClick={() => setUrgency(u)}
                  data-testid={`stock-request-create-urgency-${u}`}
                  className={`px-3 py-1 rounded-full border text-[11.5px] font-semibold capitalize ${
                    urgency === u ? (u === 'urgent' ? 'bg-rose-600 text-white border-rose-600' : 'bg-indigo-600 text-white border-indigo-600') : 'bg-white text-slate-700 border-slate-300'
                  }`}
                >{u}</button>
              ))}
            </div>
          </div>
          <div>
            <label className="block text-[10.5px] font-semibold text-slate-700 uppercase tracking-wider mb-1">Reason (optional)</label>
            <input type="text" value={reason} onChange={(e) => setReason(e.target.value)}
              data-testid="stock-request-create-reason"
              placeholder="Weekend camp inventory, low stock, patient fitting…"
              className="w-full px-3 py-1.5 text-[13px] border border-slate-300 rounded" />
          </div>
          {err && <div className="text-[12px] text-rose-700 bg-rose-50 border border-rose-200 rounded px-3 py-2">{err}</div>}
        </div>
        <footer className="px-4 py-2.5 border-t border-slate-200 bg-slate-50 flex items-center justify-end gap-2 flex-shrink-0">
          <button onClick={onClose} className="px-3 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-200 rounded" data-testid="stock-request-create-cancel">Cancel</button>
          <button onClick={submit} disabled={busy} data-testid="stock-request-create-submit" className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-white bg-indigo-600 hover:bg-indigo-700 rounded disabled:opacity-40">
            {busy ? <Loader2 size={12} className="animate-spin" /> : <Send size={12} />}
            {busy ? 'Sending…' : 'Send request'}
          </button>
        </footer>
      </div>
    </div>
  );
}

function FulfilModal({ request, headClinicId, branches, onClose, onDone }) {
  const [source, setSource] = useState(headClinicId || '');
  const [courier, setCourier] = useState('');
  const [tracking, setTracking] = useState('');
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  const sources = [
    ...(headClinicId ? [{ clinic_id: headClinicId, name: 'Head clinic', is_head: true }] : []),
    ...branches.filter((b) => b.clinic_id !== request.clinic_id),
  ];

  const submit = async () => {
    if (!source) { setErr('Pick a source clinic'); return; }
    setBusy(true); setErr('');
    try {
      await axios.post(`${API}/stock-requests/${request.request_id}/fulfill`, {
        source_clinic_id: source,
        create_transfer: true,
        courier_name: courier || null,
        tracking_no: tracking || null,
        notes: notes || null,
      });
      onDone?.();
    } catch (e) {
      const d = e?.response?.data?.detail;
      setErr(typeof d === 'string' ? d : (d?.message || 'Fulfil failed'));
    } finally { setBusy(false); }
  };

  return (
    <div
      className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4 pb-24 md:pb-4"
      onClick={(e) => { if (e.target === e.currentTarget) onClose?.(); }}
      data-testid="stock-request-fulfil-modal"
    >
      <div className="bg-white rounded-xl shadow-2xl w-[560px] max-w-full max-h-[calc(100dvh-96px)] sm:max-h-[85vh] flex flex-col">
        <header className="px-4 py-3 border-b border-slate-200 flex items-center justify-between flex-shrink-0">
          <h3 className="text-sm font-bold text-slate-900 flex items-center gap-2">
            <Send size={16} className="text-emerald-600" /> Fulfil request
          </h3>
          <button onClick={onClose} className="p-1 hover:bg-slate-100 rounded" data-testid="fulfil-close"><X size={16} /></button>
        </header>
        <div className="flex-1 overflow-y-auto p-4 space-y-3">
          <div className="text-[11.5px] text-slate-600">
            Sending <b>{request.lines?.length || 0}</b> line item{(request.lines?.length || 0) === 1 ? '' : 's'} to <b>{request.clinic_name}</b>.
          </div>

          <div>
            <div className="text-[10.5px] font-semibold text-slate-700 uppercase tracking-wider mb-1.5">Source clinic</div>
            <div className="space-y-1.5">
              {sources.map((s) => (
                <button
                  key={s.clinic_id}
                  type="button"
                  onClick={() => setSource(s.clinic_id)}
                  data-testid={`fulfil-source-${s.clinic_id}`}
                  className={`w-full text-left border rounded-md p-2.5 transition ${
                    source === s.clinic_id
                      ? 'border-emerald-500 bg-emerald-50/50'
                      : 'border-slate-200 hover:border-emerald-400'
                  }`}
                >
                  <div className="text-[13px] font-semibold text-slate-900 flex items-center gap-1.5">
                    {s.is_head && <Crown size={11} className="text-amber-500" />}
                    {s.name}
                  </div>
                  {s.stock && (
                    <div className="text-[10.5px] text-slate-500 mt-0.5">
                      {s.stock.ha_units || 0} HAs · {s.stock.low_stock_skus || 0} low SKUs
                    </div>
                  )}
                </button>
              ))}
              {sources.length === 0 && (
                <div className="text-[11.5px] text-slate-500 italic">No other clinic in your group. Add a branch first.</div>
              )}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="block text-[10.5px] font-semibold text-slate-700 uppercase tracking-wider mb-1">Courier</label>
              <input type="text" value={courier} onChange={(e) => setCourier(e.target.value)} placeholder="Blue Dart / DTDC / …" data-testid="fulfil-courier" className="w-full px-2.5 py-1.5 text-[13px] border border-slate-300 rounded" />
            </div>
            <div>
              <label className="block text-[10.5px] font-semibold text-slate-700 uppercase tracking-wider mb-1">Tracking #</label>
              <input type="text" value={tracking} onChange={(e) => setTracking(e.target.value)} data-testid="fulfil-tracking" className="w-full px-2.5 py-1.5 text-[13px] border border-slate-300 rounded" />
            </div>
          </div>
          <div>
            <label className="block text-[10.5px] font-semibold text-slate-700 uppercase tracking-wider mb-1">Notes</label>
            <input type="text" value={notes} onChange={(e) => setNotes(e.target.value)} data-testid="fulfil-notes" className="w-full px-2.5 py-1.5 text-[13px] border border-slate-300 rounded" />
          </div>
          <div className="text-[11px] text-emerald-800 bg-emerald-50 border border-emerald-200 rounded px-2.5 py-1.5">
            💡 A <b>Delivery Challan</b> draft will be created automatically. Head over to <b>Inventory → Transfers</b> to pick serials and dispatch.
          </div>
          {err && <div className="text-[12px] text-rose-700 bg-rose-50 border border-rose-200 rounded px-3 py-2">{err}</div>}
        </div>
        <footer className="px-4 py-2.5 border-t border-slate-200 bg-slate-50 flex items-center justify-end gap-2 flex-shrink-0">
          <button onClick={onClose} className="px-3 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-200 rounded" data-testid="fulfil-cancel">Cancel</button>
          <button onClick={submit} disabled={busy || !source} data-testid="fulfil-submit" className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-white bg-emerald-600 hover:bg-emerald-700 rounded disabled:opacity-40">
            {busy ? <Loader2 size={12} className="animate-spin" /> : <Send size={12} />}
            {busy ? 'Fulfilling…' : 'Confirm & create challan'}
          </button>
        </footer>
      </div>
    </div>
  );
}

function MarkPoModal({ request, onClose, onDone }) {
  const [vendor, setVendor] = useState('');
  const [poNo, setPoNo] = useState('');
  const [expected, setExpected] = useState('');
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  const submit = async () => {
    setBusy(true); setErr('');
    try {
      await axios.post(`${API}/stock-requests/${request.request_id}/mark-po`, {
        vendor_name: vendor || null,
        po_no: poNo || null,
        expected_at: expected || null,
        notes: notes || null,
      });
      onDone?.();
    } catch (e) { setErr(e?.response?.data?.detail || 'Failed'); } finally { setBusy(false); }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4 pb-24 md:pb-4" onClick={(e) => { if (e.target === e.currentTarget) onClose?.(); }} data-testid="mark-po-modal">
      <div className="bg-white rounded-xl shadow-2xl w-[480px] max-w-full max-h-[calc(100dvh-96px)] sm:max-h-[85vh] flex flex-col">
        <header className="px-4 py-3 border-b border-slate-200 flex items-center justify-between flex-shrink-0">
          <h3 className="text-sm font-bold text-slate-900">Mark for Purchase Order</h3>
          <button onClick={onClose} className="p-1 hover:bg-slate-100 rounded" data-testid="mark-po-close"><X size={16} /></button>
        </header>
        <div className="flex-1 overflow-y-auto p-4 space-y-3">
          <p className="text-[12px] text-slate-600">
            No clinic in the group has stock — raise a PO with the vendor. This request stays open; fulfil it once the delivery arrives.
          </p>
          <div>
            <label className="block text-[10.5px] font-semibold text-slate-700 uppercase tracking-wider mb-1">Vendor</label>
            <input type="text" value={vendor} onChange={(e) => setVendor(e.target.value)} data-testid="mark-po-vendor" placeholder="Phonak India / GN ReSound…" className="w-full px-2.5 py-1.5 text-[13px] border border-slate-300 rounded" />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="block text-[10.5px] font-semibold text-slate-700 uppercase tracking-wider mb-1">PO #</label>
              <input type="text" value={poNo} onChange={(e) => setPoNo(e.target.value)} data-testid="mark-po-no" className="w-full px-2.5 py-1.5 text-[13px] border border-slate-300 rounded" />
            </div>
            <div>
              <label className="block text-[10.5px] font-semibold text-slate-700 uppercase tracking-wider mb-1">Expected on</label>
              <input type="date" value={expected} onChange={(e) => setExpected(e.target.value)} data-testid="mark-po-expected" className="w-full px-2.5 py-1.5 text-[13px] border border-slate-300 rounded" />
            </div>
          </div>
          <div>
            <label className="block text-[10.5px] font-semibold text-slate-700 uppercase tracking-wider mb-1">Notes</label>
            <input type="text" value={notes} onChange={(e) => setNotes(e.target.value)} data-testid="mark-po-notes" className="w-full px-2.5 py-1.5 text-[13px] border border-slate-300 rounded" />
          </div>
          {err && <div className="text-[12px] text-rose-700 bg-rose-50 border border-rose-200 rounded px-3 py-2">{err}</div>}
        </div>
        <footer className="px-4 py-2.5 border-t border-slate-200 bg-slate-50 flex items-center justify-end gap-2 flex-shrink-0">
          <button onClick={onClose} className="px-3 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-200 rounded" data-testid="mark-po-cancel">Cancel</button>
          <button onClick={submit} disabled={busy} data-testid="mark-po-submit" className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-white bg-orange-600 hover:bg-orange-700 rounded disabled:opacity-40">
            {busy ? 'Saving…' : 'Mark for PO'}
          </button>
        </footer>
      </div>
    </div>
  );
}
