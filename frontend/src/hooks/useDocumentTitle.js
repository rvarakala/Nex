/**
 * Dynamically sets the browser tab title based on the current URL pathname.
 * Keeps "AUDINEXA" suffix for brand consistency.
 */
import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';

const TITLES = [
  { match: /^\/$/,                  title: 'AUDINEXA — Audiology Clinic OS' },
  { match: /^\/login/,              title: 'Sign in · AUDINEXA' },
  { match: /^\/admin\/dashboard/,   title: 'Dashboard · AUDINEXA' },
  { match: /^\/admin\/tenants/,     title: 'Tenants · AUDINEXA' },
  { match: /^\/admin\/revenue/,     title: 'Revenue · AUDINEXA' },
  { match: /^\/admin\/activity/,    title: 'Live Activity · AUDINEXA' },
  { match: /^\/admin\/leads/,       title: 'Leads · AUDINEXA' },
  { match: /^\/admin\/support/,     title: 'Support Desk · AUDINEXA' },
  { match: /^\/admin\/usage/,       title: 'Usage · AUDINEXA' },
  { match: /^\/admin\/system/,      title: 'System Health · AUDINEXA' },
  { match: /^\/admin\/audit/,       title: 'Audit Log · AUDINEXA' },
  { match: /^\/admin\/notif/,       title: 'Notifications · AUDINEXA' },
  { match: /^\/admin\/users/,       title: 'Users & Roles · AUDINEXA' },
  { match: /^\/admin\/settings/,    title: 'Settings · AUDINEXA' },
  { match: /^\/admin\/marketing/,   title: 'Marketing CRM · AUDINEXA' },
  { match: /^\/admin\/features/,    title: 'Feature Flags · AUDINEXA' },
  { match: /^\/admin/,              title: 'Admin · AUDINEXA' },
  { match: /^\/patients/,           title: 'Patients · AUDINEXA' },
  { match: /^\/billing/,            title: 'Billing · AUDINEXA' },
  { match: /^\/test/,               title: 'Diagnostics · AUDINEXA' },
  { match: /^\/ha\/analytics/,      title: 'Analytics · AUDINEXA' },
  { match: /^\/ha/,                 title: 'Hearing Aids · AUDINEXA' },
  { match: /^\/repair/,             title: 'Service & Repair · AUDINEXA' },
  { match: /^\/analytics/,          title: 'Clinical Analytics · AUDINEXA' },
  { match: /^\/partners/,           title: 'Referral Partners · AUDINEXA' },
  { match: /^\/reports/,            title: 'Reports · AUDINEXA' },
  { match: /^\/portal/,             title: 'Patient Portal · AUDINEXA' },
];

export function useDocumentTitle() {
  const location = useLocation();
  useEffect(() => {
    const match = TITLES.find((t) => t.match.test(location.pathname));
    document.title = match ? match.title : 'AUDINEXA';
  }, [location.pathname]);
}
