/**
 * AUDINEXA Super Admin Panel — shell (Phase 14A)
 * Dark sidebar + light canvas. Own layout, not using clinic AppShell.
 */
import React from 'react';
import { Routes, Route, NavLink, Navigate, useNavigate } from 'react-router-dom';
import { useAuth } from '../../../AuthContext';
import {
  LayoutDashboard, Building2, CreditCard, DollarSign, Flame, ToggleLeft,
  LogOut, Search, ShieldCheck, Headphones, BarChart3, HeartPulse,
  Megaphone, Bell, FileClock, Settings, Users,
} from 'lucide-react';

import DashboardPage from './DashboardPage';
import TenantsPage from './TenantsPage';
import TenantDetailPage from './TenantDetailPage';
import SubscriptionsPage from './SubscriptionsPage';
import RevenuePage from './RevenuePage';
import LeadsPage from './LeadsPage';
import FeatureFlagsPage from './FeatureFlagsPage';
import SupportDeskPage from './SupportDeskPage';
import UsageAnalyticsPage from './UsageAnalyticsPage';
import SystemHealthPage from './SystemHealthPage';
import MarketingPage from './MarketingPage';
import NotificationsPage from './NotificationsPage';
import AuditLogPage from './AuditLogPage';
import SettingsPage from './SettingsPage';
import UsersRolesPage from './UsersRolesPage';

const NAV_GROUPS = [
  {
    label: 'Core',
    items: [
      { to: '/admin/dashboard', label: 'Dashboard', icon: LayoutDashboard, testid: 'nav-admin-dashboard' },
      { to: '/admin/tenants', label: 'Tenants', icon: Building2, testid: 'nav-admin-tenants' },
      { to: '/admin/subscriptions', label: 'Plans & Pricing', icon: CreditCard, testid: 'nav-admin-plans' },
      { to: '/admin/revenue', label: 'Revenue', icon: DollarSign, testid: 'nav-admin-revenue' },
    ],
  },
  {
    label: 'Growth',
    items: [
      { to: '/admin/leads', label: 'Leads / Trials', icon: Flame, testid: 'nav-admin-leads' },
      { to: '/admin/marketing', label: 'Marketing CRM', icon: Megaphone, testid: 'nav-admin-marketing' },
      { to: '/admin/features', label: 'Feature Flags', icon: ToggleLeft, testid: 'nav-admin-features' },
    ],
  },
  {
    label: 'Ops',
    items: [
      { to: '/admin/support', label: 'Support Desk', icon: Headphones, testid: 'nav-admin-support' },
      { to: '/admin/usage', label: 'Usage Analytics', icon: BarChart3, testid: 'nav-admin-usage' },
      { to: '/admin/system', label: 'System Health', icon: HeartPulse, testid: 'nav-admin-system' },
    ],
  },
  {
    label: 'Governance',
    items: [
      { to: '/admin/notifications', label: 'Notifications', icon: Bell, testid: 'nav-admin-notifications' },
      { to: '/admin/audit', label: 'Audit Logs', icon: FileClock, testid: 'nav-admin-audit' },
      { to: '/admin/users', label: 'Users & Roles', icon: Users, testid: 'nav-admin-users' },
      { to: '/admin/settings', label: 'Settings', icon: Settings, testid: 'nav-admin-settings' },
    ],
  },
];

export default function AdminPanel() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [mobileNavOpen, setMobileNavOpen] = React.useState(false);

  // Only internal-team roles allowed
  const allowed = ['founder', 'super_admin', 'sales_manager', 'support_agent', 'finance_manager', 'product_ops', 'read_only'];
  if (!user || !allowed.includes(user.role)) {
    return <Navigate to="/login" replace />;
  }

  const closeMobileNav = () => setMobileNavOpen(false);

  const sidebarInner = (
    <>
      <div className="px-5 py-5 border-b border-slate-800">
        <div className="flex items-center gap-2.5">
          <div className="w-9 h-9 rounded-lg bg-gradient-to-br from-indigo-500 to-fuchsia-600 flex items-center justify-center shadow-lg">
            <ShieldCheck size={18} className="text-white" strokeWidth={2.2} />
          </div>
          <div>
            <div className="text-[10px] uppercase tracking-[0.2em] text-indigo-300">Admin</div>
            <div className="text-[15px] font-bold">AUDINEXA</div>
          </div>
        </div>
      </div>

      <nav className="flex-1 overflow-auto py-3 px-2 space-y-2">
        {NAV_GROUPS.map((g) => (
          <div key={g.label}>
            <div className="text-[9px] uppercase tracking-[0.2em] text-slate-500 font-bold px-3 pt-2 pb-1">{g.label}</div>
            {g.items.map((n) => (
              <NavLink
                key={n.to}
                to={n.to}
                data-testid={n.testid}
                onClick={closeMobileNav}
                className={({ isActive }) =>
                  `flex items-center gap-3 px-3 py-1.5 rounded-md text-[13px] font-medium transition-colors ${
                    isActive
                      ? 'bg-indigo-600/20 text-white border-l-2 border-indigo-400'
                      : 'text-slate-400 hover:bg-slate-900 hover:text-white'
                  }`
                }
              >
                <n.icon size={14} strokeWidth={2} />
                <span>{n.label}</span>
              </NavLink>
            ))}
          </div>
        ))}
      </nav>

      <div className="px-4 py-3 border-t border-slate-800">
        <div className="flex items-center gap-2 mb-3">
          <div className="w-8 h-8 rounded-full bg-indigo-600 flex items-center justify-center text-white font-bold text-[13px]">
            {(user.name || user.email || '?').charAt(0).toUpperCase()}
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-[12px] font-semibold text-white truncate">{user.name || user.email}</div>
            <div className="text-[9px] uppercase tracking-wider text-indigo-300">{user.role.replace('_', ' ')}</div>
          </div>
        </div>
        <button
          onClick={() => { closeMobileNav(); logout(); navigate('/login'); }}
          className="w-full flex items-center justify-center gap-1.5 py-1.5 text-[11px] font-semibold text-slate-400 hover:text-white hover:bg-slate-900 rounded-md transition-colors"
          data-testid="admin-logout-btn"
        >
          <LogOut size={13} />
          Sign out
        </button>
      </div>
    </>
  );

  return (
    <div className="h-screen w-screen flex bg-slate-50 overflow-hidden" data-testid="admin-panel">
      {/* Dark sidebar — desktop/tablet */}
      <aside className="hidden md:flex w-[240px] bg-slate-950 text-slate-200 flex-col flex-shrink-0 border-r border-slate-800">
        {sidebarInner}
      </aside>

      {/* Mobile drawer */}
      {mobileNavOpen && (
        <div className="md:hidden fixed inset-0 z-50 flex">
          <button
            aria-label="Close navigation"
            onClick={closeMobileNav}
            className="absolute inset-0 bg-black/60"
            data-testid="admin-nav-backdrop"
          />
          <aside className="relative w-[240px] bg-slate-950 text-slate-200 flex flex-col flex-shrink-0 border-r border-slate-800 shadow-2xl" data-testid="admin-nav-mobile">
            {sidebarInner}
          </aside>
        </div>
      )}

      {/* Main content */}
      <div className="flex-1 flex flex-col min-w-0">
        <header className="h-14 bg-white border-b border-slate-200 flex items-center justify-between px-3 sm:px-6 flex-shrink-0 gap-2">
          <div className="flex items-center gap-2 sm:gap-3 min-w-0">
            <button
              onClick={() => setMobileNavOpen(true)}
              className="md:hidden p-1.5 -ml-1 text-slate-600 hover:bg-slate-100 rounded-md"
              data-testid="admin-mobile-nav-toggle"
              aria-label="Open navigation"
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/>
              </svg>
            </button>
            <div className="hidden sm:block text-xs text-slate-500">Founder Command Center</div>
            <span className="hidden sm:inline text-slate-300">/</span>
            <div className="text-xs font-semibold text-slate-700 truncate">{window.location.pathname.split('/').slice(-1)[0] || 'dashboard'}</div>
          </div>
          <div className="flex items-center gap-2 text-[12px] text-slate-500 flex-shrink-0">
            <Search size={14} />
            <span className="hidden lg:inline">Press <kbd className="mx-1 px-1.5 py-0.5 bg-slate-100 border border-slate-300 rounded text-[10px] font-mono">⌘K</kbd> to search</span>
          </div>
        </header>

        <main className="flex-1 overflow-auto bg-slate-50">
          <Routes>
            <Route path="/" element={<Navigate to="dashboard" replace />} />
            <Route path="dashboard" element={<DashboardPage />} />
            <Route path="tenants" element={<TenantsPage />} />
            <Route path="tenants/:clinicId" element={<TenantDetailPage />} />
            <Route path="subscriptions" element={<SubscriptionsPage />} />
            <Route path="revenue" element={<RevenuePage />} />
            <Route path="leads" element={<LeadsPage />} />
            <Route path="marketing" element={<MarketingPage />} />
            <Route path="features" element={<FeatureFlagsPage />} />
            <Route path="support" element={<SupportDeskPage />} />
            <Route path="usage" element={<UsageAnalyticsPage />} />
            <Route path="system" element={<SystemHealthPage />} />
            <Route path="notifications" element={<NotificationsPage />} />
            <Route path="audit" element={<AuditLogPage />} />
            <Route path="users" element={<UsersRolesPage />} />
            <Route path="settings" element={<SettingsPage />} />
            <Route path="*" element={<Navigate to="dashboard" replace />} />
          </Routes>
        </main>
      </div>
    </div>
  );
}
