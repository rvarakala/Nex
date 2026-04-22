import React from 'react';
import '@/App.css';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './AuthContext';
import { SubscriptionProvider, ModuleGate } from './SubscriptionContext';
import { TestContextProvider } from './TestContext';
import { ProtectedRoute } from './shell/ProtectedRoute';
import AppShell from './shell/AppShell';
import LoginPage from './pages/LoginPage';
import TokenPrintView from './pages/TokenPrintView';
import QueueTVPage from './pages/QueueTVPage';
import LandingPage from './modules/landing/LandingPage';
import SignupPage from './modules/landing/SignupPage';
import FrontDeskModule from './modules/frontdesk/FrontDeskModule';
import BillingModule from './modules/billing/BillingModule';
import TestProceduresModule from './modules/test/TestProceduresModule';
import HAModule from './modules/ha/HAModule';
import RepairModule from './modules/repair/RepairModule';
import AdminClinicsPage from './modules/admin/AdminClinicsPage';
import ClinicalAnalyticsPage from './modules/admin/ClinicalAnalyticsPage';
import ReferralPartnersPage from './modules/admin/ReferralPartnersPage';
import PartnerPortalPage from './modules/partner/PartnerPortalPage';
import PatientPortal from './modules/patient/PatientPortal';

// Post-login redirect by role
const PostLoginRedirect = () => {
  const { user } = useAuth();
  if (!user) return <Navigate to="/login" replace />;
  if (user.role === 'referral_partner') return <Navigate to="/partner" replace />;
  if (user.role === 'audiologist') return <Navigate to="/test" replace />;
  return <Navigate to="/frontdesk" replace />;
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
          <TestContextProvider>
            <Routes>
              {/* PUBLIC */}
              <Route path="/" element={<LandingPage />} />
              <Route path="/signup" element={<SignupPage />} />
              <Route path="/login" element={<LoginPage />} />
              <Route path="/queue/:clinicId" element={<QueueTVPage />} />
              <Route path="/patient-portal" element={<PatientPortal />} />
              <Route path="/patient-portal/:clinicId" element={<PatientPortal />} />

              {/* AUTHENTICATED */}
              <Route path="/app" element={<PostLoginRedirect />} />
              <Route path="/token/:tokenId" element={<ProtectedRoute><TokenPrintView /></ProtectedRoute>} />

              {/* PARTNER (own shell — no AppShell) */}
              <Route path="/partner" element={<ProtectedRoute><PartnerPortalPage /></ProtectedRoute>} />

              <Route path="/frontdesk/*" element={
                <ShelledRoute><ModuleGate module="frontdesk"><FrontDeskModule /></ModuleGate></ShelledRoute>
              } />
              <Route path="/billing/*" element={<ShelledRoute><BillingModule /></ShelledRoute>} />
              <Route path="/test/*" element={
                <ShelledRoute><ModuleGate module="diagnostics"><TestProceduresModule /></ModuleGate></ShelledRoute>
              } />
              <Route path="/reports" element={
                <ShelledRoute><ModuleGate module="diagnostics"><TestProceduresModule /></ModuleGate></ShelledRoute>
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

              {/* SUPER-ADMIN */}
              <Route path="/admin/clinics" element={<ShelledRoute><AdminClinicsPage /></ShelledRoute>} />

              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          </TestContextProvider>
        </SubscriptionProvider>
      </AuthProvider>
    </BrowserRouter>
  );
}

export default App;
