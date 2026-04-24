/**
 * Settings Module — clinic-admin only.
 *
 * Tabs:
 *  1. Clinic Details   — logo + address + contact + GSTIN
 *  2. Staff Settings   — add/edit/deactivate/reset-password/force-logout
 *  3. Branches         — list / add / edit / deactivate branches
 *
 * Route: /settings (gated to clinic_owner + super_admin in App.js).
 */
import React, { useCallback, useEffect, useState } from 'react';
import axios from 'axios';
import { NavLink, Route, Routes, Navigate } from 'react-router-dom';
import { Settings, Building2, Users, MapPin } from 'lucide-react';
import ClinicDetailsTab from './ClinicDetailsTab';
import StaffSettingsTab from './StaffSettingsTab';
import BranchesTab from './BranchesTab';

export default function SettingsModule() {
  return (
    <div className="h-full flex bg-slate-50" data-testid="settings-module">
      <aside className="w-56 bg-white border-r border-slate-200 p-3 flex flex-col">
        <div className="flex items-center gap-2 px-2 py-1 mb-3">
          <Settings size={16} className="text-slate-500" />
          <div className="text-[11px] uppercase tracking-wider font-bold text-slate-500">Settings</div>
        </div>
        <SideLink to="/settings/clinic" icon={<Building2 size={14} />} label="Clinic Details" testid="settings-nav-clinic" />
        <SideLink to="/settings/staff"  icon={<Users size={14} />}     label="Staff Settings" testid="settings-nav-staff" />
        <SideLink to="/settings/branches" icon={<MapPin size={14} />}  label="Branches"       testid="settings-nav-branches" />
      </aside>
      <main className="flex-1 overflow-auto">
        <Routes>
          <Route index element={<Navigate to="clinic" replace />} />
          <Route path="clinic"   element={<ClinicDetailsTab />} />
          <Route path="staff"    element={<StaffSettingsTab />} />
          <Route path="branches" element={<BranchesTab />} />
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
