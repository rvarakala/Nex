import React, { useState, useEffect, useCallback } from 'react';
import axios from 'axios';
import { Link } from 'react-router-dom';
import { API, fmtINR, fmtDate, StatusPill } from './billingUtils';
import { ListSkeleton, LoadMoreButton } from '../../components/ListSkeleton';

const PAGE_SIZE = 50;

export default function InvoicesListPage() {
  const [invoices, setInvoices] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [cursor, setCursor] = useState('');
  const [hasMore, setHasMore] = useState(false);
  const [filter, setFilter] = useState({ status: '', from_date: '', to_date: '', search: '' });
  const [collections, setCollections] = useState(null);

  const fetchPage = useCallback(async (reset, useCursor) => {
    if (reset) setLoading(true); else setLoadingMore(true);
    try {
      const params = { limit: PAGE_SIZE, cursor: useCursor || '' };
      Object.entries(filter).forEach(([k, v]) => { if (v) params[k] = v; });
      const r = await axios.get(`${API}/billing/invoices`, { params });
      const body = r.data || {};
      const newRows = Array.isArray(body) ? body : (body.items || []);
      setInvoices((prev) => reset ? newRows : [...prev, ...newRows]);
      setCursor(body.next_cursor || '');
      setHasMore(!!body.has_more);
    } catch {
      if (reset) setInvoices([]);
    } finally {
      if (reset) setLoading(false); else setLoadingMore(false);
    }
  }, [filter]);

  const loadCollections = useCallback(async () => {
    try {
      const r = await axios.get(`${API}/billing/collections`);
      setCollections(r.data);
    } catch { setCollections(null); }
  }, []);

  // Filter change → reset & re-fetch from page 1
  useEffect(() => { fetchPage(true, ''); }, [fetchPage]);
  useEffect(() => { loadCollections(); }, [loadCollections]);

  return (
    <div className="p-4 space-y-3" data-testid="invoices-list-page">
      {/* Today's collections summary */}
      <div className="bg-gradient-to-r from-emerald-50 to-white border border-emerald-200 rounded-lg p-3">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-[10px] uppercase tracking-wider font-bold text-emerald-700">Today's Collections</div>
            <div className="text-2xl font-bold text-emerald-800 tabular-nums" data-testid="collections-total">
              {fmtINR(collections?.total || 0)}
            </div>
            <div className="text-[11px] text-slate-500">
              {collections?.payment_count || 0} payments received
            </div>
          </div>
          <div className="flex gap-2 flex-wrap" data-testid="collections-by-method">
            {Object.entries(collections?.by_method || {}).map(([m, amt]) => (
              <div key={m} className="bg-white border border-emerald-200 rounded px-2 py-1">
                <div className="text-[9px] uppercase tracking-wider text-slate-500">{m.replace('_', ' ')}</div>
                <div className="text-sm font-bold text-slate-800 tabular-nums">{fmtINR(amt)}</div>
              </div>
            ))}
            {(!collections || Object.keys(collections?.by_method || {}).length === 0) && (
              <div className="text-[11px] text-slate-400 italic self-center">No collections yet</div>
            )}
          </div>
        </div>
      </div>

      {/* Filters */}
      <div className="bg-white rounded-lg border border-slate-200 p-2 flex items-center gap-2 flex-wrap">
        <input
          type="text" placeholder="Search invoice no / name / mobile / MRD…"
          value={filter.search}
          onChange={(e) => setFilter({ ...filter, search: e.target.value })}
          data-testid="inv-filter-search"
          className="flex-1 min-w-[180px] text-xs border border-slate-300 rounded px-2 py-1"
        />
        <select value={filter.status} onChange={(e) => setFilter({ ...filter, status: e.target.value })}
          data-testid="inv-filter-status" className="text-xs border border-slate-300 rounded px-2 py-1 bg-white">
          <option value="">All statuses</option>
          {['draft', 'partial', 'paid', 'refunded', 'cancelled'].map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        <input type="date" value={filter.from_date} onChange={(e) => setFilter({ ...filter, from_date: e.target.value })}
          data-testid="inv-filter-from" className="text-xs border border-slate-300 rounded px-1.5 py-1" />
        <input type="date" value={filter.to_date} onChange={(e) => setFilter({ ...filter, to_date: e.target.value })}
          data-testid="inv-filter-to" className="text-xs border border-slate-300 rounded px-1.5 py-1" />
        <Link to="/billing/new" data-testid="inv-new-btn"
          className="ml-auto px-3 py-1 text-xs bg-emerald-600 hover:bg-emerald-700 text-white font-semibold rounded shadow-sm">
          + New Invoice
        </Link>
      </div>

      {/* List */}
      <div className="bg-white rounded-lg border border-slate-200 overflow-hidden">
        <table className="w-full text-xs">
          <thead className="bg-slate-50 border-b border-slate-200">
            <tr className="text-left">
              <th className="px-3 py-2 font-semibold text-slate-600">Invoice #</th>
              <th className="px-3 py-2 font-semibold text-slate-600">Date</th>
              <th className="px-3 py-2 font-semibold text-slate-600">Patient</th>
              <th className="px-3 py-2 font-semibold text-slate-600 text-right">Total</th>
              <th className="px-3 py-2 font-semibold text-slate-600 text-right">Paid</th>
              <th className="px-3 py-2 font-semibold text-slate-600 text-right">Due</th>
              <th className="px-3 py-2 font-semibold text-slate-600">Status</th>
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr><td colSpan={7} className="p-0">
                <div className="p-4"><ListSkeleton rows={6} cols={5} /></div>
              </td></tr>
            )}
            {!loading && invoices.length === 0 && (
              <tr><td colSpan={7} className="px-3 py-8 text-center text-slate-400 italic">No invoices yet. Click "+ New Invoice" to create one.</td></tr>
            )}
            {!loading && invoices.map((inv) => (
              <tr key={inv.invoice_id} data-testid={`inv-row-${inv.invoice_id}`}
                  className="border-b border-slate-100 last:border-0 hover:bg-slate-50">
                <td className="px-3 py-2 font-mono text-slate-700">
                  <Link to={`/billing/invoice/${inv.invoice_id}`} className="text-emerald-700 hover:underline font-semibold">
                    {inv.invoice_no}
                  </Link>
                </td>
                <td className="px-3 py-2 text-slate-600">{fmtDate(inv.invoice_date)}</td>
                <td className="px-3 py-2">
                  <div className="font-semibold text-slate-800">{inv.patient_name}</div>
                  <div className="text-[10px] text-slate-500">{inv.mrd || ''}{inv.patient_mobile ? ` · ${inv.patient_mobile}` : ''}</div>
                </td>
                <td className="px-3 py-2 text-right tabular-nums font-semibold">{fmtINR(inv.rounded_total)}</td>
                <td className="px-3 py-2 text-right tabular-nums text-emerald-700">{fmtINR(inv.paid_total)}</td>
                <td className="px-3 py-2 text-right tabular-nums text-rose-700 font-semibold">{fmtINR(inv.due_total)}</td>
                <td className="px-3 py-2"><StatusPill status={inv.status} /></td>
              </tr>
            ))}
          </tbody>
        </table>
        <LoadMoreButton hasMore={hasMore} loading={loadingMore} onClick={() => fetchPage(false, cursor)} />
      </div>
    </div>
  );
}
