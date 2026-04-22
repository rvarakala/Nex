/**
 * M13 Patient Portal (Phase 13.D)
 * Separate public auth: phone-OTP (mock in dev). Stores its own JWT
 * under localStorage key `acs.patient.token` to avoid clashing with clinic JWT.
 */
import React, { useEffect, useState } from 'react';
import axios from 'axios';
import { useNavigate, useParams } from 'react-router-dom';

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;
const P_TOKEN = 'acs.patient.token';
const P_META = 'acs.patient.meta';   // JSON stringified patient + clinic_id
const fmtINR = (n) => `₹${Number(n || 0).toLocaleString('en-IN')}`;
const fmtDate = (iso) => (iso ? new Date(iso).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '—');

const getToken = () => localStorage.getItem(P_TOKEN);
const getMeta = () => { try { return JSON.parse(localStorage.getItem(P_META) || 'null'); } catch { return null; } };
const withAuth = () => ({ headers: { Authorization: `Bearer ${getToken()}` } });

export default function PatientPortal() {
  const { clinicId: paramClinic } = useParams();
  const [stage, setStage] = useState('login'); // login | otp | dashboard
  const [clinicId, setClinicId] = useState(paramClinic || 'clinic-acs-demo');
  const [mobile, setMobile] = useState('');
  const [otp, setOtp] = useState('');
  const [devOtp, setDevOtp] = useState('');
  const [patient, setPatient] = useState(null);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const t = getToken();
    const m = getMeta();
    if (t && m) {
      setPatient(m);
      setStage('dashboard');
    }
  }, []);

  const requestOtp = async (e) => {
    e.preventDefault();
    setBusy(true); setErr(''); setDevOtp('');
    try {
      const r = await axios.post(`${API}/patient-portal/request-otp`, { clinic_id: clinicId, mobile });
      if (r.data.dev_note === 'no_matching_patient') {
        setErr('No patient found with that mobile in this clinic.');
      } else {
        if (r.data.dev_otp) setDevOtp(r.data.dev_otp);
        setStage('otp');
      }
    } catch (e) {
      setErr(e?.response?.data?.detail?.message || e?.response?.data?.detail || 'Failed to send OTP');
    } finally { setBusy(false); }
  };

  const verifyOtp = async (e) => {
    e.preventDefault();
    setBusy(true); setErr('');
    try {
      const r = await axios.post(`${API}/patient-portal/verify-otp`, { clinic_id: clinicId, mobile, otp });
      localStorage.setItem(P_TOKEN, r.data.access_token);
      localStorage.setItem(P_META, JSON.stringify(r.data.patient));
      setPatient(r.data.patient);
      setStage('dashboard');
    } catch (e) {
      setErr(e?.response?.data?.detail?.message || e?.response?.data?.detail || 'Invalid OTP');
    } finally { setBusy(false); }
  };

  const logout = () => {
    localStorage.removeItem(P_TOKEN);
    localStorage.removeItem(P_META);
    setStage('login');
    setPatient(null);
    setOtp('');
  };

  if (stage === 'dashboard') return <PatientDashboard patient={patient} onLogout={logout} />;

  return (
    <div className="min-h-screen bg-gradient-to-br from-indigo-900 via-slate-900 to-slate-950 flex items-center justify-center p-4" data-testid="patient-portal-login">
      <div className="w-full max-w-md bg-white/10 backdrop-blur-md rounded-2xl p-8 border border-white/20">
        <div className="text-center mb-6">
          <div className="inline-flex items-center justify-center w-12 h-12 rounded-xl bg-indigo-500/30 mb-3">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 12 A9 9 0 0 1 21 12 V17 A3 3 0 0 1 18 20 H17 V13 H21" /><path d="M3 12 V17 A3 3 0 0 0 6 20 H7 V13 H3" /></svg>
          </div>
          <h1 className="text-xl font-bold text-white">Patient Portal</h1>
          <p className="text-xs text-white/60 mt-1">Access your reports, appointments & services</p>
        </div>

        {stage === 'login' && (
          <form onSubmit={requestOtp} className="space-y-3" data-testid="portal-login-form">
            <Field label="Clinic ID" value={clinicId} onChange={setClinicId} testid="portal-clinic-id" />
            <Field label="Registered mobile" value={mobile} onChange={setMobile} required testid="portal-mobile" autoFocus={!paramClinic} />
            {err && <div className="text-xs text-rose-300 bg-rose-500/20 rounded px-3 py-2">{err}</div>}
            <button disabled={busy} className="w-full py-2.5 text-sm font-semibold text-white bg-indigo-500 hover:bg-indigo-600 rounded-lg disabled:opacity-60" data-testid="portal-request-otp-btn">{busy ? 'Sending…' : 'Send OTP'}</button>
          </form>
        )}

        {stage === 'otp' && (
          <form onSubmit={verifyOtp} className="space-y-3" data-testid="portal-otp-form">
            <div className="text-xs text-white/70">Sent a 6-digit OTP to mobile ending with <b>{mobile.slice(-4)}</b></div>
            {devOtp && <div className="bg-amber-300/20 border border-amber-300/40 text-amber-100 text-xs rounded px-3 py-2">Dev mode OTP: <b className="font-mono">{devOtp}</b></div>}
            <Field label="Enter OTP" value={otp} onChange={setOtp} required autoFocus testid="portal-otp-input" />
            {err && <div className="text-xs text-rose-300 bg-rose-500/20 rounded px-3 py-2">{err}</div>}
            <button disabled={busy} className="w-full py-2.5 text-sm font-semibold text-white bg-indigo-500 hover:bg-indigo-600 rounded-lg disabled:opacity-60" data-testid="portal-verify-otp-btn">{busy ? 'Verifying…' : 'Sign in'}</button>
            <button type="button" onClick={() => { setStage('login'); setOtp(''); }} className="w-full text-xs text-white/60 hover:text-white">Change mobile</button>
          </form>
        )}
      </div>
    </div>
  );
}

const Field = ({ label, value, onChange, type = 'text', required, testid, autoFocus }) => (
  <label className="block">
    <span className="text-[11px] font-semibold text-white/70 uppercase tracking-wider">{label}</span>
    <input data-testid={testid} type={type} value={value || ''} onChange={(e) => onChange(e.target.value)} required={required} autoFocus={autoFocus} className="mt-1 w-full px-3 py-2 text-sm bg-white/10 border border-white/20 text-white placeholder-white/40 rounded-lg focus:border-indigo-400 outline-none" />
  </label>
);

function PatientDashboard({ patient, onLogout }) {
  const [tab, setTab] = useState('overview');
  const [profile, setProfile] = useState(null);
  const [reports, setReports] = useState([]);
  const [appts, setAppts] = useState({ upcoming: [], past: [] });
  const [sales, setSales] = useState([]);
  const [svc, setSvc] = useState([]);
  const [amc, setAmc] = useState([]);
  const [invoices, setInvoices] = useState({ invoices: [], total_outstanding: 0 });
  const [err, setErr] = useState('');
  const [showRequest, setShowRequest] = useState(false);
  const [showFeedback, setShowFeedback] = useState(false);

  const loadAll = async () => {
    setErr('');
    try {
      const h = withAuth();
      const [pr, rp, ap, sl, sv, ac, iv] = await Promise.all([
        axios.get(`${API}/patient-portal/me`, h),
        axios.get(`${API}/patient-portal/me/reports`, h),
        axios.get(`${API}/patient-portal/me/appointments`, h),
        axios.get(`${API}/patient-portal/me/sales`, h),
        axios.get(`${API}/patient-portal/me/service-tickets`, h),
        axios.get(`${API}/patient-portal/me/amc`, h),
        axios.get(`${API}/patient-portal/me/invoices`, h),
      ]);
      setProfile(pr.data.patient); setReports(rp.data.reports || []);
      setAppts(ap.data); setSales(sl.data.sales || []);
      setSvc(sv.data.tickets || []); setAmc(ac.data.contracts || []);
      setInvoices(iv.data);
    } catch (e) {
      if (e?.response?.status === 401) { onLogout(); return; }
      setErr(e?.response?.data?.detail?.message || e?.response?.data?.detail || 'Failed to load');
    }
  };
  useEffect(() => { loadAll(); }, []);

  return (
    <div className="min-h-screen bg-slate-100" data-testid="patient-dashboard">
      <header className="bg-slate-900 text-white px-4 md:px-6 py-4 flex items-center justify-between">
        <div>
          <div className="text-[10px] uppercase tracking-[0.2em] text-indigo-300">Patient Portal</div>
          <div className="text-lg font-bold">Welcome, {profile?.name || patient.name}</div>
          <div className="text-xs text-slate-300">MRD: {profile?.mrd || patient.mrd}</div>
        </div>
        <button onClick={onLogout} className="text-xs px-3 py-1.5 bg-slate-800 hover:bg-slate-700 rounded" data-testid="patient-logout-btn">Sign out</button>
      </header>

      <nav className="bg-white border-b border-slate-200 overflow-x-auto">
        <div className="flex gap-1 px-4 max-w-5xl mx-auto">
          {['overview', 'reports', 'appointments', 'devices', 'invoices'].map((t) => (
            <button
              key={t}
              data-testid={`ptab-${t}`}
              onClick={() => setTab(t)}
              className={`px-4 py-2.5 text-xs font-semibold uppercase tracking-wider border-b-2 ${tab === t ? 'border-indigo-600 text-indigo-700' : 'border-transparent text-slate-500 hover:text-slate-900'}`}>{t}</button>
          ))}
        </div>
      </nav>

      <main className="p-4 md:p-6 max-w-5xl mx-auto space-y-5">
        {err && <div className="text-xs text-rose-700 bg-rose-50 border border-rose-200 rounded px-3 py-2">{err}</div>}

        {tab === 'overview' && (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <PTile label="Reports" v={reports.length} />
            <PTile label="Upcoming appts" v={appts.upcoming.length} />
            <PTile label="Active AMCs" v={amc.filter((a) => a.status === 'active').length} />
            <PTile label="Outstanding" v={fmtINR(invoices.total_outstanding)} tone="rose" />
            <div className="col-span-full bg-white rounded-lg border border-slate-200 p-5">
              <h3 className="text-sm font-bold text-slate-800">Quick actions</h3>
              <div className="flex flex-wrap gap-2 mt-3">
                <button data-testid="patient-request-appt" onClick={() => setShowRequest(true)} className="px-3 py-1.5 text-xs font-semibold text-white bg-indigo-600 hover:bg-indigo-700 rounded">Request appointment</button>
                <button data-testid="patient-feedback" onClick={() => setShowFeedback(true)} className="px-3 py-1.5 text-xs font-semibold text-indigo-700 border border-indigo-300 hover:bg-indigo-50 rounded">Submit feedback</button>
              </div>
            </div>
          </div>
        )}

        {tab === 'reports' && (
          <Section title="My diagnostic reports">
            {reports.length === 0 ? <Empty>No reports yet.</Empty> : reports.map((r) => (
              <Row key={r.session_id} left={<div><div className="font-semibold text-sm">{r.diagnosis || 'Diagnostic report'}</div><div className="text-xs text-slate-500">{fmtDate(r.test_date)}</div></div>} right={<span className="text-[11px] font-mono text-slate-500">{r.session_id}</span>} />
            ))}
          </Section>
        )}

        {tab === 'appointments' && (
          <>
            <Section title="Upcoming">
              {appts.upcoming.length === 0 ? <Empty>No upcoming appointments.</Empty> : appts.upcoming.map((a) => (
                <Row key={a.appointment_id} left={<div><div className="font-semibold text-sm">{a.service_name || a.service || 'Consultation'}</div><div className="text-xs text-slate-500">{fmtDate(a.start_at)}</div></div>} right={<span className="text-[11px] px-2 py-0.5 bg-indigo-100 text-indigo-700 rounded-full font-semibold">{a.status}</span>} />
              ))}
            </Section>
            <Section title="Past">
              {appts.past.length === 0 ? <Empty>No past appointments.</Empty> : appts.past.slice(0, 10).map((a) => (
                <Row key={a.appointment_id} left={<div><div className="font-semibold text-sm">{a.service_name || a.service || 'Consultation'}</div><div className="text-xs text-slate-500">{fmtDate(a.start_at)}</div></div>} right={<span className="text-[11px] text-slate-500">{a.status}</span>} />
              ))}
            </Section>
          </>
        )}

        {tab === 'devices' && (
          <>
            <Section title="Hearing-aid purchases">
              {sales.length === 0 ? <Empty>No purchases yet.</Empty> : sales.map((s) => (
                <Row key={s.sale_no}
                     left={<div><div className="font-mono text-xs text-indigo-700">{s.sale_no}</div><div className="text-xs text-slate-500">{fmtDate(s.created_at)} · {s.lines?.length || 0} item(s)</div></div>}
                     right={<div className="text-right"><div className="font-bold text-sm">{fmtINR(s.total)}</div><div className="text-[10px] text-slate-500">{s.status}</div></div>} />
              ))}
            </Section>
            <Section title="Service tickets">
              {svc.length === 0 ? <Empty>No service requests.</Empty> : svc.map((t) => (
                <Row key={t.ticket_no} left={<div><div className="font-mono text-xs text-indigo-700">{t.ticket_no}</div><div className="text-xs text-slate-500">{t.kind} · {fmtDate(t.created_at)}</div></div>} right={<span className="text-[11px] px-2 py-0.5 bg-slate-200 text-slate-700 rounded-full font-semibold">{t.status}</span>} />
              ))}
            </Section>
            <Section title="AMC contracts">
              {amc.length === 0 ? <Empty>No AMC contracts.</Empty> : amc.map((c) => (
                <Row key={c.contract_no}
                     left={<div><div className="font-mono text-xs text-indigo-700">{c.contract_no}</div><div className="text-xs text-slate-500">Until {fmtDate(c.amc_expiry_date)} · {c.services_used}/{c.plan_snapshot?.included_services || 0} services</div></div>}
                     right={<span className={`text-[11px] px-2 py-0.5 rounded-full font-semibold ${c.status === 'active' ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-200 text-slate-700'}`}>{c.status}</span>} />
              ))}
            </Section>
          </>
        )}

        {tab === 'invoices' && (
          <Section title={`Invoices · Outstanding ${fmtINR(invoices.total_outstanding)}`}>
            {invoices.invoices.length === 0 ? <Empty>No invoices.</Empty> : invoices.invoices.map((i) => (
              <Row key={i.invoice_id}
                   left={<div><div className="font-mono text-xs text-indigo-700">{i.invoice_no || i.invoice_id}</div><div className="text-xs text-slate-500">{fmtDate(i.invoice_date)}</div></div>}
                   right={<div className="text-right"><div className="font-bold text-sm">{fmtINR(i.grand_total || i.total)}</div><div className={`text-[10px] font-semibold uppercase tracking-wider ${i.status === 'paid' ? 'text-emerald-700' : 'text-amber-700'}`}>{i.status}</div></div>} />
            ))}
          </Section>
        )}
      </main>

      {showRequest && <AppointmentRequest onClose={() => setShowRequest(false)} onSaved={() => { setShowRequest(false); loadAll(); }} />}
      {showFeedback && <FeedbackModal onClose={() => setShowFeedback(false)} onSaved={() => setShowFeedback(false)} />}
    </div>
  );
}

const PTile = ({ label, v, tone }) => (
  <div className={`rounded-lg p-4 border ${tone === 'rose' ? 'bg-rose-50 border-rose-200 text-rose-900' : 'bg-white border-slate-200 text-slate-900'}`}>
    <div className="text-[10px] font-semibold uppercase tracking-wider opacity-70">{label}</div>
    <div className="text-2xl font-bold mt-1">{v}</div>
  </div>
);

const Section = ({ title, children }) => (
  <div className="bg-white rounded-lg border border-slate-200 overflow-hidden">
    <div className="px-4 py-2 bg-slate-50 border-b text-xs font-bold uppercase tracking-wider text-slate-700">{title}</div>
    <div className="divide-y divide-slate-100">{children}</div>
  </div>
);

const Row = ({ left, right }) => (
  <div className="px-4 py-2.5 flex items-center justify-between">{left}{right}</div>
);

const Empty = ({ children }) => <div className="px-4 py-6 text-center text-sm text-slate-500">{children}</div>;

const AppointmentRequest = ({ onClose, onSaved }) => {
  const [start, setStart] = useState('');
  const [service, setService] = useState('');
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const submit = async (e) => {
    e.preventDefault();
    setBusy(true); setErr('');
    try {
      await axios.post(`${API}/patient-portal/me/appointment-request`, {
        start_at: new Date(start).toISOString(),
        service, notes,
      }, withAuth());
      onSaved();
    } catch (e) { setErr(e?.response?.data?.detail?.message || 'Failed'); }
    finally { setBusy(false); }
  };
  return (
    <Modal title="Request an appointment" onClose={onClose}>
      <form onSubmit={submit} className="space-y-3" data-testid="patient-appt-request-form">
        <Field2 label="Preferred date/time" type="datetime-local" value={start} onChange={setStart} required />
        <Field2 label="Service" value={service} onChange={setService} placeholder="e.g. HA follow-up" />
        <Field2 label="Notes" value={notes} onChange={setNotes} />
        {err && <div className="text-xs text-rose-700">{err}</div>}
        <div className="flex justify-end gap-2 pt-1"><button type="button" onClick={onClose} className="px-3 py-1.5 text-xs text-slate-600">Cancel</button><button disabled={busy} className="px-3 py-1.5 text-xs font-semibold text-white bg-indigo-600 rounded">{busy ? 'Submitting…' : 'Submit'}</button></div>
      </form>
    </Modal>
  );
};

const FeedbackModal = ({ onClose, onSaved }) => {
  const [rating, setRating] = useState(5);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      await axios.post(`${API}/patient-portal/me/feedback`, { rating, message }, withAuth());
      onSaved();
    } finally { setBusy(false); }
  };
  return (
    <Modal title="Your feedback" onClose={onClose}>
      <form onSubmit={submit} className="space-y-3" data-testid="patient-feedback-form">
        <label className="block">
          <span className="text-[11px] font-semibold text-slate-600 uppercase tracking-wider">Rating</span>
          <div className="flex gap-1 mt-1">
            {[1, 2, 3, 4, 5].map((n) => (
              <button type="button" key={n} onClick={() => setRating(n)} className={`w-9 h-9 rounded ${rating >= n ? 'bg-amber-400 text-white' : 'bg-slate-100 text-slate-400'}`}>★</button>
            ))}
          </div>
        </label>
        <Field2 label="Message" value={message} onChange={setMessage} required textarea />
        <div className="flex justify-end gap-2"><button type="button" onClick={onClose} className="px-3 py-1.5 text-xs text-slate-600">Cancel</button><button disabled={busy || !message} className="px-3 py-1.5 text-xs font-semibold text-white bg-indigo-600 rounded disabled:opacity-50">Submit</button></div>
      </form>
    </Modal>
  );
};

const Modal = ({ title, onClose, children }) => (
  <div className="fixed inset-0 bg-slate-900/50 flex items-end md:items-center justify-center z-40 p-4">
    <div className="bg-white rounded-xl shadow-xl w-full max-w-md">
      <div className="px-5 py-3 border-b flex items-center justify-between">
        <h3 className="text-base font-bold">{title}</h3>
        <button onClick={onClose} className="text-slate-400 hover:text-slate-700 text-2xl leading-none">×</button>
      </div>
      <div className="p-5">{children}</div>
    </div>
  </div>
);

const Field2 = ({ label, value, onChange, type = 'text', required, placeholder, textarea }) => (
  <label className="block">
    <span className="text-[11px] font-semibold text-slate-600 uppercase tracking-wider">{label}</span>
    {textarea ? (
      <textarea value={value || ''} onChange={(e) => onChange(e.target.value)} required={required} placeholder={placeholder} rows={3} className="mt-1 w-full px-2 py-1.5 text-sm border border-slate-300 rounded" />
    ) : (
      <input type={type} value={value || ''} onChange={(e) => onChange(e.target.value)} required={required} placeholder={placeholder} className="mt-1 w-full px-2 py-1.5 text-sm border border-slate-300 rounded" />
    )}
  </label>
);
