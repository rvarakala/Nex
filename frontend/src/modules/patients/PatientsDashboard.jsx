/**
 * Patients Dashboard — modern AUDINEXA-fit start-up page.
 *
 * Replaces the legacy DashboardPage visual layer with `<ModernDashboard>` —
 * KPI cards, today's appointments + recent registrations side-by-side, week
 * chart, donut, quick actions, today's clinic schedule, and bottom alert
 * strip. All sub-routes (`/patients/new`, `/patients/list`, `/patients/:id`,
 * etc.) and APIs are unchanged.
 *
 * The legacy `<DashboardPage>` is no longer imported but the file remains
 * in the repo for one release window in case rollback is needed.
 */
import React from 'react';
import ModernDashboard from './ModernDashboard';

export default function PatientsDashboard() {
  return <ModernDashboard />;
}
