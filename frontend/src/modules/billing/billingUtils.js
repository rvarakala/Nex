// Shared helpers and components for the billing module.
import React from 'react';

export const BACKEND_URL = process.env.REACT_APP_BACKEND_URL;
export const API = `${BACKEND_URL}/api`;

export const PAYMENT_METHODS = [
  { value: 'cash', label: 'Cash' },
  { value: 'upi', label: 'UPI' },
  { value: 'card', label: 'Card' },
  { value: 'bank_transfer', label: 'Bank Transfer' },
  { value: 'insurance', label: 'Insurance' },
];

export const fmtINR = (n) => {
  if (n === null || n === undefined || Number.isNaN(Number(n))) return '—';
  return `₹${Number(n).toLocaleString('en-IN', { maximumFractionDigits: 2, minimumFractionDigits: 2 })}`;
};

export const fmtDate = (iso) => {
  if (!iso) return '—';
  try { return new Date(iso).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }); }
  catch { return iso; }
};

export const fmtDateTime = (iso) => {
  if (!iso) return '—';
  try { return new Date(iso).toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }); }
  catch { return iso; }
};

export const STATUS_BADGE = {
  draft:     'bg-slate-100 text-slate-700 border-slate-300',
  partial:   'bg-amber-100 text-amber-800 border-amber-300',
  paid:      'bg-emerald-100 text-emerald-800 border-emerald-300',
  refunded:  'bg-blue-100 text-blue-800 border-blue-300',
  cancelled: 'bg-rose-100 text-rose-700 border-rose-300 line-through',
};

export const StatusPill = ({ status }) => (
  <span className={`text-[10px] px-1.5 py-0.5 font-bold rounded border uppercase tracking-wider ${STATUS_BADGE[status] || STATUS_BADGE.draft}`}>
    {status}
  </span>
);
