import React, { useState, useEffect, useCallback } from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import axios from 'axios';
import {
  LayoutDashboard, Users, Receipt, Stethoscope, Headphones, Wrench,
  BarChart3, HeartPulse, Handshake, FileText, ChevronLeft, LogOut,
  Menu, Search as SearchIcon, Settings, Database,
} from 'lucide-react';
import { useAuth } from '../AuthContext';
import { useTestContext } from '../TestContext';
import CommandPalette from './CommandPalette';
import AppSwitcher from './AppSwitcher';
import { useSubscription } from '../SubscriptionContext';

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;
const COLLAPSED_KEY = 'acs.sidebar.collapsed';

// ================= Nav item =================
const NavItem = ({ to, Icon, label, testid, collapsed, onNavigate, badge }) => (
  <NavLink
    to={to}
    data-testid={testid}
    onClick={onNavigate}
    end={false}
    className={({ isActive }) =>
      `group flex items-center gap-3 px-3 py-2 rounded-lg text-[13px] font-medium transition-colors ${
        isActive
          ? 'bg-white/10 text-white shadow-inner'
          : 'text-slate-400 hover:bg-white/5 hover:text-white'
      }`
    }
    title={collapsed ? label : undefined}
  >
    <Icon size={17} strokeWidth={2} className="flex-shrink-0" />
    {!collapsed && <span className="truncate flex-1">{label}</span>}
    {!collapsed && badge && (
      <span className="px-1.5 py-0.5 text-[9px] font-bold bg-orange-500 text-white rounded-full">{badge}</span>
    )}
  </NavLink>
);

// ================= Tier badge =================
const TierBadge = ({ tier }) => {
  const colors = {
    BASIC:    'bg-sky-500/15 text-sky-300 ring-sky-500/30',
    STANDARD: 'bg-emerald-500/15 text-emerald-300 ring-emerald-500/30',
    PREMIUM:  'bg-gradient-to-r from-orange-500/25 to-fuchsia-500/25 text-orange-200 ring-orange-500/40',
  };
  const cls = colors[tier] || colors.BASIC;
  return (
    <span className={`inline-flex items-center gap-1 text-[9px] uppercase tracking-[0.2em] font-bold px-2 py-0.5 rounded ring-1 ${cls}`}>
      {tier || 'TRIAL'}
    </span>
  );
};

// ================= Shell =================
export default function AppShell({ children }) {
  const { user, clinic, logout } = useAuth();
  const { access, superAdminBypass, tier } = useSubscription();
  const { activeTest, clearActiveTest } = useTestContext();
  const navigate = useNavigate();

  const [paletteOpen, setPaletteOpen] = useState(false);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(() => {
    try { return localStorage.getItem(COLLAPSED_KEY) === '1'; } catch { return false; }
  });
  const [unreadCloseout, setUnreadCloseout] = useState(null);
  const [pendingReports, setPendingReports] = useState(0);

  useEffect(() => {
    try { localStorage.setItem(COLLAPSED_KEY, collapsed ? '1' : '0'); } catch { /* ignore */ }
  }, [collapsed]);

  const canSeeCloseout = user?.role === 'super_admin' || user?.role === 'accounts';
  const fetchCloseout = useCallback(async () => {
    if (!canSeeCloseout) { setUnreadCloseout(null); return; }
    try {
      const r = await axios.get(`${API}/closeouts/latest`);
      setUnreadCloseout(r.data?.read === false ? r.data : null);
    } catch (err) {
      // Closeout fetch is a background poll — log but don't block the UI.
      if (err?.response?.status !== 404) console.warn('[AppShell] closeout fetch failed:', err?.message);
    }
  }, [canSeeCloseout]);
  useEffect(() => {
    fetchCloseout();
    if (!canSeeCloseout) return;
    const iv = setInterval(fetchCloseout, 60000);
    return () => clearInterval(iv);
  }, [fetchCloseout, canSeeCloseout]);

  // Pending-reports badge (visible to everyone who sees the Reports nav entry)
  const fetchPendingReports = useCallback(async () => {
    try {
      const r = await axios.get(`${API}/reports/pending-count`);
      setPendingReports(Number(r.data?.pending) || 0);
    } catch (err) {
      if (err?.response?.status !== 404) console.warn('[AppShell] pending-count failed:', err?.message);
    }
  }, []);
  useEffect(() => {
    if (!user) return;
    fetchPendingReports();
    const iv = setInterval(fetchPendingReports, 60000);
    return () => clearInterval(iv);
  }, [fetchPendingReports, user]);

  // Auto-clear the global "Active test" badge if the session has already moved past
  // the audiologist (test_completed / printed / handed_over / completed). Guards against
  // the chip lingering when the audiologist completed the test on a different tab
  // or when the user navigated away mid-save.
  useEffect(() => {
    const sid = activeTest?.sessionId;
    if (!sid) return;
    let cancelled = false;
    (async () => {
      try {
        const r = await axios.get(`${API}/sessions/${sid}`);
        if (cancelled) return;
        const rs = r.data?.report_status;
        if (rs && rs !== 'draft') {
          clearActiveTest();
        }
      } catch (err) {
        // 404 → session no longer exists; clear stale chip too
        if (err?.response?.status === 404) clearActiveTest();
      }
    })();
    return () => { cancelled = true; };
  }, [activeTest?.sessionId, clearActiveTest]);

  const closeMobileNav = useCallback(() => setMobileNavOpen(false), []);

  // Keyboard shortcuts
  useEffect(() => {
    const handler = (e) => {
      const inField = ['INPUT','TEXTAREA','SELECT'].includes(document.activeElement?.tagName)
        || document.activeElement?.isContentEditable;
      const meta = e.metaKey || e.ctrlKey;
      if (meta && e.key.toLowerCase() === 'k') { e.preventDefault(); setPaletteOpen((o) => !o); return; }
      if (meta && e.key.toLowerCase() === 'b') { e.preventDefault(); setCollapsed((c) => !c); return; }
      if (inField) return;
      if (!meta && !e.altKey) {
        const k = e.key.toLowerCase();
        const map = { n: '/frontdesk/new', a: '/frontdesk/appointments', i: '/billing/new', r: '/frontdesk/returning', d: '/frontdesk', q: '/frontdesk/queue' };
        if (map[k]) { e.preventDefault(); navigate(map[k]); }
        if (k === '/') { e.preventDefault(); setPaletteOpen(true); }
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [navigate]);

  // ================= Nav structure =================
  const sections = [
    {
      label: 'Clinic',
      items: [
        { to: '/frontdesk', Icon: Users, label: 'Front Desk', testid: 'nav-frontdesk' },
        (user?.role !== 'audiologist') && { to: '/billing', Icon: Receipt, label: 'Billing', testid: 'nav-billing' },
        { to: '/test', Icon: Stethoscope, label: 'Diagnostics', testid: 'nav-test' },
      ].filter(Boolean),
    },
    {
      label: 'Commerce',
      items: [
        (user?.role !== 'audiologist') && (superAdminBypass || access['hearing-aids']) &&
          { to: '/ha', Icon: Headphones, label: 'Hearing Aids', testid: 'nav-ha' },
        (user?.role !== 'audiologist') && (superAdminBypass || access['repair']) &&
          { to: '/repair', Icon: Wrench, label: 'Service & Repair', testid: 'nav-repair' },
      ].filter(Boolean),
    },
    {
      label: 'Insights',
      items: [
        (user?.role !== 'audiologist') && (superAdminBypass || access['analytics']) &&
          { to: '/ha/analytics', Icon: BarChart3, label: 'Owner Analytics', testid: 'nav-analytics' },
        (user?.role !== 'audiologist') && (superAdminBypass || access['analytics']) &&
          { to: '/analytics/clinical', Icon: HeartPulse, label: 'Clinical Analytics', testid: 'nav-clinical-analytics' },
        (user?.role !== 'audiologist') && (superAdminBypass || access['referral-partners']) &&
          { to: '/partners', Icon: Handshake, label: 'Referral Partners', testid: 'nav-partners' },
        { to: '/reports', Icon: FileText, label: 'Reports', testid: 'nav-reports', badge: pendingReports > 0 ? pendingReports : null },
      ].filter(Boolean),
    },
    user?.role === 'super_admin' && {
      label: 'Admin',
      items: [
        { to: '/admin/clinics', Icon: Settings, label: 'Clinics Admin', testid: 'nav-admin' },
        { to: '/data-export', Icon: Database, label: 'Data Export', testid: 'nav-data-export' },
      ],
    },
    // Separate "Data" section for non-super-admin roles that can still export
    user?.role !== 'super_admin' && ['clinic_owner', 'accounts', 'founder'].includes(user?.role) && {
      label: 'Data',
      items: [
        { to: '/data-export', Icon: Database, label: 'Data Export', testid: 'nav-data-export' },
      ],
    },
  ].filter(Boolean);

  const sideWidth = collapsed ? 'w-[64px]' : 'w-[220px]';

  const navInner = (
    <>
      {/* Brand */}
      <div className={`px-3 py-4 border-b border-white/10 flex items-center ${collapsed ? 'justify-center' : 'gap-2.5'}`}>
        <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-orange-500 to-rose-600 flex items-center justify-center font-black text-white text-sm flex-shrink-0 shadow-lg shadow-orange-500/30">
          A
        </div>
        {!collapsed && (
          <div className="flex-1 min-w-0">
            <div className="text-[15px] font-black tracking-tight text-white leading-none">AUDINEXA</div>
            <div className="text-[9px] uppercase tracking-widest text-orange-300 mt-0.5">Clinic OS</div>
          </div>
        )}
      </div>

      {/* Clinic card */}
      <div className={`px-3 py-3 border-b border-white/10 ${collapsed ? 'flex justify-center' : ''}`}>
        {collapsed ? (
          <div
            title={`${clinic?.name || ''}\n${tier || ''}`}
            className="w-8 h-8 rounded-lg bg-white/5 ring-1 ring-white/10 flex items-center justify-center text-[11px] font-bold text-white"
          >
            {(clinic?.name || 'C').charAt(0).toUpperCase()}
          </div>
        ) : (
          <div>
            <div className="text-[10px] uppercase tracking-wider text-slate-500 font-bold mb-1">Clinic</div>
            <div className="text-[13px] font-bold text-white truncate leading-tight">{clinic?.name || '—'}</div>
            <div className="flex items-center justify-between mt-1.5">
              <span className="text-[10px] text-slate-400 truncate">{clinic?.city || ''}</span>
              <TierBadge tier={tier} />
            </div>
          </div>
        )}
      </div>

      {/* Nav sections */}
      <div className="flex-1 overflow-auto py-3 px-2 space-y-4">
        {sections.map((s) => (
          <div key={s.label}>
            {!collapsed && (
              <div className="text-[9px] uppercase tracking-[0.18em] text-slate-500 font-bold px-3 mb-1">{s.label}</div>
            )}
            <div className="space-y-0.5">
              {s.items.map((item) => (
                <NavItem key={item.to} {...item} collapsed={collapsed} onNavigate={closeMobileNav} />
              ))}
            </div>
          </div>
        ))}
      </div>

      {/* Footer: user + logout */}
      <div className="border-t border-white/10 p-2 space-y-1">
        {!collapsed ? (
          <div className="flex items-center gap-2 px-2 py-1.5 rounded-lg">
            <div className="w-8 h-8 rounded-full bg-gradient-to-br from-indigo-400 to-sky-500 flex items-center justify-center text-white font-bold text-xs flex-shrink-0">
              {(user?.name || user?.email || '?').charAt(0).toUpperCase()}
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-[12px] font-semibold text-white truncate">{user?.name || user?.email}</div>
              <div className="text-[9px] uppercase tracking-wider text-slate-400">{(user?.role || '').replace('_', ' ')}</div>
            </div>
          </div>
        ) : (
          <div className="flex justify-center py-1.5" title={user?.name || user?.email}>
            <div className="w-8 h-8 rounded-full bg-gradient-to-br from-indigo-400 to-sky-500 flex items-center justify-center text-white font-bold text-xs">
              {(user?.name || user?.email || '?').charAt(0).toUpperCase()}
            </div>
          </div>
        )}
        <button
          onClick={() => { closeMobileNav(); logout(); navigate('/login'); }}
          data-testid="nav-logout"
          className={`w-full flex items-center gap-3 px-3 py-2 text-[12px] font-semibold text-slate-400 hover:text-rose-300 hover:bg-white/5 rounded-lg transition-colors ${collapsed ? 'justify-center' : ''}`}
          title={collapsed ? 'Sign out' : undefined}
        >
          <LogOut size={15} />
          {!collapsed && <span>Sign out</span>}
        </button>
        {/* Desktop collapse toggle */}
        <button
          onClick={() => setCollapsed((c) => !c)}
          data-testid="nav-collapse"
          className={`hidden md:flex w-full items-center gap-3 px-3 py-1.5 text-[11px] font-semibold text-slate-500 hover:text-slate-300 hover:bg-white/5 rounded-lg transition-colors ${collapsed ? 'justify-center' : ''}`}
          title={collapsed ? 'Expand sidebar (Ctrl+B)' : 'Collapse sidebar (Ctrl+B)'}
        >
          <ChevronLeft size={14} className={`transition-transform ${collapsed ? 'rotate-180' : ''}`} />
          {!collapsed && <span>Collapse</span>}
        </button>
      </div>
    </>
  );

  return (
    <div className="h-screen w-screen flex bg-slate-100 overflow-hidden">
      {/* Desktop / tablet sidebar */}
      <nav
        className={`hidden md:flex ${sideWidth} bg-slate-950 text-slate-200 flex-col flex-shrink-0 border-r border-slate-800 transition-[width] duration-200`}
        data-testid="app-nav"
      >
        {navInner}
      </nav>

      {/* Mobile drawer */}
      {mobileNavOpen && (
        <div className="md:hidden fixed inset-0 z-50 flex">
          <button
            aria-label="Close navigation"
            onClick={closeMobileNav}
            className="absolute inset-0 bg-black/50"
            data-testid="mobile-nav-backdrop"
          />
          <nav
            className="relative w-[220px] bg-slate-950 text-slate-200 flex flex-col flex-shrink-0 shadow-2xl"
            data-testid="app-nav-mobile"
          >
            {navInner}
          </nav>
        </div>
      )}

      {/* Content area */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Top bar */}
        <header className="h-12 bg-white border-b border-slate-200 flex items-center justify-between px-2 sm:px-4 flex-shrink-0 gap-2" data-testid="app-topbar">
          <div className="flex items-center gap-2 min-w-0">
            <button
              onClick={() => setMobileNavOpen(true)}
              data-testid="mobile-nav-toggle"
              className="md:hidden p-1.5 -ml-1 text-slate-600 hover:bg-slate-100 rounded-md"
              aria-label="Open navigation"
            >
              <Menu size={18} />
            </button>
            {activeTest?.patient && (
              <div
                className="hidden lg:flex items-center gap-1.5 text-[11px] bg-amber-50 border border-amber-200 rounded px-2 py-0.5 text-amber-800"
                data-testid="active-test-badge"
              >
                <span>
                  Active test: <b>{activeTest.patient.name}</b> · {activeTest.patient.mrd || activeTest.patient.patient_id}
                </span>
                <button
                  type="button"
                  onClick={clearActiveTest}
                  data-testid="active-test-dismiss"
                  title="Dismiss — I'm done with this session"
                  className="text-amber-500 hover:text-amber-900 hover:bg-amber-100 rounded-full w-4 h-4 flex items-center justify-center text-[10px] font-bold leading-none transition-colors"
                >
                  ×
                </button>
              </div>
            )}
          </div>

          <div className="flex items-center gap-2 sm:gap-3 flex-shrink-0">
            <button
              onClick={() => setPaletteOpen(true)}
              data-testid="cmdk-trigger"
              title="Command palette (Cmd/Ctrl+K)"
              className="hidden md:flex items-center gap-2 text-[11px] text-slate-500 hover:text-slate-800 bg-slate-50 hover:bg-slate-100 border border-slate-200 rounded-md px-2.5 py-1 transition-colors"
            >
              <SearchIcon size={12} />
              <span>Search…</span>
              <span className="ml-2 font-mono bg-white border border-slate-300 text-slate-600 rounded px-1 text-[9px]">⌘K</span>
            </button>
            {canSeeCloseout && unreadCloseout && (
              <button
                onClick={() => navigate('/frontdesk/closeout')}
                data-testid="closeout-bell"
                title={`Close-out for ${unreadCloseout.date} is ready`}
                className="relative flex items-center gap-1 text-[10px] font-bold text-white bg-blue-600 hover:bg-blue-700 rounded-md px-2 py-1 shadow-sm transition-transform hover:scale-105"
              >
                <span className="text-sm">📊</span>
                <span className="hidden lg:inline">Day Close-out Ready</span>
                <span className="absolute -top-0.5 -right-0.5 w-2 h-2 bg-rose-500 rounded-full ring-2 ring-white animate-pulse" />
              </button>
            )}
            <AppSwitcher />
          </div>
        </header>

        {/* Content */}
        <main className="flex-1 overflow-auto bg-slate-50" data-testid="app-main">
          {children}
        </main>
      </div>

      <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} />
    </div>
  );
}
