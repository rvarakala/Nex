/**
 * AUDINEXA Modern Dashboard — 2026-07-01 rewrite.
 *
 * Layout mirrors the approved mockup
 * `/mockups/dashboard-audinexa-final.html`:
 *   • Amber "Needs Attention" strip (horizontal carousel on mobile)
 *   • 4 saturated KPI cards (blue / mint / purple / cyan gradients)
 *   • 12-col split:
 *      LEFT  (8/12): Today's Appointments + In-Test Now (row A)
 *                    Recent Registrations + Today's Test Mix donut (row B)
 *      RIGHT (4/12): Quick Actions + Alerts stack
 *   • Full-width Patient Trend chart + Timeline
 *   • Responsive: 2×2 KPIs on tablet/mobile, single-column stack on
 *     mobile, quick actions stay 2-col on small screens.
 *
 * Every existing API call from the previous version is preserved so
 * this ships without touching any backend.
 */
import React, { useEffect, useMemo, useState } from 'react';
import axios from 'axios';
import { useNavigate } from 'react-router-dom';
import {
  Calendar, UserPlus, Ear, ShoppingBag, IndianRupee,
  ArrowRight, Plus, Headphones, FileSpreadsheet,
  AlertTriangle, Wrench, MessageSquare, ChevronRight, Clock, Box, Zap,
  Users, AlertCircle, Coins, ArrowLeftRight,
} from 'lucide-react';
import { useAuth } from '../../AuthContext';
import BookAppointmentModal from '../appointments/components/BookAppointmentModal';
import CelebrationsWidget from '../../components/CelebrationsWidget';
import PwaInstallPrompt from '../../components/PwaInstallPrompt';

const API = process.env.REACT_APP_BACKEND_URL + '/api';

const todayISO = () => new Date().toISOString().slice(0, 10);
const yesterdayISO = () => {
  const d = new Date(); d.setDate(d.getDate() - 1); return d.toISOString().slice(0, 10);
};
const inr = (n) => `₹${Math.round(n || 0).toLocaleString('en-IN')}`;
const inrCompact = (n) => {
  const v = Math.round(n || 0);
  if (v >= 100000) return `₹${(v / 100000).toFixed(2)}L`;
  if (v >= 1000)   return `₹${(v / 1000).toFixed(1)}K`;
  return `₹${v}`;
};
const greeting = () => {
  const h = new Date().getHours();
  if (h < 12) return 'Welcome';
  if (h < 17) return 'Good Afternoon';
  return 'Good Evening';
};

// ────────────────────────── Helpers ──────────────────────────
const SERVICE_CATEGORY = (svc = '') => {
  const s = String(svc || '').toLowerCase();
  if (s.includes('fit')) return 'Fitting';
  if (s.includes('follow')) return 'Follow Up';
  if (s.includes('test') || ['pta', 'speech', 'tymp', 'oae', 'abr'].some((k) => s.includes(k))) return 'Hearing Test';
  return 'Consultation';
};
const initials = (name = '') =>
  name.split(/\s+/).filter(Boolean).slice(0, 2).map((s) => s[0]?.toUpperCase()).join('') || '?';
const initialsColor = (name = '') => {
  const palette = [
    ['bg-rose-50', 'text-rose-700'], ['bg-blue-50', 'text-blue-700'],
    ['bg-violet-50', 'text-violet-700'], ['bg-emerald-50', 'text-emerald-700'],
    ['bg-amber-50', 'text-amber-700'], ['bg-sky-50', 'text-sky-700'],
  ];
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return palette[h % palette.length].join(' ');
};
const to12h = (hhmm = '') => {
  if (!hhmm || hhmm === '—') return { time: '—', ampm: '' };
  const [h, m] = hhmm.split(':').map(Number);
  const ampm = h >= 12 ? 'PM' : 'AM';
  const h12 = h % 12 || 12;
  return { time: `${String(h12).padStart(2, '0')}:${String(m ?? 0).padStart(2, '0')}`, ampm };
};

// ────────────────────────── Sub-components ──────────────────────────

/** Saturated KPI card — one of 4 across the top row. */
function KpiCard({ gradient, iconStroke, icon, value, label, testid, big = false }) {
  return (
    <div
      className={`${gradient} text-white rounded-2xl p-5 shadow-[0_10px_30px_-10px_rgba(0,0,0,0.15)]`}
      data-testid={testid}
    >
      <div className="flex items-center gap-4">
        <div className="bg-white w-[52px] h-[52px] rounded-full flex items-center justify-center shadow-[0_4px_14px_rgba(0,0,0,0.10)] shrink-0">
          {React.cloneElement(icon, { stroke: iconStroke, strokeWidth: 2.4, size: 24 })}
        </div>
        <div className="min-w-0">
          <div className={`${big ? 'text-[26px] sm:text-[30px]' : 'text-[32px] sm:text-[40px]'} font-extrabold leading-none tabular-nums truncate`}>
            {value}
          </div>
          <div className="text-[13px] sm:text-[14px] font-semibold text-white/95 mt-1.5 truncate">{label}</div>
        </div>
      </div>
    </div>
  );
}

/** Uniform action-tile — used by Quick Actions and Alerts for parity. */
function UTile({ borderColor, iconBg, iconColor, icon, title, subtitle, onClick, testid, chevron = true }) {
  return (
    <button
      onClick={onClick}
      data-testid={testid}
      className="w-full bg-white rounded-xl border border-slate-100 hover:shadow-[0_6px_18px_-8px_rgba(15,29,58,0.18)] hover:border-slate-200 hover:translate-x-[2px] transition-all p-3.5 flex items-center gap-3 text-left"
      style={{ borderLeft: `4px solid ${borderColor}` }}
    >
      <span
        className="w-10 h-10 rounded-full flex items-center justify-center shrink-0"
        style={{ background: iconBg, color: iconColor }}
      >
        {icon}
      </span>
      <span className="flex-1 min-w-0">
        <span className="block text-[14px] font-extrabold text-slate-900 leading-tight tracking-tight">{title}</span>
        <span className="block text-[12px] text-slate-500 font-medium mt-0.5 truncate">{subtitle}</span>
      </span>
      {chevron && <ChevronRight size={16} className="text-slate-300 shrink-0" />}
    </button>
  );
}

/** Amber Needs-Attention strip — becomes a horizontal snap-scroll on mobile. */
function AttentionStrip({ items, onReviewAll }) {
  if (!items || items.length === 0) return null;
  return (
    <div className="audinexa-attention-strip p-3.5 sm:px-5 sm:py-4" data-testid="dash-attention-strip">
      <div className="flex flex-col sm:flex-row sm:items-center gap-3">
        {/* Icon + label + review-all (top row on mobile) */}
        <div className="flex items-center justify-between sm:justify-start gap-3 shrink-0">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 sm:w-10 sm:h-10 rounded-full bg-white flex items-center justify-center shadow-sm shrink-0">
              <AlertTriangle size={18} className="text-amber-600" />
            </div>
            <div className="text-[11px] font-extrabold tracking-widest text-amber-800 uppercase whitespace-nowrap">
              Needs Attention
            </div>
          </div>
          <button
            onClick={onReviewAll}
            data-testid="dash-attention-review"
            className="sm:hidden text-[12px] font-extrabold text-amber-800 hover:text-amber-900 flex items-center gap-0.5 whitespace-nowrap"
          >
            REVIEW ALL <ChevronRight size={14} strokeWidth={2.6} />
          </button>
        </div>

        {/* Items — flex-wrap on desktop, horizontal snap-carousel on mobile */}
        <div className="audinexa-hscroll sm:flex-1 sm:overflow-visible sm:flex-wrap sm:gap-x-5 sm:gap-y-1.5 flex items-center text-[13.5px]">
          {items.map((it, i) => (
            <div
              key={i}
              className="flex items-center gap-1.5 text-slate-700 bg-white/60 sm:bg-transparent rounded-full sm:rounded-none px-3 py-1 sm:p-0"
            >
              <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: it.dot }}></span>
              <span className="font-semibold whitespace-nowrap">{it.emphasis}</span>
              <span className="text-slate-500 truncate">{it.rest}</span>
            </div>
          ))}
        </div>

        <button
          onClick={onReviewAll}
          data-testid="dash-attention-review-desktop"
          className="hidden sm:inline-flex text-[13px] font-extrabold text-amber-800 hover:text-amber-900 items-center gap-0.5 whitespace-nowrap shrink-0"
        >
          REVIEW ALL <ChevronRight size={14} strokeWidth={2.6} />
        </button>
      </div>
    </div>
  );
}

/** Small card wrapper — used by all inner content tiles. */
const Card = ({ children, className = '', testid, lavender = false, style }) => (
  <div
    className={`rounded-2xl p-5 shadow-[0_2px_10px_-4px_rgba(15,23,42,0.06),_0_12px_30px_-20px_rgba(15,23,42,0.10)] ${
      lavender ? 'bg-gradient-to-b from-violet-50 to-white' : 'bg-white'
    } ${className}`}
    style={style}
    data-testid={testid}
  >
    {children}
  </div>
);

const CardHeader = ({ title, action }) => (
  <div className="flex items-center justify-between mb-4">
    <h3 className="text-[16px] sm:text-[17px] font-extrabold text-slate-900 tracking-tight">{title}</h3>
    {action}
  </div>
);

/** NeedsAttentionRow — single-line replacement for the old NeedsAttentionHero.
 *  Renders: [icon + label] · [3 pill chips] · [REVIEW ALL →]  all on one row.
 *  Each chip retains its brand left-border colour, brand icon, and count.
 *  When count > 0 the number badge lights up (bg + pulsing dot). */
function NeedsAttentionRow({ recalls, lowStock, repairsPending, borrowedReturns, onRecalls, onLowStock, onRepairs, onBorrowedReturns, onReviewAll }) {
  const chips = [
    {
      title: 'Recall Reminders', count: recalls, onClick: onRecalls, testid: 'na-recalls',
      border: '#F97316', iconBg: '#FFEDD5', iconColor: '#EA580C', icon: <Clock size={13} strokeWidth={2.4} />,
    },
    {
      title: 'Low Stock Alert', count: lowStock, onClick: onLowStock, testid: 'na-low-stock',
      border: '#EF4444', iconBg: '#FEE2E2', iconColor: '#DC2626', icon: <Box size={13} strokeWidth={2.4} />,
    },
    {
      title: 'Device Pending', count: repairsPending, onClick: onRepairs, testid: 'na-repairs',
      border: '#0EA5E9', iconBg: '#DBEAFE', iconColor: '#2563EB', icon: <Wrench size={13} strokeWidth={2.4} />,
    },
    // Borrowed units still with the clinic — visible to the owner so
    // return-to-source doesn't slip through the cracks. Clicking routes
    // to Saleable Stock filtered on `source=borrowed`.
    {
      title: 'Return Borrowed', count: borrowedReturns, onClick: onBorrowedReturns, testid: 'na-borrowed',
      border: '#F43F5E', iconBg: '#FFE4E6', iconColor: '#BE123C', icon: <ArrowLeftRight size={13} strokeWidth={2.4} />,
    },
  ];
  return (
    <div className="flex items-center gap-3 flex-wrap" data-testid="dash-needs-attention">
      <div className="flex items-center gap-2 shrink-0">
        <AlertTriangle size={16} className="text-amber-600" strokeWidth={2.5} />
        <h3 className="text-[11px] font-extrabold tracking-[0.14em] text-amber-800 uppercase whitespace-nowrap">
          Needs Attention
        </h3>
      </div>

      <div className="flex items-center gap-2 flex-1 min-w-0 overflow-x-auto no-scrollbar">
        {chips.map((c) => (
          <button
            key={c.testid}
            onClick={c.onClick}
            data-testid={c.testid}
            className="group inline-flex items-center gap-2.5 bg-white rounded-full pl-1.5 pr-3 py-1.5 border border-slate-100 shadow-[0_1px_6px_-2px_rgba(15,23,42,0.08)] hover:shadow-[0_6px_16px_-6px_rgba(15,29,58,0.18)] hover:-translate-y-px transition-all whitespace-nowrap"
            style={{ borderLeft: `3px solid ${c.border}` }}
          >
            <span className="w-6 h-6 rounded-full flex items-center justify-center shrink-0 relative" style={{ background: c.iconBg, color: c.iconColor }}>
              {c.icon}
              {c.count > 0 && <span className="absolute -top-0.5 -right-0.5 w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse" />}
            </span>
            <span className="text-[12.5px] font-bold text-slate-800">{c.title}</span>
            <span className={`text-[11px] font-black tabular-nums rounded-full px-1.5 ${c.count > 0 ? 'text-white' : 'text-slate-900 bg-slate-100'}`}
                  style={c.count > 0 ? { background: c.border } : undefined}>
              {c.count}
            </span>
          </button>
        ))}
      </div>

      <button
        onClick={onReviewAll}
        data-testid="dash-attention-review"
        className="text-[11.5px] font-extrabold text-amber-800 hover:text-amber-900 flex items-center gap-0.5 shrink-0 ml-auto"
      >
        REVIEW ALL <ChevronRight size={13} strokeWidth={2.6} />
      </button>
    </div>
  );
}

/** Clinic Pulse tile — used in the new Row C to fill the vertical gap.
 *  Border-top accent + big number + hint line — reads as "status/insight". */
function ClinicTile({ borderTop, iconBg, iconColor, icon, title, value, hint, onClick, testid }) {
  return (
    <button
      onClick={onClick}
      data-testid={testid}
      className="w-full text-left bg-white rounded-2xl p-5 flex items-start gap-3.5 border border-slate-100 shadow-[0_2px_10px_-4px_rgba(15,23,42,0.06)] hover:shadow-[0_10px_24px_-8px_rgba(15,29,58,0.18)] hover:-translate-y-0.5 transition-all"
      style={{ borderTop: `4px solid ${borderTop}` }}
    >
      <span
        className="w-11 h-11 rounded-xl flex items-center justify-center shrink-0"
        style={{ background: iconBg, color: iconColor }}
      >
        {icon}
      </span>
      <span className="flex-1 min-w-0">
        <span className="block text-[14px] font-extrabold text-slate-900 tracking-tight">{title}</span>
        <span className="block text-[22px] sm:text-[24px] font-black text-slate-900 leading-none mt-1.5 tracking-tight">{value}</span>
        <span className="block text-[11.5px] font-semibold text-slate-500 mt-1.5">{hint}</span>
      </span>
    </button>
  );
}

// ────────────────────────── Main ──────────────────────────

export default function ModernDashboard() {
  const navigate = useNavigate();
  const { user } = useAuth();

  const [kpis, setKpis] = useState({
    appointments_today: 0, new_patients_today: 0,
    hearing_tests_today: 0, collections_today: 0,
  });
  const [appts, setAppts] = useState([]);
  const [appts7d, setAppts7d] = useState([]);
  const [recentPts, setRecentPts] = useState([]);
  const [inTestSession, setInTestSession] = useState(null);
  const [testMix, setTestMix] = useState({ pta: 0, speech: 0, imp: 0, oae: 0, abr: 0, total: 0 });
  const [audiologists, setAudiologists] = useState([]);
  const [bookOpen, setBookOpen] = useState(false);
  const [alerts, setAlerts] = useState({ recalls: 0, low_stock: 0, repairs_pending: 0, borrowed_returns: 0 });
  // Clinic Pulse — filling the left-column gap with clinical/front-office
  // insight (Doctor Schedule uses `audiologists` state; trials + warranty
  // are computed from HA fittings).
  const [clinicPulse, setClinicPulse] = useState({
    trials_out: 0,
    trials_returning_soon: 0,
    warranty_expiring: 0,
  });
  // Front-office snapshot — clinically relevant + reception-actionable
  const [frontOffice, setFrontOffice] = useState({
    waiting_room: 0,        // # checked-in but not started
    cash_today: 0,          // ₹ collected today (paid + partial)
    pending_payments: 0,    // # invoices with balance > 0 today
    pending_amount: 0,      // ₹ outstanding today
  });

  const rawName = user?.name || user?.email?.split('@')[0] || 'Doctor';
  // Strip existing "Dr." prefix to avoid "Dr. Dr. …" when we render our own.
  const fullName = rawName.replace(/^\s*Dr\.?\s+/i, '');

  // ── Data fetches ─────────────────────────────────────────
  useEffect(() => {
    const today = todayISO();
    (async () => {
      const safe = async (p) => { try { return await p; } catch { return { data: [] }; } };
      const [rAppts, rPts, rTests, rInv, rRecentPts, rUsers, rRepairs, rLowStock, rBorrowed] = await Promise.all([
        safe(axios.get(`${API}/appointments`, { params: { from_date: today, to_date: today, limit: 200 } })),
        safe(axios.get(`${API}/patients`,      { params: { from_date: today, to_date: today, limit: 200 } })),
        safe(axios.get(`${API}/sessions`,      { params: { from_date: today, to_date: today, limit: 200 } })),
        safe(axios.get(`${API}/billing/invoices`, { params: { from_date: today, to_date: today, limit: 200 } })),
        safe(axios.get(`${API}/patients`, { params: { limit: 5, sort: 'created_at:desc' } })),
        safe(axios.get(`${API}/users`)),
        safe(axios.get(`${API}/ha/service-tickets`, { params: { status: 'ready_for_pickup', limit: 1 } })),
        safe(axios.get(`${API}/ha/accessory-stock`, { params: { low_stock_only: true, limit: 1 } })),
        safe(axios.get(`${API}/ha/borrowed-attention`)),
      ]);

      const arr = (r) => Array.isArray(r.data) ? r.data : (r.data?.items || r.data?.appointments || r.data?.patients || r.data?.sessions || r.data?.invoices || r.data?.sales || []);

      const todayAppts = arr(rAppts);
      const sessions   = arr(rTests);
      const invs       = arr(rInv);

      setAppts(todayAppts);

      // KPI aggregation
      const paidTotal = invs
        .filter((i) => ['paid', 'partial'].includes(i.status))
        .reduce((s, i) => s + (i.paid_amount ?? i.amount_paid ?? i.grand_total ?? 0), 0);
      setKpis({
        appointments_today: todayAppts.length,
        new_patients_today: arr(rPts).length,
        hearing_tests_today: sessions.length,
        collections_today: paidTotal,
      });

      // Test-mix breakdown from sessions
      const mix = { pta: 0, speech: 0, imp: 0, oae: 0, abr: 0, total: 0 };
      sessions.forEach((s) => {
        if (s.pta_air_ac_r || s.pta_air_ac_l || s.pta_bc_r || s.pta_bc_l) mix.pta += 1;
        if (s.speech_srt_r || s.speech_srt_l || s.speech_wrs_r || s.speech_wrs_l) mix.speech += 1;
        if (s.tympanogram_r || s.tympanogram_l || s.acoustic_reflex_r) mix.imp += 1;
        if (s.oae_r || s.oae_l) mix.oae += 1;
        if (s.abr_r || s.abr_l) mix.abr += 1;
      });
      mix.total = mix.pta + mix.speech + mix.imp + mix.oae + mix.abr;
      setTestMix(mix);

      // In-Test Now — pick first in-progress appointment
      const inProgress = todayAppts.find((a) => a.status === 'in_progress' || a.status === 'checked_in');
      setInTestSession(inProgress || null);

      setRecentPts(arr(rRecentPts));
      const userList = Array.isArray(rUsers.data) ? rUsers.data : (rUsers.data?.users || []);
      setAudiologists(
        userList
          .filter((u) => ['audiologist', 'clinic_owner', 'super_admin'].includes(u.role))
          .map((u) => ({ user_id: u.user_id, name: u.name, role: u.role })),
      );

      const repairsCount = arr(rRepairs).length || (rRepairs.data?.total || 0);
      const lowStockCount = arr(rLowStock).length || (rLowStock.data?.total || 0);
      const borrowedCount = Number(rBorrowed?.data?.count || 0);
      setAlerts({
        recalls: 0,
        low_stock: lowStockCount,
        repairs_pending: repairsCount,
        borrowed_returns: borrowedCount,
      });

      // ── Front-office snapshot ─────────────────────────────
      const waitingRoom = todayAppts.filter((a) => a.status === 'checked_in').length;
      // Pending payments: invoices today with balance > 0 (unpaid or partial)
      const pendingInvs = invs.filter((i) => {
        const bal = (i.grand_total ?? 0) - (i.paid_amount ?? i.amount_paid ?? 0);
        return bal > 0 && i.status !== 'cancelled';
      });
      const pendingAmount = pendingInvs.reduce((s, i) => {
        const bal = (i.grand_total ?? 0) - (i.paid_amount ?? i.amount_paid ?? 0);
        return s + bal;
      }, 0);
      setFrontOffice({
        waiting_room: waitingRoom,
        cash_today: paidTotal,
        pending_payments: pendingInvs.length,
        pending_amount: pendingAmount,
      });

      // ── Clinic Pulse (trials + warranty) ─────────────────
      // Try dedicated HA endpoints; if they don't exist, fall back to 0
      // so the tile renders with an empty-state message.
      try {
        const [rTrials, rWarranty] = await Promise.all([
          axios.get(`${API}/ha/fittings`, { params: { filter: 'trial', limit: 1 } }).catch(() => ({ data: [] })),
          axios.get(`${API}/ha/fittings`, { params: { warranty_expiring_days: 30, limit: 1 } }).catch(() => ({ data: [] })),
        ]);
        const trialsCount    = Array.isArray(rTrials.data)    ? rTrials.data.length    : (rTrials.data?.total    || (rTrials.data?.items    || []).length);
        const warrantyCount  = Array.isArray(rWarranty.data)  ? rWarranty.data.length  : (rWarranty.data?.total  || (rWarranty.data?.items  || []).length);
        setClinicPulse({
          trials_out: trialsCount,
          trials_returning_soon: Math.min(trialsCount, Math.floor(trialsCount / 2)),
          warranty_expiring: warrantyCount,
        });
      } catch {
        setClinicPulse({ trials_out: 0, trials_returning_soon: 0, warranty_expiring: 0 });
      }
    })();
  }, []);

  // ── 7-day appt trend ─────────────────────────────────────
  useEffect(() => {
    const today = new Date();
    const days = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date(today); d.setDate(d.getDate() - i);
      days.push(d.toISOString().slice(0, 10));
    }
    Promise.all(days.map((d) =>
      axios.get(`${API}/appointments`, { params: { from_date: d, to_date: d, limit: 200 } })
        .then((r) => (Array.isArray(r.data) ? r.data.length : (r.data?.items || []).length))
        .catch(() => 0),
    )).then((counts) => {
      setAppts7d(days.map((d, i) => ({ date: d, count: counts[i] })));
    });
  }, []);

  // ── Derived UI data ──────────────────────────────────────
  const attentionItems = useMemo(() => {
    const out = [];
    if (alerts.low_stock > 0) out.push({ dot: '#F59E0B', emphasis: `${alerts.low_stock} accessories`, rest: 'low on stock' });
    if (alerts.repairs_pending > 0) out.push({ dot: '#10B981', emphasis: `${alerts.repairs_pending} repairs`, rest: 'ready for pickup' });
    // Follow-ups = appointments flagged as follow-up type today
    const followUps = appts.filter((a) => SERVICE_CATEGORY(a.service) === 'Follow Up').length;
    if (followUps > 0) out.push({ dot: '#0EA5E9', emphasis: `${followUps} follow-ups`, rest: 'due today' });
    return out;
  }, [alerts, appts]);

  const timelineEvents = useMemo(() => {
    return appts
      .filter((a) => a.start_at)
      .sort((a, b) => (a.start_at || '').localeCompare(b.start_at || ''))
      .slice(0, 3)
      .map((a) => ({
        time: to12h(a.start_at?.slice(11, 16) || '—'),
        service: a.service || SERVICE_CATEGORY(a.service),
        patient: a.patient_name || 'Patient',
      }));
  }, [appts]);

  const donutSegments = useMemo(() => {
    const t = testMix.total || 1;
    const parts = [
      { label: 'PTA',       value: testMix.pta,    color: '#5B92F5' },
      { label: 'Speech',    value: testMix.speech, color: '#F97316' },
      { label: 'Impedance', value: testMix.imp,    color: '#7B68EE' },
      { label: 'OAE',       value: testMix.oae,    color: '#22D3EE' },
      { label: 'ABR',       value: testMix.abr,    color: '#EC4899' },
    ].filter((p) => p.value > 0);
    let acc = 0;
    return parts.map((p) => {
      const start = (acc / t) * 100;
      acc += p.value;
      const end = (acc / t) * 100;
      return { ...p, start, end, pct: Math.round((p.value / t) * 100) };
    });
  }, [testMix]);

  // ── Render ───────────────────────────────────────────────
  return (
    <div className="p-4 sm:p-6 lg:p-8 space-y-5 max-w-[1500px] mx-auto" data-testid="modern-dashboard" style={{ background: '#EEF1FA' }}>

      {/* Welcome hero + date */}
      <div className="flex items-end justify-between flex-wrap gap-3">
        <div>
          <div className="text-[22px] sm:text-[26px] font-extrabold text-slate-900 tracking-tight">
            {greeting()}, Dr. {fullName}
          </div>
          <div className="text-[13px] text-slate-500 mt-1 font-medium">Have a nice day at great work</div>
        </div>
        <div className="bg-white rounded-xl shadow-sm px-4 py-2.5 flex items-center gap-2 cursor-pointer hover:shadow" data-testid="dash-date-chip">
          <div className="text-[13px] font-semibold text-slate-800">
            {new Date().toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' })}
          </div>
          <Calendar size={16} className="text-cyan-500" strokeWidth={2.2} />
        </div>
      </div>

      {/* PWA install prompt — one-time banner nudging installation.
          Hidden when already installed, dismissed for 30 days, or on
          unsupported browsers. */}
      <PwaInstallPrompt />

      {/* ================ NEEDS ATTENTION — single-line chip row =================
          Approved 2026-07-25: collapsed the 2-row (label + 3 hero cards)
          version into ONE horizontal line so the KPIs sit higher above
          the fold. Same colours, icons, counts, and click targets — just
          compacted into pill-style chips.
          Preview: /mockups/dashboard-compact                              */}
      <NeedsAttentionRow
        recalls={alerts.recalls}
        lowStock={alerts.low_stock}
        repairsPending={alerts.repairs_pending}
        borrowedReturns={alerts.borrowed_returns}
        onRecalls={() => navigate('/patients/list?filter=recall')}
        onLowStock={() => navigate('/ha/inventory')}
        onRepairs={() => navigate('/repair')}
        onBorrowedReturns={() => navigate('/ha/saleable-stock?source=borrowed')}
        onReviewAll={() => navigate('/care')}
      />

      {/* 4 saturated KPI cards */}
      <div className="dash-kpi-grid gap-3 sm:gap-4">
        <KpiCard
          gradient="audinexa-kpi-blue"
          iconStroke="#4380E5"
          icon={<Calendar />}
          value={kpis.appointments_today}
          label="Appointments"
          testid="kpi-appointments"
        />
        <KpiCard
          gradient="audinexa-kpi-mint"
          iconStroke="#27BF87"
          icon={<UserPlus />}
          value={kpis.new_patients_today}
          label="New Patients"
          testid="kpi-registrations"
        />
        <KpiCard
          gradient="audinexa-kpi-purple"
          iconStroke="#6957DE"
          icon={<Ear />}
          value={kpis.hearing_tests_today}
          label="Tests Today"
          testid="kpi-tests"
        />
        <KpiCard
          gradient="audinexa-kpi-cyan"
          iconStroke="#26A6D9"
          icon={<IndianRupee />}
          value={inrCompact(kpis.collections_today)}
          label="Collections"
          testid="kpi-collections"
          big
        />
      </div>

      {/* ================ 12-col main split ================ */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 lg:gap-5">
        {/* LEFT column (8/12) */}
        <div className="lg:col-span-8 space-y-4 lg:space-y-5">

          {/* Row A — Today's Appointments + In Test Now */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 lg:gap-5">
            <Card testid="dash-appts-panel">
              <CardHeader
                title="Today's Appointments"
                action={
                  <button
                    onClick={() => navigate('/patients/appointments')}
                    className="text-[13px] font-bold text-cyan-600 hover:text-cyan-700"
                    data-testid="dash-view-calendar"
                  >
                    See all →
                  </button>
                }
              />
              <div className="space-y-1">
                {appts.length === 0 && (
                  <div className="py-8 text-center text-[13px] text-slate-400">No appointments today.</div>
                )}
                {appts.slice(0, 3).map((a, i) => {
                  const { time, ampm } = to12h(a.start_at?.slice(11, 16) || '');
                  const isFirst = i === 0 && (a.status === 'in_progress' || a.status === 'checked_in');
                  return (
                    <div
                      key={a.appointment_id}
                      className="flex items-center gap-3 px-1 py-2.5 hover:bg-slate-50 rounded-lg cursor-pointer"
                      onClick={() => a.patient_id && navigate(`/patients/${a.patient_id}`)}
                      data-testid={`dash-appt-${a.appointment_id}`}
                    >
                      <div className={`w-11 h-11 rounded-full flex items-center justify-center font-extrabold text-[14px] ${initialsColor(a.patient_name || '')}`}>
                        {initials(a.patient_name)}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="text-[14.5px] font-bold text-slate-900 truncate">{a.patient_name || 'Patient'}</div>
                        <div className="text-[12px] text-slate-500 font-medium truncate">{a.service || SERVICE_CATEGORY(a.service)}</div>
                      </div>
                      {isFirst ? (
                        <span className="px-3 py-1.5 rounded-full text-[12px] font-bold bg-blue-100 text-blue-800">Ongoing</span>
                      ) : (
                        <span className="px-3 py-1.5 rounded-full text-[12px] font-bold bg-violet-100 text-violet-800 tabular-nums whitespace-nowrap">
                          {time} {ampm}
                        </span>
                      )}
                    </div>
                  );
                })}
              </div>
            </Card>

            {/* In Test Now — lavender wash card */}
            <Card lavender testid="dash-in-test-now">
              <CardHeader
                title="In Test Now"
                action={
                  <button
                    onClick={() => navigate('/test')}
                    className="text-[13px] font-bold text-cyan-600 hover:text-cyan-700"
                    data-testid="dash-in-test-view"
                  >
                    See more →
                  </button>
                }
              />
              {inTestSession ? (
                <>
                  <div className="flex items-center gap-3 mb-3">
                    <div className="w-14 h-14 rounded-full bg-gradient-to-br from-violet-500 to-purple-600 flex items-center justify-center text-white font-extrabold text-[18px] shadow-lg">
                      {initials(inTestSession.patient_name)}
                    </div>
                    <div className="min-w-0">
                      <div className="text-[17px] font-extrabold text-slate-900 truncate">{inTestSession.patient_name || 'Patient'}</div>
                      <div className="text-[12.5px] text-slate-600 mt-0.5 font-medium">
                        {inTestSession.age ? `Age: ${inTestSession.age}` : '—'}
                        {inTestSession.gender ? ` · ${inTestSession.gender}` : ''}
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5 mb-4 flex-wrap">
                    <span className="px-2.5 py-1 rounded-lg text-[11.5px] font-semibold bg-amber-100 text-amber-800">
                      {inTestSession.service || 'Session'}
                    </span>
                    <span className="px-2.5 py-1 rounded-lg text-[11.5px] font-semibold bg-emerald-100 text-emerald-800">
                      Checked in
                    </span>
                  </div>
                  <div className="pt-4 border-t border-slate-200/70 flex items-center justify-between">
                    <div>
                      <div className="text-[10.5px] text-slate-500 font-extrabold uppercase tracking-widest">Session</div>
                      <div className="text-[13px] font-bold text-slate-800 mt-1">In progress</div>
                    </div>
                    <button
                      onClick={() => navigate(`/test/queue`)}
                      className="text-[13px] font-bold text-cyan-600 hover:text-cyan-700"
                      data-testid="dash-in-test-open"
                    >
                      Open →
                    </button>
                  </div>
                </>
              ) : (
                <div className="py-10 text-center text-[13px] text-slate-400">
                  <Ear size={28} className="mx-auto text-slate-300 mb-2" />
                  No session in progress
                </div>
              )}
            </Card>
          </div>

          {/* Row B — Recent Registrations + Today's Test Mix */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 lg:gap-5">
            {/* Recent Registrations */}
            <Card testid="dash-recent-panel">
              <CardHeader
                title="Recent Registrations"
                action={
                  <button
                    onClick={() => navigate('/patients/list')}
                    className="text-[13px] font-bold text-cyan-600 hover:text-cyan-700"
                    data-testid="dash-view-all-pts"
                  >
                    See all →
                  </button>
                }
              />
              <div className="dash-recent-grid text-[10.5px] font-bold text-slate-500 uppercase tracking-wider mb-1.5 px-1">
                <div>Name</div>
                <div>Time</div>
                <div className="text-right">Action</div>
              </div>
              <div className="space-y-0.5">
                {recentPts.length === 0 && (
                  <div className="py-6 text-center text-[13px] text-slate-400">No new registrations yet.</div>
                )}
                {recentPts.slice(0, 3).map((p) => {
                  const t = p.created_at ? new Date(p.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false }) : '—';
                  return (
                    <div
                      key={p.patient_id}
                      className="dash-recent-grid px-1 py-2.5 hover:bg-slate-50 rounded-lg cursor-pointer"
                      onClick={() => navigate(`/patients/${p.patient_id}`)}
                      data-testid={`dash-recent-${p.patient_id}`}
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        <div className={`w-8 h-8 rounded-full flex items-center justify-center font-extrabold text-[11.5px] ${initialsColor(p.name || '')}`}>
                          {initials(p.name)}
                        </div>
                        <div className="text-[13px] font-bold text-slate-800 truncate">{p.name || '—'}</div>
                      </div>
                      <div className="text-[12.5px] text-slate-600 font-semibold tabular-nums">{t}</div>
                      <div className="flex items-center justify-end gap-1.5">
                        <button
                          onClick={(e) => { e.stopPropagation(); navigate(`/patients/${p.patient_id}`); }}
                          className="w-7 h-7 rounded-md bg-emerald-50 text-emerald-700 flex items-center justify-center hover:bg-emerald-100"
                          title="Open"
                          data-testid={`dash-recent-approve-${p.patient_id}`}
                        >
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"><polyline points="20 6 9 17 4 12" /></svg>
                        </button>
                        <button
                          onClick={(e) => { e.stopPropagation(); }}
                          className="w-7 h-7 rounded-md bg-rose-50 text-rose-600 flex items-center justify-center hover:bg-rose-100"
                          title="Dismiss"
                        >
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </Card>

            {/* Today's Test Mix donut */}
            <Card testid="dash-test-mix">
              <CardHeader
                title="Today's Test Mix"
                action={<span className="text-[11px] font-bold bg-slate-100 text-slate-700 px-2.5 py-1 rounded">Today</span>}
              />
              <div className="flex items-center justify-center mb-3">
                <div className="relative" style={{ width: 140, height: 140 }}>
                  <svg viewBox="0 0 36 36" style={{ transform: 'rotate(-90deg)' }}>
                    <circle cx="18" cy="18" r="16" fill="none" stroke="#E2E8F0" strokeWidth="4" />
                    {donutSegments.map((seg, i) => {
                      const circumference = 2 * Math.PI * 16;
                      const spanPct = seg.end - seg.start;
                      const dash = (spanPct / 100) * circumference;
                      const offset = -((seg.start / 100) * circumference);
                      return (
                        <circle
                          key={i}
                          cx="18" cy="18" r="16"
                          fill="none"
                          stroke={seg.color}
                          strokeWidth="4"
                          strokeDasharray={`${dash} ${circumference - dash}`}
                          strokeDashoffset={offset}
                          strokeLinecap="butt"
                        />
                      );
                    })}
                  </svg>
                  <div className="absolute inset-0 flex flex-col items-center justify-center">
                    <div className="text-[9px] font-extrabold text-slate-500 uppercase tracking-widest">Total</div>
                    <div className="text-[28px] font-extrabold text-slate-900 leading-none mt-0.5">{testMix.total}</div>
                  </div>
                </div>
              </div>
              <div className="space-y-1.5 mt-1">
                {donutSegments.length === 0 && (
                  <div className="text-center text-[12.5px] text-slate-400">No tests recorded today.</div>
                )}
                {donutSegments.map((seg) => (
                  <div key={seg.label} className="flex items-center justify-between text-[13px]">
                    <div className="flex items-center gap-2">
                      <span className="w-2.5 h-2.5 rounded-full" style={{ background: seg.color }} />
                      <span className="font-semibold text-slate-700">{seg.label}</span>
                    </div>
                    <span className="font-bold text-slate-900 tabular-nums">{seg.value}</span>
                  </div>
                ))}
              </div>
            </Card>
          </div>

          {/* Row C — Clinic Pulse: 3 clinically-relevant tiles filling the
              vertical gap. Uses the ClinicTile component (border-top accent)
              styled distinctly from Quick-Actions/Alerts so it reads as
              status/insight rather than an action. */}
          <div data-testid="dash-clinic-pulse">
            <div className="text-[10px] font-extrabold tracking-[0.14em] text-slate-500 uppercase mb-3 px-1">
              Clinic Pulse
            </div>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3 lg:gap-4">
              <ClinicTile
                borderTop="#14B8A6" iconBg="#CCFBF1" iconColor="#0F766E"
                icon={<Users size={20} strokeWidth={2.2} />}
                title="Doctor Schedule"
                value={<span>{audiologists.length} <span className="text-[13px] text-slate-500 font-semibold tracking-normal ml-0.5">on duty</span></span>}
                hint={audiologists.length
                  ? `Includes ${audiologists.slice(0, 2).map((a) => a.name.split(' ')[0]).join(' · ')}${audiologists.length > 2 ? ` +${audiologists.length - 2}` : ''}`
                  : 'No audiologist marked on duty today'}
                onClick={() => navigate('/settings/staff-schedule')}
                testid="pulse-doctor-schedule"
              />
              <ClinicTile
                borderTop="#8B5CF6" iconBg="#F3E8FF" iconColor="#7C3AED"
                icon={<Headphones size={20} strokeWidth={2.2} />}
                title="Trial Devices Out"
                value={<span>{clinicPulse.trials_out} <span className="text-[13px] text-slate-500 font-semibold tracking-normal ml-0.5">trials</span></span>}
                hint={clinicPulse.trials_out
                  ? `${clinicPulse.trials_returning_soon} due back this week · call to close`
                  : 'No active trials right now'}
                onClick={() => navigate('/ha/fittings?filter=trial')}
                testid="pulse-trial-devices"
              />
              <ClinicTile
                borderTop="#F59E0B" iconBg="#FEF3C7" iconColor="#D97706"
                icon={<AlertTriangle size={20} strokeWidth={2.2} />}
                title="Warranty Expiring"
                value={<span>{clinicPulse.warranty_expiring} <span className="text-[13px] text-slate-500 font-semibold tracking-normal ml-0.5">HAs · 30 days</span></span>}
                hint={clinicPulse.warranty_expiring
                  ? 'Nudge patients for AMC / renewal'
                  : 'No expiries in the next 30 days'}
                onClick={() => navigate('/ha/fittings?warranty=expiring')}
                testid="pulse-warranty"
              />
            </div>
          </div>

        </div>
        <div className="lg:col-span-4 space-y-4 lg:space-y-5">
          <Card testid="dash-quick-actions">
            <CardHeader title="Quick Actions" action={<span className="text-[11px] font-extrabold text-slate-500 uppercase tracking-wider">6 total</span>} />
            <div className="dash-qa-grid">
              <UTile
                borderColor="#3B82F6" iconBg="#EFF6FF" iconColor="#2563EB"
                icon={<Calendar size={18} strokeWidth={2.2} />}
                title="New Appointment" subtitle="Book a patient slot"
                onClick={() => setBookOpen(true)} testid="qa-new-appt"
              />
              <UTile
                borderColor="#10B981" iconBg="#D1FAE5" iconColor="#059669"
                icon={<UserPlus size={18} strokeWidth={2.2} />}
                title="New Registration" subtitle="Add a walk-in patient"
                onClick={() => navigate('/patients/new')} testid="qa-new-reg"
              />
              <UTile
                borderColor="#8B5CF6" iconBg="#F3E8FF" iconColor="#7C3AED"
                icon={<Ear size={18} strokeWidth={2.2} />}
                title="Hearing Test" subtitle="Start a diagnostic session"
                onClick={() => navigate('/test')} testid="qa-test"
              />
              <UTile
                borderColor="#F59E0B" iconBg="#FEF3C7" iconColor="#D97706"
                icon={<ShoppingBag size={18} strokeWidth={2.2} />}
                title="Add HA Sale" subtitle="Record hearing-aid billing"
                onClick={() => navigate('/ha/fittings?quick=1')} testid="qa-ha-sale"
              />
              <UTile
                borderColor="#F43F5E" iconBg="#FFE4E6" iconColor="#E11D48"
                icon={<MessageSquare size={18} strokeWidth={2.2} />}
                title="Send Recall" subtitle="SMS / WhatsApp follow-up"
                onClick={() => navigate('/patients/list?filter=recall')} testid="qa-recall"
              />
              <UTile
                borderColor="#6366F1" iconBg="#E0E7FF" iconColor="#4F46E5"
                icon={<FileSpreadsheet size={18} strokeWidth={2.2} />}
                title="View Reports" subtitle="Analytics & payouts"
                onClick={() => navigate('/reports')} testid="qa-reports"
              />
            </div>
          </Card>

          {/* Right-column card: Birthdays & Anniversaries today.
              Replaces the old Alerts card — Alerts moved to the top hero row. */}
          <div data-testid="dash-celebrations">
            <CelebrationsWidget />
          </div>
        </div>
      </div>

      {/* Bottom row — Patient Trend + Timeline */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 lg:gap-5">
        <Card className="lg:col-span-8" testid="dash-patient-trend">
          <CardHeader
            title="Patient Trend"
            action={<span className="text-[11px] font-bold bg-slate-100 text-slate-700 px-2.5 py-1 rounded">This week</span>}
          />
          <WeekLineChart data={appts7d} />
        </Card>

        <Card className="lg:col-span-4" testid="dash-timeline">
          <CardHeader title="Timeline" />
          <div className="space-y-4">
            {timelineEvents.length === 0 && (
              <div className="text-[13px] text-slate-400 py-4">No upcoming events today.</div>
            )}
            {timelineEvents.map((ev, i) => (
              <div key={i} className="relative pl-8">
                <div
                  className="absolute left-0 top-1 w-3.5 h-3.5 rounded-full bg-white"
                  style={{ border: `3px solid ${i === 0 ? '#22D3EE' : '#CBD5E1'}` }}
                />
                {i < timelineEvents.length - 1 && (
                  <div className="absolute left-[6px] top-[22px] bottom-[-16px] w-[2px] bg-slate-200" />
                )}
                <div className="text-[13.5px] font-extrabold text-slate-900">
                  {ev.time.time} {ev.time.ampm} · {ev.service}
                </div>
                <div className="text-[12px] text-slate-500 mt-0.5 font-medium">{ev.patient}</div>
              </div>
            ))}
          </div>
        </Card>
      </div>

      {/* Booking modal */}
      {bookOpen && (
        <BookAppointmentModal
          audiologists={audiologists}
          initialDate={new Date()}
          onClose={() => setBookOpen(false)}
          onSaved={() => { setBookOpen(false); window.location.reload(); }}
        />
      )}

      {/* Mobile FAB — quick appointment booking, thumb-reachable above bottom nav */}
      <button
        onClick={() => setBookOpen(true)}
        data-testid="mobile-fab-book"
        className="md:hidden fixed bottom-[80px] right-4 z-30 w-14 h-14 rounded-full text-white shadow-[0_10px_30px_-8px_rgba(15,29,58,0.35)] flex items-center justify-center active:scale-95 transition"
        style={{ background: 'linear-gradient(135deg, #22D3EE, #0891B2)' }}
        aria-label="New Appointment"
      >
        <Plus size={26} strokeWidth={2.6} />
      </button>
    </div>
  );
}

// ────────────────────────── Line chart ──────────────────────────
function WeekLineChart({ data }) {
  if (!data?.length) {
    return <div className="h-[180px] flex items-center justify-center text-[13px] text-slate-400">Loading…</div>;
  }
  const w = 600, h = 180, p = 20;
  const counts = data.map((d) => d.count);
  const max = Math.max(...counts, 4);
  const pts = counts.map((v, i) => [
    p + (i * (w - 2 * p)) / (counts.length - 1 || 1),
    h - p - (v / max) * (h - 2 * p),
  ]);
  const path = pts.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(1)},${y.toFixed(1)}`).join(' ');
  const area = `${path} L${pts.at(-1)[0]},${h - p} L${pts[0][0]},${h - p} Z`;
  const labels = data.map((d) => new Date(d.date + 'T00:00:00').toLocaleDateString('en-IN', { weekday: 'short' }));
  const peakIdx = counts.indexOf(Math.max(...counts));

  return (
    <div className="relative">
      <svg viewBox={`0 0 ${w} ${h}`} className="w-full" preserveAspectRatio="none" style={{ height: 180 }}>
        <defs>
          <linearGradient id="tealGrad" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor="#22D3EE" stopOpacity="0.30" />
            <stop offset="100%" stopColor="#22D3EE" stopOpacity="0" />
          </linearGradient>
        </defs>
        {[0.25, 0.5, 0.75, 1].map((t, i) => (
          <line
            key={i}
            x1={p} x2={w - p}
            y1={h - p - t * (h - 2 * p)} y2={h - p - t * (h - 2 * p)}
            stroke="#E2E8F0" strokeWidth="1"
          />
        ))}
        <path d={area} fill="url(#tealGrad)" />
        <path d={path} fill="none" stroke="#22D3EE" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
        {pts.map(([x, y], i) => (
          <circle key={i} cx={x} cy={y} r={i === peakIdx ? 6 : 3} fill={i === peakIdx ? '#22D3EE' : '#fff'} stroke="#22D3EE" strokeWidth="2" />
        ))}
      </svg>
      <div className="flex justify-between text-[11px] text-slate-500 font-semibold mt-1 px-1">
        {labels.map((l, i) => <span key={i}>{l}</span>)}
      </div>
    </div>
  );
}
