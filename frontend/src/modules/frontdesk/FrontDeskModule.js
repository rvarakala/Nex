import React from 'react';
import { NavLink, Routes, Route, Navigate } from 'react-router-dom';
import DashboardPage from './DashboardPage';
import NewPatientPage from './NewPatientPage';
import ReturningPage from './ReturningPage';
import QueuePage from './QueuePage';
import AppointmentsPage from './AppointmentsPage';
import QRPosterPage from './QRPosterPage';
import CloseoutPage from './CloseoutPage';
import { useAuth } from '../../AuthContext';

const Tab = ({ to, label, testid }) => (
  <NavLink
    to={to}
    end
    data-testid={testid}
    className={({ isActive }) =>
      `px-3 py-1.5 text-xs font-semibold rounded transition-colors ${
        isActive ? 'bg-blue-600 text-white shadow-sm' : 'text-slate-600 hover:bg-slate-100'
      }`
    }
  >
    {label}
  </NavLink>
);

export default function FrontDeskModule() {
  const { user } = useAuth();
  const canSeeCloseout = user?.role === 'super_admin' || user?.role === 'accounts';

  return (
    <div className="h-full flex flex-col" data-testid="frontdesk-module">
      <div className="bg-white border-b border-slate-200 px-4 py-2 flex items-center gap-2 flex-shrink-0">
        <h2 className="text-sm font-bold text-slate-800 mr-3">Front Desk</h2>
        <Tab to="/frontdesk" testid="fd-tab-dashboard" label="Dashboard" />
        <Tab to="/frontdesk/new" testid="fd-tab-new" label="+ New Patient" />
        <Tab to="/frontdesk/returning" testid="fd-tab-returning" label="Returning Patient" />
        <Tab to="/frontdesk/appointments" testid="fd-tab-appointments" label="Appointments" />
        <Tab to="/frontdesk/queue" testid="fd-tab-queue" label="Queue" />
        <Tab to="/frontdesk/qr-poster" testid="fd-tab-qr" label="QR Poster" />
        {canSeeCloseout && <Tab to="/frontdesk/closeout" testid="fd-tab-closeout" label="Day Close-out" />}
      </div>

      <div className="flex-1 overflow-auto">
        <Routes>
          <Route index element={<DashboardPage />} />
          <Route path="new" element={<NewPatientPage />} />
          <Route path="returning" element={<ReturningPage />} />
          <Route path="appointments" element={<AppointmentsPage />} />
          <Route path="queue" element={<QueuePage />} />
          <Route path="qr-poster" element={<QRPosterPage />} />
          {canSeeCloseout && <Route path="closeout" element={<CloseoutPage />} />}
          <Route path="*" element={<Navigate to="." replace />} />
        </Routes>
      </div>
    </div>
  );
}
