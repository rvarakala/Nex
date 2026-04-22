import React from 'react';
import { Routes, Route, NavLink, Navigate } from 'react-router-dom';
import ProductCataloguePage from './ProductCataloguePage';
import InventoryBoardPage from './InventoryBoardPage';
import ProcurementPage from './ProcurementPage';

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
        <Tab to="/ha/procurement" label="Procurement" testid="ha-tab-procurement" />
        <Tab to="/ha/products" label="Product Catalogue" testid="ha-tab-products" />
      </div>

      <div className="flex-1 overflow-auto">
        <Routes>
          <Route path="/" element={<Navigate to="inventory" replace />} />
          <Route path="inventory" element={<InventoryBoardPage />} />
          <Route path="procurement" element={<ProcurementPage />} />
          <Route path="products" element={<ProductCataloguePage />} />
        </Routes>
      </div>
    </div>
  );
}
