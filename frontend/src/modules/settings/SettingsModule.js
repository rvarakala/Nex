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
import { Settings, Building2, Users, MapPin, Pen, ListChecks, ShieldCheck, MessageCircle } from 'lucide-react';
import ClinicDetailsTab from './ClinicDetailsTab';
import StaffSettingsTab from './StaffSettingsTab';
import BranchesTab from './BranchesTab';
import MySignatureTab from './MySignatureTab';
import SecurityPrivacyTab from './SecurityPrivacyTab';
import ConnectWhatsAppTab from './ConnectWhatsAppTab';
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
            <SideLink to="/settings/staff"  icon={<Users size={14} />}     label="Staff Settings" testid="settings-nav-staff" />
            <SideLink to="/settings/branches" icon={<MapPin size={14} />}  label="Branches"       testid="settings-nav-branches" />
            <SideLink to="/settings/security" icon={<ShieldCheck size={14} />} label="Security & Privacy" testid="settings-nav-security" />
            <SideLink to="/settings/connect"  icon={<MessageCircle size={14} />} label="Connect (WhatsApp)" testid="settings-nav-connect" />
          </>
        )}
        {canManageCatalog && (
          <SideLink to="/settings/services" icon={<ListChecks size={14} />} label="Service Catalogue" testid="settings-nav-services" />
        )}
        {(isAdmin || canManageCatalog) && <div className="my-2 border-t border-slate-100" />}
        <SideLink to="/settings/signature" icon={<Pen size={14} />} label="My Signature" testid="settings-nav-signature" />
      </aside>
      <main className="flex-1 overflow-auto">
        <Routes>
          <Route index element={<Navigate to={isAdmin ? 'clinic' : (canManageCatalog ? 'services' : 'signature')} replace />} />
          {isAdmin && <Route path="clinic"   element={<ClinicDetailsTab />} />}
          {isAdmin && <Route path="staff"    element={<StaffSettingsTab />} />}
          {isAdmin && <Route path="branches" element={<BranchesTab />} />}
          {isAdmin && <Route path="security" element={<SecurityPrivacyTab />} />}
          {isAdmin && <Route path="connect"  element={<ConnectWhatsAppTab />} />}
          {canManageCatalog && <Route path="services" element={<ServiceCatalogPage />} />}
          <Route path="signature" element={<MySignatureTab />} />
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
