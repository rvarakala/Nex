/**
 * SealPlacementCard — settings widget under Print Templates. Lets a user
 * pick which document types should have their personal seal stamped on
 * them at print/PDF time.
 *
 * Three document types are supported (kept tight on the server too so a
 * typo can't silently disable the feature):
 *   • Audiogram report (backend-rendered PDF)
 *   • Invoice         (frontend-rendered, on-screen + print)
 *   • Delivery challan (frontend-rendered, on-screen + html2canvas → PDF)
 *
 * Each toggle is disabled when the user hasn't yet uploaded a seal — we
 * link them to /settings/seal so the empty-state has an obvious next step
 * instead of confusing them with checkboxes that wouldn't do anything.
 */
import React, { useEffect, useState } from 'react';
import axios from 'axios';
import { Link } from 'react-router-dom';
import {
  Stamp, FileText, Receipt, Truck, CheckCircle2, AlertCircle, Loader2, ArrowRight,
} from 'lucide-react';

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;

const DOC_TYPES = [
  {
    code: 'audiogram',
    label: 'Audiogram reports',
    blurb: 'Stamped next to your signature on every signed PDF report.',
    icon: FileText,
  },
  {
    code: 'invoice',
    label: 'Invoices',
    blurb: 'Adds a seal next to "Authorised signatory" on printed invoices.',
    icon: Receipt,
  },
  {
    code: 'challan',
    label: 'Delivery challans',
    blurb: 'Embeds your seal beside the receiver signature on stock transfers.',
    icon: Truck,
  },
];

export default function SealPlacementCard() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');
  const [savedFlash, setSavedFlash] = useState(false);
  const [hasSeal, setHasSeal] = useState(false);
  const [selected, setSelected] = useState(new Set());

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const r = await axios.get(`${API}/settings/me/seal-prefs`);
        if (!alive) return;
        setHasSeal(!!r.data.has_seal);
        setSelected(new Set(r.data.include_on || []));
      } catch (e) {
        if (alive) setErr(e?.response?.data?.detail || 'Could not load preferences');
      } finally { if (alive) setLoading(false); }
    })();
    return () => { alive = false; };
  }, []);

  const toggle = async (code) => {
    if (!hasSeal || saving) return;
    const next = new Set(selected);
    if (next.has(code)) next.delete(code); else next.add(code);
    // Optimistic UI — set then persist; revert + show error if it fails.
    const prev = selected;
    setSelected(next);
    setErr('');
    setSaving(true);
    try {
      await axios.put(`${API}/settings/me/seal-prefs`, { include_on: Array.from(next) });
      setSavedFlash(true);
      setTimeout(() => setSavedFlash(false), 1600);
    } catch (e) {
      setSelected(prev); // revert
      setErr(e?.response?.data?.detail || 'Could not save preference');
    } finally { setSaving(false); }
  };

  return (
    <div
      data-testid="seal-placement-card"
      className="mt-6 bg-white border border-slate-200 rounded-xl p-5 shadow-sm"
    >
      <div className="flex items-start justify-between gap-3 mb-1">
        <div className="flex items-center gap-2">
          <div className="w-9 h-9 rounded-lg bg-indigo-50 border border-indigo-200 flex items-center justify-center">
            <Stamp size={16} className="text-indigo-600" />
          </div>
          <div>
            <h3 className="font-bold text-slate-900 text-[15px]">Seal placement</h3>
            <p className="text-[12px] text-slate-500">
              Choose which printed documents include your official seal.
            </p>
          </div>
        </div>
        {savedFlash && (
          <span
            data-testid="seal-prefs-saved-flash"
            className="inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider px-2 py-1 rounded bg-emerald-50 text-emerald-700 border border-emerald-200"
          >
            <CheckCircle2 size={11} /> Saved
          </span>
        )}
      </div>

      {/* Empty-state CTA — direct them to upload before they can configure. */}
      {!loading && !hasSeal && (
        <Link
          to="/settings/seal"
          data-testid="seal-placement-empty-cta"
          className="mt-4 flex items-center justify-between gap-3 rounded-lg border border-dashed border-amber-300 bg-amber-50 px-4 py-3 hover:bg-amber-100/70 transition-colors"
        >
          <div className="flex items-center gap-2">
            <AlertCircle size={14} className="text-amber-600" />
            <div className="text-[12px] text-amber-800 font-semibold">
              Upload a seal first — then come back to choose where it appears.
            </div>
          </div>
          <ArrowRight size={14} className="text-amber-700" />
        </Link>
      )}

      {/* Three checkboxes — each rendered as a compact card so the affordance
          is obvious and the helper copy can fit comfortably next to it. */}
      {!loading && hasSeal && (
        <div className="mt-4 grid grid-cols-1 sm:grid-cols-3 gap-2">
          {DOC_TYPES.map((d) => {
            const Icon = d.icon;
            const on = selected.has(d.code);
            return (
              <label
                key={d.code}
                data-testid={`seal-doc-toggle-${d.code}`}
                className={`relative flex items-start gap-2.5 rounded-lg border p-3 cursor-pointer transition-all ${
                  on
                    ? 'border-indigo-300 bg-indigo-50 ring-1 ring-indigo-200'
                    : 'border-slate-200 bg-white hover:border-indigo-200 hover:bg-slate-50'
                }`}
              >
                <input
                  type="checkbox"
                  checked={on}
                  onChange={() => toggle(d.code)}
                  disabled={saving}
                  data-testid={`seal-doc-checkbox-${d.code}`}
                  className="mt-0.5 h-4 w-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500 cursor-pointer disabled:cursor-not-allowed"
                />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5 text-[12px] font-bold text-slate-800">
                    <Icon size={12} className={on ? 'text-indigo-600' : 'text-slate-400'} />
                    {d.label}
                  </div>
                  <div className="text-[10.5px] text-slate-500 mt-0.5 leading-snug">
                    {d.blurb}
                  </div>
                </div>
              </label>
            );
          })}
        </div>
      )}

      {loading && (
        <div className="mt-4 flex items-center gap-2 text-[12px] text-slate-500">
          <Loader2 size={12} className="animate-spin" /> Loading preferences…
        </div>
      )}

      {err && (
        <div
          data-testid="seal-prefs-err"
          className="mt-3 flex items-start gap-2 bg-rose-50 border border-rose-200 text-rose-700 text-[11px] px-3 py-2 rounded"
        >
          <AlertCircle size={12} className="flex-shrink-0 mt-0.5" />
          <div>{err}</div>
        </div>
      )}
    </div>
  );
}
