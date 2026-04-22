import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import axios from 'axios';
import { useNavigate } from 'react-router-dom';

const BACKEND_URL = process.env.REACT_APP_BACKEND_URL;
const API = `${BACKEND_URL}/api`;

const SHORTCUT_HINT = (() => {
  if (typeof navigator === 'undefined') return 'Ctrl';
  return /Mac|iPhone|iPad/i.test(navigator.platform || navigator.userAgent || '') ? '⌘' : 'Ctrl';
})();

const ACTIONS = [
  { id: 'new-patient',      label: 'New Patient Walk-in',      hint: 'N',    to: '/frontdesk/new',              icon: '👤' },
  { id: 'returning',        label: 'Search Returning Patient', hint: 'R',    to: '/frontdesk/returning',        icon: '🔍' },
  { id: 'book-appointment', label: 'Book Appointment',         hint: 'A',    to: '/frontdesk/appointments',     icon: '📅', onOpen: true },
  { id: 'new-invoice',      label: 'New Invoice',              hint: 'I',    to: '/billing/new',                icon: '₹'  },
  { id: 'invoices',         label: 'View Invoices',            hint: '',     to: '/billing',                    icon: '📄' },
  { id: 'handover',         label: 'Report Handover',          hint: '',     to: '/billing/handover',           icon: '📦' },
  { id: 'dashboard',        label: 'Front Desk Dashboard',     hint: 'D',    to: '/frontdesk',                  icon: '🏠' },
  { id: 'queue',            label: 'Queue',                    hint: 'Q',    to: '/frontdesk/queue',            icon: '⏱' },
  { id: 'qr-poster',        label: 'Waiting-Room QR Poster',   hint: '',     to: '/frontdesk/qr-poster',        icon: '📱' },
  { id: 'closeout',         label: 'Day Close-out',            hint: '',     to: '/frontdesk/closeout',         icon: '📊' },
];

export default function CommandPalette({ open, onClose }) {
  const navigate = useNavigate();
  const [q, setQ] = useState('');
  const [patients, setPatients] = useState([]);
  const [invoices, setInvoices] = useState([]);
  const [cursor, setCursor] = useState(0);
  const inputRef = useRef(null);

  // Reset on open
  useEffect(() => {
    if (open) {
      setQ('');
      setCursor(0);
      setPatients([]);
      setInvoices([]);
      setTimeout(() => inputRef.current?.focus(), 20);
    }
  }, [open]);

  // Debounced backend search
  useEffect(() => {
    if (!open) return;
    const term = q.trim();
    if (term.length < 2) { setPatients([]); setInvoices([]); return; }
    const t = setTimeout(async () => {
      try {
        const [pRes, iRes] = await Promise.all([
          axios.get(`${API}/patients`, { params: { search: term, limit: 5 } }).catch(() => ({ data: [] })),
          axios.get(`${API}/billing/invoices`, { params: { search: term, limit: 5 } }).catch(() => ({ data: [] })),
        ]);
        setPatients(pRes.data || []);
        setInvoices(iRes.data || []);
      } catch { /* ignore */ }
    }, 180);
    return () => clearTimeout(t);
  }, [q, open]);

  // Filter action list by query
  const filteredActions = useMemo(() => {
    const term = q.trim().toLowerCase();
    if (!term) return ACTIONS;
    return ACTIONS.filter((a) => a.label.toLowerCase().includes(term) || (a.hint || '').toLowerCase() === term);
  }, [q]);

  // Flatten into a single item array for keyboard nav
  const items = useMemo(() => {
    const it = filteredActions.map((a) => ({ kind: 'action', ...a }));
    patients.forEach((p) => it.push({
      kind: 'patient', id: `p-${p.patient_id}`,
      label: p.name,
      sub: `${p.mrd || p.patient_id}${p.mobile ? ` · ${p.mobile}` : ''}`,
      icon: '🧑', _data: p,
    }));
    invoices.forEach((inv) => it.push({
      kind: 'invoice', id: `i-${inv.invoice_id}`,
      label: `${inv.invoice_no} — ${inv.patient_name}`,
      sub: `₹${inv.rounded_total} · ${inv.status}`,
      icon: '📄', _data: inv,
    }));
    return it;
  }, [filteredActions, patients, invoices]);

  const select = useCallback((it) => {
    if (!it) return;
    if (it.kind === 'action') {
      navigate(it.to);
    } else if (it.kind === 'patient') {
      // Route to billing/new with patient preselected
      navigate('/billing/new', { state: { patient: it._data } });
    } else if (it.kind === 'invoice') {
      navigate(`/billing/invoice/${it._data.invoice_id}`);
    }
    onClose();
  }, [navigate, onClose]);

  const onKeyDown = (e) => {
    if (e.key === 'Escape') { onClose(); return; }
    if (e.key === 'ArrowDown') { e.preventDefault(); setCursor((c) => Math.min(c + 1, items.length - 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setCursor((c) => Math.max(c - 1, 0)); }
    else if (e.key === 'Enter') { e.preventDefault(); select(items[cursor]); }
  };

  // Keep cursor in range when items change
  useEffect(() => {
    if (cursor >= items.length) setCursor(Math.max(0, items.length - 1));
  }, [items.length, cursor]);

  if (!open) return null;

  return (
    <div
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
      className="fixed inset-0 z-[60] bg-slate-900/50 backdrop-blur-sm flex items-start justify-center pt-[10vh] px-4"
      data-testid="cmdk-palette">
      <div className="bg-white rounded-xl shadow-2xl w-[640px] max-w-full border border-slate-200 overflow-hidden">
        {/* Input */}
        <div className="flex items-center border-b border-slate-200 px-3 py-2">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-slate-400 mr-2">
            <circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/>
          </svg>
          <input
            ref={inputRef}
            type="text"
            value={q}
            onChange={(e) => { setQ(e.target.value); setCursor(0); }}
            onKeyDown={onKeyDown}
            placeholder="Search patients, invoices, or jump to…"
            data-testid="cmdk-input"
            className="flex-1 text-sm outline-none bg-transparent placeholder-slate-400"
          />
          <span className="text-[10px] text-slate-400 bg-slate-100 border border-slate-200 rounded px-1.5 py-0.5 font-mono">ESC</span>
        </div>

        {/* Results */}
        <div className="max-h-[60vh] overflow-auto py-1" data-testid="cmdk-results">
          {items.length === 0 && (
            <div className="px-3 py-6 text-center text-xs text-slate-400 italic">
              No matches. Type at least 2 chars to search patients / invoices.
            </div>
          )}
          {/* Group separators */}
          {items.some((it) => it.kind === 'action') && (
            <SectionLabel>Quick Actions</SectionLabel>
          )}
          {items.filter((it) => it.kind === 'action').map((it) => {
            const idx = items.indexOf(it);
            return <Row key={it.id} it={it} active={idx === cursor} onMouseEnter={() => setCursor(idx)} onClick={() => select(it)} />;
          })}

          {patients.length > 0 && <SectionLabel>Patients</SectionLabel>}
          {items.filter((it) => it.kind === 'patient').map((it) => {
            const idx = items.indexOf(it);
            return <Row key={it.id} it={it} active={idx === cursor} onMouseEnter={() => setCursor(idx)} onClick={() => select(it)} />;
          })}

          {invoices.length > 0 && <SectionLabel>Invoices</SectionLabel>}
          {items.filter((it) => it.kind === 'invoice').map((it) => {
            const idx = items.indexOf(it);
            return <Row key={it.id} it={it} active={idx === cursor} onMouseEnter={() => setCursor(idx)} onClick={() => select(it)} />;
          })}
        </div>

        {/* Footer */}
        <div className="border-t border-slate-200 px-3 py-1.5 bg-slate-50 flex items-center justify-between text-[10px] text-slate-500">
          <div className="flex gap-2">
            <span><kbd className="px-1 bg-white border rounded">↑↓</kbd> navigate</span>
            <span><kbd className="px-1 bg-white border rounded">↵</kbd> open</span>
            <span><kbd className="px-1 bg-white border rounded">{SHORTCUT_HINT}K</kbd> toggle</span>
          </div>
          <div>ACS · Command Palette</div>
        </div>
      </div>
    </div>
  );
}

const SectionLabel = ({ children }) => (
  <div className="px-3 pt-2 pb-0.5 text-[9px] uppercase tracking-[0.2em] font-bold text-slate-400">{children}</div>
);

const Row = ({ it, active, onClick, onMouseEnter }) => (
  <button
    onClick={onClick}
    onMouseEnter={onMouseEnter}
    data-testid={`cmdk-item-${it.id}`}
    className={`w-full text-left flex items-center gap-2 px-3 py-2 text-sm transition-colors ${
      active ? 'bg-blue-600 text-white' : 'hover:bg-slate-100 text-slate-800'
    }`}>
    <span className="w-5 text-center">{it.icon}</span>
    <span className="flex-1 truncate">
      <span className="font-medium">{it.label}</span>
      {it.sub && <span className={`ml-2 text-xs ${active ? 'text-blue-100' : 'text-slate-500'}`}>{it.sub}</span>}
    </span>
    {it.hint && (
      <span className={`text-[10px] font-mono px-1.5 py-0.5 rounded border ${
        active ? 'bg-blue-700 border-blue-400 text-blue-100' : 'bg-slate-100 border-slate-200 text-slate-500'
      }`}>{it.hint}</span>
    )}
  </button>
);
