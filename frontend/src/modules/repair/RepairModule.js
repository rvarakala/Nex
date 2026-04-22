import React from 'react';
import { Routes, Route, NavLink, Navigate } from 'react-router-dom';
import ServiceTicketsPage from '../ha/ServiceTicketsPage';
import LoanersPage from '../ha/LoanersPage';

const Tab = ({ to, label, testid }) => (
  <NavLink
    to={to}
    end
    data-testid={testid}
    className={({ isActive }) =>
      `px-4 py-2 text-[12px] font-semibold uppercase tracking-wider border-b-2 transition-colors ${
        isActive
          ? 'border-orange-600 text-orange-700 bg-white'
          : 'border-transparent text-slate-500 hover:text-slate-800'
      }`
    }
  >
    {label}
  </NavLink>
);

export default function RepairModule() {
  return (
    <div className="h-full flex flex-col" data-testid="repair-module">
      <div className="border-b border-slate-200 bg-slate-50 flex items-center gap-1 px-4 flex-shrink-0">
        <Tab to="/repair/jobs" label="Service Jobs" testid="repair-tab-jobs" />
        <Tab to="/repair/loaners" label="Loaners" testid="repair-tab-loaners" />
      </div>

      <div className="flex-1 overflow-auto">
        <Routes>
          <Route path="/" element={<Navigate to="jobs" replace />} />
          <Route path="jobs" element={<ServiceTicketsPage />} />
          <Route path="loaners" element={<LoanersPage />} />
        </Routes>
      </div>
    </div>
  );
}
