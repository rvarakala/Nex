/**
 * Saleable Stock — the pool of hearing-aid units that CAN be dispensed
 * to a patient. Excludes demo units (kept aside for trials) and
 * lifecycle-terminated states (SOLD / RETURNED / RETIRED).
 *
 * A unit lands here either from a vendor Purchase Order OR by being
 * BORROWED from another clinic when our own stock is short. Borrowed
 * rows show a badge + source note, and can be returned via the row
 * action once we're done with them.
 */
import React, { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import axios from 'axios';
import { Package, ArrowLeftRight, AlertTriangle, Boxes, Truck, X } from 'lucide-react';
import ModalShell from '../../components/ModalShell';
import AddSerialModal from './AddSerialModal';

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;

const STATE_BADGE = {
  IN_STOCK:  'bg-emerald-100 text-emerald-700 border-emerald-200',
  RESERVED:  'bg-indigo-100 text-indigo-700 border-indigo-200',
  TRIAL_OUT: 'bg-amber-100 text-amber-700 border-amber-200',
  ON_LOAN:   'bg-sky-100 text-sky-700 border-sky-200',
  SERVICE_IN:'bg-sky-100 text-sky-700 border-sky-200',
};

const fmtINR = (n) => (n == null ? '—' : `₹${Number(n).toLocaleString('en-IN')}`);

export default function SaleableStockPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [data, setData] = useState({ totals: {}, items: [] });
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');
  // Honour ?source=borrowed from the Dashboard "Return Borrowed" chip so
  // the page auto-lands on the Borrowed filter — the whole point of the
  // widget is one-click drill-down.
  const [source, setSource] = useState(
    ['vendor', 'borrowed'].includes(searchParams.get('source')) ? searchParams.get('source') : 'all',
  );
  const [stateFilter, setStateFilter] = useState('all');
  const [search, setSearch] = useState('');
  const [showAdd, setShowAdd] = useState(false);
  const [returnRow, setReturnRow] = useState(null);
  // Warranty-expiring filter — dashboard "Warranty Expiring" tile
  // deep-links here with ?warranty=expiring&days=30. Cleared via the
  // banner's Clear button.
  const warrantyExpiring = searchParams.get('warranty') === 'expiring';
  const warrantyDays = (() => {
    const raw = Number(searchParams.get('days'));
    return Number.isFinite(raw) && raw > 0 && raw <= 365 ? raw : 30;
  })();

  const load = async () => {
    setLoading(true); setErr('');
    try {
      const r = await axios.get(`${API}/ha/saleable-stock`);
      setData(r.data || { totals: {}, items: [] });
    } catch (e) {
      setErr(e?.response?.data?.detail || 'Unable to load saleable stock');
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => { load(); }, []);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const nowMs = Date.now();
    const cutoffMs = nowMs + warrantyDays * 24 * 3600 * 1000;
    return (data.items || []).filter((r) => {
      const kind = r.source_kind || 'vendor';
      if (source === 'vendor' && kind !== 'vendor') return false;
      if (source === 'borrowed' && kind !== 'borrowed') return false;
      if (stateFilter !== 'all' && r.state !== stateFilter) return false;
      // Warranty-expiring: warranty_end_date is set AND falls between
      // today and the requested horizon (default 30 days). We keep
      // already-expired units in-list too since they need the most
      // urgent nudge for AMC / renewal.
      if (warrantyExpiring) {
        if (!r.warranty_end_date) return false;
        const end = new Date(r.warranty_end_date).getTime();
        if (!Number.isFinite(end) || end > cutoffMs) return false;
      }
      if (!q) return true;
      const p = r.product || {};
      return (
        r.serial_no?.toLowerCase().includes(q)
        || p.brand?.toLowerCase().includes(q)
        || p.model?.toLowerCase().includes(q)
        || (r.borrowed_from || '').toLowerCase().includes(q)
      );
    });
  }, [data, source, stateFilter, search, warrantyExpiring, warrantyDays]);

  const totals = data.totals || {};

  return (
    <div className="p-5" data-testid="ha-saleable-page">
      <div className="flex items-center justify-between mb-4 gap-3">
        <div>
          <h1 className="text-xl font-bold text-slate-800 flex items-center gap-2">
            <Package size={18} className="text-indigo-600" /> Saleable Stock
          </h1>
          <p className="text-[11px] text-slate-500 mt-0.5">
            Every hearing aid that can be sold — from vendor purchases OR borrowed from other clinics. Excludes demo units.
          </p>
        </div>
        <button
          onClick={() => setShowAdd(true)}
          data-testid="ha-saleable-add-btn"
          className="px-3 py-1.5 text-xs font-semibold bg-indigo-600 hover:bg-indigo-700 text-white rounded-md shadow-sm inline-flex items-center gap-1.5"
        ><Truck size={13} /> + Add to Saleable Pool</button>
      </div>

      {/* KPI strip */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-4" data-testid="ha-saleable-stats">
        <Stat label="Total in pool"   value={totals.total ?? 0}              tone="slate" />
        <Stat label="Available"       value={totals.available ?? 0}          tone="emerald" />
        <Stat label="Reserved"        value={totals.reserved ?? 0}           tone="indigo" />
        <Stat label="On trial"        value={totals.on_trial ?? 0}           tone="amber" />
        <Stat label="Borrowed here"   value={totals.borrowed_still_here ?? 0} tone="rose"
              testid="ha-saleable-stat-borrowed" />
      </div>

      {warrantyExpiring && (
        <div
          className="flex items-center gap-2 bg-amber-50 border border-amber-200 text-amber-900 rounded-lg px-3 py-2 mb-3 text-[12px]"
          data-testid="ha-saleable-warranty-banner"
        >
          <AlertTriangle size={14} className="shrink-0" />
          <span className="font-semibold">Warranty-expiring filter active —</span>
          <span className="opacity-90">
            showing units whose warranty ends within {warrantyDays} days (already-expired included).
            Nudge patients for AMC / renewal.
            {' · '}
            {filtered.length} matching {filtered.length === 1 ? 'unit' : 'units'}.
          </span>
          <button
            type="button"
            onClick={() => {
              const next = new URLSearchParams(searchParams);
              next.delete('warranty');
              next.delete('days');
              setSearchParams(next, { replace: true });
            }}
            data-testid="ha-saleable-warranty-clear"
            className="ml-auto inline-flex items-center gap-1 text-[11px] font-bold text-amber-900 hover:text-amber-950 bg-amber-100 hover:bg-amber-200 rounded px-2 py-0.5"
          >
            <X size={11} /> Clear
          </button>
        </div>
      )}

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-2 mb-3">
        <div className="flex items-center gap-1 bg-slate-100 rounded p-0.5">
          {[['all', 'All sources'], ['vendor', 'From vendor'], ['borrowed', 'Borrowed']].map(([k, lab]) => (
            <button
              key={k}
              onClick={() => setSource(k)}
              data-testid={`ha-saleable-source-${k}`}
              className={`px-2.5 py-1 text-[11px] font-semibold rounded ${source === k ? 'bg-white shadow text-slate-900' : 'text-slate-600'}`}
            >{lab}</button>
          ))}
        </div>
        <div className="flex items-center gap-1 bg-slate-100 rounded p-0.5">
          {[['all', 'All states'], ['IN_STOCK', 'Available'], ['RESERVED', 'Reserved'], ['TRIAL_OUT', 'On trial']].map(([k, lab]) => (
            <button
              key={k}
              onClick={() => setStateFilter(k)}
              data-testid={`ha-saleable-state-${k}`}
              className={`px-2.5 py-1 text-[11px] font-semibold rounded ${stateFilter === k ? 'bg-white shadow text-slate-900' : 'text-slate-600'}`}
            >{lab}</button>
          ))}
        </div>
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search serial / brand / model / borrowed-from"
          data-testid="ha-saleable-search"
          className="flex-1 max-w-md border border-slate-300 rounded px-3 py-1.5 text-sm"
        />
      </div>

      {err && (
        <div className="mb-3 flex items-center gap-2 text-xs text-rose-700 bg-rose-50 border border-rose-200 rounded px-3 py-2">
          <AlertTriangle size={13} /> {err}
        </div>
      )}

      {loading ? (
        <div className="text-center py-10 text-slate-400 italic text-sm">Loading…</div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-10 text-slate-400 italic text-sm" data-testid="ha-saleable-empty">
          {(data.items || []).length === 0
            ? 'No saleable units yet. Add a unit from a vendor PO or borrow from another clinic.'
            : 'No units match this filter.'}
        </div>
      ) : (
        <div className="bg-white rounded-md border border-slate-200 overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 border-b border-slate-200 text-[10px] uppercase tracking-wider text-slate-600">
              <tr>
                <th className="px-3 py-2 text-left">Serial</th>
                <th className="px-3 py-2 text-left">Product</th>
                <th className="px-3 py-2 text-center">Sale Unit</th>
                <th className="px-3 py-2 text-left">State</th>
                <th className="px-3 py-2 text-left">Source</th>
                <th className="px-3 py-2 text-right">MRP</th>
                <th className="px-3 py-2 text-left">Warranty</th>
                <th className="px-3 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((r) => {
                const isBorrowed = r.source_kind === 'borrowed';
                const p = r.product || {};
                return (
                  <tr key={r.serial_id} className="border-t border-slate-100" data-testid={`ha-saleable-row-${r.serial_id}`}>
                    <td className="px-3 py-2 font-mono text-xs font-bold">{r.serial_no}</td>
                    <td className="px-3 py-2">
                      {p.brand ? (
                        <div>
                          <div className="font-semibold">{p.brand} {p.model}</div>
                          <div className="text-[10px] text-slate-500">{p.form_factor}</div>
                        </div>
                      ) : <span className="text-slate-400">—</span>}
                    </td>
                    <td className="px-3 py-2 text-center text-[10px]">
                      <span className="bg-indigo-50 text-indigo-700 rounded px-1.5 py-0.5 uppercase tracking-wide">
                        {p.sale_unit === 'kit' ? 'Kit' : (p.sale_unit === 'pair' ? 'Pair' : 'Single')}
                      </span>
                    </td>
                    <td className="px-3 py-2">
                      <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded border ${STATE_BADGE[r.state] || 'bg-slate-100 text-slate-700 border-slate-200'}`}>
                        {r.state}
                      </span>
                    </td>
                    <td className="px-3 py-2">
                      {isBorrowed ? (
                        <div>
                          <span className="inline-flex items-center gap-1 text-[10px] font-bold bg-rose-100 text-rose-700 border border-rose-200 rounded px-1.5 py-0.5">
                            <ArrowLeftRight size={10} /> BORROWED
                          </span>
                          <div className="text-[11px] text-slate-800 mt-0.5 font-medium">
                            from <span className="italic">{r.borrowed_from || 'unknown'}</span>
                          </div>
                          {r.borrow_reason && (
                            <div className="text-[10px] text-slate-500 max-w-[280px] truncate" title={r.borrow_reason}>
                              {r.borrow_reason}
                            </div>
                          )}
                        </div>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-[10px] font-semibold bg-slate-100 text-slate-700 border border-slate-200 rounded px-1.5 py-0.5">
                          <Boxes size={10} /> Vendor
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums text-slate-700">{fmtINR(p.mrp)}</td>
                    <td className="px-3 py-2 text-xs text-slate-600">{r.warranty_end_date || '—'}</td>
                    <td className="px-3 py-2 text-right">
                      {isBorrowed && (
                        <button
                          onClick={() => setReturnRow(r)}
                          data-testid={`ha-saleable-return-${r.serial_id}`}
                          className="inline-flex items-center gap-1 text-[10px] font-semibold text-rose-700 border border-rose-300 rounded px-2 py-0.5 hover:bg-rose-50"
                          title="Return this unit to the source clinic"
                        >Return to Source</button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {showAdd && (
        <AddSerialModal
          pool="saleable"
          onClose={() => setShowAdd(false)}
          onDone={() => { setShowAdd(false); load(); }}
        />
      )}
      {returnRow && (
        <ReturnBorrowModal
          row={returnRow}
          onClose={() => setReturnRow(null)}
          onDone={() => { setReturnRow(null); load(); }}
        />
      )}
    </div>
  );
}

function Stat({ label, value, tone, testid }) {
  const cls = {
    slate:   'bg-slate-50 border-slate-200 text-slate-900',
    emerald: 'bg-emerald-50 border-emerald-200 text-emerald-900',
    amber:   'bg-amber-50 border-amber-200 text-amber-900',
    indigo:  'bg-indigo-50 border-indigo-200 text-indigo-900',
    rose:    'bg-rose-50 border-rose-200 text-rose-900',
  }[tone];
  return (
    <div className={`rounded border ${cls} px-3 py-2`} data-testid={testid || `ha-saleable-stat-${tone}`}>
      <div className="text-[10px] uppercase tracking-wider font-semibold opacity-70">{label}</div>
      <div className="text-xl font-bold tabular-nums">{value}</div>
    </div>
  );
}


/**
 * "Return to Source" confirmation modal — captures an optional note
 * (usually the date + who took it back). The backend flips state=RETURNED
 * so the unit disappears from active stock but the audit trail persists.
 */
function ReturnBorrowModal({ row, onClose, onDone }) {
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');

  const submit = async () => {
    setErr(''); setSaving(true);
    try {
      await axios.post(`${API}/ha/serial-items/${row.serial_id}/return-borrow`, {
        note: note.trim() || null,
      });
      onDone();
    } catch (e) {
      setErr(e?.response?.data?.detail || 'Return failed');
    } finally { setSaving(false); }
  };

  return (
    <ModalShell onClose={onClose} cardClassName="max-w-md w-full p-5" testid="ha-saleable-return-modal">
      <h2 className="text-base font-bold mb-2 flex items-center gap-2">
        <ArrowLeftRight size={16} className="text-rose-600" /> Return to Source
      </h2>
      <p className="text-[11px] text-slate-600 mb-3">
        Confirming this returns unit <b className="font-mono">{row.serial_no}</b>
        {' '}to <span className="italic">{row.borrowed_from || 'source'}</span>. The unit will
        be marked RETURNED and dropped off active stock lists.
      </p>
      <label className="block text-[11px] font-semibold text-slate-600 mb-1">Return note</label>
      <textarea
        value={note}
        onChange={(e) => setNote(e.target.value)}
        placeholder="e.g., picked up by their staff on 05-Aug"
        rows={2}
        data-testid="ha-saleable-return-note"
        className="w-full border border-slate-300 rounded px-2 py-1.5 text-sm mb-3"
      />
      {err && <div className="bg-rose-50 text-rose-700 text-xs p-2 rounded mb-2">{err}</div>}
      <div className="flex justify-end gap-2">
        <button onClick={onClose} disabled={saving}
                className="px-3 py-1.5 text-xs font-semibold border border-slate-300 rounded">Cancel</button>
        <button
          onClick={submit}
          disabled={saving}
          data-testid="ha-saleable-return-confirm"
          className="px-4 py-1.5 text-xs font-semibold bg-rose-600 hover:bg-rose-700 text-white rounded disabled:opacity-50"
        >{saving ? 'Returning…' : 'Confirm Return'}</button>
      </div>
    </ModalShell>
  );
}
