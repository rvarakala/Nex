/**
 * Demo Stock — hearing-aid units kept aside for patient trials & clinic demos.
 *
 * Demo pool rules:
 *   • Unit is in the 'demo' pool (never 'saleable').
 *   • Rotates between IN_STOCK (available) ↔ TRIAL_OUT (with a patient).
 *   • Owners/inventory managers can move a saleable unit in, or retire one out.
 */
import React, { useEffect, useMemo, useState } from 'react';
import axios from 'axios';
import { Sparkles, RotateCcw, Tag, AlertTriangle } from 'lucide-react';
import ModalShell from '../../components/ModalShell';

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;

const STATE_BADGE = {
  IN_STOCK: 'bg-emerald-100 text-emerald-700 border-emerald-200',
  TRIAL_OUT: 'bg-amber-100 text-amber-700 border-amber-200',
  SERVICE_IN: 'bg-sky-100 text-sky-700 border-sky-200',
};

export default function DemoStockPage() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');
  const [filter, setFilter] = useState('all'); // all | available | out
  const [search, setSearch] = useState('');
  const [showPromote, setShowPromote] = useState(false);

  const load = async () => {
    setLoading(true); setErr('');
    try {
      const r = await axios.get(`${API}/ha/demo-stock`);
      setRows(Array.isArray(r.data) ? r.data : []);
    } catch (e) {
      setErr(e?.response?.data?.detail || 'Unable to load demo stock');
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => { load(); }, []);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter((r) => {
      if (filter === 'available' && r.state !== 'IN_STOCK') return false;
      if (filter === 'out' && r.state !== 'TRIAL_OUT') return false;
      if (!q) return true;
      const p = r.product || {};
      return (
        r.serial_no?.toLowerCase().includes(q)
        || p.brand?.toLowerCase().includes(q)
        || p.model?.toLowerCase().includes(q)
        || r.current_patient?.name?.toLowerCase().includes(q)
      );
    });
  }, [rows, filter, search]);

  const stats = useMemo(() => {
    const total = rows.length;
    const avail = rows.filter(r => r.state === 'IN_STOCK').length;
    const out = rows.filter(r => r.state === 'TRIAL_OUT').length;
    const utilization = total > 0 ? Math.round((out / total) * 100) : 0;
    return { total, avail, out, utilization };
  }, [rows]);

  const unmark = async (serial_id) => {
    if (!window.confirm('Remove this unit from the demo pool and return to saleable stock?')) return;
    try {
      await axios.post(`${API}/ha/serial-items/${serial_id}/unmark-demo`);
      await load();
    } catch (e) {
      alert(e?.response?.data?.detail || 'Could not unmark');
    }
  };

  return (
    <div className="p-5" data-testid="ha-demo-stock-page">
      <div className="flex items-center justify-between mb-4 gap-3">
        <div>
          <h1 className="text-xl font-bold text-slate-800 flex items-center gap-2">
            <Sparkles size={18} className="text-purple-600" /> Demo Stock
          </h1>
          <p className="text-[11px] text-slate-500 mt-0.5">
            Units reserved for patient trials. Every trial draws from this pool — flag a saleable unit as demo to include it here.
          </p>
        </div>
        <button
          onClick={() => setShowPromote(true)}
          data-testid="ha-demo-add-btn"
          className="px-3 py-1.5 text-xs font-semibold bg-purple-600 hover:bg-purple-700 text-white rounded-md shadow-sm"
        >+ Add to Demo Pool</button>
      </div>

      {/* Stats bar */}
      <div className="grid grid-cols-4 gap-3 mb-4" data-testid="ha-demo-stats">
        <Stat label="Total demo units"     value={stats.total}              tone="slate" />
        <Stat label="Available for trial"  value={stats.avail}              tone="emerald" />
        <Stat label="Currently on trial"   value={stats.out}                tone="amber" />
        <Stat label="Utilization"          value={`${stats.utilization}%`}  tone="purple" />
      </div>

      {/* Filters */}
      <div className="flex items-center gap-2 mb-3">
        <div className="flex items-center gap-1 bg-slate-100 rounded p-0.5">
          {[['all', 'All'], ['available', 'Available'], ['out', 'On Trial']].map(([k, lab]) => (
            <button
              key={k}
              onClick={() => setFilter(k)}
              data-testid={`ha-demo-filter-${k}`}
              className={`px-2.5 py-1 text-[11px] font-semibold rounded ${filter === k ? 'bg-white shadow text-slate-900' : 'text-slate-600'}`}
            >{lab}</button>
          ))}
        </div>
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search serial / brand / model / patient"
          data-testid="ha-demo-search"
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
        <div className="text-center py-10 text-slate-400 italic text-sm" data-testid="ha-demo-empty">
          {rows.length === 0
            ? 'No demo units yet. Click "+ Add to Demo Pool" to flag a saleable unit as a demo.'
            : 'No units match this filter.'}
        </div>
      ) : (
        <div className="bg-white rounded-md border border-slate-200 overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 border-b border-slate-200 text-[10px] uppercase tracking-wider text-slate-600">
              <tr>
                <th className="px-3 py-2 text-left">Serial</th>
                <th className="px-3 py-2 text-left">Product</th>
                <th className="px-3 py-2 text-left">State</th>
                <th className="px-3 py-2 text-left">Current Patient</th>
                <th className="px-3 py-2 text-left">Warranty</th>
                <th className="px-3 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((r) => (
                <tr key={r.serial_id} className="border-t border-slate-100" data-testid={`ha-demo-row-${r.serial_id}`}>
                  <td className="px-3 py-2 font-mono text-xs font-bold">{r.serial_no}</td>
                  <td className="px-3 py-2">
                    {r.product ? (
                      <div>
                        <div className="font-semibold">{r.product.brand} {r.product.model}</div>
                        <div className="text-[10px] text-slate-500">{r.product.form_factor}</div>
                      </div>
                    ) : <span className="text-slate-400">—</span>}
                  </td>
                  <td className="px-3 py-2">
                    <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded border ${STATE_BADGE[r.state] || 'bg-slate-100 text-slate-700 border-slate-200'}`}>
                      {r.state}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-xs">
                    {r.current_patient ? (
                      <>
                        <span className="font-semibold">{r.current_patient.name}</span>
                        <span className="text-slate-400 ml-1">{r.current_patient.mrd || ''}</span>
                      </>
                    ) : <span className="text-slate-400 italic">—</span>}
                  </td>
                  <td className="px-3 py-2 text-xs text-slate-600">{r.warranty_end_date || '—'}</td>
                  <td className="px-3 py-2 text-right">
                    {r.state === 'IN_STOCK' && (
                      <button
                        onClick={() => unmark(r.serial_id)}
                        data-testid={`ha-demo-unmark-${r.serial_id}`}
                        className="inline-flex items-center gap-1 text-[10px] font-semibold text-slate-700 border border-slate-300 rounded px-2 py-0.5 hover:bg-slate-50"
                        title="Return this unit to the saleable pool"
                      ><RotateCcw size={11} /> Return to Saleable</button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {showPromote && (
        <PromoteModal onClose={() => setShowPromote(false)} onDone={() => { setShowPromote(false); load(); }} />
      )}
    </div>
  );
}

function Stat({ label, value, tone }) {
  const cls = {
    slate:   'bg-slate-50 border-slate-200 text-slate-900',
    emerald: 'bg-emerald-50 border-emerald-200 text-emerald-900',
    amber:   'bg-amber-50 border-amber-200 text-amber-900',
    purple:  'bg-purple-50 border-purple-200 text-purple-900',
  }[tone];
  return (
    <div className={`rounded border ${cls} px-3 py-2`} data-testid={`ha-demo-stat-${tone}`}>
      <div className="text-[10px] uppercase tracking-wider font-semibold opacity-70">{label}</div>
      <div className="text-xl font-bold tabular-nums">{value}</div>
    </div>
  );
}

function PromoteModal({ onClose, onDone }) {
  const [serials, setSerials] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [err, setErr] = useState('');

  useEffect(() => {
    (async () => {
      setLoading(true);
      try {
        const r = await axios.get(`${API}/ha/serial-items`, { params: { state: 'IN_STOCK', limit: 500 } });
        setSerials((r.data || []).filter((s) => (s.pool || 'saleable') !== 'demo'));
      } catch (e) {
        setErr(e?.response?.data?.detail || 'Failed to load');
      } finally { setLoading(false); }
    })();
  }, []);

  const filtered = useMemo(() => {
    const q = search.toLowerCase().trim();
    if (!q) return serials;
    return serials.filter((s) => s.serial_no?.toLowerCase().includes(q) || s.product_id?.toLowerCase().includes(q));
  }, [serials, search]);

  const promote = async (serial_id) => {
    try {
      await axios.post(`${API}/ha/serial-items/${serial_id}/mark-demo`);
      onDone();
    } catch (e) {
      alert(e?.response?.data?.detail || 'Could not add to demo pool');
    }
  };

  return (
    <ModalShell onClose={onClose} cardClassName="max-w-xl w-full p-5 max-h-[85vh] overflow-auto" testid="ha-demo-promote-modal">
      <h2 className="text-base font-bold mb-3 flex items-center gap-2">
        <Tag size={16} className="text-purple-600" /> Flag a Unit as Demo
      </h2>
      <p className="text-[11px] text-slate-500 mb-3">
        Pick an IN_STOCK saleable serial to move it into the demo pool. Demo units are never sold and are the default source for trials.
      </p>
      <input
        autoFocus
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder="Search serial or product…"
        data-testid="ha-demo-promote-search"
        className="w-full border border-slate-300 rounded px-2 py-1.5 text-sm mb-3"
      />
      {err && <div className="bg-rose-50 text-rose-700 text-xs p-2 rounded mb-2">{err}</div>}
      {loading ? (
        <div className="py-6 text-center text-slate-400 italic text-sm">Loading…</div>
      ) : filtered.length === 0 ? (
        <div className="py-6 text-center text-slate-400 italic text-sm" data-testid="ha-demo-promote-empty">
          No saleable IN_STOCK serials available.
        </div>
      ) : (
        <div className="border border-slate-200 rounded max-h-96 overflow-auto">
          {filtered.map((s) => (
            <div key={s.serial_id} className="flex items-center gap-2 px-3 py-2 border-b border-slate-100 text-[12px]" data-testid={`ha-demo-promote-row-${s.serial_id}`}>
              <div className="flex-1">
                <div className="font-mono font-bold">{s.serial_no}</div>
                <div className="text-[10px] text-slate-500">{s.product_id} · branch {s.branch_id}</div>
              </div>
              <button
                onClick={() => promote(s.serial_id)}
                data-testid={`ha-demo-promote-btn-${s.serial_id}`}
                className="px-2 py-1 text-[10px] font-semibold bg-purple-600 hover:bg-purple-700 text-white rounded"
              >Mark as Demo →</button>
            </div>
          ))}
        </div>
      )}
      <div className="flex justify-end mt-3">
        <button onClick={onClose} className="px-3 py-1.5 text-xs font-semibold border border-slate-300 rounded">Close</button>
      </div>
    </ModalShell>
  );
}
