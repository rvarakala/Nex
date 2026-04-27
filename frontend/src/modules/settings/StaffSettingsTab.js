/**
 * Staff Settings tab — add / edit / deactivate / reset password / force logout.
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import axios from 'axios';
import { Plus, Pencil, Key, LogOut, Power, AlertTriangle, Check, Copy, Mail, ExternalLink, Trash2 } from 'lucide-react';
import ModalShell from '../../components/ModalShell';

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;

const ROLE_OPTIONS = [
  { v: 'clinic_owner',      l: 'Clinic Owner',      desc: 'Full access — every module, every branch, staff + settings' },
  { v: 'front_desk',        l: 'Front Desk',        desc: 'Patients, appointments, tokens, billing, invoicing' },
  { v: 'audiologist',       l: 'Audiologist',       desc: 'Diagnostics, reports, hearing aid trials, fitments' },
  { v: 'accounts',          l: 'Accounts',          desc: 'Billing + invoices + GST + collections + closeout' },
  { v: 'inventory_manager', l: 'Inventory Manager', desc: 'Products, procurement, inventory, demo stock, vendors' },
  { v: 'technician',        l: 'Technician',        desc: 'Service desk, repairs, warranty tickets' },
];
const ROLE_LABEL = Object.fromEntries(ROLE_OPTIONS.map(r => [r.v, r.l]));
const ROLE_BADGE = {
  clinic_owner: 'bg-purple-100 text-purple-800 border-purple-200',
  front_desk: 'bg-sky-100 text-sky-800 border-sky-200',
  audiologist: 'bg-emerald-100 text-emerald-800 border-emerald-200',
  accounts: 'bg-amber-100 text-amber-800 border-amber-200',
  inventory_manager: 'bg-indigo-100 text-indigo-800 border-indigo-200',
  technician: 'bg-slate-100 text-slate-800 border-slate-200',
};

export default function StaffSettingsTab() {
  const [rows, setRows] = useState([]);
  const [branches, setBranches] = useState([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');
  const [msg, setMsg] = useState('');
  const [editing, setEditing] = useState(null); // null | 'new' | user
  const [pwdModal, setPwdModal] = useState(null); // {email, temp_password}
  const [inviteOpen, setInviteOpen] = useState(false);
  const [pendingInvites, setPendingInvites] = useState([]);

  const load = useCallback(async () => {
    setLoading(true); setErr('');
    try {
      const [u, b, inv] = await Promise.all([
        axios.get(`${API}/users`),
        axios.get(`${API}/branches`).catch(() => ({ data: [] })),
        axios.get(`${API}/settings/staff/invitations`).catch(() => ({ data: [] })),
      ]);
      // Show only real staff — hide referral_partner test noise.
      const EXCLUDE = new Set(['referral_partner', 'super_admin']);
      setRows((u.data || []).filter((x) => !EXCLUDE.has(x.role)));
      setBranches(b.data || []);
      setPendingInvites((inv.data || []).filter((i) => i.status === 'pending'));
    } catch (e) {
      setErr(e?.response?.data?.detail || 'Unable to load staff');
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  const flash = (text) => { setMsg(text); setTimeout(() => setMsg(''), 3000); };

  const resetPwd = async (u) => {
    if (!window.confirm(`Reset password for ${u.name}? They will be logged out of all devices and need the new password to log back in.`)) return;
    try {
      const r = await axios.post(`${API}/settings/staff/${u.user_id}/reset-password`);
      setPwdModal({ email: u.email, temp_password: r.data.temp_password });
      flash('Password reset. A copy has been emailed (MOCKED).');
      await load();
    } catch (e) { setErr(e?.response?.data?.detail || 'Reset failed'); }
  };

  const forceLogout = async (u) => {
    if (!window.confirm(`Force-logout ${u.name}? Their active tokens will be invalidated immediately.`)) return;
    try {
      await axios.post(`${API}/settings/staff/${u.user_id}/force-logout`);
      flash(`${u.name} signed out of all devices.`);
    } catch (e) { setErr(e?.response?.data?.detail || 'Force-logout failed'); }
  };

  const toggleActive = async (u) => {
    try {
      await axios.put(`${API}/settings/staff/${u.user_id}`, { active: !u.active });
      flash(`${u.name} ${u.active ? 'deactivated' : 'reactivated'}.`);
      await load();
    } catch (e) { setErr(e?.response?.data?.detail || 'Update failed'); }
  };

  return (
    <div className="p-6 max-w-5xl" data-testid="settings-staff-tab">
      <div className="flex items-start justify-between mb-4">
        <div>
          <h1 className="text-lg font-bold text-slate-800">Staff Settings</h1>
          <p className="text-[11px] text-slate-500 mt-0.5">Your clinic team and their access. Only active staff can log in.</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setInviteOpen(true)}
            data-testid="staff-invite-btn"
            className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-semibold bg-emerald-600 hover:bg-emerald-700 text-white rounded-md shadow-sm"
          ><Mail size={13} /> Invite by Email</button>
          <button
            onClick={() => setEditing('new')}
            data-testid="staff-new-btn"
            className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-semibold bg-indigo-600 hover:bg-indigo-700 text-white rounded-md shadow-sm"
          ><Plus size={13} /> Add Staff (with password)</button>
        </div>
      </div>

      {msg && <div className="mb-3 flex items-center gap-2 text-xs text-emerald-700 bg-emerald-50 border border-emerald-200 rounded px-3 py-2"><Check size={13} />{msg}</div>}
      {err && <div className="mb-3 flex items-center gap-2 text-xs text-rose-700 bg-rose-50 border border-rose-200 rounded px-3 py-2"><AlertTriangle size={13} />{err}</div>}

      {pendingInvites.length > 0 && (
        <div className="mb-4 bg-amber-50 border border-amber-200 rounded-lg p-3" data-testid="pending-invites-strip">
          <div className="flex items-center gap-2 text-[11px] uppercase tracking-wider font-bold text-amber-900 mb-2">
            <Mail size={12} /> {pendingInvites.length} pending invitation{pendingInvites.length === 1 ? '' : 's'}
          </div>
          <ul className="space-y-1.5 text-xs">
            {pendingInvites.map((inv) => (
              <li key={inv.token_preview} className="flex items-center justify-between gap-2">
                <span className="text-slate-700">
                  <strong>{inv.name}</strong> · {inv.email} ·{' '}
                  <span className="text-slate-500">{ROLE_LABEL[inv.role] || inv.role}</span>{' '}
                  <span className="text-slate-400">— expires {new Date(inv.expires_at).toLocaleDateString()}</span>
                </span>
                <button
                  onClick={async () => {
                    if (!window.confirm(`Revoke invitation to ${inv.email}?`)) return;
                    // Need full token — but we only stored preview. Owner can simply re-invite to overwrite,
                    // but we keep a revoke for the freshly-created link from the modal.
                    setErr('To revoke, re-invite the same email — that will auto-revoke any pending invite for them.');
                  }}
                  className="text-rose-600 hover:text-rose-700 text-[11px] font-semibold inline-flex items-center gap-1"
                  data-testid={`pending-invite-revoke-${inv.token_preview}`}
                ><Trash2 size={11} /> Revoke</button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {loading ? (
        <div className="py-8 text-center text-slate-400 italic text-sm">Loading…</div>
      ) : rows.length === 0 ? (
        <div className="py-8 text-center text-slate-400 italic text-sm" data-testid="staff-empty">No staff yet.</div>
      ) : (
        <div className="bg-white rounded border border-slate-200 overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 border-b border-slate-200 text-[10px] uppercase tracking-wider text-slate-600">
              <tr>
                <th className="px-3 py-2 text-left">Name</th>
                <th className="px-3 py-2 text-left">Email</th>
                <th className="px-3 py-2 text-left">Role</th>
                <th className="px-3 py-2 text-left">Branches</th>
                <th className="px-3 py-2 text-center">Status</th>
                <th className="px-3 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((u) => (
                <tr key={u.user_id} className={`border-t border-slate-100 ${u.active ? '' : 'opacity-60'}`} data-testid={`staff-row-${u.user_id}`}>
                  <td className="px-3 py-2 font-semibold">{u.name}</td>
                  <td className="px-3 py-2 text-xs">{u.email}</td>
                  <td className="px-3 py-2">
                    <span className={`text-[10px] font-bold px-1.5 py-0.5 border rounded ${ROLE_BADGE[u.role] || 'bg-slate-100 text-slate-700 border-slate-200'}`}>
                      {ROLE_LABEL[u.role] || u.role}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-xs text-slate-600">
                    {(u.branch_ids || []).length === 0
                      ? <span className="italic text-slate-400">all branches</span>
                      : `${(u.branch_ids || []).length} branch${(u.branch_ids || []).length > 1 ? 'es' : ''}`}
                  </td>
                  <td className="px-3 py-2 text-center">
                    {u.active
                      ? <span className="text-[10px] font-bold px-1.5 py-0.5 bg-emerald-100 text-emerald-800 border border-emerald-200 rounded">ACTIVE</span>
                      : <span className="text-[10px] font-bold px-1.5 py-0.5 bg-slate-100 text-slate-700 border border-slate-300 rounded">INACTIVE</span>}
                  </td>
                  <td className="px-3 py-2 text-right">
                    <div className="inline-flex gap-1">
                      <button onClick={() => setEditing(u)} data-testid={`staff-edit-${u.user_id}`} className="inline-flex items-center gap-1 text-[10px] font-semibold text-indigo-700 hover:underline px-1"><Pencil size={11} /> Edit</button>
                      <button onClick={() => resetPwd(u)} data-testid={`staff-reset-${u.user_id}`} className="inline-flex items-center gap-1 text-[10px] font-semibold text-amber-700 hover:underline px-1"><Key size={11} /> Reset</button>
                      <button onClick={() => forceLogout(u)} data-testid={`staff-logout-${u.user_id}`} className="inline-flex items-center gap-1 text-[10px] font-semibold text-slate-600 hover:text-rose-600 px-1"><LogOut size={11} /> Logout</button>
                      <button onClick={() => toggleActive(u)} data-testid={`staff-toggle-${u.user_id}`} className={`inline-flex items-center gap-1 text-[10px] font-semibold px-1 ${u.active ? 'text-slate-600 hover:text-rose-600' : 'text-emerald-600 hover:underline'}`}><Power size={11} /> {u.active ? 'Deactivate' : 'Activate'}</button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {editing && (
        <StaffForm
          user={editing === 'new' ? null : editing}
          branches={branches}
          onClose={() => setEditing(null)}
          onCreated={(resp) => { setEditing(null); setPwdModal({ email: resp.user.email, temp_password: resp.temp_password }); load(); }}
          onSaved={() => { setEditing(null); load(); }}
        />
      )}

      {pwdModal && <TempPasswordModal data={pwdModal} onClose={() => setPwdModal(null)} />}
      {inviteOpen && (
        <InviteModal
          branches={branches}
          onClose={() => setInviteOpen(false)}
          onInvited={() => { setInviteOpen(false); load(); flash('Invitation link generated. Share it with your team member.'); }}
        />
      )}
    </div>
  );
}

/* ============================ Invite by Email Modal ============================ */

function InviteModal({ branches, onClose, onInvited }) {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [role, setRole] = useState('audiologist');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [created, setCreated] = useState(null); // {accept_url, email, ...}
  const [copied, setCopied] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    if (!name.trim() || !email.trim()) return;
    setBusy(true); setErr('');
    try {
      const r = await axios.post(`${API}/settings/staff/invite`, {
        name: name.trim(), email: email.trim(), role, branch_ids: [],
      });
      setCreated(r.data);
    } catch (e) {
      setErr(e?.response?.data?.detail || 'Invite failed');
    } finally { setBusy(false); }
  };

  const copy = async () => {
    if (!created) return;
    await navigator.clipboard.writeText(created.accept_url);
    setCopied(true); setTimeout(() => setCopied(false), 2000);
  };

  if (created) {
    return (
      <ModalShell onClose={onInvited} cardClassName="max-w-lg w-full p-5" testid="staff-invite-success">
        <div className="flex items-center gap-2 mb-3">
          <span className="w-8 h-8 rounded-full bg-emerald-100 text-emerald-700 flex items-center justify-center"><Check size={16} /></span>
          <h3 className="text-base font-bold">Invitation ready to share</h3>
        </div>
        <p className="text-xs text-slate-600 mb-4">
          Send this link to <b>{created.email}</b>. They&apos;ll click it, choose their own password, and land in your clinic dashboard.
          The link is single-use and expires on <strong>{new Date(created.expires_at).toLocaleDateString()}</strong>.
        </p>
        <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 flex items-center gap-2">
          <ExternalLink size={14} className="text-[#0B5FFF] shrink-0" />
          <code className="flex-1 text-[11px] font-mono text-slate-800 break-all" data-testid="staff-invite-url">{created.accept_url}</code>
          <button
            onClick={copy}
            data-testid="staff-invite-copy"
            className="text-[11px] inline-flex items-center gap-1 px-2 py-1 rounded font-semibold text-white bg-[#0B5FFF] hover:bg-[#094acf]"
          >
            <Copy size={11} /> {copied ? 'Copied' : 'Copy link'}
          </button>
        </div>
        <p className="mt-3 text-[11px] text-slate-500">
          💡 Share via WhatsApp, email, or Slack. Once they click it, they&apos;ll appear in your staff list.
        </p>
        <div className="flex justify-end mt-4 gap-2">
          <button onClick={onInvited} data-testid="staff-invite-done" className="px-4 py-2 text-xs font-semibold bg-[#0B5FFF] hover:bg-[#094acf] text-white rounded">Done</button>
        </div>
      </ModalShell>
    );
  }

  return (
    <ModalShell onClose={onClose} cardClassName="max-w-md w-full p-5" testid="staff-invite-modal">
      <h3 className="text-base font-bold mb-1">Invite a staff member</h3>
      <p className="text-[11px] text-slate-500 mb-4">
        We&apos;ll generate a single-use invitation link. Your team member sets their own password — you never see or send it.
      </p>
      <form onSubmit={submit} className="space-y-3">
        <label className="block">
          <span className="block text-[11px] uppercase tracking-wider font-bold text-slate-500 mb-1">Full name</span>
          <input value={name} onChange={(e) => setName(e.target.value)} required data-testid="staff-invite-name"
            className="w-full px-3 py-2 rounded border border-slate-200 text-sm focus:ring-2 focus:ring-blue-100 focus:border-[#0B5FFF] outline-none"
            placeholder="Dr. Aditi Krishnan" />
        </label>
        <label className="block">
          <span className="block text-[11px] uppercase tracking-wider font-bold text-slate-500 mb-1">Email</span>
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required data-testid="staff-invite-email"
            className="w-full px-3 py-2 rounded border border-slate-200 text-sm focus:ring-2 focus:ring-blue-100 focus:border-[#0B5FFF] outline-none"
            placeholder="aditi@yourclinic.com" />
        </label>
        <label className="block">
          <span className="block text-[11px] uppercase tracking-wider font-bold text-slate-500 mb-1">Role</span>
          <select value={role} onChange={(e) => setRole(e.target.value)} data-testid="staff-invite-role"
            className="w-full px-3 py-2 rounded border border-slate-200 text-sm focus:ring-2 focus:ring-blue-100 focus:border-[#0B5FFF] outline-none bg-white">
            <option value="clinic_owner">Clinic Owner</option>
            <option value="audiologist">Audiologist</option>
            <option value="front_desk">Front Desk</option>
            <option value="accounts">Accounts</option>
          </select>
        </label>
        {err && <div className="text-xs rounded bg-rose-50 border border-rose-200 text-rose-700 px-3 py-2 flex items-center gap-1.5"><AlertTriangle size={12} /> {err}</div>}
        <div className="flex justify-end gap-2 pt-2">
          <button type="button" onClick={onClose} className="px-3 py-2 text-xs font-semibold border border-slate-300 rounded">Cancel</button>
          <button type="submit" disabled={busy} data-testid="staff-invite-submit"
            className="px-4 py-2 text-xs font-semibold bg-emerald-600 hover:bg-emerald-700 disabled:bg-slate-300 text-white rounded inline-flex items-center gap-1">
            {busy ? 'Generating…' : <><Mail size={12} /> Generate invite link</>}
          </button>
        </div>
      </form>
    </ModalShell>
  );
}

function TempPasswordModal({ data, onClose }) {
  const [copied, setCopied] = useState(false);
  const copy = () => {
    navigator.clipboard.writeText(data.temp_password).then(() => {
      setCopied(true); setTimeout(() => setCopied(false), 2000);
    });
  };
  return (
    <ModalShell onClose={onClose} cardClassName="max-w-md w-full p-5" testid="staff-temp-password-modal">
      <h3 className="text-base font-bold mb-2">Temporary password generated</h3>
      <p className="text-xs text-slate-600 mb-4">
        A copy was emailed to <b>{data.email}</b> (<span className="text-amber-700 font-semibold">MOCKED — real email coming soon</span>). Share it securely until they set their own.
      </p>
      <div className="border border-slate-300 rounded p-3 bg-slate-50 flex items-center justify-between">
        <code className="text-sm font-mono font-bold text-slate-900" data-testid="staff-temp-password-value">{data.temp_password}</code>
        <button onClick={copy} data-testid="staff-temp-password-copy" className="inline-flex items-center gap-1 text-[11px] font-semibold text-indigo-700 hover:underline">
          <Copy size={12} /> {copied ? 'Copied!' : 'Copy'}
        </button>
      </div>
      <div className="flex justify-end mt-4">
        <button onClick={onClose} data-testid="staff-temp-password-close" className="px-3 py-1.5 text-xs font-semibold border border-slate-300 rounded">Done</button>
      </div>
    </ModalShell>
  );
}

function StaffForm({ user, branches, onClose, onCreated, onSaved }) {
  const isEdit = !!user;
  const [f, setF] = useState(() => ({
    name: user?.name || '',
    email: user?.email || '',
    role: user?.role || 'front_desk',
    branch_ids: user?.branch_ids || [],
    phone: user?.phone || '',
  }));
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');

  const save = async () => {
    if (!f.name.trim()) { setErr('Name is required'); return; }
    if (!isEdit && !f.email.trim()) { setErr('Email is required'); return; }
    setErr(''); setSaving(true);
    try {
      if (isEdit) {
        await axios.put(`${API}/settings/staff/${user.user_id}`, {
          name: f.name, role: f.role, branch_ids: f.branch_ids, phone: f.phone,
        });
        onSaved();
      } else {
        const r = await axios.post(`${API}/settings/staff`, f);
        onCreated(r.data);
      }
    } catch (e) {
      const d = e?.response?.data?.detail;
      setErr(typeof d === 'string' ? d : 'Save failed');
    } finally { setSaving(false); }
  };

  const toggleBranch = (bid) => {
    setF((x) => ({ ...x, branch_ids: x.branch_ids.includes(bid) ? x.branch_ids.filter(b => b !== bid) : [...x.branch_ids, bid] }));
  };

  const roleMeta = ROLE_OPTIONS.find(r => r.v === f.role);

  return (
    <ModalShell onClose={onClose} cardClassName="max-w-lg w-full p-5 max-h-[90vh] overflow-auto" testid="staff-form-modal">
      <h3 className="text-base font-bold mb-3">{isEdit ? `Edit ${user.name}` : 'Add New Staff'}</h3>
      {err && <div className="bg-rose-50 text-rose-700 text-xs p-2 rounded mb-2">{err}</div>}
      <div className="grid grid-cols-2 gap-2 text-sm">
        <F label="Name *"><input autoFocus value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} data-testid="staff-field-name" className={inputCls} /></F>
        <F label="Phone"><input value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} data-testid="staff-field-phone" placeholder="+91…" className={inputCls} /></F>
        <F label="Email *" className="col-span-2"><input type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value.toLowerCase() })} data-testid="staff-field-email" disabled={isEdit} placeholder="staff@clinic.in" className={`${inputCls} ${isEdit ? 'bg-slate-50 cursor-not-allowed' : ''}`} /></F>
        <F label="Role *" className="col-span-2">
          <select value={f.role} onChange={(e) => setF({ ...f, role: e.target.value })} data-testid="staff-field-role" className={inputCls}>
            {ROLE_OPTIONS.map(r => <option key={r.v} value={r.v}>{r.l}</option>)}
          </select>
          {roleMeta && <div className="text-[10px] text-slate-500 mt-1">{roleMeta.desc}</div>}
        </F>
        <F label="Branch access" className="col-span-2">
          <div className="border border-slate-300 rounded p-2 max-h-32 overflow-auto">
            {branches.length === 0 && <div className="text-[11px] italic text-slate-400">No branches yet. Create one in the Branches tab.</div>}
            {branches.map((b) => (
              <label key={b.branch_id} className="flex items-center gap-2 text-xs py-0.5">
                <input type="checkbox" checked={f.branch_ids.includes(b.branch_id)} onChange={() => toggleBranch(b.branch_id)} data-testid={`staff-branch-${b.branch_id}`} />
                {b.name}
              </label>
            ))}
            <div className="text-[10px] text-slate-500 mt-1 italic">Leave empty for clinic-wide access (owners + accounts).</div>
          </div>
        </F>
      </div>
      <div className="flex justify-end gap-2 mt-4 pt-3 border-t border-slate-100">
        <button onClick={onClose} className="px-3 py-1.5 text-xs font-semibold border border-slate-300 rounded">Cancel</button>
        <button onClick={save} disabled={saving} data-testid="staff-save" className="px-3 py-1.5 text-xs font-semibold bg-indigo-600 hover:bg-indigo-700 disabled:bg-slate-300 text-white rounded shadow-sm">
          {saving ? 'Saving…' : (isEdit ? 'Save Changes' : 'Create & Email Password')}
        </button>
      </div>
    </ModalShell>
  );
}

const inputCls = 'w-full border border-slate-300 rounded px-2 py-1 text-sm focus:outline-none focus:border-indigo-400';
const F = ({ label, children, className = '' }) => (
  <label className={`block ${className}`}>
    <span className="block text-[10px] uppercase tracking-wider text-slate-500 mb-0.5 font-semibold">{label}</span>
    {children}
  </label>
);
