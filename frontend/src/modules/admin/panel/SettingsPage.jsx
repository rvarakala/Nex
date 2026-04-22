import React, { useEffect, useState } from 'react';
import axios from 'axios';
import { PageHeader, Card, Empty } from './shared';
import { Save } from 'lucide-react';

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;

export default function SettingsPage() {
  const [s, setS] = useState(null);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    axios.get(`${API}/admin/v2/settings`).then((r) => setS(r.data));
  }, []);

  const save = async () => {
    setBusy(true); setSaved(false);
    try {
      const { updated_at, updated_by, ...payload } = s;
      const r = await axios.put(`${API}/admin/v2/settings`, payload);
      setS(r.data); setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } finally { setBusy(false); }
  };

  if (!s) return <div className="p-6 text-slate-500">Loading settings…</div>;

  const Field = ({ label, k, type = 'text' }) => (
    <label className="block text-sm">
      <span className="text-[11px] font-semibold text-slate-600 uppercase tracking-wider">{label}</span>
      <input type={type} value={s[k] ?? ''} onChange={(e) => setS({ ...s, [k]: type === 'number' ? parseFloat(e.target.value) || 0 : e.target.value })}
        className="mt-0.5 w-full px-2 py-1.5 text-sm border border-slate-300 rounded focus:border-indigo-500 outline-none" data-testid={`setting-${k}`} />
    </label>
  );

  return (
    <div className="p-6 space-y-5" data-testid="admin-settings-page">
      <PageHeader title="Platform Settings" subtitle="Global configuration applied across the AUDINEXA platform">
        <button onClick={save} disabled={busy} data-testid="settings-save-btn" className="flex items-center gap-1 px-3 py-1.5 text-xs font-semibold text-white bg-indigo-600 hover:bg-indigo-700 rounded disabled:opacity-50">
          <Save size={12} /> {busy ? 'Saving…' : saved ? 'Saved ✓' : 'Save all'}
        </button>
      </PageHeader>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
        <Card title="Brand">
          <div className="p-5 space-y-3">
            <Field label="Brand name" k="brand_name" />
            <Field label="Brand logo URL" k="brand_logo_url" />
            <Field label="Support email" k="support_email" type="email" />
          </div>
        </Card>

        <Card title="Locale & Commerce">
          <div className="p-5 space-y-3">
            <Field label="Currency" k="currency" />
            <Field label="Timezone" k="timezone" />
            <div className="grid grid-cols-2 gap-3">
              <Field label="Tax label" k="tax_label" />
              <Field label="Tax rate %" k="tax_rate_pct" type="number" />
            </div>
            <Field label="Trial duration (days)" k="trial_duration_days" type="number" />
          </div>
        </Card>

        <Card title="Email Templates" className="md:col-span-2">
          <div className="p-5 space-y-3">
            {Object.entries(s.email_templates || {}).map(([key, val]) => (
              <label key={key} className="block text-sm">
                <span className="text-[11px] font-semibold text-slate-600 uppercase tracking-wider">{key.replace(/_/g, ' ')}</span>
                <textarea value={val} rows={2} onChange={(e) => setS({ ...s, email_templates: { ...s.email_templates, [key]: e.target.value } })}
                  className="mt-0.5 w-full px-2 py-1.5 text-sm border border-slate-300 rounded" />
              </label>
            ))}
          </div>
        </Card>

        <Card title="Default Onboarding Checklist" className="md:col-span-2">
          <div className="p-5 space-y-2">
            {(s.default_onboarding_checklist || []).map((item, i) => (
              <div key={i} className="flex gap-2">
                <input value={item} onChange={(e) => {
                  const next = [...s.default_onboarding_checklist];
                  next[i] = e.target.value;
                  setS({ ...s, default_onboarding_checklist: next });
                }} className="flex-1 px-2 py-1 text-sm border border-slate-300 rounded" />
                <button onClick={() => setS({ ...s, default_onboarding_checklist: s.default_onboarding_checklist.filter((_, j) => j !== i) })}
                  className="px-2 py-1 text-xs text-rose-600 hover:text-rose-700">×</button>
              </div>
            ))}
            <button onClick={() => setS({ ...s, default_onboarding_checklist: [...(s.default_onboarding_checklist || []), ''] })}
              className="text-xs text-indigo-700 hover:underline">+ Add item</button>
          </div>
        </Card>
      </div>
    </div>
  );
}
