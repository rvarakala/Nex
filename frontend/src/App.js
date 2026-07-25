import React from 'react';
import '@/App.css';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';import { AuthProvider, useAuth } from './AuthContext';
import { SubscriptionProvider, ModuleGate } from './SubscriptionContext';
import { TestContextProvider } from './TestContext';
import { ProtectedRoute } from './shell/ProtectedRoute';
import AppShell from './shell/AppShell';
import LoginPage from './pages/LoginPage';
import ForgotPasswordPage from './pages/ForgotPasswordPage';
import ResetPasswordPage from './pages/ResetPasswordPage';
import TokenPrintView from './pages/TokenPrintView';
import QueueTVPage from './pages/QueueTVPage';
import LandingPage from './modules/landing/v2/LandingPage';
import SignupPage from './modules/landing/SignupPage';
import BillingModule from './modules/billing/BillingModule';
import AccountsRevenuePage from './modules/accounts/AccountsRevenuePage';
import CompliancePolicyPack from './modules/compliance/CompliancePolicyPack';
import TestProceduresModule from './modules/test/TestProceduresModule';
import HAModule from './modules/ha/HAModule';
import RepairModule from './modules/repair/RepairModule';
import AdminPanel from './modules/admin/panel/AdminPanel';
import SettingsModule from './modules/settings/SettingsModule';
import ClinicalAnalyticsPage from './modules/admin/ClinicalAnalyticsPage';
import ReferralPartnersPage from './modules/admin/ReferralPartnersPage';
import ReferralCornerPage from './modules/referrals/ReferralCornerPage';
import PartnerPortalPage from './modules/partner/PartnerPortalPage';
import DashboardCompactPreview from './modules/patients/DashboardMockups';
import PatientPortal from './modules/patient/PatientPortal';
import DataExportPage from './modules/data/DataExportPage';
import ReportsModule from './modules/reports/ReportsModule';
import AppointmentsCalendarPage from './modules/appointments/AppointmentsCalendarPage';
import { usePageViewTracker } from './hooks/usePageViewTracker';
import { useDocumentTitle } from './hooks/useDocumentTitle';
import TopProgressBar from './components/TopProgressBar';
import { ConnectivityProvider } from './connectivity/ConnectivityContext';
import { VaultProvider } from './crypto/VaultContext';
import VaultDemoPage from './modules/settings/VaultDemoPage';
import InviteAcceptPage from './modules/auth/InviteAcceptPage';
import AudinexaCarePage from './modules/care/AudinexaCarePage';
import LegalPage from './modules/legal/LegalPage';
import PatientsModule from './modules/patients/PatientsModule';
import CloseoutPage from './modules/closeout/CloseoutPage';
import StatusPage from './pages/StatusPage';

// Post-login redirect by role
const INTERNAL_ADMIN_ROLES = ['founder', 'super_admin', 'sales_manager', 'support_agent', 'finance_manager', 'product_ops', 'read_only'];
const PostLoginRedirect = () => {
  const { user } = useAuth();
  if (!user) return <Navigate to="/login" replace />;
  if (INTERNAL_ADMIN_ROLES.includes(user.role)) return <Navigate to="/admin/dashboard" replace />;
  if (user.role === 'referral_partner') return <Navigate to="/partner" replace />;
  if (user.role === 'audiologist') return <Navigate to="/test" replace />;
  return <Navigate to="/patients" replace />;
};

const ShelledRoute = ({ children }) => {
  return (
    <ProtectedRoute>
      <PartnerRedirect>
        <AppShell>{children}</AppShell>
      </PartnerRedirect>
    </ProtectedRoute>
  );
};

const PartnerRedirect = ({ children }) => {
  const { user } = useAuth();
  if (user?.role === 'referral_partner') return <Navigate to="/partner" replace />;
  return children;
};

function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <SubscriptionProvider>
          <ConnectivityProvider>
            <TestContextProvider>
              <VaultGuardedRoutes />
            </TestContextProvider>
          </ConnectivityProvider>
        </SubscriptionProvider>
      </AuthProvider>
    </BrowserRouter>
  );
}

// Wraps routes in VaultProvider once auth state is known. Vault hydration
// only fires for authenticated users to avoid a status-check storm on the
// public landing page.
function VaultGuardedRoutes() {
  const { user } = useAuth();
  return (
    <VaultProvider isAuthed={!!user}>
      <AppRoutes />
    </VaultProvider>
  );
}

function AppRoutes() {
  // Track page views on every route change (authenticated users only)
  usePageViewTracker();
  // Update browser tab title
  useDocumentTitle();
  return (
    <>
      <TopProgressBar />
      <Routes>
              {/* PUBLIC */}
              <Route path="/" element={<LandingPage />} />
              <Route path="/signup" element={<SignupPage />} />
              <Route path="/login" element={<LoginPage />} />
              <Route path="/forgot-password" element={<ForgotPasswordPage />} />
              <Route path="/reset-password/:token" element={<ResetPasswordPage />} />
              <Route path="/invite/:token" element={<InviteAcceptPage />} />
              <Route path="/queue/:clinicId" element={<QueueTVPage />} />
              <Route path="/patient-portal" element={<PatientPortal />} />
              <Route path="/patient-portal/:clinicId" element={<PatientPortal />} />
              <Route path="/status" element={<StatusPage />} />

              {/* PUBLIC LEGAL — required for Razorpay / payment gateway KYC */}
              <Route path="/terms" element={<LegalPage />} />
              <Route path="/privacy" element={<LegalPage />} />
              <Route path="/refund" element={<LegalPage />} />
              <Route path="/contact" element={<LegalPage />} />

              {/* AUTHENTICATED */}
              <Route path="/app" element={<PostLoginRedirect />} />
              <Route path="/token/:tokenId" element={<ProtectedRoute><TokenPrintView /></ProtectedRoute>} />

              {/* PARTNER (own shell — no AppShell) */}
              <Route path="/partner" element={<ProtectedRoute><PartnerPortalPage /></ProtectedRoute>} />

              <Route path="/frontdesk/*" element={<Navigate to="/patients" replace />} />
              <Route path="/closeout" element={
                <ShelledRoute><CloseoutPage /></ShelledRoute>
              } />
              <Route path="/patients/*" element={
                <ShelledRoute><PatientsModule /></ShelledRoute>
              } />
              <Route path="/appointments" element={
                <ShelledRoute><AppointmentsCalendarPage /></ShelledRoute>
              } />
              <Route path="/billing/*" element={<ShelledRoute><BillingModule /></ShelledRoute>} />
              <Route path="/accounts" element={
                <ShelledRoute><AccountsRevenuePage /></ShelledRoute>
              } />
              <Route path="/settings/compliance" element={
                <ShelledRoute><CompliancePolicyPack /></ShelledRoute>
              } />
              <Route path="/test/*" element={
                <ShelledRoute><ModuleGate module="diagnostics"><TestProceduresModule /></ModuleGate></ShelledRoute>
              } />
              <Route path="/reports" element={
                <ShelledRoute><ReportsModule /></ShelledRoute>
              } />
              <Route path="/ha/*" element={
                <ShelledRoute><ModuleGate module="hearing-aids"><HAModule /></ModuleGate></ShelledRoute>
              } />
              <Route path="/repair/*" element={
                <ShelledRoute><ModuleGate module="repair"><RepairModule /></ModuleGate></ShelledRoute>
              } />

              {/* Clinical Analytics + Referral Partners (PREMIUM) */}
              <Route path="/analytics/clinical" element={
                <ShelledRoute><ModuleGate module="analytics"><ClinicalAnalyticsPage /></ModuleGate></ShelledRoute>
              } />
              <Route path="/partners" element={
                <ShelledRoute><ModuleGate module="referral-partners"><ReferralPartnersPage /></ModuleGate></ShelledRoute>
              } />

              {/* Referral Corner — owner-grade payout dashboard (access enforced inside the page) */}
              <Route path="/referrals" element={
                <ShelledRoute><ReferralCornerPage /></ShelledRoute>
              } />

              {/* CLINIC DATA EXPORT — role-gated inside the page */}
              <Route path="/data-export" element={
                <ShelledRoute><DataExportPage /></ShelledRoute>
              } />
              <Route path="/settings/*" element={
                <ShelledRoute><SettingsModule /></ShelledRoute>
              } />
              <Route path="/care" element={
                <ShelledRoute><AudinexaCarePage /></ShelledRoute>
              } />

              {/* BYOK Phase 1 PoC — Clinic Vault demo (any authed user) */}
              <Route path="/vault/demo" element={
                <ShelledRoute><VaultDemoPage /></ShelledRoute>
              } />

              {/* SUPER-ADMIN PANEL (founder / super_admin only — own shell) */}
              <Route path="/admin/*" element={<ProtectedRoute><AdminPanel /></ProtectedRoute>} />
              {/* Temporary dashboard compact preview — deleted after approval */}
              <Route path="/mockups/dashboard-compact" element={<ProtectedRoute><DashboardCompactPreview /></ProtectedRoute>} />

              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
    </>
  );
}

export default App;
