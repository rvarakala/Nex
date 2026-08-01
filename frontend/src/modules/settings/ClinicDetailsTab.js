/**
 * Clinic Details tab — logo + address + GSTIN + contact.
 * Clinic-owner/super-admin only.
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import axios from 'axios';
import { Upload, AlertTriangle, Check } from 'lucide-react';

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;

export default function ClinicDetailsTab() {
  const [clinic, setClinic] = useState(null);
  const [f, setF] = useState({});
  const [logoBustKey, setLogoBustKey] = useState(0);
  const [saving, setSaving] = useState(false);
  const [uploadBusy, setUploadBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');
  const fileInput = useRef(null);

  const load = useCallback(async () => {
    try {
      const r = await axios.get(`${API}/settings/clinic`);
      setClinic(r.data);
      setF({
        name: r.data.name || '',
        // Tagline sits under clinic name on every report / print template.
        // Empty string means "no tagline" — the ReportHeader gracefully
        // hides the row when tagline is falsy.
        tagline: r.data.tagline || '',
        address: r.data.address || '',
        city: r.data.city || '',
        state: r.data.state || '',
        pincode: r.data.pincode || '',
        phone: r.data.phone || '',
        email: r.data.email || '',
        website: r.data.website || '',
        gstin: r.data.gstin || '',
        pan: r.data.pan || '',
        // Font family for reports + print templates. Empty string = default (Arial).
        report_font: r.data.report_font || '',
        template_font: r.data.template_font || '',
      });
    } catch (e) {
      setErr(e?.response?.data?.detail || 'Failed to load clinic');
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const save = useCallback(async () => {
    setSaving(true); setErr(''); setMsg('');
    try {
      await axios.put(`${API}/settings/clinic`, f);
      setMsg('Saved successfully');
      setTimeout(() => setMsg(''), 3000);
      await load();
    } catch (e) {
      setErr(e?.response?.data?.detail || 'Save failed');
    } finally {
      setSaving(false);
    }
  }, [f, load]);

  const onPickLogo = () => fileInput.current?.click();
  const onLogoFile = useCallback(async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 2 * 1024 * 1024) {
      setErr('Logo must be ≤ 2 MB');
      return;
    }
    setUploadBusy(true); setErr(''); setMsg('');
    try {
      const fd = new FormData();
      fd.append('file', file);
      await axios.post(`${API}/settings/clinic/logo`, fd, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      setMsg('Logo uploaded');
      setLogoBustKey((k) => k + 1);
      setTimeout(() => setMsg(''), 3000);
      await load();
    } catch (ex) {
      setErr(ex?.response?.data?.detail || 'Upload failed');
    } finally {
      setUploadBusy(false);
      e.target.value = ''; // allow re-selecting the same file
    }
  }, [load]);

  if (!clinic) {
    return <div className="p-6 text-slate-400 italic">Loading…</div>;
  }

  const logoUrl = clinic.logo_fs_id
    ? `${API}/settings/clinic/logo?v=${logoBustKey}`
    : null;

  return (
    <div className="p-6 max-w-3xl" data-testid="settings-clinic-tab">
      <h1 className="text-lg font-bold text-slate-800">Clinic Details</h1>
      <p className="text-[11px] text-slate-500 mt-0.5 mb-4">
        Shown on invoices, reports, and the patient portal. Kept in sync across every branch.
      </p>

      {msg && <div className="mb-3 flex items-center gap-2 text-xs text-emerald-700 bg-emerald-50 border border-emerald-200 rounded px-3 py-2"><Check size={13} />{msg}</div>}
      {err && <div className="mb-3 flex items-center gap-2 text-xs text-rose-700 bg-rose-50 border border-rose-200 rounded px-3 py-2"><AlertTriangle size={13} />{err}</div>}

      {/* Logo uploader */}
      <div className="bg-white rounded border border-slate-200 p-4 mb-5">
        <div className="text-xs font-bold text-slate-700 mb-2">Logo</div>
        <div className="flex items-center gap-4">
          <div className="w-28 h-28 border border-slate-200 rounded bg-slate-50 flex items-center justify-center overflow-hidden flex-shrink-0">
            {logoUrl ? (
              <img src={logoUrl} alt="clinic logo" className="max-w-full max-h-full object-contain" data-testid="clinic-logo-preview" />
            ) : (
              <div className="text-[10px] text-slate-400 italic">No logo</div>
            )}
          </div>
          <div className="flex-1">
            <input ref={fileInput} type="file" accept="image/png,image/jpeg,image/jpg,image/svg+xml" onChange={onLogoFile} className="hidden" data-testid="clinic-logo-file" />
            <button
              onClick={onPickLogo}
              disabled={uploadBusy}
              data-testid="clinic-logo-upload"
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold bg-indigo-600 hover:bg-indigo-700 disabled:bg-slate-300 text-white rounded"
            ><Upload size={12} /> {uploadBusy ? 'Uploading…' : 'Upload Logo'}</button>
            <div className="text-[11px] text-slate-500 mt-1">PNG, JPG, or SVG · Max 2 MB · Square works best</div>
          </div>
        </div>
      </div>

      {/* Details form */}
      <div className="bg-white rounded border border-slate-200 p-4">
        <div className="grid grid-cols-2 gap-3 text-sm">
          <Fld label="Clinic Name *"><input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} data-testid="clinic-field-name" className={inputCls} /></Fld>
          <Fld label="Tagline">
            {/* One-line motto printed under the clinic name on every report. */}
            <input
              value={f.tagline}
              onChange={(e) => setF({ ...f, tagline: e.target.value })}
              data-testid="clinic-field-tagline"
              placeholder="e.g., Listen Better. Live Brighter."
              maxLength={80}
              className={inputCls}
            />
          </Fld>
          <Fld label="Phone"><input value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} data-testid="clinic-field-phone" placeholder="+91 99999 99999" className={inputCls} /></Fld>
          <Fld label="Email"><input type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} data-testid="clinic-field-email" placeholder="clinic@example.in" className={inputCls} /></Fld>
          <Fld label="Website"><input value={f.website} onChange={(e) => setF({ ...f, website: e.target.value })} data-testid="clinic-field-website" placeholder="https://…" className={inputCls} /></Fld>
          <Fld label="Address" className="col-span-2"><textarea rows={2} value={f.address} onChange={(e) => setF({ ...f, address: e.target.value })} data-testid="clinic-field-address" className={inputCls} /></Fld>
          <Fld label="City"><input value={f.city} onChange={(e) => setF({ ...f, city: e.target.value })} data-testid="clinic-field-city" className={inputCls} /></Fld>
          <Fld label="State"><input value={f.state} onChange={(e) => setF({ ...f, state: e.target.value })} data-testid="clinic-field-state" className={inputCls} /></Fld>
          <Fld label="Pincode"><input value={f.pincode} onChange={(e) => setF({ ...f, pincode: e.target.value })} data-testid="clinic-field-pincode" className={inputCls} /></Fld>
          <Fld label="&nbsp;">{/* filler */}<div /></Fld>
          <Fld label="GSTIN"><input value={f.gstin} onChange={(e) => setF({ ...f, gstin: e.target.value.toUpperCase() })} data-testid="clinic-field-gstin" placeholder="15-char GSTIN" className={`${inputCls} font-mono`} /></Fld>
          <Fld label="PAN"><input value={f.pan} onChange={(e) => setF({ ...f, pan: e.target.value.toUpperCase() })} data-testid="clinic-field-pan" placeholder="10-char PAN" className={`${inputCls} font-mono`} /></Fld>
        </div>

        {/* Typography — choose the font for on-screen reports AND print templates. */}
        <div className="mt-5 pt-4 border-t border-slate-100">
          <div className="text-xs font-bold text-slate-700 mb-2">Typography</div>
          <p className="text-[11px] text-slate-500 mb-3">
            Applied to on-screen reports, print templates, and the exported PDF. Leave blank to use the default (Arial).
          </p>
          <div className="grid grid-cols-2 gap-3 text-sm">
            <Fld label="Report Font">
              <select
                value={f.report_font}
                onChange={(e) => setF({ ...f, report_font: e.target.value })}
                data-testid="clinic-field-report-font"
                className={inputCls}
                style={{ fontFamily: f.report_font || undefined }}
              >
                {FONT_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value} style={{ fontFamily: o.value || undefined }}>{o.label}</option>
                ))}
              </select>
            </Fld>
            <Fld label="Print Template Font">
              <select
                value={f.template_font}
                onChange={(e) => setF({ ...f, template_font: e.target.value })}
                data-testid="clinic-field-template-font"
                className={inputCls}
                style={{ fontFamily: f.template_font || undefined }}
              >
                {FONT_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value} style={{ fontFamily: o.value || undefined }}>{o.label}</option>
                ))}
              </select>
            </Fld>
          </div>
        </div>

        <div className="flex justify-end mt-4 pt-3 border-t border-slate-100">
          <button
            onClick={save}
            disabled={saving}
            data-testid="clinic-save"
            className="px-4 py-1.5 text-xs font-semibold bg-indigo-600 hover:bg-indigo-700 disabled:bg-slate-300 text-white rounded shadow-sm"
          >{saving ? 'Saving…' : 'Save Changes'}</button>
        </div>
      </div>
    </div>
  );
}

// Curated PDF-safe font stack — every option here is either a system
// font (installed on all major OS + printers) or a well-supported web
// fallback. html2canvas needs the font to be actually rendered by the
// browser at capture time, so we stick to safe choices.
const FONT_OPTIONS = [
  { value: '',                                    label: 'Default (Arial)' },
  { value: 'Arial, sans-serif',                   label: 'Arial (clean)' },
  { value: 'Helvetica, Arial, sans-serif',        label: 'Helvetica' },
  { value: '"Segoe UI", Roboto, sans-serif',      label: 'Segoe UI / Roboto' },
  { value: 'Georgia, "Times New Roman", serif',   label: 'Georgia (serif)' },
  { value: '"Times New Roman", Times, serif',     label: 'Times New Roman' },
  { value: '"Trebuchet MS", sans-serif',          label: 'Trebuchet MS' },
  { value: 'Verdana, Geneva, sans-serif',         label: 'Verdana (wide)' },
  { value: '"Courier New", Courier, monospace',   label: 'Courier New (mono)' },
  { value: '"Palatino Linotype", "Book Antiqua", Palatino, serif', label: 'Palatino (classic)' },
  { value: '"Cambria", Georgia, serif',           label: 'Cambria' },
  { value: '"Calibri", "Segoe UI", sans-serif',   label: 'Calibri (modern)' },
];

const inputCls = 'w-full border border-slate-300 rounded px-2 py-1 text-sm focus:outline-none focus:border-indigo-400';
const Fld = ({ label, children, className = '' }) => (
  <label className={`block ${className}`}>
    <span className="block text-[10px] uppercase tracking-wider text-slate-500 mb-0.5 font-semibold">{label}</span>
    {children}
  </label>
);
