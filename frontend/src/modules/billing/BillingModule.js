import React from 'react';
import { NavLink, Routes, Route, Navigate, useLocation } from 'react-router-dom';
import InvoicesListPage from './InvoicesListPage';
import InvoiceDetailPage from './InvoiceDetailPage';
import CreateInvoicePage from './CreateInvoicePage';
import ReportHandoverPage from './ReportHandoverPage';
import ServiceCatalogPage from './ServiceCatalogPage';
import { useAuth } from '../../AuthContext';

const Tab = ({ to, label, testid }) => {
  const loc = useLocation();
  // Mark /billing (index) active only when on /billing exactly or /billing/invoices*
  const isIndex = to === '/billing';
  const active = isIndex
    ? (loc.pathname === '/billing' || loc.pathname.startsWith('/billing/invoice'))
    : loc.pathname.startsWith(to);
  return (
    <NavLink
      to={to}
      data-testid={testid}
      className={`px-3 py-1.5 text-xs font-semibold rounded transition-colors ${
        active ? 'bg-emerald-600 text-white shadow-sm' : 'text-slate-600 hover:bg-slate-100'
      }`}
    >
      {label}
    </NavLink>
  );
};

const CatalogGate = ({ canManageCatalog, children }) =>
  (canManageCatalog ? children : <Navigate to="/billing" replace />);

export default function BillingModule() {
  const { user } = useAuth();
  const canManageCatalog = user?.role === 'super_admin' || user?.role === 'accounts';

  return (
    <div className="h-full flex flex-col" data-testid="billing-module">
      <div className="bg-white border-b border-slate-200 px-4 py-2 flex items-center gap-2 flex-shrink-0">
        <h2 className="text-sm font-bold text-slate-800 mr-3">Billing</h2>
        <Tab to="/billing" testid="bill-tab-invoices" label="Invoices" />
        <Tab to="/billing/new" testid="bill-tab-new" label="+ New Invoice" />
        <Tab to="/billing/handover" testid="bill-tab-handover" label="Report Handover" />
        {canManageCatalog && <Tab to="/billing/catalog" testid="bill-tab-catalog" label="Service Catalog" />}
      </div>

      <div className="flex-1 overflow-auto">
        <Routes>
          <Route index element={<InvoicesListPage />} />
          <Route path="new" element={<CreateInvoicePage />} />
          <Route path="invoice/:invoiceId" element={<InvoiceDetailPage />} />
          <Route path="handover" element={<ReportHandoverPage />} />
          <Route
            path="catalog"
            element={<CatalogGate canManageCatalog={canManageCatalog}><ServiceCatalogPage /></CatalogGate>}
          />
          <Route path="*" element={<Navigate to="." replace />} />
        </Routes>
      </div>
    </div>
  );
}
