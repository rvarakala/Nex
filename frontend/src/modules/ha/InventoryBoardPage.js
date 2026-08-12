import React, { useEffect, useMemo, useState, useCallback } from 'react';
import axios from 'axios';

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;

// 9 states, ordered for display
const STATES = ['IN_STOCK', 'RESERVED', 'TRIAL_OUT', 'SOLD', 'LOANER', 'SERVICE_IN', 'RETURNED', 'DAMAGED', 'RETIRED'];
const STATE_STYLES = {
  IN_STOCK:   'bg-emerald-100 text-emerald-800 border-emerald-300',
  RESERVED:   'bg-amber-100 text-amber-800 border-amber-300',
  TRIAL_OUT:  'bg-blue-100 text-blue-800 border-blue-300',
  SOLD:       'bg-indigo-100 text-indigo-800 border-indigo-300',
  LOANER:     'bg-purple-100 text-purple-800 border-purple-300',
  SERVICE_IN: 'bg-cyan-100 text-cyan-800 border-cyan-300',
  RETURNED:   'bg-slate-200 text-slate-700 border-slate-300',
  DAMAGED:    'bg-rose-100 text-rose-800 border-rose-300',
  RETIRED:    'bg-slate-100 text-slate-500 border-slate-200 line-through',
};
const POOLS = ['saleable', 'demo', 'loaner', 'refurbished'];

export default function InventoryBoardPage() {
  const [items, setItems] = useState([]);
  const [summary, setSummary] = useState({ total: 0, by_state: {}, by_pool: {} });
  const [products, setProducts] = useState({});
  // Serial-id → invoice info (invoice_no, patient_name, total, paid, due, status).
  // Populated by one POST /serial-items/invoice-lookup after the list arrives,
  // so SOLD & RESERVED rows show "who bought it + which bill" inline. Empty
  // dict is fine — non-SOLD/RESERVED serials never match this map.
  const [invoices, setInvoices] = useState({});
  const [state, setState] = useState('');
  const [pool, setPool] = useState('');
  const [search, setSearch] = useState('');
  const [drawer, setDrawer] = useState(null); // serial_id for timeline

  const load = useCallback(async () => {
    const p = {};
    if (state) p.state = state;
    if (pool) p.pool = pool;
    if (search) p.search = search;
    const [si, sum, prods] = await Promise.all([
      axios.get(`${API}/ha/serial-items`, { params: p }),
      axios.get(`${API}/ha/serial-items/by-branch-summary`),
      axios.get(`${API}/ha/products`),
    ]);
    setItems(si.data);
    setSummary(sum.data);
    setProducts(Object.fromEntries(prods.data.map(pr => [pr.product_id, pr])));

    // Second call: bulk-hydrate invoice/patient info for SOLD & RESERVED rows.
    // Kept as a separate call so the table's primary render isn't blocked
    // waiting on the join across ha_quick_sales + ha_sales.
    const linkableIds = (si.data || [])
      .filter(r => r.state === 'SOLD' || r.state === 'RESERVED')
      .map(r => r.serial_id);
    if (linkableIds.length > 0) {
      try {
        const lk = await axios.post(`${API}/ha/serial-items/invoice-lookup`, { serial_ids: linkableIds });
        setInvoices(lk.data || {});
      } catch {
        setInvoices({});
      }
    } else {
      setInvoices({});
    }
  }, [state, pool, search]);

  useEffect(() => { load(); }, [load]);

  const kpiStates = useMemo(() => STATES.map(s => ({ s, n: summary.by_state[s] || 0 })), [summary]);

  return (
    <div className="p-5" data-testid="ha-inventory-page">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h1 className="text-xl font-bold text-slate-800">Inventory Board</h1>
          <p className="text-[11px] text-slate-500 mt-0.5">All serialised hearing-aid units across your branches. Click a row to see its lifecycle.</p>
        </div>
        <div className="text-right">
          <div className="text-[10px] uppercase tracking-wider text-slate-500 font-semibold">Total Units</div>
          <div className="text-2xl font-bold text-slate-800 tabular-nums">{summary.total}</div>
        </div>
      </div>

      {/* KPI chips by state */}
      <div className="grid grid-cols-3 md:grid-cols-5 lg:grid-cols-9 gap-2 mb-4" data-testid="ha-inventory-state-chips">
        {kpiStates.map(({ s, n }) => (
          <button
            key={s}
            onClick={() => setState(state === s ? '' : s)}
            data-testid={`ha-chip-${s}`}
            className={`text-left rounded-md border px-2 py-2 transition-all ${STATE_STYLES[s]} ${state === s ? 'ring-2 ring-slate-800 shadow-md' : 'opacity-90 hover:opacity-100'}`}
          >
            <div className="text-[9px] uppercase tracking-widest font-bold">{s.replace('_', ' ')}</div>
            <div className="text-lg font-bold tabular-nums">{n}</div>
          </button>
        ))}
      </div>

      {/* Filters */}
      <div className="flex items-center gap-2 mb-3">
        <input
          placeholder="Search serial number…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          data-testid="ha-inventory-search"
          className="flex-1 max-w-sm bg-white border border-slate-300 rounded-md px-3 py-1.5 text-sm"
        />
        <select value={pool} onChange={(e) => setPool(e.target.value)} data-testid="ha-inventory-pool-filter" className="bg-white border border-slate-300 rounded-md px-2 py-1.5 text-sm">
          <option value="">All pools</option>
          {POOLS.map(p => <option key={p} value={p}>{p}</option>)}
        </select>
        {(state || pool || search) && (
          <button onClick={() => { setState(''); setPool(''); setSearch(''); }} className="text-[11px] text-slate-500 hover:text-slate-800 underline">Clear filters</button>
        )}
      </div>

      {/* Item rows */}
      <div className="bg-white border border-slate-200 rounded-md overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-[10px] uppercase tracking-wider text-slate-600">
            <tr>
              <th className="px-3 py-2 text-left">Serial No</th>
              <th className="px-3 py-2 text-left">Product</th>
              <th className="px-3 py-2 text-left">State</th>
              <th className="px-3 py-2 text-left">Pool</th>
              <th className="px-3 py-2 text-left">Warranty Until</th>
              <th className="px-3 py-2 text-left">GRN</th>
              {/* Only meaningful for SOLD/RESERVED rows — non-linked serials
                  simply show an em-dash so the grid rhythm stays intact. */}
              <th className="px-3 py-2 text-left">Sold / Reserved To</th>
              <th className="px-3 py-2"></th>
            </tr>
          </thead>
          <tbody>
            {items.length === 0 && (
              <tr><td colSpan={8} className="py-10 text-center text-slate-400 italic text-xs">No units match. Create a PO + post a GRN in the Procurement tab to populate inventory.</td></tr>
            )}
            {items.map(it => {
              const p = products[it.product_id];
              const inv = invoices[it.serial_id];
              return (
                <tr key={it.serial_id} className="border-t border-slate-100 hover:bg-slate-50/50" data-testid={`ha-serial-row-${it.serial_id}`}>
                  <td className="px-3 py-2 font-mono text-xs font-bold">{it.serial_no}</td>
                  <td className="px-3 py-2">{p ? `${p.brand} ${p.model}` : <span className="text-slate-400 italic">unknown</span>}</td>
                  <td className="px-3 py-2"><span className={`inline-block text-[10px] font-bold px-2 py-0.5 rounded border ${STATE_STYLES[it.state] || ''}`}>{it.state}</span></td>
                  <td className="px-3 py-2 text-xs capitalize">{it.pool}</td>
                  <td className="px-3 py-2 text-xs tabular-nums">{it.warranty_end_date || '—'}</td>
                  <td className="px-3 py-2 text-xs font-mono">{it.grn_no || '—'}</td>
                  <td className="px-3 py-2 text-xs" data-testid={`ha-serial-invoice-${it.serial_id}`}>
                    <InvoiceCell inv={inv} />
                  </td>
                  <td className="px-3 py-2 text-right">
                    <button
                      data-testid={`ha-serial-timeline-${it.serial_id}`}
                      onClick={() => setDrawer(it.serial_id)}
                      className="text-[10px] text-indigo-600 font-semibold hover:underline">Timeline →</button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {drawer && (
        <TimelineDrawer serialId={drawer} products={products} onClose={() => setDrawer(null)} onChanged={load} />
      )}
    </div>
  );
}

function TimelineDrawer({ serialId, products, onClose, onChanged }) {
  const [data, setData] = useState(null);
  const [targetState, setTargetState] = useState('');
  const [err, setErr] = useState('');

  const load = useCallback(async () => {
    const r = await axios.get(`${API}/ha/serial-items/${serialId}/timeline`);
    // Server now attaches `invoice` at the top level for SOLD/RESERVED serials.
    setData(r.data);
  }, [serialId]);

  useEffect(() => { load(); }, [load]);

  const transition = async () => {
    setErr('');
    try {
      await axios.post(`${API}/ha/serial-items/${serialId}/transition`, { to_state: targetState });
      setTargetState('');
      await load();
      onChanged && onChanged();
    } catch (e) {
      setErr(e?.response?.data?.detail || 'Transition failed');
    }
  };

  if (!data) return null;
  const p = products[data.serial.product_id];

  return (
    <div className="fixed inset-0 z-50 flex" data-testid="ha-timeline-drawer">
      <div className="flex-1 bg-black/40" onClick={onClose} />
      <aside className="w-full max-w-lg bg-white shadow-2xl flex flex-col">
        <div className="border-b border-slate-200 p-4 flex items-center justify-between">
          <div>
            <div className="text-[10px] uppercase tracking-wider text-slate-500 font-semibold">Serial Lifecycle</div>
            <div className="text-lg font-bold font-mono">{data.serial.serial_no}</div>
            <div className="text-[11px] text-slate-500">{p ? `${p.brand} ${p.model}` : ''} · current state: <span className={`inline-block ml-1 text-[10px] font-bold px-1.5 py-0.5 rounded border ${STATE_STYLES[data.serial.state]}`}>{data.serial.state}</span></div>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-800 text-2xl leading-none" data-testid="ha-timeline-close">×</button>
        </div>

        {/* Invoice / patient link — the "who did this go to?" answer that
            the audiologist is here to find. Rendered right below the header
            for SOLD/RESERVED serials; silently hides for everything else. */}
        {data.invoice && (
          <div className="border-b border-slate-200 p-4 bg-indigo-50/40" data-testid="ha-timeline-invoice">
            <InvoiceBlock inv={data.invoice} />
          </div>
        )}

        {/* Transition UI */}
        <div className="border-b border-slate-200 p-4 bg-slate-50">
          <div className="text-[10px] uppercase tracking-wider text-slate-500 font-semibold mb-1.5">Move to a new state</div>
          <div className="flex gap-2">
            <select value={targetState} onChange={(e) => setTargetState(e.target.value)} data-testid="ha-timeline-state-select" className="flex-1 bg-white border border-slate-300 rounded-md px-2 py-1 text-sm">
              <option value="">Select target state…</option>
              {STATES.filter(s => s !== data.serial.state).map(s => <option key={s} value={s}>{s}</option>)}
            </select>
            <button onClick={transition} disabled={!targetState} data-testid="ha-timeline-transition-btn" className="px-3 py-1 text-xs font-semibold bg-slate-800 hover:bg-slate-900 text-white rounded disabled:opacity-40 disabled:cursor-not-allowed">Apply</button>
          </div>
          {err && <div className="mt-2 text-xs text-rose-700 bg-rose-50 rounded p-2">{err}</div>}
        </div>

        {/* Timeline */}
        <div className="flex-1 overflow-auto p-4" data-testid="ha-timeline-events">
          <div className="space-y-3">
            {data.events.map((e, i) => (
              <div key={`${e.at || ''}-${e.from || ''}-${e.to || ''}-${i}`} className="flex gap-3">
                <div className="flex flex-col items-center">
                  <div className="w-2.5 h-2.5 rounded-full bg-indigo-500 mt-1.5" />
                  {i < data.events.length - 1 && <div className="w-px flex-1 bg-slate-200 my-1" />}
                </div>
                <div className="flex-1 pb-3">
                  <div className="flex items-baseline gap-2 text-sm">
                    <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded border ${STATE_STYLES[e.from] || 'bg-slate-100 text-slate-600 border-slate-200'}`}>{e.from}</span>
                    <span className="text-slate-400">→</span>
                    <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded border ${STATE_STYLES[e.to] || ''}`}>{e.to}</span>
                  </div>
                  <div className="text-[10px] text-slate-500 mt-1 tabular-nums">{new Date(e.at).toLocaleString('en-IN')}</div>
                  {e.ref_doc?.kind && (
                    <div className="text-[10px] text-slate-600 mt-0.5">
                      <span className="uppercase tracking-wider text-slate-400">{e.ref_doc.kind}</span>
                      {e.ref_doc.id && <span className="font-mono ml-1">{e.ref_doc.id}</span>}
                    </div>
                  )}
                  {e.note && <div className="text-xs italic text-slate-600 mt-0.5">“{e.note}”</div>}
                </div>
              </div>
            ))}
          </div>
        </div>
      </aside>
    </div>
  );
}


/* ============================================================
 *   INVOICE CELL / INVOICE BLOCK
 *
 * Two flavours of the same data:
 *   • InvoiceCell — dense one-liner for the Inventory Board table row
 *   • InvoiceBlock — richer 3-line card for the Timeline drawer header
 *
 * Both read the shape returned by POST /serial-items/invoice-lookup:
 *   { source, sale_no, invoice_no, patient_id, patient_name,
 *     total, amount_paid, balance_due, payment_status, status, ... }
 *
 * source="quick_sale" carries `payment_status` + `amount_paid` / `balance_due`.
 * source="ha_sale"    carries `status` ("reserved" | "completed") only.
 * ============================================================ */
const fmtINR = (n) => {
  if (n == null || Number.isNaN(Number(n))) return '';
  const num = Number(n);
  if (num >= 100000) return `₹${(num / 100000).toFixed(1).replace(/\.0$/, '')}L`;
  if (num >= 1000)  return `₹${(num / 1000).toFixed(1).replace(/\.0$/, '')}k`;
  return `₹${Math.round(num)}`;
};

// Small badge that reflects the true billing state of the linked sale.
// Quick Sale: uses `payment_status` (fully_paid / partial / unpaid).
// HA Sale: uses `status` (reserved / completed) — reserved has no invoice_no yet.
function InvoicePaymentBadge({ inv }) {
  const src = inv?.source;
  let label = '';
  let tone = 'bg-slate-100 text-slate-700 border-slate-200';
  if (src === 'quick_sale') {
    const ps = String(inv.payment_status || '').toLowerCase();
    if (ps === 'fully_paid' || ps === 'paid') { label = 'Paid';    tone = 'bg-emerald-100 text-emerald-800 border-emerald-300'; }
    else if (ps === 'partial')                { label = 'Partial'; tone = 'bg-amber-100 text-amber-800 border-amber-300'; }
    else if (ps === 'unpaid')                 { label = 'Unpaid';  tone = 'bg-rose-100 text-rose-800 border-rose-300'; }
    else label = ps || '—';
  } else if (src === 'ha_sale') {
    const st = String(inv.status || '').toLowerCase();
    if (st === 'reserved')       { label = 'Reserved';  tone = 'bg-amber-100 text-amber-800 border-amber-300'; }
    else if (st === 'completed') { label = 'Completed'; tone = 'bg-emerald-100 text-emerald-800 border-emerald-300'; }
    else label = st || '—';
  }
  if (!label) return null;
  return <span className={`inline-block text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded border ${tone}`}>{label}</span>;
}

function InvoiceCell({ inv }) {
  if (!inv) return <span className="text-slate-400">—</span>;
  const ref = inv.invoice_no || inv.sale_no || '—';
  return (
    <div className="min-w-0">
      <div className="flex items-center gap-1.5 whitespace-nowrap">
        <span className="font-mono font-semibold text-slate-800 text-[11.5px]">{ref}</span>
        <InvoicePaymentBadge inv={inv} />
      </div>
      <div className="text-[10.5px] text-slate-600 mt-0.5 truncate">
        {inv.patient_name || '—'}
        {inv.total != null && (
          <span className="text-slate-400 ml-1.5">· {fmtINR(inv.total)}</span>
        )}
      </div>
    </div>
  );
}

function InvoiceBlock({ inv }) {
  if (!inv) return null;
  const isQuick = inv.source === 'quick_sale';
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wider text-indigo-700 font-semibold mb-1.5">
        Linked {isQuick ? 'Quick Sale' : 'Sale'}
      </div>
      <div className="flex items-baseline gap-2 flex-wrap">
        <span className="font-mono font-bold text-slate-800 text-[14px]">
          {inv.invoice_no || inv.sale_no || '—'}
        </span>
        <InvoicePaymentBadge inv={inv} />
      </div>
      <div className="text-[12px] text-slate-700 mt-1">
        Sold to <span className="font-semibold">{inv.patient_name || '—'}</span>
        {inv.patient_id && (
          <span className="text-slate-400 ml-1.5 font-mono text-[10.5px]">({inv.patient_id})</span>
        )}
      </div>
      {(inv.total != null || inv.amount_paid != null || inv.balance_due != null) && (
        <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-0.5 text-[11px]">
          {inv.total != null && (
            <span>Total <b className="tabular-nums text-slate-800">₹{Number(inv.total).toLocaleString('en-IN')}</b></span>
          )}
          {inv.amount_paid != null && (
            <span>Paid <b className="tabular-nums text-emerald-700">₹{Number(inv.amount_paid).toLocaleString('en-IN')}</b></span>
          )}
          {inv.balance_due != null && Number(inv.balance_due) > 0 && (
            <span>Due <b className="tabular-nums text-rose-700">₹{Number(inv.balance_due).toLocaleString('en-IN')}</b></span>
          )}
        </div>
      )}
      {inv.sale_no && inv.invoice_no && inv.sale_no !== inv.invoice_no && (
        <div className="text-[10px] text-slate-500 mt-1">Sale ref: <span className="font-mono">{inv.sale_no}</span></div>
      )}
    </div>
  );
}
