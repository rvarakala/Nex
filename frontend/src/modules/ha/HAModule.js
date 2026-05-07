import React from 'react';
import { Routes, Route, NavLink, Navigate, useLocation } from 'react-router-dom';
import ProductCataloguePage from './ProductCataloguePage';
import InventoryBoardPage from './InventoryBoardPage';
import DemoStockPage from './DemoStockPage';
import ProcurementPage from './ProcurementPage';
import VendorsPage from './VendorsPage';
import QuotationStudioPage from './QuotationStudioPage';
import FittingLedgerPage from './FittingLedgerPage';
import TrialsPage from './TrialsPage';
import FollowupBoardPage from './FollowupBoardPage';
import SubscriptionsPage from './SubscriptionsPage';
import OwnerAnalyticsPage from './OwnerAnalyticsPage';
import UpgradeFunnelPage from './UpgradeFunnelPage';
import AMCPage from './AMCPage';
import StockTransfersPage from './transfers/StockTransfersPage';

// Sub-tabs grouped by section. Sidebar shows two top-level links:
//   • "Hearing Aids" → /ha/trials (sales lifecycle)
//   • "Inventory"    → /ha/inventory (stock + procurement + catalogue)
// Both render <HAModule />; this component picks which tab strip to show
// based on the current pathname so the sub-nav stays scoped to the section
// the user clicked. Routes the user reaches via direct URL still resolve.
const SALES_PATHS = new Set(['trials', 'quotations', 'fittings', 'followups']);
const INVENTORY_PATHS = new Set([
  'inventory', 'demo-stock', 'amc', 'procurement', 'products', 'transfers', 'vendors',
]);

const SALES_TABS = [
  { to: '/ha/trials',     label: 'Trials',     testid: 'ha-tab-trials' },
  { to: '/ha/quotations', label: 'Quotations', testid: 'ha-tab-quotations' },
  { to: '/ha/fittings',   label: 'Fittings',   testid: 'ha-tab-fittings' },
  { to: '/ha/followups',  label: 'Follow-ups', testid: 'ha-tab-followups' },
];

const INVENTORY_TABS = [
  { to: '/ha/inventory',   label: 'Inventory Board', testid: 'ha-tab-inventory' },
  { to: '/ha/demo-stock',  label: 'Demo Stock',      testid: 'ha-tab-demo-stock' },
  { to: '/ha/amc',         label: 'AMC',             testid: 'ha-tab-amc' },
  { to: '/ha/procurement', label: 'Procurement',     testid: 'ha-tab-procurement' },
  { to: '/ha/products',    label: 'Catalogue',       testid: 'ha-tab-products' },
];

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
  const loc = useLocation();
  const segment = (loc.pathname.split('/')[2] || '').split('?')[0];
  // Default unknown segments to inventory tabs (catches `/ha`, `/ha/upgrades`, `/ha/subscriptions`, etc.)
  const tabs = SALES_PATHS.has(segment) ? SALES_TABS
             : INVENTORY_PATHS.has(segment) ? INVENTORY_TABS
             : INVENTORY_TABS;

  return (
    <div className="h-full flex flex-col" data-testid="ha-module">
      <div className="border-b border-slate-200 bg-slate-50 flex items-center gap-1 px-4 flex-shrink-0">
        {tabs.map((t) => <Tab key={t.to} {...t} />)}
      </div>

      <div className="flex-1 overflow-auto">
        <Routes>
          <Route path="/" element={<Navigate to="inventory" replace />} />
          <Route path="inventory" element={<InventoryBoardPage />} />
          <Route path="transfers" element={<StockTransfersPage />} />
          <Route path="demo-stock" element={<DemoStockPage />} />
          <Route path="quotations/*" element={<QuotationStudioPage />} />
          <Route path="trials" element={<TrialsPage />} />
          <Route path="fittings" element={<FittingLedgerPage />} />
          <Route path="upgrades" element={<UpgradeFunnelPage />} />
          <Route path="followups" element={<FollowupBoardPage />} />
          <Route path="subscriptions" element={<SubscriptionsPage />} />
          <Route path="amc" element={<AMCPage />} />
          <Route path="analytics" element={<OwnerAnalyticsPage />} />
          <Route path="procurement" element={<ProcurementPage />} />
          <Route path="vendors" element={<VendorsPage />} />
          <Route path="products" element={<ProductCataloguePage />} />
        </Routes>
      </div>
    </div>
  );
}
