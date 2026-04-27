/**
 * Patients Dashboard — replaces the legacy FrontDesk Dashboard.
 * Reuses the existing /api/dashboard/frontdesk + Clinic Pulse + Live Queue
 * but wraps them in the new white/indigo aesthetic with the 7Health-style
 * "Hey! {name} 👋" greeting bar.
 */
import React from 'react';
import { Link } from 'react-router-dom';
import { UserPlus, Search } from 'lucide-react';
import DashboardPage from '../frontdesk/DashboardPage';
import { useAuth } from '../../AuthContext';

export default function PatientsDashboard() {
  const { user } = useAuth();
  const firstName = (user?.name || user?.email || 'there').split(/[ @]/)[0];
  return (
    <div className="p-4 sm:p-6 space-y-4" data-testid="patients-dashboard">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold text-slate-900">Hey! {firstName} <span className="inline-block">👋</span></h1>
          <p className="text-[12.5px] text-slate-500 mt-0.5">Here's everything happening at your clinic right now.</p>
        </div>
        <div className="flex items-center gap-2">
          <Link
            to="/frontdesk/returning"
            data-testid="pmod-search-patient"
            className="inline-flex items-center gap-1.5 text-[12px] px-3 py-2 border border-slate-200 hover:border-slate-300 bg-white rounded-lg text-slate-700 font-semibold">
            <Search size={13} /> Search patient
          </Link>
          <Link
            to="/frontdesk/new"
            data-testid="pmod-new-patient"
            className="inline-flex items-center gap-1.5 text-[12px] px-3 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg font-semibold shadow-sm shadow-indigo-600/20">
            <UserPlus size={13} /> New Patient
          </Link>
        </div>
      </header>
      {/* Reuse existing dashboard widget (Clinic Pulse + KPIs + Live Queue) */}
      <DashboardPage />
    </div>
  );
}
