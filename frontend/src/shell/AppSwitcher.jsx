/**
 * Top-level app switcher — Google Workspace-style module grid.
 * Renders beside the existing AppShell header. Tier-gated:
 *  - always-on: frontdesk, diagnostics (BASIC)
 *  - tier-gated: hearing-aids, repair, analytics
 *
 * Locked modules render at reduced opacity + lock icon; clicking opens
 * the upgrade CTA modal via the ModuleGate on the destination page.
 */
import React, { useState, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useSubscription } from '../SubscriptionContext';

const MODULES = [
  { key: 'frontdesk',    label: 'Front Desk',    path: '/frontdesk',   color: 'bg-blue-600',    icon: '🏥' },
  { key: 'diagnostics',  label: 'Diagnostics',   path: '/test',        color: 'bg-emerald-600', icon: '🎧' },
  { key: 'hearing-aids', label: 'Hearing Aids',  path: '/ha',          color: 'bg-indigo-600',  icon: '🔊' },
  { key: 'repair',       label: 'Service & Repair', path: '/repair',   color: 'bg-orange-600',  icon: '🔧' },
  { key: 'analytics',    label: 'Analytics',     path: '/ha/analytics',color: 'bg-purple-600',  icon: '📊' },
];

export default function AppSwitcher() {
  const [open, setOpen] = useState(false);
  const navigate = useNavigate();
  const { access, tier, superAdminBypass, trialActive, trialDaysLeft } = useSubscription();
  const ref = useRef(null);

  useEffect(() => {
    const close = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, []);

  const go = (m) => {
    if (!superAdminBypass && !access[m.key]) return;
    setOpen(false);
    navigate(m.path);
  };

  return (
    <div className="relative" ref={ref}>
      <button onClick={() => setOpen((o) => !o)} data-testid="app-switcher-toggle"
              className="w-9 h-9 rounded hover:bg-slate-100 flex items-center justify-center"
              title="Switch app">
        <span className="grid grid-cols-3 gap-0.5">
          {[...Array(9)].map((_, i) => <span key={i} className="w-1 h-1 bg-slate-600 rounded-full" />)}
        </span>
      </button>
      {open && (
        <div className="absolute right-0 top-11 w-72 bg-white rounded-lg shadow-2xl border border-slate-200 z-50 p-3" data-testid="app-switcher-panel">
          <div className="flex items-center justify-between mb-2 px-1">
            <div className="text-[10px] uppercase tracking-wider text-slate-500 font-bold">Apps</div>
            <div className="text-[10px] font-bold">
              <span className={`px-1.5 py-0.5 rounded text-white ${tier === 'PREMIUM' ? 'bg-orange-600' : tier === 'STANDARD' ? 'bg-indigo-600' : 'bg-slate-500'}`}>
                {tier}
              </span>
              {trialActive && <span className="ml-1 text-orange-600" data-testid="app-switcher-trial-banner">· trial: {trialDaysLeft}d left</span>}
            </div>
          </div>
          <div className="grid grid-cols-3 gap-2">
            {MODULES.map(m => {
              const locked = !superAdminBypass && !access[m.key];
              return (
                <button key={m.key}
                        onClick={() => go(m)}
                        data-testid={`app-switcher-${m.key}`}
                        className={`aspect-square rounded-md flex flex-col items-center justify-center gap-1 p-2 relative transition ${
                          locked
                            ? 'bg-slate-50 text-slate-400 cursor-not-allowed opacity-60'
                            : 'hover:bg-slate-100 text-slate-800'
                        }`}>
                  <div className={`w-10 h-10 rounded ${locked ? 'bg-slate-200' : m.color} text-white text-xl flex items-center justify-center`}>
                    {locked ? '🔒' : m.icon}
                  </div>
                  <div className="text-[10px] font-semibold text-center leading-tight">{m.label}</div>
                </button>
              );
            })}
          </div>
          {!superAdminBypass && tier !== 'PREMIUM' && (
            <a href="/#pricing" target="_blank" rel="noreferrer"
               data-testid="app-switcher-upgrade"
               className="block mt-3 text-center py-2 bg-gradient-to-r from-orange-500 to-rose-600 text-white text-xs font-bold rounded hover:opacity-90">
              ⚡ Upgrade to unlock all modules
            </a>
          )}
        </div>
      )}
    </div>
  );
}
