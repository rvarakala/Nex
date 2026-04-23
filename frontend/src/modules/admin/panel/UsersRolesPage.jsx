import React, { useEffect, useState } from 'react';
import Pagination, { DEFAULT_PAGE_SIZE, usePaginationSlice } from '../../../components/Pagination';
import axios from 'axios';
import { PageHeader, Card, Pill, fmtDate, Empty } from './shared';
import { ShieldCheck, UserPlus } from 'lucide-react';

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;

const ROLE_TONE = {
  founder: 'fuchsia', super_admin: 'indigo',
  sales_manager: 'emerald', support_agent: 'amber',
  finance_manager: 'rose', product_ops: 'indigo', read_only: 'slate',
};

export default function UsersRolesPage() {
  const [users, setUsers] = useState([]);
  const [rbac, setRbac] = useState(null);
  const [showInvite, setShowInvite] = useState(false);
  const [page, setPage] = useState(1);
  const pagedUsers = usePaginationSlice(users, page, DEFAULT_PAGE_SIZE);
  useEffect(() => { setPage(1); }, [users.length]);

  const load = async () => {
    const [u, m] = await Promise.all([
      axios.get(`${API}/admin/v2/internal-users`),
      axios.get(`${API}/admin/v2/rbac/matrix`),
    ]);
    setUsers(u.data || []);
    setRbac(m.data);
  };
  useEffect(() => { load(); }, []);

  const toggleActive = async (u) => {
    await axios.patch(`${API}/admin/v2/internal-users/${u.user_id}?active=${!u.active}`);
    load();
  };

  const internalRoles = Object.keys(rbac?.matrix || {}).filter((r) =>
    !['clinic_owner', 'front_desk', 'audiologist', 'accounts', 'inventory_manager', 'technician', 'referral_partner'].includes(r)
  );

  return (
    <div className="p-6 space-y-5" data-testid="admin-users-roles-page">
      <PageHeader title="Users & Roles" subtitle="AUDINEXA internal team · granular 7-role RBAC">
        <button onClick={() => setShowInvite(true)} data-testid="invite-user-btn" className="flex items-center gap-1 px-3 py-1.5 text-xs font-semibold text-white bg-indigo-600 hover:bg-indigo-700 rounded">
          <UserPlus size={13} /> Invite user
        </button>
      </PageHeader>

      <Card title="Internal Team">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-[10px] uppercase tracking-wider text-slate-500">
            <tr>
              <th className="px-4 py-2 text-left">Name</th>
              <th className="px-4 py-2 text-left">Email</th>
              <th className="px-4 py-2 text-center">Role</th>
              <th className="px-4 py-2 text-center">2FA</th>
              <th className="px-4 py-2 text-center">Active</th>
              <th className="px-4 py-2 text-left">Created</th>
              <th className="px-4 py-2 text-right"></th>
            </tr>
          </thead>
          <tbody>
            {pagedUsers.map((u) => (
              <tr key={u.user_id} className="border-t border-slate-100">
                <td className="px-4 py-2 font-semibold">{u.name}</td>
                <td className="px-4 py-2 text-xs">{u.email}</td>
                <td className="px-4 py-2 text-center"><Pill tone={ROLE_TONE[u.role] || 'slate'}>{u.role}</Pill></td>
                <td className="px-4 py-2 text-center text-xs">{u.two_fa_enabled ? <ShieldCheck size={14} className="inline text-emerald-600" /> : '—'}</td>
                <td className="px-4 py-2 text-center">{u.active ? <Pill tone="emerald">Active</Pill> : <Pill tone="slate">Disabled</Pill>}</td>
                <td className="px-4 py-2 text-xs text-slate-500">{fmtDate(u.created_at)}</td>
                <td className="px-4 py-2 text-right">
                  <button onClick={() => toggleActive(u)} className="text-xs text-indigo-700 hover:underline">{u.active ? 'Disable' : 'Enable'}</button>
                </td>
              </tr>
            ))}
            {users.length === 0 && <tr><td colSpan={7}><Empty>No internal users yet.</Empty></td></tr>}
          </tbody>
        </table>
        <Pagination page={page} setPage={setPage} total={users.length} testidPrefix="users-pagination" />
      </Card>

      <Card title="RBAC Matrix" subtitle="Action permissions per role">
        <div className="p-3 overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="bg-slate-50 text-[10px] uppercase tracking-wider text-slate-500">
              <tr>
                <th className="px-3 py-2 text-left">Role</th>
                <th className="px-3 py-2 text-left">Permissions</th>
              </tr>
            </thead>
            <tbody>
              {internalRoles.map((r) => (
                <tr key={r} className="border-t border-slate-100">
                  <td className="px-3 py-2"><Pill tone={ROLE_TONE[r] || 'slate'}>{r}</Pill></td>
                  <td className="px-3 py-2">
                    <div className="flex flex-wrap gap-1">
                      {(rbac?.matrix[r] || []).map((p) => (
                        <span key={p} className="px-1.5 py-0.5 bg-slate-100 text-slate-700 rounded font-mono text-[10px]">{p}</span>
                      ))}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      {showInvite && <InviteUserForm roles={internalRoles} onClose={() => setShowInvite(false)} onSaved={() => { setShowInvite(false); load(); }} />}
    </div>
  );
}

const InviteUserForm = ({ roles, onClose, onSaved }) => {
  const [f, setF] = useState({ email: '', name: '', password: '', role: 'read_only', two_fa_enabled: false });
  const [busy, setBusy] = useState(false); const [err, setErr] = useState('');
  const submit = async (e) => {
    e.preventDefault(); setBusy(true); setErr('');
    try { await axios.post(`${API}/admin/v2/internal-users`, f); onSaved(); }
    catch (e) { setErr(e?.response?.data?.detail || 'Failed'); }
    finally { setBusy(false); }
  };
  return (
    <div className="fixed inset-0 bg-slate-900/50 flex items-center justify-center z-40 p-4">
      <form onSubmit={submit} className="bg-white rounded-xl shadow-xl p-6 w-full max-w-md space-y-3" data-testid="invite-form">
        <h3 className="text-base font-bold">Invite Team Member</h3>
        <div className="grid grid-cols-2 gap-3">
          <label className="block text-sm">Name <input required value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} className="mt-0.5 w-full px-2 py-1.5 border border-slate-300 rounded" /></label>
          <label className="block text-sm">Email <input required type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} className="mt-0.5 w-full px-2 py-1.5 border border-slate-300 rounded" /></label>
        </div>
        <label className="block text-sm">Password <input required type="password" minLength={8} value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} className="mt-0.5 w-full px-2 py-1.5 border border-slate-300 rounded" placeholder="min 8 chars" /></label>
        <label className="block text-sm">Role
          <select value={f.role} onChange={(e) => setF({ ...f, role: e.target.value })} className="mt-0.5 w-full px-2 py-1.5 border border-slate-300 rounded">
            {roles.map((r) => <option key={r} value={r}>{r}</option>)}
          </select>
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={f.two_fa_enabled} onChange={(e) => setF({ ...f, two_fa_enabled: e.target.checked })} />
          <span>2FA enabled</span>
        </label>
        {err && <div className="text-xs text-rose-700">{typeof err === 'string' ? err : JSON.stringify(err)}</div>}
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className="px-3 py-1.5 text-xs text-slate-600">Cancel</button>
          <button disabled={busy} className="px-3 py-1.5 text-xs font-semibold text-white bg-indigo-600 rounded">Invite</button>
        </div>
      </form>
    </div>
  );
};
