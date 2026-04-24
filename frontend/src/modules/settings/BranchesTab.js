/**
 * Branches tab — list / add / edit / (deactivate).
 *
 * Thin wrapper over the existing /api/branches CRUD.
 */
import React, { useCallback, useEffect, useState } from 'react';
import axios from 'axios';
import { Plus, Pencil, AlertTriangle, Check, MapPin } from 'lucide-react';
import ModalShell from '../../components/ModalShell';

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;

export default function BranchesTab() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(null); // null | 'new' | branch
  const [err, setErr] = useState('');
  const [msg, setMsg] = useState('');

  const load = useCallback(async () => {
    setLoading(true); setErr('');
    try {
      const r = await axios.get(`${API}/branches`);
      setRows(r.data || []);
    } catch (e) {
      setErr(e?.response?.data?.detail || 'Failed to load');
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  const flash = (t) => { setMsg(t); setTimeout(() => setMsg(''), 2500); };

  return (
    <div className="p-6 max-w-5xl" data-testid="settings-branches-tab">
      <div className="flex items-start justify-between mb-4">
        <div>
          <h1 className="text-lg font-bold text-slate-800">Branches</h1>
          <p className="text-[11px] text-slate-500 mt-0.5">Physical locations for this clinic. Staff can be scoped to one or many.</p>
        </div>
        <button
          onClick={() => setEditing('new')}
          data-testid="branch-new-btn"
          className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-semibold bg-indigo-600 hover:bg-indigo-700 text-white rounded-md shadow-sm"
        ><Plus size={13} /> Add Branch</button>
      </div>

      {msg && <div className="mb-3 flex items-center gap-2 text-xs text-emerald-700 bg-emerald-50 border border-emerald-200 rounded px-3 py-2"><Check size={13} />{msg}</div>}
      {err && <div className="mb-3 flex items-center gap-2 text-xs text-rose-700 bg-rose-50 border border-rose-200 rounded px-3 py-2"><AlertTriangle size={13} />{err}</div>}

      {loading ? (
        <div className="py-8 text-center text-slate-400 italic text-sm">Loading…</div>
      ) : rows.length === 0 ? (
        <div className="py-8 text-center text-slate-400 italic text-sm" data-testid="branches-empty">
          No branches yet. Every clinic needs at least one branch — click "Add Branch".
        </div>
      ) : (
        <div className="bg-white rounded border border-slate-200 overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 border-b border-slate-200 text-[10px] uppercase tracking-wider text-slate-600">
              <tr>
                <th className="px-3 py-2 text-left">Branch</th>
                <th className="px-3 py-2 text-left">City</th>
                <th className="px-3 py-2 text-left">Phone</th>
                <th className="px-3 py-2 text-left">Code</th>
                <th className="px-3 py-2 text-center">Status</th>
                <th className="px-3 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((b) => (
                <tr key={b.branch_id} className="border-t border-slate-100" data-testid={`branch-row-${b.branch_id}`}>
                  <td className="px-3 py-2">
                    <div className="font-semibold flex items-center gap-1.5"><MapPin size={11} className="text-slate-400" /> {b.name}</div>
                    {b.address && <div className="text-[10px] text-slate-500 ml-[19px]">{b.address}</div>}
                  </td>
                  <td className="px-3 py-2 text-xs text-slate-600">{b.city || '—'}</td>
                  <td className="px-3 py-2 text-xs text-slate-600">{b.phone || '—'}</td>
                  <td className="px-3 py-2 text-[10px] font-mono text-slate-500">{b.branch_id}</td>
                  <td className="px-3 py-2 text-center">
                    {b.active !== false
                      ? <span className="text-[10px] font-bold px-1.5 py-0.5 bg-emerald-100 text-emerald-800 border border-emerald-200 rounded">ACTIVE</span>
                      : <span className="text-[10px] font-bold px-1.5 py-0.5 bg-slate-100 text-slate-700 border border-slate-300 rounded">INACTIVE</span>}
                  </td>
                  <td className="px-3 py-2 text-right">
                    <button onClick={() => setEditing(b)} data-testid={`branch-edit-${b.branch_id}`} className="inline-flex items-center gap-1 text-[10px] font-semibold text-indigo-700 hover:underline"><Pencil size={11} /> Edit</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {editing && (
        <BranchForm
          branch={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={(n) => { setEditing(null); flash(n); load(); }}
        />
      )}
    </div>
  );
}

function BranchForm({ branch, onClose, onSaved }) {
  const isEdit = !!branch;
  const [f, setF] = useState({
    name: branch?.name || '',
    address: branch?.address || '',
    city: branch?.city || '',
    state: branch?.state || '',
    pincode: branch?.pincode || '',
    phone: branch?.phone || '',
    email: branch?.email || '',
  });
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');

  const save = async () => {
    if (!f.name.trim()) { setErr('Branch name is required'); return; }
    setErr(''); setSaving(true);
    try {
      if (isEdit) {
        await axios.put(`${API}/branches/${branch.branch_id}`, f);
        onSaved('Branch updated');
      } else {
        await axios.post(`${API}/branches`, f);
        onSaved('Branch created');
      }
    } catch (e) {
      setErr(e?.response?.data?.detail || 'Save failed');
    } finally { setSaving(false); }
  };

  return (
    <ModalShell onClose={onClose} cardClassName="max-w-lg w-full p-5" testid="branch-form-modal">
      <h3 className="text-base font-bold mb-3">{isEdit ? 'Edit Branch' : 'Add New Branch'}</h3>
      {err && <div className="bg-rose-50 text-rose-700 text-xs p-2 rounded mb-2">{err}</div>}
      <div className="grid grid-cols-2 gap-2 text-sm">
        <F label="Branch Name *"><input autoFocus value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} data-testid="branch-field-name" placeholder="e.g. Hyderabad Central" className={inputCls} /></F>
        <F label="Phone"><input value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} data-testid="branch-field-phone" className={inputCls} /></F>
        <F label="Address" className="col-span-2"><textarea rows={2} value={f.address} onChange={(e) => setF({ ...f, address: e.target.value })} data-testid="branch-field-address" className={inputCls} /></F>
        <F label="City"><input value={f.city} onChange={(e) => setF({ ...f, city: e.target.value })} data-testid="branch-field-city" className={inputCls} /></F>
        <F label="State"><input value={f.state} onChange={(e) => setF({ ...f, state: e.target.value })} data-testid="branch-field-state" className={inputCls} /></F>
        <F label="Pincode"><input value={f.pincode} onChange={(e) => setF({ ...f, pincode: e.target.value })} data-testid="branch-field-pincode" className={inputCls} /></F>
        <F label="Email"><input type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} data-testid="branch-field-email" className={inputCls} /></F>
      </div>
      <div className="flex justify-end gap-2 mt-4 pt-3 border-t border-slate-100">
        <button onClick={onClose} className="px-3 py-1.5 text-xs font-semibold border border-slate-300 rounded">Cancel</button>
        <button onClick={save} disabled={saving} data-testid="branch-save" className="px-3 py-1.5 text-xs font-semibold bg-indigo-600 hover:bg-indigo-700 disabled:bg-slate-300 text-white rounded shadow-sm">
          {saving ? 'Saving…' : (isEdit ? 'Save' : 'Create Branch')}
        </button>
      </div>
    </ModalShell>
  );
}

const inputCls = 'w-full border border-slate-300 rounded px-2 py-1 text-sm focus:outline-none focus:border-indigo-400';
const F = ({ label, children, className = '' }) => (
  <label className={`block ${className}`}>
    <span className="block text-[10px] uppercase tracking-wider text-slate-500 mb-0.5 font-semibold">{label}</span>
    {children}
  </label>
);
