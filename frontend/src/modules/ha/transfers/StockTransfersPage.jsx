import React, { useEffect, useState, useCallback } from 'react';
import axios from 'axios';
import { Truck, Plus, ArrowDownLeft, ArrowUpRight, AlertCircle, Check, Ear } from 'lucide-react';
import CreateTransferModal from './CreateTransferModal';
import ReceiveTransferModal from './ReceiveTransferModal';
import ChallanPrintModal from './ChallanPrintModal';
import { CustomHAOrderModal } from '../CustomHAOrdersPage';
import { useAuth } from '../../../AuthContext';

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;

const STATUS_STYLE = {
  draft:      { bg: 'bg-slate-100',    fg: 'text-slate-700',    label: 'DRAFT'      },
  dispatched: { bg: 'bg-amber-100',    fg: 'text-amber-800',    label: 'IN TRANSIT' },
  received:   { bg: 'bg-emerald-100',  fg: 'text-emerald-800',  label: 'RECEIVED'   },
  cancelled:  { bg: 'bg-rose-100',     fg: 'text-rose-700',     label: 'CANCELLED'  },
};

const TABS = [
  { key: 'outgoing', label: 'Outgoing',  Icon: ArrowUpRight,   testid: 'transfers-tab-outgoing' },
  { key: 'incoming', label: 'Incoming',  Icon: ArrowDownLeft,  testid: 'transfers-tab-incoming' },
  { key: 'all',      label: 'All',       Icon: Truck,          testid: 'transfers-tab-all' },
];

const fmtDate = (iso) => {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
  } catch { return iso; }
};
const fmtDateTime = (iso) => {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false });
  } catch { return iso; }
};

export default function StockTransfersPage() {
  const { clinic } = useAuth();
  const [tab, setTab] = useState('outgoing');
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [receiving, setReceiving] = useState(null);   // transfer doc when modal open
  const [printing, setPrinting] = useState(null);     // transfer doc when challan modal open
  const [customHAOpen, setCustomHAOpen] = useState(false);
  const [busyId, setBusyId] = useState(null);
  const [err, setErr] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setErr('');
    try {
      const r = await axios.get(`${API}/stock-transfers`, { params: { direction: tab } });
      setRows(r.data || []);
    } catch (e) {
      setErr(e?.response?.data?.detail || 'Failed to load');
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [tab]);

  useEffect(() => { load(); }, [load]);

  const dispatch = async (id) => {
    setBusyId(id); setErr('');
    try {
      await axios.post(`${API}/stock-transfers/${id}/dispatch`, {});
      await load();
    } catch (e) {
      setErr(e?.response?.data?.detail || 'Dispatch failed');
    } finally { setBusyId(null); }
  };

  const cancel = async (id) => {
    const reason = window.prompt('Reason for cancellation?');
    if (!reason) return;
    setBusyId(id); setErr('');
    try {
      await axios.post(`${API}/stock-transfers/${id}/cancel`, { reason });
      await load();
    } catch (e) {
      setErr(e?.response?.data?.detail || 'Cancel failed');
    } finally { setBusyId(null); }
  };

  return (
    <div className="p-5" data-testid="ha-transfers-page">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div>
          <div className="flex items-center gap-2">
            <Truck size={20} className="text-indigo-600" />
            <h1 className="text-lg font-bold text-slate-800">Inter-clinic Transfers</h1>
          </div>
          <p className="text-[12px] text-slate-500 mt-0.5">
            Move serialised hearing aids between clinics with a signed delivery challan.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setCustomHAOpen(true)}
            data-testid="transfers-request-custom-ha-btn"
            className="inline-flex items-center gap-1.5 bg-white border border-indigo-300 hover:bg-indigo-50 text-indigo-700 text-[12px] font-bold uppercase tracking-wide px-3 py-2 rounded-lg shadow-sm transition-colors"
          >
            <Ear size={13} />
            Request Custom HA
          </button>
          <button
            type="button"
            onClick={() => setCreating(true)}
            data-testid="transfers-new-btn"
            className="inline-flex items-center gap-1.5 bg-indigo-600 hover:bg-indigo-700 text-white text-[12px] font-bold uppercase tracking-wide px-4 py-2 rounded-lg shadow-sm shadow-indigo-500/30 transition-colors"
          >
            <Plus size={14} strokeWidth={2.5} />
            New Transfer
          </button>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex items-center gap-1 mb-4 border-b border-slate-200">
        {TABS.map(({ key, label, Icon, testid }) => (
          <button
            key={key}
            type="button"
            onClick={() => setTab(key)}
            data-testid={testid}
            className={`flex items-center gap-1.5 px-4 py-2 text-[12px] font-semibold uppercase tracking-wide border-b-2 transition-colors -mb-[2px] ${
              tab === key
                ? 'border-indigo-600 text-indigo-700'
                : 'border-transparent text-slate-500 hover:text-slate-800'
            }`}
          >
            <Icon size={13} />
            {label}
          </button>
        ))}
      </div>

      {/* Errors */}
      {err && (
        <div className="mb-3 flex items-start gap-2 bg-rose-50 border border-rose-200 text-rose-700 text-[12px] px-3 py-2 rounded" data-testid="transfers-error">
          <AlertCircle size={14} className="flex-shrink-0 mt-0.5" />
          <div>{err}</div>
        </div>
      )}

      {/* List */}
      {loading ? (
        <div className="text-slate-400 text-sm py-8 text-center">Loading…</div>
      ) : rows.length === 0 ? (
        <EmptyState tab={tab} onNew={() => setCreating(true)} />
      ) : (
        <div className="space-y-2">
          {rows.map((t) => (
            <TransferRow
              key={t.transfer_id}
              t={t}
              currentClinicId={clinic?.clinic_id}
              busy={busyId === t.transfer_id}
              onDispatch={() => dispatch(t.transfer_id)}
              onCancel={() => cancel(t.transfer_id)}
              onReceive={() => setReceiving(t)}
              onPrint={() => setPrinting(t)}
            />
          ))}
        </div>
      )}

      {creating && (
        <CreateTransferModal
          onClose={() => setCreating(false)}
          onCreated={() => { setCreating(false); load(); }}
        />
      )}
      {customHAOpen && (
        <CustomHAOrderModal
          defaultTarget="branch"
          onClose={() => setCustomHAOpen(false)}
          onSaved={() => setCustomHAOpen(false)}
        />
      )}
      {receiving && (
        <ReceiveTransferModal
          transfer={receiving}
          onClose={() => setReceiving(null)}
          onReceived={() => { setReceiving(null); load(); }}
        />
      )}
      {printing && (
        <ChallanPrintModal
          transfer={printing}
          onClose={() => setPrinting(null)}
        />
      )}
    </div>
  );
}

// =============================================================================
// TransferRow — single line item with status chip + line preview + actions
// =============================================================================
const TransferRow = ({ t, busy, currentClinicId, onDispatch, onCancel, onReceive, onPrint }) => {
  const sty = STATUS_STYLE[t.status] || STATUS_STYLE.draft;
  const lineCount = (t.lines?.length || 0) + (t.accessory_lines?.length || 0);
  const isIncoming = t.to_clinic_id === currentClinicId;
  const canReceive = t.status === 'dispatched' && isIncoming;
  const hasChallan = !!t.challan_no && t.status !== 'cancelled';
  return (
    <div
      className="bg-white border border-slate-200 rounded-lg p-3 hover:shadow-sm transition-shadow"
      data-testid={`transfer-row-${t.transfer_id}`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className={`text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded ${sty.bg} ${sty.fg}`} data-testid={`transfer-status-${t.transfer_id}`}>
              {sty.label}
            </span>
            <span className="text-[12px] font-bold text-slate-800">{t.challan_no || '(no challan yet)'}</span>
            <span className="text-[10px] text-slate-400 uppercase tracking-wider font-semibold">
              {t.purpose}
            </span>
          </div>
          <div className="mt-1.5 flex items-center gap-2 text-[12px] text-slate-700">
            <span className="font-semibold truncate">{t.from_clinic_name}</span>
            <span className="text-slate-300">→</span>
            <span className="font-semibold truncate">{t.to_clinic_name}</span>
          </div>
          <div className="mt-1 text-[11px] text-slate-500">
            <span className="font-semibold">{lineCount}</span> item{lineCount === 1 ? '' : 's'}
            {t.lines?.[0] && (
              <span className="ml-1 text-slate-400">
                · {t.lines[0].product_label} (S/N {t.lines[0].serial_no})
                {t.lines.length > 1 && ` +${t.lines.length - 1} more`}
              </span>
            )}
          </div>
          {/* Timeline */}
          <div className="mt-2 flex items-center gap-3 text-[10px] text-slate-400">
            <span>Created {fmtDate(t.created_at)}</span>
            {t.dispatched_at && (
              <span>· Dispatched {fmtDateTime(t.dispatched_at)} by {t.dispatched_by_name}</span>
            )}
            {t.received_at && (
              <span className="text-emerald-700 font-semibold">
                · ✓ Received {fmtDateTime(t.received_at)} by {t.received_by_name} ({t.received_by_role?.replace('_', ' ')})
              </span>
            )}
            {t.cancelled_at && (
              <span className="text-rose-700">· Cancelled: {t.cancelled_reason}</span>
            )}
          </div>
        </div>

        {/* Actions */}
        <div className="flex flex-col items-end gap-1 flex-shrink-0">
          {t.status === 'draft' && (
            <>
              <button
                type="button"
                onClick={onDispatch}
                disabled={busy}
                data-testid={`transfer-dispatch-${t.transfer_id}`}
                className="text-[11px] font-bold uppercase tracking-wide bg-amber-500 hover:bg-amber-600 disabled:bg-slate-300 text-white px-3 py-1 rounded transition-colors"
              >
                {busy ? 'Working…' : 'Dispatch'}
              </button>
              <button
                type="button"
                onClick={onCancel}
                disabled={busy}
                className="text-[10px] text-slate-500 hover:text-rose-700 hover:underline"
              >
                Cancel
              </button>
            </>
          )}
          {t.status === 'dispatched' && (
            <>
              {canReceive ? (
                <button
                  type="button"
                  onClick={onReceive}
                  disabled={busy}
                  data-testid={`transfer-receive-${t.transfer_id}`}
                  className="text-[11px] font-bold uppercase tracking-wide bg-emerald-600 hover:bg-emerald-700 disabled:bg-slate-300 text-white px-3 py-1 rounded transition-colors"
                >
                  Accept &amp; Sign
                </button>
              ) : (
                <span className="text-[10px] text-amber-700 font-semibold flex items-center gap-1">
                  <Truck size={11} /> awaiting receipt
                </span>
              )}
              <button
                type="button"
                onClick={onCancel}
                disabled={busy}
                className="text-[10px] text-slate-500 hover:text-rose-700 hover:underline"
              >
                Cancel
              </button>
            </>
          )}
          {t.status === 'received' && (
            <span className="text-[10px] text-emerald-700 font-semibold flex items-center gap-1">
              <Check size={11} strokeWidth={3} /> closed
            </span>
          )}
          {hasChallan && (
            <button
              type="button"
              onClick={onPrint}
              data-testid={`transfer-print-${t.transfer_id}`}
              className="text-[10px] font-bold uppercase tracking-wider text-indigo-600 hover:text-indigo-800 hover:underline"
            >
              Print Challan
            </button>
          )}
          {t.courier_name && (
            <span className="text-[9px] text-slate-400 font-mono">
              {t.courier_name} {t.tracking_no && `· ${t.tracking_no}`}
            </span>
          )}
        </div>
      </div>
    </div>
  );
};

// =============================================================================
// EmptyState
// =============================================================================
const EmptyState = ({ tab, onNew }) => (
  <div className="text-center py-12 border-2 border-dashed border-slate-200 rounded-lg bg-slate-50" data-testid="transfers-empty">
    <Truck size={32} className="mx-auto text-slate-300 mb-2" />
    <div className="text-sm font-semibold text-slate-700">
      No {tab === 'all' ? '' : tab} transfers yet
    </div>
    <div className="text-[12px] text-slate-500 mt-1 mb-4">
      {tab === 'incoming'
        ? 'Transfers from other clinics will appear here when dispatched.'
        : 'Move serialised stock between your clinics with a signed delivery challan.'}
    </div>
    {tab !== 'incoming' && (
      <button
        type="button"
        onClick={onNew}
        className="inline-flex items-center gap-1.5 bg-indigo-600 hover:bg-indigo-700 text-white text-[12px] font-bold uppercase px-4 py-2 rounded transition-colors"
      >
        <Plus size={14} /> Create Transfer
      </button>
    )}
  </div>
);
