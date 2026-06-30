/**
 * Unified Patients Module — merges Front Desk dashboard + Appointments
 * (card-grid layout) + Patients list + Reports queue under one roof,
 * styled to match the 7Health.Pro reference (white surfaces, indigo accents,
 * card-based primary content).
 *
 * Routes:
 *   /patients                 → Dashboard (KPI tiles + live queue)
 *   /patients/appointments    → Appointment cards grid
 *   /patients/list            → Patient directory table
 *   /patients/reports         → Reports handover queue (legacy /reports)
 *   /patients/:patientId      → Single Patient profile (sub-tabs)
 */
import React, { useEffect } from 'react';
import { Routes, Route, Navigate, NavLink, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { LayoutDashboard, CalendarDays, Users, FileText } from 'lucide-react';
import PatientsDashboard from './PatientsDashboard';
import PatientsListPage from './PatientsListPage';
import AppointmentsBoard from './AppointmentsBoard';
import PatientProfilePage from './PatientProfilePage';
import NewPatientPage from './NewPatientPage';
import ReportsModule from '../reports/ReportsModule';

const TABS = [
  { to: '/patients',              end: true,  icon: LayoutDashboard, label: 'Dashboard',    testid: 'pmod-tab-dashboard' },
  { to: '/patients/appointments', end: false, icon: CalendarDays,    label: 'Appointments', testid: 'pmod-tab-appointments' },
  { to: '/patients/list',         end: false, icon: Users,           label: 'Patients',     testid: 'pmod-tab-list' },
  { to: '/patients/reports',      end: false, icon: FileText,        label: 'Reports',      testid: 'pmod-tab-reports' },
];

export default function PatientsModule() {
  const location = useLocation();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  // Backward-compat: legacy buttons & shortcuts use `/patients?new=1` to open
  // the New Patient form. We rewrite that to the dedicated `/patients/new`
  // route so the form actually mounts (the previous version silently rendered
  // the dashboard). Done in an effect so we keep <Link to="/patients?new=1">
  // semantics while presenting the proper page.
  useEffect(() => {
    if (searchParams.get('new') === '1' && location.pathname === '/patients') {
      navigate('/patients/new', { replace: true });
    }
  }, [searchParams, location.pathname, navigate]);

  // Hide top tab bar on the per-patient profile page (it has its own sub-tabs).
  // Edit-patient pages also get the bar hidden — they're a sub-flow of the
  // profile, not a navigation peer of Dashboard / Appointments / Patients.
  const onProfile = (
    /^\/patients\/[^/]+$/.test(location.pathname)
    || /^\/patients\/[^/]+\/edit$/.test(location.pathname)
  ) && !['/patients/new', '/patients/appointments', '/patients/list', '/patients/reports'].includes(location.pathname);

  return (
    <div className="h-full flex flex-col bg-slate-50" data-testid="patients-module">
      {!onProfile && (
        <div className="bg-white border-b border-slate-200 px-4 sm:px-6 flex items-center gap-1 overflow-x-auto">
          {TABS.map((t) => {
            const Icon = t.icon;
            return (
              <NavLink
                key={t.to}
                to={t.to}
                end={t.end}
                data-testid={t.testid}
                className={({ isActive }) => `flex items-center gap-1.5 text-[12.5px] font-semibold px-3 py-3 -mb-px border-b-2 transition whitespace-nowrap ${
                  isActive
                    ? 'text-indigo-700 border-indigo-600'
                    : 'text-slate-500 border-transparent hover:text-slate-800'}`}>
                <Icon size={14} /> {t.label}
              </NavLink>
            );
          })}
        </div>
      )}
      <main className="flex-1 overflow-auto">
        <Routes>
          <Route index element={<PatientsDashboard />} />
          <Route path="new" element={<NewPatientPage />} />
          <Route path="appointments" element={<AppointmentsBoard />} />
          <Route path="list" element={<PatientsListPage />} />
          <Route path="reports" element={<ReportsModule />} />
          {/* Edit route MUST come before `:patientId` so React Router prefers
              the more specific match (otherwise `PT-123/edit` would render
              the profile and pass `PT-123/edit` as patientId). */}
          <Route path=":patientId/edit" element={<NewPatientPage />} />
          <Route path=":patientId" element={<PatientProfilePage />} />
          <Route path="*" element={<Navigate to="/patients" replace />} />
        </Routes>
      </main>
    </div>
  );
}
