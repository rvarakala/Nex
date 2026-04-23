import React, { useMemo, useState } from 'react';
import { useSubscription } from '../SubscriptionContext';

/**
 * Tier-aware diagnostic tabs.
 *
 * BASIC tier clinics get core diagnostics only:
 *   Pre-Test · Pure Tone · Impedance · Reports
 *
 * All other panels (Speech, OAE, ABR, Special Tests, Sound Field,
 * Pediatric, Tinnitus) require STANDARD or PREMIUM.
 *
 * Locked tabs render with a 🔒 icon. Clicking a locked tab opens an
 * upgrade hint instead of switching. Super-admin & Premium bypass all gates.
 */
const TABS = [
  { id: 'pre_test',   label: 'Pre-Test',            basic: true  },
  { id: 'pure_tone',  label: 'Pure Tone',           basic: true  },
  { id: 'impedance',  label: 'Impedance',           basic: true  },
  { id: 'speech',     label: 'Speech',              basic: false },
  { id: 'special',    label: 'Special Tests',       basic: false },
  { id: 'oae',        label: 'OAE',                 basic: false },
  { id: 'soundfield', label: 'Sound Field / Aided', basic: false },
  { id: 'abr',        label: 'ABR / ASSR',          basic: false },
  { id: 'pediatric',  label: 'Pediatric',           basic: false },
  { id: 'tinnitus',   label: 'Tinnitus',            basic: false },
  { id: 'reports',    label: 'Reports',             basic: true  },
];

const LockIcon = () => (
  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="inline-block ml-1 -mt-0.5">
    <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
    <path d="M7 11V7a5 5 0 0 1 10 0v4" />
  </svg>
);

const SimpleTabs = ({ activeTab, onTabChange }) => {
  const { tier, superAdminBypass } = useSubscription();
  const [upgradeFor, setUpgradeFor] = useState(null);

  const isLocked = useMemo(() => {
    return (tab) => {
      if (superAdminBypass) return false;
      if (tier === 'BASIC') return !tab.basic;
      return false;
    };
  }, [tier, superAdminBypass]);

  const handleClick = (tab) => {
    if (isLocked(tab)) {
      setUpgradeFor(tab);
      return;
    }
    onTabChange(tab.id);
  };

  return (
    <>
      <div className="flex items-center gap-0.5 bg-gray-200 px-2 pt-1 border-b border-gray-300 overflow-x-auto flex-shrink-0" data-testid="diagnostic-tabs">
        {TABS.map((tab) => {
          const locked = isLocked(tab);
          const active = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              onClick={() => handleClick(tab)}
              data-testid={`tab-${tab.id}${locked ? '-locked' : ''}`}
              title={locked ? `${tab.label} — upgrade to Standard to unlock` : tab.label}
              className={`
                px-3 py-1.5 text-xs font-medium rounded-t whitespace-nowrap
                transition-colors duration-150
                ${active && !locked
                  ? 'bg-white text-gray-900 border-t-2 border-x border-gray-400 border-t-blue-500'
                  : locked
                    ? 'bg-gray-100 text-gray-400 border border-gray-200 cursor-pointer hover:bg-amber-50 hover:text-amber-700 hover:border-amber-200'
                    : 'bg-gray-100 text-gray-600 hover:bg-gray-50 border border-gray-200'
                }
              `}
            >
              {tab.label}
              {locked && <LockIcon />}
            </button>
          );
        })}
      </div>

      {/* Upgrade modal — appears when a locked tab is clicked */}
      {upgradeFor && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-sm p-4"
          data-testid="diagnostic-upgrade-modal"
          role="dialog"
          onClick={() => setUpgradeFor(null)}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="bg-white rounded-xl shadow-2xl max-w-md w-full p-6 space-y-4"
          >
            <div className="flex items-start gap-3">
              <div className="w-10 h-10 rounded-lg bg-amber-100 flex items-center justify-center flex-shrink-0">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#b45309" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
                  <path d="M7 11V7a5 5 0 0 1 10 0v4" />
                </svg>
              </div>
              <div>
                <div className="text-[10px] uppercase tracking-wider font-bold text-amber-600">Upgrade Required</div>
                <h3 className="text-lg font-bold text-slate-900">{upgradeFor.label} is a Standard feature</h3>
              </div>
            </div>
            <p className="text-sm text-slate-600 leading-relaxed">
              Your clinic is on the <b>BASIC</b> plan which includes Pre-Test, Pure Tone &amp; Impedance.
              Unlock {upgradeFor.label}, plus OAE, ABR, Speech and Sound Field by upgrading to{' '}
              <b>Standard</b> or <b>Premium</b>.
            </p>
            <div className="bg-slate-50 border border-slate-200 rounded-lg p-3">
              <div className="text-[10px] uppercase font-bold tracking-wider text-slate-500 mb-1">What you unlock</div>
              <ul className="text-xs text-slate-700 grid grid-cols-2 gap-1">
                <li>· Speech Audiometry</li>
                <li>· OAE</li>
                <li>· ABR / ASSR</li>
                <li>· Special Tests</li>
                <li>· Sound Field / Aided</li>
                <li>· Pediatric Battery</li>
                <li>· Tinnitus Assessment</li>
                <li>· + Hearing Aid Sales</li>
              </ul>
            </div>
            <div className="flex gap-2 pt-1">
              <button
                onClick={() => setUpgradeFor(null)}
                className="flex-1 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-100 rounded-lg transition-colors"
                data-testid="diagnostic-upgrade-dismiss"
              >
                Not now
              </button>
              <a
                href="/#pricing"
                target="_blank"
                rel="noreferrer"
                className="flex-1 py-2 text-sm font-bold text-white bg-indigo-600 hover:bg-indigo-700 rounded-lg text-center transition-colors"
                data-testid="diagnostic-upgrade-cta"
              >
                See Plans →
              </a>
            </div>
          </div>
        </div>
      )}
    </>
  );
};

export default SimpleTabs;
