/**
 * LaunchBannerAdminCard — founder-only editor for the public launch banner.
 *
 * Shows a live preview at the top so the founder can eyeball copy before
 * hitting Save. Persists via PATCH /api/admin/v2/platform/launch-banner.
 */
import React, { useEffect, useState } from 'react';
import axios from 'axios';
import { Megaphone, Save, Eye } from 'lucide-react';
import { Card, Pill } from './shared';

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;

const TONE_OPTIONS = [
  { code: 'indigo',  label: 'Indigo',  swatch: 'bg-indigo-600' },
  { code: 'emerald', label: 'Emerald', swatch: 'bg-emerald-600' },
  { code: 'rose',    label: 'Rose',    swatch: 'bg-rose-600' },
  { code: 'amber',   label: 'Amber',   swatch: 'bg-amber-500' },
];

export default function LaunchBannerAdminCard() {
  const [cfg, setCfg] = useState(null);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState('');

  useEffect(() => { load(); }, []);
  const load = async () => {
    try {
      const r = await axios.get(`${API}/admin/v2/platform/launch-banner`);
      setCfg(r.data);
    } catch (e) {
      setMsg(e?.response?.data?.detail || 'Failed to load banner');
    }
  };

  const save = async (patch) => {
    setSaving(true); setMsg('');
    try {
      const r = await axios.patch(`${API}/admin/v2/platform/launch-banner`, patch);
      setCfg(r.data);
      setMsg('Saved.');
      setTimeout(() => setMsg(''), 2500);
    } catch (e) {
      setMsg(e?.response?.data?.detail || 'Save failed');
    } finally { setSaving(false); }
  };

  if (!cfg) return null;

  return (
    <Card
      title="Launch Banner"
      subtitle="Public ribbon shown on the landing + signup pages"
      testid="launch-banner-admin-card"
      actions={<Pill tone={cfg.enabled ? 'emerald' : 'slate'} testid="banner-status-pill">{cfg.enabled ? 'Live' : 'Off'}</Pill>}
    >
      <div className="p-5 space-y-4">
        {/* Live preview */}
        <div>
          <div className="text-[10px] uppercase tracking-wider text-slate-500 font-semibold flex items-center gap-1 mb-1.5">
            <Eye size={11} /> Live preview
          </div>
          <BannerPreview cfg={cfg} />
        </div>

        {/* Fields */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <label className="col-span-2">
            <div className="text-[10px] uppercase tracking-wider text-slate-500 font-semibold mb-1">Message (max 280 chars)</div>
            <textarea
              value={cfg.message || ''}
              onChange={(e) => setCfg({ ...cfg, message: e.target.value.slice(0, 280) })}
              rows={2}
              data-testid="banner-message-input"
              className="w-full px-3 py-2 text-sm border border-slate-300 rounded resize-y focus:outline-none focus:border-indigo-500"
            />
            <div className="text-[10px] text-slate-400 mt-0.5 text-right">{(cfg.message || '').length}/280</div>
          </label>
          <label>
            <div className="text-[10px] uppercase tracking-wider text-slate-500 font-semibold mb-1">CTA Text</div>
            <input
              type="text"
              value={cfg.cta_text || ''}
              maxLength={40}
              onChange={(e) => setCfg({ ...cfg, cta_text: e.target.value })}
              data-testid="banner-cta-text-input"
              className="w-full px-3 py-1.5 text-sm border border-slate-300 rounded focus:outline-none focus:border-indigo-500"
            />
          </label>
          <label>
            <div className="text-[10px] uppercase tracking-wider text-slate-500 font-semibold mb-1">CTA Link</div>
            <input
              type="text"
              value={cfg.cta_href || ''}
              maxLength={200}
              onChange={(e) => setCfg({ ...cfg, cta_href: e.target.value })}
              placeholder="/#pricing or https://…"
              data-testid="banner-cta-href-input"
              className="w-full px-3 py-1.5 text-sm border border-slate-300 rounded focus:outline-none focus:border-indigo-500"
            />
          </label>
          <div>
            <div className="text-[10px] uppercase tracking-wider text-slate-500 font-semibold mb-1">Color tone</div>
            <div className="flex gap-2">
              {TONE_OPTIONS.map((t) => (
                <button
                  key={t.code}
                  onClick={() => setCfg({ ...cfg, tone: t.code })}
                  data-testid={`banner-tone-${t.code}`}
                  className={`flex items-center gap-1.5 px-2 py-1 text-xs rounded border ${cfg.tone === t.code ? 'border-slate-800 font-semibold' : 'border-slate-200'}`}
                >
                  <span className={`w-3 h-3 rounded-full ${t.swatch}`} />
                  {t.label}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Save + toggle */}
        <div className="flex items-center justify-between gap-3 pt-2 border-t border-slate-100">
          <button
            onClick={() => save({ enabled: !cfg.enabled })}
            data-testid="banner-toggle-btn"
            disabled={saving}
            className={`px-3 py-1.5 text-xs font-semibold rounded ${cfg.enabled ? 'bg-slate-200 text-slate-700 hover:bg-slate-300' : 'bg-emerald-600 text-white hover:bg-emerald-700'} disabled:opacity-60`}
          >
            {cfg.enabled ? 'Turn OFF banner' : 'Turn ON banner'}
          </button>
          <div className="flex items-center gap-3">
            {msg && <span className="text-[11px] text-emerald-700 font-semibold">{msg}</span>}
            <button
              onClick={() => save({
                message: cfg.message,
                cta_text: cfg.cta_text,
                cta_href: cfg.cta_href,
                tone: cfg.tone,
              })}
              data-testid="banner-save-btn"
              disabled={saving}
              className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-semibold text-white bg-indigo-600 hover:bg-indigo-700 disabled:opacity-60 rounded"
            >
              <Save size={12} /> Save changes
            </button>
          </div>
        </div>
      </div>
    </Card>
  );
}

function BannerPreview({ cfg }) {
  const toneMap = {
    indigo:  'bg-indigo-600',
    emerald: 'bg-emerald-600',
    rose:    'bg-rose-600',
    amber:   'bg-amber-500',
  };
  return (
    <div className={`${toneMap[cfg.tone] || toneMap.indigo} text-white rounded shadow-inner`} data-testid="banner-preview">
      <div className="px-4 py-2.5 flex items-center justify-between gap-3 text-sm">
        <div className="flex-1 min-w-0 truncate font-medium">
          <Megaphone size={12} className="inline mr-2 opacity-80" />
          {cfg.message || <span className="italic opacity-60">Type a message…</span>}
        </div>
        {cfg.cta_text && (
          <span className="hidden sm:inline-flex items-center gap-1 px-3 py-1 text-xs font-semibold bg-white/15 rounded shrink-0">
            {cfg.cta_text} →
          </span>
        )}
      </div>
    </div>
  );
}
