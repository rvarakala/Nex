import React, { useState, useEffect, useCallback } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import axios from 'axios';
import {
  LayoutDashboard, Users, Receipt, Stethoscope, Headphones, Wrench,
  BarChart3, ChevronLeft, LogOut,
  Menu, Search as SearchIcon, Settings, Database, LifeBuoy,
  Calendar, CalendarDays, BookOpen, RotateCcw, UserPlus, UserSquare2,
  Package, Tag, IndianRupee, Bell, MessageSquare, HelpCircle, ChevronDown,
} from 'lucide-react';
import { useAuth } from '../AuthContext';
import ClinicSwitcher from './ClinicSwitcher';
import { useTestContext } from '../TestContext';
import CommandPalette from './CommandPalette';
import SignatureNudgeBanner from './SignatureNudgeBanner';
import AppSwitcher from './AppSwitcher';
import { useSubscription } from '../SubscriptionContext';
import ConnectivityIndicator from '../connectivity/ConnectivityIndicator';
import OfflineBanner from '../connectivity/OfflineBanner';
import InstallPrompt from '../connectivity/InstallPrompt';
import IdleLogout from '../connectivity/IdleLogout';
import { SyncPill, SyncDrawer } from '../connectivity/SyncDashboard';
import ClinicStatusToggle from '../components/ClinicStatusToggle';
import UpdateAvailableToast from '../components/UpdateAvailableToast';
import WhatsNewModal from '../components/WhatsNewModal';

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;
const COLLAPSED_KEY = 'acs.sidebar.collapsed';
const INTERNAL_ADMIN_ROLES = ['founder', 'super_admin', 'sales_manager', 'support_agent', 'finance_manager', 'product_ops', 'read_only'];

// ================= Nav item =================
// Custom matcher (replaces NavLink) so that:
//  • Items sharing a path but different query strings (Patients vs
//    Follow Ups vs Leads — all under /patients/list) don't all light up
//    at once.
//  • `exact` items (Dashboard /patients, Patients /patients/list) only
//    match when no filter query is present, so their child / filtered
//    siblings can claim the active state instead.
//  • Other items keep prefix-matching so deep child routes (e.g.
//    /test/queue under /test) still highlight the parent.
const NavItem = ({ to, Icon, label, testid, collapsed, onNavigate, badge, exact = false }) => {
  const location = useLocation();
  const [toPath, toSearch = ''] = to.split('?');

  let isActive = false;
  if (toSearch) {
    // Must match path exactly AND every query param the link declared.
    const want = new URLSearchParams(toSearch);
    const cur = new URLSearchParams(location.search);
    isActive = location.pathname === toPath
      && Array.from(want).every(([k, v]) => cur.get(k) === v);
  } else if (exact) {
    // Path exact + no `filter=` query (so filtered siblings win).
    isActive = location.pathname === toPath && !location.search.includes('filter=');
  } else {
    isActive = location.pathname === toPath
      || location.pathname.startsWith(toPath + '/');
  }

  return (
    <Link
      to={to}
      data-testid={testid}
      onClick={onNavigate}
      // Active row uses a high-contrast white pill on the deep-navy rail —
      // matches the SoundCare reference. Inactive rows are slate-300 with
      // slate-700 hover background; subtle, premium, scannable.
      className={`group flex items-center gap-3 px-3 py-2.5 rounded-lg text-[13px] font-medium transition-colors ${
        isActive
          ? 'bg-white text-slate-900 shadow-sm shadow-black/30'
          : 'text-slate-300 hover:bg-slate-800/60 hover:text-white'
      }`}
      title={collapsed ? label : undefined}
    >
      <Icon size={17} strokeWidth={2} className="flex-shrink-0" />
      {!collapsed && <span className="truncate flex-1">{label}</span>}
      {!collapsed && badge && (
        <span className="px-1.5 py-0.5 text-[9px] font-bold bg-orange-500 text-white rounded-full">{badge}</span>
      )}
    </Link>
  );
};

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
  const [syncOpen, setSyncOpen] = useState(false);
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(() => {
    try { return localStorage.getItem(COLLAPSED_KEY) === '1'; } catch { return false; }
  });
  const [unreadCloseout, setUnreadCloseout] = useState(null);
  const [pendingReports, setPendingReports] = useState(0);
  const [careOpenCount, setCareOpenCount] = useState(0);

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

  // AUDINEXA Care badge — open ticket count for the clinic side.
  const showCareBadge = user && !INTERNAL_ADMIN_ROLES.includes(user?.role) && user?.role !== 'referral_partner';
  const fetchCareCount = useCallback(async () => {
    if (!showCareBadge) { setCareOpenCount(0); return; }
    try {
      const r = await axios.get(`${API}/care/tickets`);
      setCareOpenCount(Number(r.data?.open_count) || 0);
    } catch (err) {
      if (err?.response?.status !== 404) console.warn('[AppShell] care-count failed:', err?.message);
    }
  }, [showCareBadge]);
  useEffect(() => {
    if (!user) return;
    fetchCareCount();
    const iv = setInterval(fetchCareCount, 90000);
    return () => clearInterval(iv);
  }, [fetchCareCount, user]);

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
        const map = { n: '/patients', a: '/patients/appointments', i: '/billing/new', r: '/patients', d: '/patients', q: '/test/queue' };
        if (map[k]) { e.preventDefault(); navigate(map[k]); }
        if (k === '/') { e.preventDefault(); setPaletteOpen(true); }
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [navigate]);

  // ================= Nav structure (SoundCare-style grouping) =================
  // Sections mirror the user's reference layout: Dashboard at top (no group
  // header), then APPOINTMENTS / REGISTRATION / MANAGE / BILLING / REPORTS /
  // OTHER. Items are gated by tier + role just like before; module-flag access
  // checks (e.g. `access['hearing-aids']`) survive untouched.
  const isAudio = user?.role === 'audiologist';
  const isOwnerOrAdmin = ['clinic_owner', 'super_admin', 'founder'].includes(user?.role);
  const m = (k) => superAdminBypass || access[k];          // shorthand for module access

  const sections = [
    {
      // Dashboard sits in its own ungrouped row at the top — no header
      label: '',
      items: [
        { to: '/patients', Icon: LayoutDashboard, label: 'Dashboard', testid: 'nav-dashboard', exact: true,
          badge: pendingReports > 0 ? pendingReports : null },
      ].filter(Boolean),
    },
    {
      label: 'Appointments',
      items: [
        { to: '/patients/appointments', Icon: Calendar, label: 'Appointments', testid: 'nav-appointments' },
        { to: '/appointments',           Icon: CalendarDays, label: 'Calendar',     testid: 'nav-calendar' },
        isOwnerOrAdmin &&
          { to: '/settings/staff-schedule', Icon: BookOpen, label: 'Doctor Schedule', testid: 'nav-doctor-schedule' },
        { to: '/patients/list?filter=recall', Icon: RotateCcw, label: 'Follow Ups & Recall', testid: 'nav-followups' },
      ].filter(Boolean),
    },
    {
      label: 'Registration',
      items: [
        { to: '/patients/new',   Icon: UserPlus,    label: 'New Registration', testid: 'nav-new-registration', exact: true },
        { to: '/patients/list',  Icon: Users,       label: 'Patients',         testid: 'nav-patients',         exact: true },
        !isAudio &&
          { to: '/patients/list?filter=leads', Icon: UserSquare2, label: 'Leads & Walk-ins', testid: 'nav-leads' },
      ].filter(Boolean),
    },
    {
      label: 'Manage',
      items: [
        { to: '/test', Icon: Stethoscope, label: 'Hearing Tests', testid: 'nav-test' },
        !isAudio && m('hearing-aids') &&
          { to: '/ha',           Icon: Headphones, label: 'Hearing Aids', testid: 'nav-ha' },
        !isAudio && m('hearing-aids') &&
          { to: '/ha/inventory', Icon: Package,    label: 'Inventory',    testid: 'nav-inventory' },
        isOwnerOrAdmin &&
          { to: '/settings/services', Icon: Tag, label: 'Services & Packages', testid: 'nav-services' },
        !isAudio && m('repair') &&
          { to: '/repair', Icon: Wrench, label: 'Service & Repair', testid: 'nav-repair' },
      ].filter(Boolean),
    },
    !isAudio && {
      label: 'Billing',
      items: [
        { to: '/billing',         Icon: Receipt,      label: 'Invoices',          testid: 'nav-billing' },
        { to: '/billing/payments', Icon: IndianRupee, label: 'Payments & Refunds', testid: 'nav-payments' },
      ].filter(Boolean),
    },
    !isAudio && m('analytics') && {
      label: 'Reports',
      items: [
        { to: '/ha/analytics',       Icon: BarChart3, label: 'Reports & Analytics', testid: 'nav-analytics' },
      ].filter(Boolean),
    },
    {
      label: 'Other',
      items: [
        isOwnerOrAdmin &&
          { to: '/settings/clinic', Icon: Settings, label: 'Settings', testid: 'nav-settings' },
        ['clinic_owner', 'accounts', 'founder'].includes(user?.role) &&
          { to: '/data-export',     Icon: Database, label: 'Data Export', testid: 'nav-data-export' },
        user?.role === 'super_admin' &&
          { to: '/admin/clinics',   Icon: Settings, label: 'Clinics Admin', testid: 'nav-admin' },
        user && !INTERNAL_ADMIN_ROLES.includes(user?.role) && user?.role !== 'referral_partner' &&
          { to: '/care', Icon: LifeBuoy, label: 'AUDINEXA Care', testid: 'nav-care',
            badge: careOpenCount > 0 ? careOpenCount : null },
      ].filter(Boolean),
    },
  ].filter(Boolean).filter((s) => s.items.length > 0);

  const sideWidth = collapsed ? 'w-[64px]' : 'w-[248px]';

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
        <div className="mt-2">
          <ClinicSwitcher collapsed={collapsed} />
        </div>
      </div>

      {/* Nav sections */}
      <div className="flex-1 overflow-y-auto py-3 px-2 space-y-3 nav-scrollbar">
        {sections.map((s, idx) => (
          <div key={s.label || `__top_${idx}`}>
            {!collapsed && s.label && (
              <div className="text-[10px] uppercase tracking-[0.18em] text-slate-500 font-bold px-3 mb-1.5 mt-2">{s.label}</div>
            )}
            <div className="space-y-0.5">
              {s.items.map((item) => (
                <NavItem key={item.to + item.label} {...item} collapsed={collapsed} onNavigate={closeMobileNav} />
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

          <div className="flex items-center gap-1 sm:gap-2 flex-shrink-0">
            <UpdateAvailableToast />
            {/* Reference-style top bar — bell, chat, help, avatar.
                We retain the command-palette trigger (essential power-user
                shortcut) and online connectivity dot since both are operational
                signals; the rest of the noisier widgets (clinic status toggle,
                day-close-out bell, sync pill, app switcher) are now reachable
                from the sidebar / settings instead. */}
            <button
              onClick={() => setPaletteOpen(true)}
              data-testid="cmdk-trigger"
              title="Search (Cmd/Ctrl+K)"
              className="hidden md:flex items-center gap-2 text-[12px] text-slate-500 hover:text-slate-800 bg-slate-50 hover:bg-slate-100 border border-slate-200 rounded-md px-3 py-1.5 transition-colors"
            >
              <SearchIcon size={13} />
              <span className="hidden lg:inline">Search…</span>
              <span className="ml-1 font-mono bg-white border border-slate-300 text-slate-600 rounded px-1 text-[10px]">⌘K</span>
            </button>
            <ConnectivityIndicator />
            <button
              onClick={() => navigate('/care')}
              data-testid="topbar-bell"
              title="Notifications"
              className="relative p-2 text-slate-600 hover:bg-slate-100 rounded-lg"
            >
              <Bell size={17} />
              {careOpenCount > 0 && (
                <span className="absolute top-1 right-1 w-2 h-2 bg-rose-500 rounded-full ring-2 ring-white" />
              )}
            </button>
            <button
              onClick={() => navigate('/care')}
              data-testid="topbar-chat"
              title="AUDINEXA Care · Support inbox"
              className="hidden sm:inline-flex p-2 text-slate-600 hover:bg-slate-100 rounded-lg"
            >
              <MessageSquare size={17} />
            </button>
            <button
              onClick={() => window.open('https://audinexa.com/help', '_blank', 'noopener,noreferrer')}
              data-testid="topbar-help"
              title="Help & docs"
              className="hidden sm:inline-flex p-2 text-slate-600 hover:bg-slate-100 rounded-lg"
            >
              <HelpCircle size={17} />
            </button>
            <button
              onClick={() => setUserMenuOpen((o) => !o)}
              data-testid="topbar-avatar"
              title={user?.name || user?.email}
              className="flex items-center gap-1.5 pl-1 pr-1.5 py-1 hover:bg-slate-100 rounded-full transition-colors"
            >
              <span className="w-8 h-8 rounded-full bg-gradient-to-br from-indigo-500 to-sky-600 text-white font-bold text-[12px] flex items-center justify-center">
                {(user?.name || user?.email || '?').charAt(0).toUpperCase()}
              </span>
              <ChevronDown size={13} className="text-slate-400" />
            </button>
            {userMenuOpen && (
              <>
                {/* Backdrop closes the menu on outside click */}
                <button
                  className="fixed inset-0 z-40"
                  aria-label="Close menu"
                  onClick={() => setUserMenuOpen(false)}
                />
                <div
                  className="absolute right-3 top-12 z-50 w-56 bg-white border border-slate-200 rounded-lg shadow-lg p-2"
                  data-testid="topbar-user-menu"
                >
                  <div className="px-3 py-2 border-b border-slate-100 mb-1">
                    <div className="text-[12.5px] font-semibold text-slate-800 truncate">{user?.name || user?.email}</div>
                    <div className="text-[10.5px] uppercase tracking-wider text-slate-400">{(user?.role || '').replace('_', ' ')}</div>
                    {clinic?.name && (
                      <div className="text-[11px] text-slate-500 mt-0.5 truncate">{clinic.name}</div>
                    )}
                  </div>
                  <button
                    onClick={() => { setUserMenuOpen(false); navigate('/settings/clinic'); }}
                    className="w-full text-left text-[12.5px] px-3 py-1.5 text-slate-700 hover:bg-slate-50 rounded-md"
                    data-testid="topbar-menu-settings"
                  >
                    Settings
                  </button>
                  <ClinicSwitcher inline collapsed={false} />
                  <button
                    onClick={() => { setUserMenuOpen(false); logout(); navigate('/login'); }}
                    className="w-full text-left text-[12.5px] px-3 py-1.5 text-rose-600 hover:bg-rose-50 rounded-md"
                    data-testid="topbar-menu-signout"
                  >
                    Sign out
                  </button>
                </div>
              </>
            )}
          </div>
        </header>

        {/* Content */}
        <main className="flex-1 overflow-auto bg-slate-50" data-testid="app-main">
          <OfflineBanner />
          <SignatureNudgeBanner />
          {children}
        </main>
      </div>

      {/* PWA install prompt — only renders for signed-in users on eligible browsers */}
      <InstallPrompt />

      {/* Idle auto-logout — invisible component, signs out after role-based timeout */}
      <IdleLogout />

      <SyncDrawer open={syncOpen} onClose={() => setSyncOpen(false)} />

      <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} />
      <WhatsNewModal />
    </div>
  );
}
