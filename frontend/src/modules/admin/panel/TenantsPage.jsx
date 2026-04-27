import React, { useEffect, useState } from 'react';
import axios from 'axios';
import { useNavigate } from 'react-router-dom';
import { PageHeader, Card, Pill, tierTone, fmtDate, fmtInt, Empty } from './shared';
import { MoreVertical, UserCog, PauseCircle, PlayCircle, Trash2, Eye, Plus } from 'lucide-react';
import { useAuth } from '../../../AuthContext';
import Pagination, { DEFAULT_PAGE_SIZE, usePaginationSlice } from '../../../components/Pagination';
import InviteSuccessModal from './InviteSuccessModal';
import AddTenantModal from './AddTenantModal';

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;

export default function TenantsPage() {
  const [tenants, setTenants] = useState([]);
  const [q, setQ] = useState('');
  const [tierFilter, setTierFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [busy, setBusy] = useState('');
  const [page, setPage] = useState(1);
  const [addOpen, setAddOpen] = useState(false);
  const [inviteResult, setInviteResult] = useState(null);
  const navigate = useNavigate();
  const { user, loginWithToken } = useAuth();

  const paged = usePaginationSlice(tenants, page, DEFAULT_PAGE_SIZE);
  // Reset to page 1 when filters change
  useEffect(() => { setPage(1); }, [q, tierFilter, statusFilter, tenants.length]);

  const load = async () => {
    const params = new URLSearchParams();
    if (q) params.set('q', q);
    if (tierFilter) params.set('tier', tierFilter);
    if (statusFilter) params.set('status', statusFilter);
    const r = await axios.get(`${API}/admin/v2/tenants?${params}`);
    setTenants(r.data.rows || []);
  };
  useEffect(() => { load(); /* eslint-disable-next-line */ }, []);
  useEffect(() => { const t = setTimeout(load, 300); return () => clearTimeout(t); /* eslint-disable-next-line */ }, [q, tierFilter, statusFilter]);

  const action = async (cid, verb) => {
    if (verb === 'delete' && !window.confirm(`Delete tenant ${cid}? This is irreversible.`)) return;
    setBusy(cid);
    try {
      if (verb === 'suspend') await axios.post(`${API}/admin/v2/tenants/${cid}/suspend`);
      else if (verb === 'activate') await axios.post(`${API}/admin/v2/tenants/${cid}/activate`);
      else if (verb === 'delete') await axios.delete(`${API}/admin/v2/tenants/${cid}`);
      else if (verb === 'impersonate') {
        const r = await axios.post(`${API}/admin/v2/tenants/${cid}/impersonate`);
        if (r.data.access_token) {
          await loginWithToken(r.data.access_token);
          navigate('/frontdesk');
          return;
        }
      }
      await load();
    } catch (e) {
      alert(e?.response?.data?.detail?.message || e?.response?.data?.detail || 'Action failed');
    } finally { setBusy(''); }
  };

  return (
    <div className="p-6 space-y-5" data-testid="admin-tenants-page">
      <PageHeader title="Tenants / Clinics" subtitle={`${tenants.length} tenants across the platform`}>
        <input
          value={q} onChange={(e) => setQ(e.target.value)}
          placeholder="Search name, city, email…"
          data-testid="tenants-search"
          className="px-3 py-1.5 text-sm border border-slate-300 rounded-lg w-56 focus:border-indigo-500 outline-none"
        />
        <select value={tierFilter} onChange={(e) => setTierFilter(e.target.value)} data-testid="tenants-tier-filter" className="px-2 py-1.5 text-sm border border-slate-300 rounded-lg">
          <option value="">All tiers</option>
          <option value="BASIC">Basic</option>
          <option value="STANDARD">Standard</option>
          <option value="PREMIUM">Premium</option>
        </select>
        <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} data-testid="tenants-status-filter" className="px-2 py-1.5 text-sm border border-slate-300 rounded-lg">
          <option value="">All statuses</option>
          <option value="active">Active</option>
          <option value="suspended">Suspended</option>
        </select>
        <button
          onClick={() => setAddOpen(true)}
          data-testid="tenants-add-btn"
          className="inline-flex items-center gap-1 px-3 py-1.5 text-sm font-semibold bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg shadow-sm"
        >
          <Plus size={14} /> Add Tenant
        </button>
      </PageHeader>

      <Card testid="tenants-table-card">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-[10px] uppercase tracking-wider text-slate-500 border-b border-slate-200">
              <tr>
                <th className="px-4 py-2 text-left">Tenant</th>
                <th className="px-4 py-2 text-left">Owner</th>
                <th className="px-4 py-2 text-left">City</th>
                <th className="px-4 py-2 text-center">Tier</th>
                <th className="px-4 py-2 text-right">Users</th>
                <th className="px-4 py-2 text-right">Patients</th>
                <th className="px-4 py-2 text-right">Health</th>
                <th className="px-4 py-2 text-left">Signed up</th>
                <th className="px-4 py-2 text-center">Status</th>
                <th className="px-4 py-2 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {paged.map((t) => (
                <tr key={t.clinic_id} className="border-t border-slate-100 hover:bg-slate-50" data-testid={`tenant-row-${t.clinic_id}`}>
                  <td className="px-4 py-2">
                    <button onClick={() => navigate(`/admin/tenants/${t.clinic_id}`)} className="font-semibold text-indigo-700 hover:underline text-left">{t.name || t.clinic_id}</button>
                    <div className="text-[10px] text-slate-400 font-mono">{t.clinic_id}</div>
                  </td>
                  <td className="px-4 py-2 text-xs">
                    <div className="font-semibold">{t.owner_name || '—'}</div>
                    <div className="text-[10px] text-slate-500">{t.owner_email}</div>
                  </td>
                  <td className="px-4 py-2 text-xs">{t.city || '—'}</td>
                  <td className="px-4 py-2 text-center"><Pill tone={tierTone(t.effective_tier)}>{t.effective_tier}</Pill></td>
                  <td className="px-4 py-2 text-right text-xs font-semibold">{fmtInt(t.users_count)}</td>
                  <td className="px-4 py-2 text-right text-xs font-semibold">{fmtInt(t.patients_count)}</td>
                  <td className="px-4 py-2 text-right">
                    <div className="inline-flex items-center gap-1">
                      <div className="w-12 h-1.5 bg-slate-200 rounded-full overflow-hidden">
                        <div className={`h-full ${t.health_score > 66 ? 'bg-emerald-500' : t.health_score > 33 ? 'bg-amber-500' : 'bg-rose-500'}`} style={{ width: `${t.health_score}%` }} />
                      </div>
                      <span className="text-[10px] text-slate-600 w-6 text-right">{t.health_score}</span>
                    </div>
                  </td>
                  <td className="px-4 py-2 text-xs text-slate-500">{fmtDate(t.created_at)}</td>
                  <td className="px-4 py-2 text-center">
                    <Pill tone={t.status === 'suspended' ? 'rose' : 'emerald'}>{t.status || 'active'}</Pill>
                  </td>
                  <td className="px-4 py-2 text-right">
                    <div className="inline-flex gap-1">
                      <button title="View" onClick={() => navigate(`/admin/tenants/${t.clinic_id}`)} className="p-1 text-slate-500 hover:text-indigo-600" data-testid={`tenant-view-${t.clinic_id}`}><Eye size={14} /></button>
                      <button title="Impersonate" disabled={busy === t.clinic_id} onClick={() => action(t.clinic_id, 'impersonate')} className="p-1 text-slate-500 hover:text-fuchsia-600" data-testid={`tenant-impersonate-${t.clinic_id}`}><UserCog size={14} /></button>
                      {t.status === 'suspended' ? (
                        <button title="Activate" disabled={busy === t.clinic_id} onClick={() => action(t.clinic_id, 'activate')} className="p-1 text-emerald-600 hover:text-emerald-700"><PlayCircle size={14} /></button>
                      ) : (
                        <button title="Suspend" disabled={busy === t.clinic_id} onClick={() => action(t.clinic_id, 'suspend')} className="p-1 text-amber-600 hover:text-amber-700" data-testid={`tenant-suspend-${t.clinic_id}`}><PauseCircle size={14} /></button>
                      )}
                      {user?.role === 'founder' && (
                        <button title="Delete (founder only)" disabled={busy === t.clinic_id} onClick={() => action(t.clinic_id, 'delete')} className="p-1 text-rose-600 hover:text-rose-700" data-testid={`tenant-delete-${t.clinic_id}`}><Trash2 size={14} /></button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
              {tenants.length === 0 && <tr><td colSpan={10}><Empty>No tenants match your filters.</Empty></td></tr>}
            </tbody>
          </table>
        </div>
        <Pagination page={page} setPage={setPage} total={tenants.length} testidPrefix="tenants-pagination" />
      </Card>

      {addOpen && (
        <AddTenantModal
          onClose={() => setAddOpen(false)}
          onCreated={(result) => { setAddOpen(false); setInviteResult(result); load(); }}
        />
      )}
      {inviteResult && (
        <InviteSuccessModal result={inviteResult} onClose={() => setInviteResult(null)} />
      )}
    </div>
  );
}
