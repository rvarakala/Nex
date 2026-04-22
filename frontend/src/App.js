import React from 'react';
import '@/App.css';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './AuthContext';
import { TestContextProvider } from './TestContext';
import { ProtectedRoute } from './shell/ProtectedRoute';
import AppShell from './shell/AppShell';
import LoginPage from './pages/LoginPage';
import TokenPrintView from './pages/TokenPrintView';
import QueueTVPage from './pages/QueueTVPage';
import FrontDeskModule from './modules/frontdesk/FrontDeskModule';
import BillingModule from './modules/billing/BillingModule';
import TestProceduresModule from './modules/test/TestProceduresModule';

// Entry — picks initial landing based on user role
const LandingRedirect = () => {
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
        <TestContextProvider>
          <Routes>
            <Route path="/login" element={<LoginPage />} />
            <Route path="/queue/:clinicId" element={<QueueTVPage />} />
            <Route path="/token/:tokenId" element={<ProtectedRoute><TokenPrintView /></ProtectedRoute>} />

            <Route path="/frontdesk/*" element={<ShelledRoute><FrontDeskModule /></ShelledRoute>} />
            <Route path="/billing/*" element={<ShelledRoute><BillingModule /></ShelledRoute>} />
            <Route path="/test/*" element={<ShelledRoute><TestProceduresModule /></ShelledRoute>} />
            <Route path="/reports" element={<ShelledRoute><TestProceduresModule /></ShelledRoute>} />

            <Route path="/" element={<LandingRedirect />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </TestContextProvider>
      </AuthProvider>
    </BrowserRouter>
  );
}

export default App;
