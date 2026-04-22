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
import FrontDeskModule from './modules/frontdesk/FrontDeskModule';
import BillingModule from './modules/billing/BillingModule';
import TestProceduresModule from './modules/test/TestProceduresModule';
import HAModule from './modules/ha/HAModule';
import RepairModule from './modules/repair/RepairModule';
import AdminClinicsPage from './modules/admin/AdminClinicsPage';

// Post-login redirect by role
const PostLoginRedirect = () => {
  const { user } = useAuth();
  if (!user) return <Navigate to="/login" replace />;
  if (user.role === 'audiologist') return <Navigate to="/test" replace />;
  return <Navigate to="/frontdesk" replace />;
};

const ShelledRoute = ({ children }) => (
  <ProtectedRoute>
    <AppShell>{children}</AppShell>
  </ProtectedRoute>
);

function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <SubscriptionProvider>
          <TestContextProvider>
            <Routes>
              {/* PUBLIC */}
              <Route path="/" element={<LandingPage />} />
              <Route path="/login" element={<LoginPage />} />
              <Route path="/queue/:clinicId" element={<QueueTVPage />} />

              {/* AUTHENTICATED */}
              <Route path="/app" element={<PostLoginRedirect />} />
              <Route path="/token/:tokenId" element={<ProtectedRoute><TokenPrintView /></ProtectedRoute>} />

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
