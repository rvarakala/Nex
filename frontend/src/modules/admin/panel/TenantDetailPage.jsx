import React, { useEffect, useState } from 'react';
import axios from 'axios';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { PageHeader, Card, Pill, tierTone, fmtINR, fmtInt, fmtDate, fmtDateTime, Empty } from './shared';
import { ArrowLeft, UserCog, PauseCircle, PlayCircle, Download, UserPlus, RefreshCw, Eye, EyeOff, Copy, CheckCircle2 } from 'lucide-react';
import { useAuth } from '../../../AuthContext';
import { RazorpayPayTenantInvoiceButton, RazorpayRefundTenantInvoiceButton, RazorpayReconcileButton } from './RazorpayTenantInvoiceActions';

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;

export default function TenantDetailPage() {
  const { clinicId } = useParams();
  const [d, setD] = useState(null);
  const [tab, setTab] = useState('overview');
  const [err, setErr] = useState('');
  const [showInvoice, setShowInvoice] = useState(false);
  const { loginWithToken } = useAuth();
  const navigate = useNavigate();

  const load = async () => {
    try {
      const r = await axios.get(`${API}/admin/v2/tenants/${clinicId}`);
      setD(r.data); setErr('');
    } catch (e) {
      setErr(e?.response?.data?.detail?.message || e?.response?.data?.detail || 'Failed to load');
    }
  };
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [clinicId]);

  const impersonate = async () => {
    const r = await axios.post(`${API}/admin/v2/tenants/${clinicId}/impersonate`);
    await loginWithToken(r.data.access_token);
    navigate('/patients');
  };
  const suspendToggle = async () => {
    const verb = d.tenant.status === 'suspended' ? 'activate' : 'suspend';
    await axios.post(`${API}/admin/v2/tenants/${clinicId}/${verb}`);
    load();
  };

  const [exporting, setExporting] = useState(false);
  const [showCreateUser, setShowCreateUser] = useState(false);
  const [createdUserInfo, setCreatedUserInfo] = useState(null); // {email, password, role} after creation
  const exportTenantData = async () => {
    if (!window.confirm(`Export all data for ${d?.tenant?.name || clinicId}? This will be logged in the tenant's audit trail.`)) return;
    setExporting(true);
    try {
      const r = await axios.get(`${API}/export/full`, {
        params: { clinic_id: clinicId },
        responseType: 'blob',
      });
      const cd = r.headers['content-disposition'] || '';
      const m = cd.match(/filename="?([^"]+)"?/);
      const filename = m ? m[1] : `audinexa-${clinicId}-${Date.now()}.zip`;
      const url = URL.createObjectURL(r.data);
      const a = document.createElement('a');
      a.href = url; a.download = filename;
      document.body.appendChild(a); a.click(); a.remove();
      URL.revokeObjectURL(url);
    } catch (e) {
      alert(e?.response?.data?.detail || 'Export failed');
    } finally {
      setExporting(false);
    }
  };

  if (err) return <div className="p-6 text-rose-700">{err}</div>;
  if (!d) return <div className="p-6 text-slate-500">Loading tenant…</div>;

  const { tenant, users, branches, usage, invoices, feature_flags, audit_trail } = d;

  return (
    <div className="p-6 space-y-5" data-testid="tenant-detail-page">
      <div>
        <button onClick={() => navigate('/admin/tenants')} className="text-xs text-slate-500 hover:text-slate-800 flex items-center gap-1 mb-2">
          <ArrowLeft size={13} /> All tenants
        </button>
        <PageHeader title={tenant.name || tenant.clinic_id} subtitle={`${tenant.clinic_id} · ${tenant.city || ''} ${tenant.state || ''}`}>
          <Pill tone={tierTone(tenant.effective_tier)}>{tenant.effective_tier}</Pill>
          <Pill tone={tenant.status === 'suspended' ? 'rose' : 'emerald'}>{tenant.status || 'active'}</Pill>
          <button onClick={impersonate} className="px-3 py-1.5 text-xs font-semibold text-white bg-fuchsia-600 hover:bg-fuchsia-700 rounded-md flex items-center gap-1" data-testid="tenant-detail-impersonate">
            <UserCog size={13} /> Impersonate
          </button>
          <button onClick={suspendToggle} className={`px-3 py-1.5 text-xs font-semibold text-white rounded-md flex items-center gap-1 ${tenant.status === 'suspended' ? 'bg-emerald-600 hover:bg-emerald-700' : 'bg-amber-600 hover:bg-amber-700'}`}>
            {tenant.status === 'suspended' ? <><PlayCircle size={13} /> Activate</> : <><PauseCircle size={13} /> Suspend</>}
          </button>
          <button onClick={() => setShowInvoice(true)} className="px-3 py-1.5 text-xs font-semibold text-indigo-700 border border-indigo-200 hover:bg-indigo-50 rounded-md" data-testid="tenant-new-invoice">+ Invoice</button>
          <button
            onClick={exportTenantData}
            disabled={exporting}
            data-testid="tenant-detail-export"
            title="Download this clinic's complete dataset as ZIP (CSVs + metadata)"
            className="px-3 py-1.5 text-xs font-semibold text-emerald-700 border border-emerald-200 hover:bg-emerald-50 disabled:opacity-60 rounded-md flex items-center gap-1"
          >
            <Download size={13} /> {exporting ? 'Exporting…' : 'Export Data'}
          </button>
        </PageHeader>
      </div>

      {/* Tabs */}
      <div className="border-b border-slate-200 flex gap-4">
        {['overview', 'usage', 'users', 'billing', 'features', 'audit'].map((t) => (
          <button key={t} data-testid={`tab-${t}`} onClick={() => setTab(t)}
            className={`px-1 py-2 -mb-px text-sm font-semibold border-b-2 capitalize ${tab === t ? 'border-indigo-600 text-indigo-700' : 'border-transparent text-slate-500 hover:text-slate-800'}`}>
            {t === 'audit' ? 'Audit trail' : t}
          </button>
        ))}
      </div>

      {tab === 'overview' && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <Card title="Primary Contact"><div className="p-5 text-sm space-y-1">
            <div><span className="text-slate-500">Email:</span> {tenant.email || '—'}</div>
            <div><span className="text-slate-500">Phone:</span> {tenant.phone || '—'}</div>
            <div><span className="text-slate-500">MRD prefix:</span> {tenant.mrd_prefix || '—'}</div>
            <div><span className="text-slate-500">Signup source:</span> {tenant.signup_source || 'n/a'}</div>
            <div><span className="text-slate-500">Created:</span> {fmtDate(tenant.created_at)}</div>
          </div></Card>
          <Card title="Subscription"><div className="p-5 text-sm space-y-1">
            <div><span className="text-slate-500">Stored tier:</span> <Pill tone={tierTone(tenant.subscription_tier || 'BASIC')}>{tenant.subscription_tier || 'BASIC'}</Pill></div>
            <div><span className="text-slate-500">Effective:</span> <Pill tone={tierTone(tenant.effective_tier)}>{tenant.effective_tier}</Pill></div>
            <div><span className="text-slate-500">Trial ends:</span> {fmtDate(tenant.trial_ends_at)}</div>
            <div><span className="text-slate-500">Branches:</span> {branches.length}</div>
            <div><span className="text-slate-500">Active users:</span> {users.filter((u) => u.active).length}</div>
          </div></Card>
          <Card title="Activity Summary"><div className="p-5 text-sm space-y-1">
            <div><span className="text-slate-500">Patients registered:</span> <b>{fmtInt(usage.patients)}</b></div>
            <div><span className="text-slate-500">Diagnostic sessions:</span> {fmtInt(usage.test_sessions)}</div>
            <div><span className="text-slate-500">Clinic invoices:</span> {fmtInt(usage.invoices)}</div>
            <div><span className="text-slate-500">HA sales:</span> {fmtInt(usage.ha_sales)}</div>
            <div><span className="text-slate-500">Service tickets:</span> {fmtInt(usage.service_tickets)}</div>
          </div></Card>
        </div>
      )}

      {tab === 'usage' && (
        <Card title="Usage metrics">
          <div className="p-5 grid grid-cols-2 md:grid-cols-5 gap-4">
            {Object.entries(usage).map(([k, v]) => (
              <div key={k} className="bg-slate-50 rounded-lg p-3 text-center">
                <div className="text-[10px] uppercase tracking-wider text-slate-500 font-semibold">{k.replace(/_/g, ' ')}</div>
                <div className="text-xl font-bold mt-1">{fmtInt(v)}</div>
              </div>
            ))}
          </div>
        </Card>
      )}

      {tab === 'users' && (
        <Card
          title="Users"
          actions={
            <button
              onClick={() => setShowCreateUser(true)}
              data-testid="tenant-create-user-btn"
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-white bg-indigo-600 hover:bg-indigo-700 rounded"
            >
              <UserPlus size={13} /> Create User
            </button>
          }
        >
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-[10px] uppercase tracking-wider text-slate-500">
              <tr>
                <th className="px-4 py-2 text-left">Name</th>
                <th className="px-4 py-2 text-left">Email</th>
                <th className="px-4 py-2 text-left">Role</th>
                <th className="px-4 py-2 text-center">Active</th>
                <th className="px-4 py-2 text-left">Branches</th>
                <th className="px-4 py-2 text-left">Created</th>
              </tr>
            </thead>
            <tbody>
              {users.map((u) => (
                <tr key={u.user_id} className="border-t border-slate-100">
                  <td className="px-4 py-2 font-semibold">{u.name || u.user_id}</td>
                  <td className="px-4 py-2 text-xs">{u.email}</td>
                  <td className="px-4 py-2 text-xs"><Pill tone="indigo">{u.role}</Pill></td>
                  <td className="px-4 py-2 text-center">{u.active ? '✓' : '—'}</td>
                  <td className="px-4 py-2 text-xs">{(u.branch_ids || []).length}</td>
                  <td className="px-4 py-2 text-xs text-slate-500">{fmtDate(u.created_at)}</td>
                </tr>
              ))}
              {users.length === 0 && <tr><td colSpan={6}><Empty>No users.</Empty></td></tr>}
            </tbody>
          </table>
        </Card>
      )}

      {showCreateUser && (
        <CreateTenantUserModal
          clinicId={clinicId}
          clinicName={tenant.name}
          onClose={() => setShowCreateUser(false)}
          onCreated={(info) => {
            setShowCreateUser(false);
            setCreatedUserInfo(info);
            load();
          }}
        />
      )}
      {createdUserInfo && (
        <UserCreatedReceiptModal info={createdUserInfo} onClose={() => setCreatedUserInfo(null)} />
      )}

      {tab === 'billing' && (
        <Card title="Tenant invoices (SaaS billing)">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-[10px] uppercase tracking-wider text-slate-500">
              <tr>
                <th className="px-4 py-2 text-left">Invoice</th>
                <th className="px-4 py-2 text-left">Tier</th>
                <th className="px-4 py-2 text-left">Duration</th>
                <th className="px-4 py-2 text-right">Base</th>
                <th className="px-4 py-2 text-right">GST</th>
                <th className="px-4 py-2 text-right">Grand Total</th>
                <th className="px-4 py-2 text-center">Status</th>
                <th className="px-4 py-2 text-left">Issued</th>
                <th className="px-4 py-2 text-right"></th>
              </tr>
            </thead>
            <tbody>
              {invoices.map((i) => (
                <tr key={i.invoice_id} className="border-t border-slate-100">
                  <td className="px-4 py-2 font-mono text-xs text-indigo-700">{i.invoice_id}</td>
                  <td className="px-4 py-2"><Pill tone={tierTone(i.tier)}>{i.tier}</Pill></td>
                  <td className="px-4 py-2 text-xs capitalize">{i.duration.replace('_', ' ')}</td>
                  <td className="px-4 py-2 text-right text-xs">{fmtINR(i.base_amount)}</td>
                  <td className="px-4 py-2 text-right text-xs">{fmtINR(i.gst_amount)}</td>
                  <td className="px-4 py-2 text-right font-bold">{fmtINR(i.grand_total)}</td>
                  <td className="px-4 py-2 text-center"><Pill tone={
                    i.status === 'paid' ? 'emerald' :
                    i.status === 'refunded' ? 'rose' :
                    i.status === 'partially_refunded' ? 'amber' : 'amber'
                  }>{i.status?.replace(/_/g, ' ')}</Pill></td>
                  <td className="px-4 py-2 text-xs text-slate-500">{fmtDate(i.issued_at)}</td>
                  <td className="px-4 py-2 text-right">
                    {i.status === 'pending' && (
                      <span className="inline-flex items-center gap-2 flex-wrap justify-end">
                        <RazorpayReconcileButton invoice={i} onReconciled={load} />
                        <RazorpayPayTenantInvoiceButton invoice={i} onPaid={load} />
                        <button onClick={async () => { await axios.post(`${API}/admin/v2/subscriptions/invoices/${i.invoice_id}/mark-paid`); load(); }}
                          className="text-xs text-emerald-700 hover:underline">Mark paid</button>
                      </span>
                    )}
                    {(i.status === 'paid' || i.status === 'partially_refunded') && i.razorpay_payment_id && (
                      <RazorpayRefundTenantInvoiceButton invoice={i} onRefunded={load} />
                    )}
                  </td>
                </tr>
              ))}
              {invoices.length === 0 && <tr><td colSpan={9}><Empty>No SaaS invoices issued. Click "+ Invoice" to create one.</Empty></td></tr>}
            </tbody>
          </table>
        </Card>
      )}

      {tab === 'features' && (
        <Card title="Feature flags (additive toggles)" testid="tenant-feature-flags">
          <FeatureFlagsEditor clinicId={clinicId} initial={feature_flags} onSaved={load} />
        </Card>
      )}

      {tab === 'audit' && (
        <Card title="Admin actions on this tenant">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-[10px] uppercase tracking-wider text-slate-500">
              <tr>
                <th className="px-4 py-2 text-left">When</th>
                <th className="px-4 py-2 text-left">Actor</th>
                <th className="px-4 py-2 text-left">Action</th>
                <th className="px-4 py-2 text-left">IP</th>
              </tr>
            </thead>
            <tbody>
              {audit_trail.map((a) => (
                <tr key={a.log_id} className="border-t border-slate-100">
                  <td className="px-4 py-2 text-xs text-slate-500">{fmtDateTime(a.at)}</td>
                  <td className="px-4 py-2 text-xs">{a.actor_email}<div className="text-[10px] text-slate-500">{a.actor_role}</div></td>
                  <td className="px-4 py-2 text-xs font-semibold">{a.action}</td>
                  <td className="px-4 py-2 text-[10px] font-mono text-slate-500">{a.ip || '—'}</td>
                </tr>
              ))}
              {audit_trail.length === 0 && <tr><td colSpan={4}><Empty>No admin actions logged for this tenant yet.</Empty></td></tr>}
            </tbody>
          </table>
        </Card>
      )}

      {showInvoice && <NewInvoiceModal clinicId={clinicId} onClose={() => setShowInvoice(false)} onSaved={() => { setShowInvoice(false); load(); }} />}
    </div>
  );
}

const FeatureFlagsEditor = ({ clinicId, initial, onSaved }) => {
  const [extra, setExtra] = useState(initial.extra_modules || []);
  const [disabled, setDisabled] = useState(initial.disabled_modules || []);
  const [busy, setBusy] = useState(false);
  const base = new Set(initial.base_modules || []);
  const effective = new Set([...base, ...extra].filter((m) => !disabled.includes(m)));

  const toggle = (code, mode) => {
    if (mode === 'extra') {
      setExtra((xs) => xs.includes(code) ? xs.filter((x) => x !== code) : [...xs, code]);
      setDisabled((xs) => xs.filter((x) => x !== code));
    } else {
      setDisabled((xs) => xs.includes(code) ? xs.filter((x) => x !== code) : [...xs, code]);
      setExtra((xs) => xs.filter((x) => x !== code));
    }
  };

  const save = async () => {
    setBusy(true);
    try {
      await axios.put(`${API}/admin/v2/feature-flags/${clinicId}`, { extra_modules: extra, disabled_modules: disabled });
      onSaved();
    } finally { setBusy(false); }
  };

  return (
    <div className="p-5 space-y-3">
      <p className="text-xs text-slate-500">Tier gives <b>{initial.base_modules.length}</b> modules. Add overrides below — additive toggles stack on top of the plan.</p>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
        {initial.available_modules.map((m) => {
          const isBase = base.has(m.code);
          const isExtra = extra.includes(m.code);
          const isDisabled = disabled.includes(m.code);
          const isEffective = effective.has(m.code);
          return (
            <div key={m.code} data-testid={`flag-${m.code}`} className={`flex items-center justify-between p-3 rounded-lg border ${isEffective ? 'bg-emerald-50 border-emerald-200' : 'bg-slate-50 border-slate-200'}`}>
              <div>
                <div className="text-sm font-semibold">{m.label}</div>
                <div className="text-[10px] text-slate-500">{m.code} · {m.category}</div>
              </div>
              <div className="flex gap-1">
                {isBase ? (
                  <button onClick={() => toggle(m.code, 'disabled')}
                    className={`text-[10px] px-2 py-1 rounded ${isDisabled ? 'bg-rose-600 text-white' : 'bg-white border border-slate-300 text-slate-600'}`}>
                    {isDisabled ? 'Disabled' : 'Tier-enabled'}
                  </button>
                ) : (
                  <button onClick={() => toggle(m.code, 'extra')}
                    className={`text-[10px] px-2 py-1 rounded ${isExtra ? 'bg-indigo-600 text-white' : 'bg-white border border-slate-300 text-slate-600'}`}>
                    {isExtra ? 'Added' : 'Add'}
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>
      <div className="flex justify-end">
        <button disabled={busy} onClick={save} className="px-4 py-1.5 text-sm font-semibold text-white bg-indigo-600 hover:bg-indigo-700 rounded disabled:opacity-50" data-testid="flags-save-btn">
          {busy ? 'Saving…' : 'Save flags'}
        </button>
      </div>
    </div>
  );
};

const NewInvoiceModal = ({ clinicId, onClose, onSaved }) => {
  const [tier, setTier] = useState('PREMIUM');
  const [duration, setDuration] = useState('annual');
  const [override, setOverride] = useState('');
  const [coupon, setCoupon] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const submit = async (e) => {
    e.preventDefault(); setBusy(true); setErr('');
    try {
      const body = { clinic_id: clinicId, tier, duration };
      if (override) body.amount_override = parseFloat(override);
      if (coupon) body.coupon_code = coupon;
      await axios.post(`${API}/admin/v2/subscriptions/invoices`, body);
      onSaved();
    } catch (e) { setErr(e?.response?.data?.detail?.message || 'Failed'); }
    finally { setBusy(false); }
  };
  return (
    <div className="fixed inset-0 bg-slate-900/50 flex items-center justify-center z-40 p-4">
      <form onSubmit={submit} className="bg-white rounded-xl shadow-xl p-6 w-full max-w-md space-y-3" data-testid="new-invoice-form">
        <h3 className="text-base font-bold">Issue SaaS Invoice</h3>
        <label className="block text-sm">Tier
          <select value={tier} onChange={(e) => setTier(e.target.value)} className="mt-1 w-full px-2 py-1.5 border border-slate-300 rounded">
            <option value="BASIC">Basic</option><option value="STANDARD">Standard</option><option value="PREMIUM">Premium</option>
          </select>
        </label>
        <label className="block text-sm">Duration
          <select value={duration} onChange={(e) => setDuration(e.target.value)} className="mt-1 w-full px-2 py-1.5 border border-slate-300 rounded">
            <option value="annual">Annual</option><option value="half_yearly">Half-yearly</option><option value="quarterly">Quarterly</option>
          </select>
        </label>
        <label className="block text-sm">Override ₹ (optional)
          <input type="number" value={override} onChange={(e) => setOverride(e.target.value)} placeholder="e.g. 10999" className="mt-1 w-full px-2 py-1.5 border border-slate-300 rounded" />
        </label>
        <label className="block text-sm">Coupon code (optional)
          <input value={coupon} onChange={(e) => setCoupon(e.target.value)} className="mt-1 w-full px-2 py-1.5 border border-slate-300 rounded" />
        </label>
        {err && <div className="text-xs text-rose-700">{err}</div>}
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className="px-3 py-1.5 text-xs text-slate-600">Cancel</button>
          <button disabled={busy} className="px-3 py-1.5 text-xs font-semibold text-white bg-indigo-600 rounded disabled:opacity-50">Issue</button>
        </div>
      </form>
    </div>
  );
};


// ============================================================================
// Create Tenant User Modal — admin manually provisions a clinic user.
// Founder / Super Admin flow: support rep on a call with a new clinic owner
// types their credentials live; no invite-accept dance.
// ============================================================================

const CLINIC_ROLES = [
  { value: 'clinic_owner',      label: 'Clinic Owner — full admin' },
  { value: 'front_desk',        label: 'Front Desk — reception / registrations' },
  { value: 'audiologist',       label: 'Audiologist — hearing tests + fittings' },
  { value: 'accounts',          label: 'Accounts — billing + closeout' },
  { value: 'inventory_manager', label: 'Inventory Manager — stock + procurement' },
  { value: 'technician',        label: 'Technician — repairs' },
  { value: 'referral_partner',  label: 'Referral Partner — portal access' },
];

function generatePassword() {
  // 14-char mix of upper/lower/digits/symbols (easy to read aloud on a call).
  const upper = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  const lower = 'abcdefghijkmnpqrstuvwxyz';
  const digit = '23456789';
  const sym   = '@#$%*';
  const pools = [upper, lower, digit, sym];
  let out = '';
  for (let i = 0; i < 14; i += 1) {
    const pool = pools[i % 4];
    out += pool[Math.floor(Math.random() * pool.length)];
  }
  // Shuffle so the char-class pattern isn't predictable.
  return out.split('').sort(() => Math.random() - 0.5).join('');
}

const CreateTenantUserModal = ({ clinicId, clinicName, onClose, onCreated }) => {
  const [f, setF] = useState({
    name: '', email: '', password: generatePassword(), role: 'clinic_owner',
  });
  const [showPw, setShowPw] = useState(true);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true); setErr('');
    try {
      await axios.post(`${API}/admin/v2/tenant-users`, {
        clinic_id: clinicId,
        name: f.name.trim(),
        email: f.email.trim().toLowerCase(),
        password: f.password,
        role: f.role,
      });
      onCreated({ email: f.email.trim().toLowerCase(), password: f.password, role: f.role, name: f.name.trim(), clinicName });
    } catch (e2) {
      const d = e2?.response?.data?.detail;
      setErr(typeof d === 'string' ? d : (d?.message || 'Failed to create user'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-slate-900/50 flex items-center justify-center z-40 p-4">
      <form onSubmit={submit} className="bg-white rounded-xl shadow-xl p-6 w-full max-w-lg space-y-3" data-testid="create-tenant-user-form">
        <div>
          <h3 className="text-base font-bold text-slate-800">Create user for {clinicName}</h3>
          <p className="text-[11px] text-slate-500 mt-0.5">Account is created immediately with the email + password below. Share credentials over a secure channel.</p>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <label className="block text-sm">Name
            <input required value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })}
              data-testid="create-user-name"
              className="mt-0.5 w-full px-2 py-1.5 border border-slate-300 rounded text-sm" />
          </label>
          <label className="block text-sm">Email
            <input required type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })}
              data-testid="create-user-email"
              className="mt-0.5 w-full px-2 py-1.5 border border-slate-300 rounded text-sm" />
          </label>
        </div>

        <label className="block text-sm">Password
          <div className="mt-0.5 flex items-center gap-1">
            <div className="relative flex-1">
              <input required type={showPw ? 'text' : 'password'} minLength={8}
                value={f.password}
                onChange={(e) => setF({ ...f, password: e.target.value })}
                data-testid="create-user-password"
                className="w-full px-2 py-1.5 pr-8 border border-slate-300 rounded text-sm font-mono"
              />
              <button type="button" onClick={() => setShowPw((v) => !v)}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-700"
                title={showPw ? 'Hide' : 'Show'}
              >
                {showPw ? <EyeOff size={14} /> : <Eye size={14} />}
              </button>
            </div>
            <button type="button" onClick={() => setF((cur) => ({ ...cur, password: generatePassword() }))}
              data-testid="create-user-regen-password"
              className="inline-flex items-center gap-1 px-2 py-1.5 text-[11px] font-semibold text-indigo-700 border border-indigo-200 bg-indigo-50 hover:bg-indigo-100 rounded"
            >
              <RefreshCw size={12} /> New
            </button>
          </div>
          <p className="text-[10px] text-slate-500 mt-1">Min 8 characters. User can change it after first login.</p>
        </label>

        <label className="block text-sm">Role
          <select value={f.role} onChange={(e) => setF({ ...f, role: e.target.value })}
            data-testid="create-user-role"
            className="mt-0.5 w-full px-2 py-1.5 border border-slate-300 rounded text-sm"
          >
            {CLINIC_ROLES.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
          </select>
        </label>

        {err && <div className="text-xs text-rose-700 bg-rose-50 border border-rose-200 rounded px-2 py-1.5">{err}</div>}

        <div className="flex justify-end gap-2 pt-1">
          <button type="button" onClick={onClose} data-testid="create-user-cancel" className="px-3 py-1.5 text-xs text-slate-600 hover:bg-slate-100 rounded">Cancel</button>
          <button disabled={busy} data-testid="create-user-submit"
            className="inline-flex items-center gap-1 px-4 py-1.5 text-xs font-semibold text-white bg-indigo-600 hover:bg-indigo-700 rounded disabled:opacity-50"
          >
            <UserPlus size={13} /> {busy ? 'Creating…' : 'Create user'}
          </button>
        </div>
      </form>
    </div>
  );
};

// Post-create receipt — shows credentials one time + copy buttons.
const UserCreatedReceiptModal = ({ info, onClose }) => {
  const [copied, setCopied] = useState('');
  const copy = (text, which) => {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(which);
      setTimeout(() => setCopied(''), 1500);
    });
  };
  const copyBoth = () => copy(`Email: ${info.email}\nPassword: ${info.password}`, 'both');

  return (
    <div className="fixed inset-0 bg-slate-900/50 flex items-center justify-center z-40 p-4">
      <div className="bg-white rounded-xl shadow-xl p-6 w-full max-w-md space-y-4" data-testid="user-created-receipt">
        <div className="flex items-start gap-3">
          <div className="w-10 h-10 rounded-full bg-emerald-100 text-emerald-700 flex items-center justify-center shrink-0">
            <CheckCircle2 size={20} />
          </div>
          <div>
            <h3 className="text-base font-bold text-slate-800">User created</h3>
            <p className="text-[12px] text-slate-500 mt-0.5">
              <b>{info.name}</b> has been added to <b>{info.clinicName}</b> as <Pill tone="indigo">{info.role}</Pill>. Share these credentials securely — the password won't be shown again.
            </p>
          </div>
        </div>

        <div className="space-y-2">
          <CredentialRow label="Email" value={info.email} onCopy={() => copy(info.email, 'email')} copied={copied === 'email'} />
          <CredentialRow label="Password" value={info.password} onCopy={() => copy(info.password, 'password')} copied={copied === 'password'} mono />
        </div>

        <div className="flex justify-between items-center pt-1">
          <button type="button" onClick={copyBoth}
            data-testid="receipt-copy-both"
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-[11px] font-semibold text-indigo-700 border border-indigo-200 bg-indigo-50 hover:bg-indigo-100 rounded"
          >
            <Copy size={12} /> {copied === 'both' ? 'Copied!' : 'Copy both'}
          </button>
          <button type="button" onClick={onClose} data-testid="receipt-close"
            className="px-4 py-1.5 text-xs font-semibold text-white bg-slate-800 hover:bg-slate-900 rounded"
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
};

const CredentialRow = ({ label, value, onCopy, copied, mono = false }) => (
  <div className="border border-slate-200 rounded-lg px-3 py-2 flex items-center justify-between gap-2">
    <div className="min-w-0 flex-1">
      <div className="text-[10px] uppercase tracking-wider font-bold text-slate-500">{label}</div>
      <div className={`text-[13px] text-slate-900 truncate ${mono ? 'font-mono' : 'font-semibold'}`}>{value}</div>
    </div>
    <button type="button" onClick={onCopy}
      className={`shrink-0 inline-flex items-center gap-1 px-2 py-1 text-[11px] font-semibold rounded transition-colors ${
        copied ? 'text-emerald-700 bg-emerald-50 border border-emerald-200' : 'text-slate-600 hover:bg-slate-100 border border-slate-200'
      }`}
    >
      {copied ? <CheckCircle2 size={11} /> : <Copy size={11} />}
      {copied ? 'Copied' : 'Copy'}
    </button>
  </div>
);
