/**
 * Vendors Master — lightweight list/edit/deactivate page for hearing-aid suppliers.
 *
 * Scope: per-clinic. Finance can update GSTIN / payment terms / contacts here
 * without having to start a new PO. Deactivating preserves historical PO & GRN
 * references (soft-delete).
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import axios from 'axios';
import { Briefcase, Plus, Pencil, Power, Search, AlertTriangle } from 'lucide-react';
import ModalShell from '../../components/ModalShell';

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;

export default function VendorsPage() {
  const [rows, setRows] = useState([]);
  const [statsMap, setStatsMap] = useState({}); // vendor_id → {open_po_count, outstanding_amount}
  const [search, setSearch] = useState('');
  const [showInactive, setShowInactive] = useState(false);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');
  const [editing, setEditing] = useState(null); // null | 'new' | vendor object

  const load = useCallback(async () => {
    setLoading(true); setErr('');
    try {
      const params = {};
      if (search) params.search = search;
      if (!showInactive) params.active = true;
      const [listR, statsR] = await Promise.all([
        axios.get(`${API}/vendors`, { params }),
        axios.get(`${API}/vendors/stats`).catch(() => ({ data: {} })),
      ]);
      setRows(listR.data || []);
      setStatsMap(statsR.data || {});
    } catch (e) {
      setErr(e?.response?.data?.detail || 'Unable to load vendors');
    } finally {
      setLoading(false);
    }
  }, [search, showInactive]);

  useEffect(() => { load(); }, [load]);

  const stats = useMemo(() => {
    const active = rows.filter(v => v.active).length;
    return { total: rows.length, active, inactive: rows.length - active };
  }, [rows]);

  const toggleActive = async (v) => {
    if (v.active) {
      const s = statsMap[v.vendor_id];
      const extra = s && s.open_po_count > 0
        ? `\n\n⚠ This vendor has ${s.open_po_count} open PO(s) · ₹${Number(s.outstanding_amount || 0).toLocaleString('en-IN')} outstanding. Existing POs are preserved; only the dropdown is hidden.`
        : '';
      if (!window.confirm(`Deactivate ${v.name}?${extra}`)) return;
      try {
        await axios.delete(`${API}/vendors/${v.vendor_id}`);
        await load();
      } catch (e) { alert(e?.response?.data?.detail || 'Deactivate failed'); }
    } else {
      try {
        await axios.post(`${API}/vendors/${v.vendor_id}/reactivate`);
        await load();
      } catch (e) { alert(e?.response?.data?.detail || 'Could not reactivate'); }
    }
  };

  return (
    <div className="p-5" data-testid="ha-vendors-page">
      <div className="flex items-center justify-between mb-4 gap-3">
        <div>
          <h1 className="text-xl font-bold text-slate-800 flex items-center gap-2">
            <Briefcase size={18} className="text-indigo-600" /> Vendors
          </h1>
          <p className="text-[11px] text-slate-500 mt-0.5">
            Hearing-aid distributors & accessory suppliers. Keep GSTIN / payment terms / contacts up-to-date for clean POs and GSTR filing.
          </p>
        </div>
        <button
          onClick={() => setEditing('new')}
          data-testid="ha-vendors-new"
          className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-semibold bg-indigo-600 hover:bg-indigo-700 text-white rounded-md shadow-sm"
        ><Plus size={13} /> New Vendor</button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-3 gap-3 mb-4" data-testid="ha-vendors-stats">
        <Stat label="Total vendors"    value={stats.total}    tone="slate" />
        <Stat label="Active"           value={stats.active}   tone="emerald" />
        <Stat label="Inactive"         value={stats.inactive} tone="amber" />
      </div>

      {/* Filters */}
      <div className="flex items-center gap-3 mb-3">
        <div className="relative flex-1 max-w-md">
          <Search size={12} className="absolute left-2 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search name / contact / phone / email"
            data-testid="ha-vendors-search"
            className="w-full pl-7 pr-3 py-1.5 border border-slate-300 rounded text-sm"
          />
        </div>
        <label className="flex items-center gap-1.5 text-xs text-slate-600">
          <input
            type="checkbox"
            checked={showInactive}
            onChange={(e) => setShowInactive(e.target.checked)}
            data-testid="ha-vendors-show-inactive"
          />
          Include inactive
        </label>
      </div>

      {err && (
        <div className="mb-3 flex items-center gap-2 text-xs text-rose-700 bg-rose-50 border border-rose-200 rounded px-3 py-2">
          <AlertTriangle size={13} /> {err}
        </div>
      )}

      {loading ? (
        <div className="text-center py-10 text-slate-400 italic text-sm">Loading…</div>
      ) : rows.length === 0 ? (
        <div className="text-center py-10 text-slate-400 italic text-sm" data-testid="ha-vendors-empty">
          {search ? 'No vendors match that search.' : 'No vendors yet. Click "+ New Vendor" to add your first distributor.'}
        </div>
      ) : (
        <div className="bg-white rounded-md border border-slate-200 overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 border-b border-slate-200 text-[10px] uppercase tracking-wider text-slate-600">
              <tr>
                <th className="px-3 py-2 text-left">Vendor</th>
                <th className="px-3 py-2 text-left">Contact</th>
                <th className="px-3 py-2 text-left">GSTIN / State</th>
                <th className="px-3 py-2 text-right">Terms</th>
                <th className="px-3 py-2 text-right">Open POs</th>
                <th className="px-3 py-2 text-center">Status</th>
                <th className="px-3 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((v) => (
                <tr key={v.vendor_id} className={`border-t border-slate-100 ${v.active ? '' : 'opacity-55'}`} data-testid={`ha-vendor-row-${v.vendor_id}`}>
                  <td className="px-3 py-2">
                    <div className="font-semibold">{v.name}</div>
                    <div className="text-[10px] text-slate-500 font-mono">{v.vendor_id}</div>
                  </td>
                  <td className="px-3 py-2 text-xs">
                    {v.contact_person && <div>{v.contact_person}</div>}
                    {v.phone && <div className="text-slate-500">{v.phone}</div>}
                    {v.email && <div className="text-slate-500 truncate max-w-[180px]" title={v.email}>{v.email}</div>}
                    {!v.contact_person && !v.phone && !v.email && <span className="text-slate-400 italic">—</span>}
                  </td>
                  <td className="px-3 py-2 text-xs">
                    <div className="font-mono">{v.gstin || <span className="text-slate-400 italic">—</span>}</div>
                    <div className="text-slate-500">{v.state || ''}</div>
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums text-xs">{v.payment_terms_days || 30}d</td>
                  <td className="px-3 py-2 text-right tabular-nums text-xs" data-testid={`ha-vendor-open-${v.vendor_id}`}>
                    {(() => {
                      const s = statsMap[v.vendor_id];
                      if (!s || s.open_po_count === 0) {
                        return <span className="text-slate-400 italic text-[11px]">—</span>;
                      }
                      const amt = Number(s.outstanding_amount || 0);
                      const amtLabel = amt >= 100000
                        ? `₹${(amt / 100000).toFixed(1)}L`
                        : amt >= 1000
                        ? `₹${(amt / 1000).toFixed(0)}k`
                        : `₹${amt.toFixed(0)}`;
                      return (
                        <div className="inline-flex items-center gap-1" title={`${s.open_po_count} open PO(s) · ₹${amt.toLocaleString('en-IN')} outstanding (GST-incl.)`}>
                          <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-indigo-100 text-indigo-800 border border-indigo-200">
                            {s.open_po_count}
                          </span>
                          <span className="font-semibold text-slate-700">{amtLabel}</span>
                        </div>
                      );
                    })()}
                  </td>
                  <td className="px-3 py-2 text-center">
                    {v.active ? (
                      <span className="inline-block text-[10px] font-bold px-1.5 py-0.5 bg-emerald-100 text-emerald-800 border border-emerald-200 rounded">ACTIVE</span>
                    ) : (
                      <span className="inline-block text-[10px] font-bold px-1.5 py-0.5 bg-slate-100 text-slate-600 border border-slate-300 rounded">INACTIVE</span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-right">
                    <div className="inline-flex gap-1">
                      <button
                        onClick={() => setEditing(v)}
                        data-testid={`ha-vendor-edit-${v.vendor_id}`}
                        className="inline-flex items-center gap-1 text-[10px] font-semibold text-indigo-700 hover:underline px-1"
                      ><Pencil size={11} /> Edit</button>
                      <button
                        onClick={() => toggleActive(v)}
                        data-testid={`ha-vendor-toggle-${v.vendor_id}`}
                        title={v.active ? 'Deactivate — hides from PO dropdown (preserves history)' : 'Re-activate'}
                        className={`inline-flex items-center gap-1 text-[10px] font-semibold px-1 ${v.active ? 'text-slate-600 hover:text-rose-600' : 'text-emerald-600 hover:underline'}`}
                      ><Power size={11} /> {v.active ? 'Deactivate' : 'Re-activate'}</button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {editing && (
        <VendorForm
          vendor={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); load(); }}
        />
      )}
    </div>
  );
}

function Stat({ label, value, tone }) {
  const cls = {
    slate:   'bg-slate-50 border-slate-200 text-slate-900',
    emerald: 'bg-emerald-50 border-emerald-200 text-emerald-900',
    amber:   'bg-amber-50 border-amber-200 text-amber-900',
  }[tone];
  return (
    <div className={`rounded border ${cls} px-3 py-2`}>
      <div className="text-[10px] uppercase tracking-wider font-semibold opacity-70">{label}</div>
      <div className="text-xl font-bold tabular-nums">{value}</div>
    </div>
  );
}

function VendorForm({ vendor, onClose, onSaved }) {
  const [f, setF] = useState(() => ({
    name: vendor?.name || '',
    contact_person: vendor?.contact_person || '',
    phone: vendor?.phone || '',
    email: vendor?.email || '',
    gstin: vendor?.gstin || '',
    state: vendor?.state || '',
    address: vendor?.address || '',
    payment_terms_days: vendor?.payment_terms_days ?? 30,
  }));
  const [err, setErr] = useState('');
  const [saving, setSaving] = useState(false);

  const save = async () => {
    if (!f.name.trim()) { setErr('Vendor name is required'); return; }
    setErr(''); setSaving(true);
    try {
      if (vendor) {
        await axios.put(`${API}/vendors/${vendor.vendor_id}`, f);
      } else {
        await axios.post(`${API}/vendors`, f);
      }
      onSaved();
    } catch (e) {
      const d = e?.response?.data?.detail;
      setErr(typeof d === 'string' ? d : 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  return (
    <ModalShell onClose={onClose} cardClassName="max-w-lg w-full p-5 max-h-[90vh] overflow-auto" testid="ha-vendor-form-modal">
      <h3 className="text-base font-bold mb-3">{vendor ? 'Edit Vendor' : 'New Vendor'}</h3>
      {err && <div className="bg-rose-50 text-rose-700 text-xs p-2 rounded mb-2">{err}</div>}
      <div className="grid grid-cols-2 gap-2 text-sm">
        <F label="Vendor Name *">
          <input autoFocus value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} data-testid="ha-vendor-form-name" placeholder="e.g. Phonak India Pvt Ltd" className="w-full border border-slate-300 rounded px-2 py-1" />
        </F>
        <F label="Contact Person">
          <input value={f.contact_person} onChange={(e) => setF({ ...f, contact_person: e.target.value })} data-testid="ha-vendor-form-contact" className="w-full border border-slate-300 rounded px-2 py-1" />
        </F>
        <F label="Phone">
          <input value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} data-testid="ha-vendor-form-phone" placeholder="+91…" className="w-full border border-slate-300 rounded px-2 py-1" />
        </F>
        <F label="Email">
          <input type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} data-testid="ha-vendor-form-email" className="w-full border border-slate-300 rounded px-2 py-1" />
        </F>
        <F label="GSTIN">
          <input value={f.gstin} onChange={(e) => setF({ ...f, gstin: e.target.value.toUpperCase() })} data-testid="ha-vendor-form-gstin" placeholder="15-char GSTIN" className="w-full border border-slate-300 rounded px-2 py-1 font-mono" />
        </F>
        <F label="State">
          <input value={f.state} onChange={(e) => setF({ ...f, state: e.target.value })} data-testid="ha-vendor-form-state" placeholder="Maharashtra" className="w-full border border-slate-300 rounded px-2 py-1" />
        </F>
        <F label="Payment Terms (days)">
          <input type="number" value={f.payment_terms_days} onChange={(e) => setF({ ...f, payment_terms_days: Number(e.target.value) })} data-testid="ha-vendor-form-terms" className="w-full border border-slate-300 rounded px-2 py-1" />
        </F>
        <label className="block col-span-2">
          <span className="block text-[10px] uppercase tracking-wider text-slate-500 mb-0.5 font-semibold">Address</span>
          <textarea value={f.address} onChange={(e) => setF({ ...f, address: e.target.value })} data-testid="ha-vendor-form-address" rows={2} className="w-full border border-slate-300 rounded px-2 py-1" />
        </label>
      </div>
      <div className="flex justify-end gap-2 mt-4 pt-3 border-t border-slate-200">
        <button onClick={onClose} className="px-3 py-1.5 text-xs font-semibold border border-slate-300 rounded">Cancel</button>
        <button
          onClick={save}
          disabled={saving}
          data-testid="ha-vendor-form-save"
          className="px-3 py-1.5 text-xs font-semibold bg-indigo-600 hover:bg-indigo-700 disabled:bg-slate-300 text-white rounded shadow-sm"
        >{saving ? 'Saving…' : (vendor ? 'Save Changes' : 'Save Vendor')}</button>
      </div>
    </ModalShell>
  );
}

const F = ({ label, children }) => (
  <label className="block">
    <span className="block text-[10px] uppercase tracking-wider text-slate-500 mb-0.5 font-semibold">{label}</span>
    {children}
  </label>
);
