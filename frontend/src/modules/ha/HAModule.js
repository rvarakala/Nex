import React from 'react';
import { Routes, Route, NavLink, Navigate } from 'react-router-dom';
import ProductCataloguePage from './ProductCataloguePage';
import InventoryBoardPage from './InventoryBoardPage';
import ProcurementPage from './ProcurementPage';
import QuotationStudioPage from './QuotationStudioPage';
import FittingLedgerPage from './FittingLedgerPage';
import TrialsPage from './TrialsPage';
import FollowupBoardPage from './FollowupBoardPage';
import SubscriptionsPage from './SubscriptionsPage';
import OwnerAnalyticsPage from './OwnerAnalyticsPage';
import UpgradeFunnelPage from './UpgradeFunnelPage';
import AMCPage from './AMCPage';

const Tab = ({ to, label, testid }) => (
  <NavLink
    to={to}
    end
    data-testid={testid}
    className={({ isActive }) =>
      `px-4 py-2 text-[12px] font-semibold uppercase tracking-wider border-b-2 transition-colors ${
        isActive
          ? 'border-indigo-600 text-indigo-700 bg-white'
          : 'border-transparent text-slate-500 hover:text-slate-800'
      }`
    }
  >
    {label}
  </NavLink>
);

export default function HAModule() {
  return (
    <div className="h-full flex flex-col" data-testid="ha-module">
      {/* Sub-nav for HA */}
      <div className="border-b border-slate-200 bg-slate-50 flex items-center gap-1 px-4 flex-shrink-0">
        <Tab to="/ha/inventory" label="Inventory Board" testid="ha-tab-inventory" />
        <Tab to="/ha/quotations" label="Quotations" testid="ha-tab-quotations" />
        <Tab to="/ha/trials" label="Trials" testid="ha-tab-trials" />
        <Tab to="/ha/fittings" label="Fittings" testid="ha-tab-fittings" />
        <Tab to="/ha/upgrades" label="Upgrades" testid="ha-tab-upgrades" />
        <Tab to="/ha/followups" label="Follow-ups" testid="ha-tab-followups" />
        <Tab to="/ha/subscriptions" label="Subscriptions" testid="ha-tab-subs" />
        <Tab to="/ha/amc" label="AMC" testid="ha-tab-amc" />
        <Tab to="/ha/procurement" label="Procurement" testid="ha-tab-procurement" />
        <Tab to="/ha/products" label="Catalogue" testid="ha-tab-products" />
        <Tab to="/ha/analytics" label="Analytics" testid="ha-tab-analytics" />
      </div>

      <div className="flex-1 overflow-auto">
        <Routes>
          <Route path="/" element={<Navigate to="inventory" replace />} />
          <Route path="inventory" element={<InventoryBoardPage />} />
          <Route path="quotations/*" element={<QuotationStudioPage />} />
          <Route path="trials" element={<TrialsPage />} />
          <Route path="fittings" element={<FittingLedgerPage />} />
          <Route path="upgrades" element={<UpgradeFunnelPage />} />
          <Route path="followups" element={<FollowupBoardPage />} />
          <Route path="subscriptions" element={<SubscriptionsPage />} />
          <Route path="amc" element={<AMCPage />} />
          <Route path="analytics" element={<OwnerAnalyticsPage />} />
          <Route path="procurement" element={<ProcurementPage />} />
          <Route path="products" element={<ProductCataloguePage />} />
        </Routes>
      </div>
    </div>
  );
}
