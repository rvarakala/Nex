import React from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import { useAuth } from '../AuthContext';
import { useTestContext } from '../TestContext';

const NavItem = ({ to, icon, label, testid }) => (
  <NavLink
    to={to}
    data-testid={testid}
    className={({ isActive }) =>
      `flex flex-col items-center justify-center gap-0.5 py-3 px-2 rounded-lg transition-colors ${
        isActive ? 'bg-blue-600 text-white shadow-md' : 'text-slate-300 hover:bg-slate-700 hover:text-white'
      }`
    }
  >
    <div className="w-5 h-5">{icon}</div>
    <span className="text-[9px] font-semibold uppercase tracking-wider">{label}</span>
  </NavLink>
);

export default function AppShell({ children }) {
  const { user, clinic, logout } = useAuth();
  const { activeTest } = useTestContext();
  const navigate = useNavigate();

  return (
    <div className="h-screen w-screen flex bg-slate-100 overflow-hidden">
      {/* Left module nav */}
      <nav className="w-[84px] bg-slate-900 border-r border-slate-800 flex flex-col flex-shrink-0" data-testid="app-nav">
        <div className="px-2 py-3 border-b border-slate-800 flex items-center justify-center">
          <div className="w-9 h-9 rounded-lg bg-gradient-to-br from-blue-500 to-blue-700 flex items-center justify-center shadow">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
              <path d="M3 12 A9 9 0 0 1 21 12 V17 A3 3 0 0 1 18 20 H17 V13 H21" />
              <path d="M3 12 V17 A3 3 0 0 0 6 20 H7 V13 H3" />
            </svg>
          </div>
        </div>

        <div className="flex-1 overflow-auto p-1.5 space-y-1">
          <NavItem
            to="/frontdesk"
            testid="nav-frontdesk"
            label="Front Desk"
            icon={<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 12h18M3 6h18M3 18h12"/></svg>}
          />
          {user?.role !== 'audiologist' && (
            <NavItem
              to="/billing"
              testid="nav-billing"
              label="Billing"
              icon={<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M6 2h12v20l-3-2-3 2-3-2-3 2V2z"/><path d="M9 8h6M9 12h6M9 16h4"/></svg>}
            />
          )}
          <NavItem
            to="/test"
            testid="nav-test"
            label="Diagnostics"
            icon={<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 3v18h18M7 14l3-3 4 4 5-5"/></svg>}
          />
          <NavItem
            to="/reports"
            testid="nav-reports"
            label="Reports"
            icon={<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="8" y1="13" x2="16" y2="13"/><line x1="8" y1="17" x2="13" y2="17"/></svg>}
          />
        </div>

        <div className="p-1.5 border-t border-slate-800">
          <button
            onClick={() => { logout(); navigate('/login'); }}
            data-testid="nav-logout"
            title={`Sign out — ${user?.email}`}
            className="w-full flex flex-col items-center justify-center gap-0.5 py-2 text-slate-400 hover:text-red-400 hover:bg-slate-800 rounded-lg transition-colors"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>
            <span className="text-[9px] font-semibold">Sign Out</span>
          </button>
        </div>
      </nav>

      {/* Right content area */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Top bar */}
        <header className="h-11 bg-white border-b border-slate-200 flex items-center justify-between px-4 flex-shrink-0" data-testid="app-topbar">
          <div className="flex items-center gap-2">
            <span className="text-sm font-bold text-slate-800">{clinic?.name || 'ACS Clinic'}</span>
            {clinic?.city && <span className="text-[11px] text-slate-500">· {clinic.city}</span>}
          </div>

          <div className="flex items-center gap-3">
            {activeTest?.patient && (
              <div className="text-[11px] bg-amber-50 border border-amber-200 rounded px-2 py-0.5 text-amber-800" data-testid="active-test-badge">
                Active test: <b>{activeTest.patient.name}</b> · {activeTest.patient.mrd || activeTest.patient.patient_id}
              </div>
            )}
            <div className="text-xs text-slate-700">
              <span className="font-semibold">{user?.name}</span>
              <span className="ml-1.5 text-[10px] text-slate-500 uppercase tracking-wider">{(user?.role || '').replace('_', ' ')}</span>
            </div>
          </div>
        </header>

        {/* Module content */}
        <main className="flex-1 overflow-hidden bg-slate-50" data-testid="app-main">
          {children}
        </main>
      </div>
    </div>
  );
}
