/**
 * Settings Module — clinic-admin only.
 *
 * Tabs:
 *  1. Clinic Details    — logo + address + contact + GSTIN
 *  2. Staff Settings    — add/edit/deactivate/reset-password/force-logout
 *  3. Branches          — list / add / edit / deactivate branches
 *  4. Service Catalogue — services + rates (used by billing & appointment booking)
 *
 * Route: /settings (gated to clinic_owner + super_admin in App.js).
 */
import React from 'react';
import { NavLink, Route, Routes, Navigate } from 'react-router-dom';
import { Settings, Building2, Users, MapPin, Pen, ListChecks, ShieldCheck, MessageCircle, Clock, CalendarClock, Upload, User, Printer, Stamp } from 'lucide-react';
import ClinicDetailsTab from './ClinicDetailsTab';
import StaffSettingsTab from './StaffSettingsTab';
import BranchesTab from './BranchesTab';
import MySignatureTab from './MySignatureTab';
import MySealTab from './MySealTab';
import MyProfileTab from './MyProfileTab';
import SecurityPrivacyTab from './SecurityPrivacyTab';
import ConnectWhatsAppTab from './ConnectWhatsAppTab';
import ClinicHoursTab from './ClinicHoursTab';
import StaffScheduleTab from './StaffScheduleTab';
import DataImportTab from './DataImportTab';
import PrintTemplatesTab from './PrintTemplatesTab';
import BlankAudiogramTemplate from './templates/BlankAudiogramTemplate';
import ServiceCatalogPage from '../billing/ServiceCatalogPage';
import { useAuth } from '../../AuthContext';

export default function SettingsModule() {
  const { user } = useAuth();
  const isAdmin = ['clinic_owner', 'super_admin'].includes(user?.role);
  const canManageCatalog = ['clinic_owner', 'super_admin', 'accounts'].includes(user?.role);

  return (
    <div className="h-full flex bg-slate-50" data-testid="settings-module">
      <aside className="w-56 bg-white border-r border-slate-200 p-3 flex flex-col">
        <div className="flex items-center gap-2 px-2 py-1 mb-3">
          <Settings size={16} className="text-slate-500" />
          <div className="text-[11px] uppercase tracking-wider font-bold text-slate-500">Settings</div>
        </div>
        {isAdmin && (
          <>
            <SideLink to="/settings/clinic" icon={<Building2 size={14} />} label="Clinic Details" testid="settings-nav-clinic" />
            <SideLink to="/settings/hours"  icon={<Clock size={14} />}     label="Clinic Hours"   testid="settings-nav-hours" />
            <SideLink to="/settings/staff"  icon={<Users size={14} />}     label="Staff Settings" testid="settings-nav-staff" />
            <SideLink to="/settings/staff-schedule" icon={<CalendarClock size={14} />} label="Staff Schedule" testid="settings-nav-staff-schedule" />
            <SideLink to="/settings/branches" icon={<MapPin size={14} />}  label="Branches"       testid="settings-nav-branches" />
            <SideLink to="/settings/security" icon={<ShieldCheck size={14} />} label="Security & Privacy" testid="settings-nav-security" />
            <SideLink to="/settings/connect"  icon={<MessageCircle size={14} />} label="Connect (WhatsApp)" testid="settings-nav-connect" />
            <SideLink to="/settings/import"   icon={<Upload size={14} />}        label="Data Import"        testid="settings-nav-import" />
            <SideLink to="/settings/templates" icon={<Printer size={14} />}      label="Print Templates"    testid="settings-nav-templates" />
          </>
        )}
        {canManageCatalog && (
          <SideLink to="/settings/services" icon={<ListChecks size={14} />} label="Service Catalogue" testid="settings-nav-services" />
        )}
        {(isAdmin || canManageCatalog) && <div className="my-2 border-t border-slate-100" />}
        <SideLink to="/settings/profile"   icon={<User size={14} />} label="My Profile"   testid="settings-nav-profile" />
        <SideLink to="/settings/signature" icon={<Pen size={14} />}  label="My Signature" testid="settings-nav-signature" />
        <SideLink to="/settings/seal"      icon={<Stamp size={14} />} label="My Seal"     testid="settings-nav-seal" />
      </aside>
      <main className="flex-1 overflow-auto">
        <Routes>
          <Route index element={<Navigate to={isAdmin ? 'clinic' : (canManageCatalog ? 'services' : 'profile')} replace />} />
          {isAdmin && <Route path="clinic"   element={<ClinicDetailsTab />} />}
          {isAdmin && <Route path="hours"    element={<ClinicHoursTab />} />}
          {isAdmin && <Route path="staff"    element={<StaffSettingsTab />} />}
          {isAdmin && <Route path="staff-schedule" element={<StaffScheduleTab />} />}
          {isAdmin && <Route path="branches" element={<BranchesTab />} />}
          {isAdmin && <Route path="security" element={<SecurityPrivacyTab />} />}
          {isAdmin && <Route path="connect"  element={<ConnectWhatsAppTab />} />}
          {isAdmin && <Route path="import"   element={<DataImportTab />} />}
          {isAdmin && <Route path="templates" element={<PrintTemplatesTab />} />}
          {isAdmin && <Route path="templates/audiogram" element={<BlankAudiogramTemplate />} />}
          {canManageCatalog && <Route path="services" element={<ServiceCatalogPage />} />}
          <Route path="profile"   element={<MyProfileTab />} />
          <Route path="signature" element={<MySignatureTab />} />
          <Route path="seal"      element={<MySealTab />} />
        </Routes>
      </main>
    </div>
  );
}

function SideLink({ to, icon, label, testid }) {
  return (
    <NavLink
      to={to}
      data-testid={testid}
      className={({ isActive }) =>
        `flex items-center gap-2 px-3 py-2 text-xs font-semibold rounded transition ${
          isActive ? 'bg-indigo-50 text-indigo-700 border border-indigo-200' : 'text-slate-600 hover:bg-slate-50'
        }`
      }
    >
      {icon}
      {label}
    </NavLink>
  );
}
