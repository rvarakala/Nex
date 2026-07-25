/**
 * DashboardMockups — 3 side-by-side design proposals so the clinic owner can
 * pick one before we replace the real Overview. These are pure JSX + sample
 * data (no API calls, no side effects). Once a direction is picked, the
 * winning layout is ported into `ModernDashboard.jsx` and this file is
 * deleted.
 */
import React from 'react';
import {
  Calendar, UserPlus, Ear, IndianRupee, Sparkles, Search, Bell,
  Plus, Package, Wrench, PhoneCall, ChevronRight, Cake, Heart,
  ArrowUpRight, Zap, TrendingUp,
} from 'lucide-react';

// ─── Shared sample data so all 3 mocks are directly comparable ───
const S = {
  greeting: 'Good Afternoon, Dr. Raina',
  today: '25 Jul 2026',
  kpis: {
    appointments: 12,
    newPatients: 3,
    tests: 8,
    revenue: 4000,
  },
  attention: {
    recalls: 0,
    stock: 0,
    repairs: 0,
    invoices: 2,
  },
  live: [
    { id: 'A', name: 'Aditi P.',  test: 'PTA',    status: 'testing', mins: 6 },
    { id: 'B', name: 'Ravi K.',   test: 'SPEECH', status: 'waiting', mins: 12 },
    { id: 'C', name: 'Deepa S.',  test: 'IA',     status: 'next',    mins: 25 },
  ],
  celebrations: [
    { id: 'x1', kind: 'birthday',     name: 'Priya Menon',  when: 'Today' },
    { id: 'x2', kind: 'anniversary',  name: 'Ajay & Nita',  when: 'Tomorrow' },
  ],
};

const fmtINR = (n) => `₹${n.toLocaleString('en-IN')}`;

// ═════════════════════════════════════════════════════════════════════
// DIRECTION A — "Command Deck" (dense tactical grid)
// ═════════════════════════════════════════════════════════════════════
export function DashboardMockA() {
  return (
    <div className="min-h-screen bg-[#EEF1FA] p-6 sm:p-8" data-testid="mock-a-root">
      {/* Header */}
      <div className="flex items-end justify-between mb-6">
        <div>
          <h1 className="text-3xl sm:text-4xl font-light tracking-tight text-[#0F1D3A]">
            <span className="font-semibold">Good Afternoon,</span> Dr. Raina.
          </h1>
        </div>
        <div className="text-xs font-medium tracking-[0.2em] uppercase text-[#0F1D3A]/60 tabular-nums">
          {S.today}
        </div>
      </div>

      {/* Zero-state attention chip */}
      <div className="mb-6 inline-flex items-center gap-2 px-3 py-1.5 bg-emerald-50 border border-emerald-200/70 rounded-md text-[11px] font-semibold text-emerald-800 tracking-wide">
        <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
        All clear — 0 recalls · 0 low-stock · 0 repairs pending
        <span className="ml-2 text-emerald-700/60">·</span>
        <a href="#" className="underline underline-offset-2 text-emerald-800/80 hover:text-emerald-900">2 invoices past due →</a>
      </div>

      {/* KPI row */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
        {[
          { k: 'Appointments', v: S.kpis.appointments, sub: '+2 vs yesterday',   test: 'kpi-appts' },
          { k: 'New Patients', v: S.kpis.newPatients,  sub: 'today',             test: 'kpi-new'   },
          { k: 'Tests',        v: S.kpis.tests,        sub: '4 PTA · 2 SPEECH',  test: 'kpi-tests' },
          { k: 'Revenue',      v: fmtINR(S.kpis.revenue), sub: '3 invoices',    test: 'kpi-rev'   },
        ].map((c) => (
          <div key={c.k} data-testid={`mock-a-${c.test}`}
               className="bg-white border border-[#0F1D3A]/10 rounded-lg p-4 hover:-translate-y-0.5 hover:border-teal-400/40 hover:shadow-sm transition-all duration-200">
            <div className="text-[10px] font-bold tracking-[0.2em] uppercase text-[#0F1D3A]/50">{c.k}</div>
            <div className="mt-2 flex items-baseline gap-2">
              <div className="text-4xl sm:text-5xl font-black tracking-tighter text-[#0F1D3A]" style={{ fontFamily: 'Plus Jakarta Sans, Inter, sans-serif' }}>
                {c.v}
              </div>
              <span className="w-1.5 h-1.5 rounded-full bg-teal-500" />
            </div>
            <div className="mt-1 text-[11px] text-[#0F1D3A]/55">{c.sub}</div>
          </div>
        ))}
      </div>

      {/* Timeline + Quick Actions */}
      <div className="grid grid-cols-12 gap-4">
        <div className="col-span-12 lg:col-span-8 bg-white border border-[#0F1D3A]/10 rounded-lg p-5">
          <div className="flex items-center justify-between mb-4">
            <div className="text-[11px] font-bold tracking-[0.2em] uppercase text-[#0F1D3A]/60">{`Today's Timeline`}</div>
            <div className="text-[11px] text-[#0F1D3A]/40">In-Test · Waiting · Next</div>
          </div>
          <ul className="divide-y divide-[#0F1D3A]/5">
            {S.live.map((r) => (
              <li key={r.id} className="py-3 flex items-center gap-3">
                <span className={`w-1.5 h-9 rounded-full ${r.status === 'testing' ? 'bg-teal-500' : r.status === 'waiting' ? 'bg-amber-400' : 'bg-[#0F1D3A]/20'}`} />
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-semibold text-[#0F1D3A]">{r.name}</div>
                  <div className="text-[11px] text-[#0F1D3A]/55">{r.test} · {r.mins}m {r.status === 'testing' ? 'in test' : r.status === 'waiting' ? 'waiting' : 'until'}</div>
                </div>
                <span className={`text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded ${r.status === 'testing' ? 'bg-teal-50 text-teal-700' : r.status === 'waiting' ? 'bg-amber-50 text-amber-800' : 'bg-[#0F1D3A]/5 text-[#0F1D3A]/60'}`}>
                  {r.status}
                </span>
              </li>
            ))}
          </ul>
        </div>

        <div className="col-span-12 lg:col-span-4 bg-white border border-[#0F1D3A]/10 rounded-lg p-5">
          <div className="text-[11px] font-bold tracking-[0.2em] uppercase text-[#0F1D3A]/60 mb-3">Quick Actions</div>
          <div className="grid grid-cols-2 gap-2">
            {[
              { icon: Calendar,  label: 'New Appt' },
              { icon: UserPlus,  label: 'Register' },
              { icon: Ear,       label: 'Hearing Test' },
              { icon: Package,   label: 'HA Sale' },
              { icon: PhoneCall, label: 'Recall' },
              { icon: Wrench,    label: 'Service' },
            ].map(({ icon: Icon, label }) => (
              <button key={label}
                      className="group flex flex-col items-start gap-1 p-2.5 border border-[#0F1D3A]/10 rounded-md hover:border-teal-400/40 hover:bg-teal-50/30 transition-colors">
                <Icon size={14} className="text-[#0F1D3A]/70 group-hover:text-teal-600" />
                <span className="text-[11px] font-semibold text-[#0F1D3A]/80">{label}</span>
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

// ═════════════════════════════════════════════════════════════════════
// DIRECTION B — "Focus Feed" (task-first live pulse)
// ═════════════════════════════════════════════════════════════════════
export function DashboardMockB() {
  return (
    <div className="min-h-screen bg-[#EEF1FA] p-6 sm:p-8" data-testid="mock-b-root">
      <h1 className="text-3xl sm:text-4xl font-light tracking-tight text-[#0F1D3A] mb-8">
        <span className="font-semibold">Good Afternoon,</span> Dr. Raina.
      </h1>

      <div className="grid grid-cols-12 gap-5">
        {/* LEFT · Metrics + Actions */}
        <aside className="col-span-12 lg:col-span-3 space-y-6">
          <div>
            <div className="text-[10px] font-bold tracking-[0.2em] uppercase text-[#0F1D3A]/50 mb-3">Metrics</div>
            <ul className="space-y-3">
              {[
                { k: 'Appointments', v: S.kpis.appointments },
                { k: 'New patients', v: S.kpis.newPatients },
                { k: 'Tests today',  v: S.kpis.tests },
                { k: 'Revenue',      v: fmtINR(S.kpis.revenue) },
              ].map((r) => (
                <li key={r.k} className="flex items-baseline justify-between border-b border-[#0F1D3A]/8 pb-2">
                  <span className="text-[13px] text-[#0F1D3A]/70 font-medium">{r.k}</span>
                  <span className="text-2xl font-black tabular-nums tracking-tight text-[#0F1D3A]" style={{ fontFamily: 'Plus Jakarta Sans, Inter, sans-serif' }}>
                    {r.v}
                  </span>
                </li>
              ))}
            </ul>
          </div>

          <div>
            <div className="text-[10px] font-bold tracking-[0.2em] uppercase text-[#0F1D3A]/50 mb-3">Actions</div>
            <div className="space-y-1.5">
              {[
                { icon: Plus,      label: 'New appointment' },
                { icon: UserPlus,  label: 'Register patient' },
                { icon: Ear,       label: 'Start hearing test' },
                { icon: IndianRupee, label: 'Add HA sale' },
              ].map(({ icon: Icon, label }) => (
                <button key={label}
                        className="w-full text-left flex items-center gap-2 px-3 py-2 rounded-md border border-transparent hover:border-[#0F1D3A]/10 hover:bg-white transition">
                  <Icon size={13} className="text-[#0F1D3A]/60" />
                  <span className="text-[12px] font-semibold text-[#0F1D3A]/80">{label}</span>
                </button>
              ))}
            </div>
          </div>
        </aside>

        {/* CENTER · Today's Feed */}
        <div className="col-span-12 lg:col-span-6 bg-white border border-[#0F1D3A]/10 rounded-lg">
          <div className="p-5 border-b border-[#0F1D3A]/8 flex items-center justify-between">
            <div>
              <div className="text-[10px] font-bold tracking-[0.2em] uppercase text-[#0F1D3A]/50">{`Today's Feed`}</div>
              <div className="mt-1 text-sm font-semibold text-[#0F1D3A]">Live · 3 sessions</div>
            </div>
            <div className="flex items-center gap-1 text-[11px] font-semibold text-teal-600">
              <span className="w-1.5 h-1.5 rounded-full bg-teal-500 animate-pulse" />
              Streaming
            </div>
          </div>
          <ul>
            {S.live.map((r, i) => (
              <li key={r.id} className={`px-5 py-4 flex items-center gap-3 ${i < S.live.length - 1 ? 'border-b border-[#0F1D3A]/6' : ''}`}>
                <div className={`w-8 h-8 rounded-md flex items-center justify-center text-[10px] font-black ${r.status === 'testing' ? 'bg-teal-500 text-white' : r.status === 'waiting' ? 'bg-amber-100 text-amber-900' : 'bg-[#0F1D3A]/5 text-[#0F1D3A]/60'}`}>
                  {r.test}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-semibold text-[#0F1D3A]">{r.name}</div>
                  <div className="text-[11px] text-[#0F1D3A]/55">
                    {r.status === 'testing' ? `Testing · ${r.mins}m elapsed` :
                     r.status === 'waiting' ? `Waiting · ${r.mins}m ago` :
                     `Next up · in ${r.mins}m`}
                  </div>
                </div>
                <ChevronRight size={14} className="text-[#0F1D3A]/30" />
              </li>
            ))}
          </ul>
          <div className="p-4 border-t border-[#0F1D3A]/6">
            <div className="text-[10px] font-bold tracking-[0.2em] uppercase text-[#0F1D3A]/50 mb-2">Recent registrations</div>
            <div className="space-y-1.5 text-[12px]">
              <div className="flex items-center justify-between text-[#0F1D3A]/70">
                <span>Mark Smith</span>
                <span className="text-teal-700 font-semibold cursor-pointer">Approve →</span>
              </div>
              <div className="flex items-center justify-between text-[#0F1D3A]/70">
                <span>Priya Suresh</span>
                <span className="text-teal-700 font-semibold cursor-pointer">Approve →</span>
              </div>
            </div>
          </div>
        </div>

        {/* RIGHT · Attention + Celebrations */}
        <aside className="col-span-12 lg:col-span-3 space-y-6">
          <div>
            <div className="flex items-center justify-between mb-3">
              <div className="text-[10px] font-bold tracking-[0.2em] uppercase text-[#0F1D3A]/50">Attention</div>
              <span className="text-[10px] font-bold text-emerald-600 uppercase tracking-wider">0</span>
            </div>
            <ul className="space-y-2 text-[12px]">
              {[
                { k: 'Recalls due',   v: S.attention.recalls,  ok: true },
                { k: 'Low stock',     v: S.attention.stock,    ok: true },
                { k: 'Repairs ready', v: S.attention.repairs,  ok: true },
                { k: 'Invoices due',  v: S.attention.invoices, ok: false },
              ].map((r) => (
                <li key={r.k} className={`flex items-center justify-between ${r.ok ? 'text-[#0F1D3A]/40' : 'text-[#0F1D3A]/80'}`}>
                  <span className="font-medium">{r.k}</span>
                  <span className={`tabular-nums font-black ${r.ok ? '' : 'text-rose-600'}`}>{r.v}</span>
                </li>
              ))}
            </ul>
          </div>

          <div>
            <div className="text-[10px] font-bold tracking-[0.2em] uppercase text-[#0F1D3A]/50 mb-3">Celebrations</div>
            <ul className="space-y-2">
              {S.celebrations.map((c) => (
                <li key={c.id} className="flex items-center gap-2 text-[12px] text-[#0F1D3A]/70">
                  {c.kind === 'birthday' ? <Cake size={12} className="text-pink-500" /> : <Heart size={12} className="text-rose-500" />}
                  <span className="font-semibold text-[#0F1D3A]/85">{c.name}</span>
                  <span className="ml-auto text-[10px] text-[#0F1D3A]/40">{c.when}</span>
                </li>
              ))}
            </ul>
          </div>
        </aside>
      </div>
    </div>
  );
}

// ═════════════════════════════════════════════════════════════════════
// DIRECTION C — "Editorial Overview" (asymmetric bento)
// ═════════════════════════════════════════════════════════════════════
export function DashboardMockC() {
  return (
    <div className="min-h-screen bg-[#EEF1FA] p-6 sm:p-8" data-testid="mock-c-root">
      <div className="grid grid-cols-12 gap-6">
        {/* LEFT rail · sticky command center */}
        <aside className="col-span-12 lg:col-span-4 space-y-8">
          <div>
            <div className="text-[10px] font-bold tracking-[0.2em] uppercase text-[#0F1D3A]/50 tabular-nums">
              {S.today}
            </div>
            <h1 className="mt-2 text-4xl sm:text-5xl font-light leading-[1.05] tracking-tight text-[#0F1D3A]">
              Good Afternoon,<br /><span className="font-semibold">Dr. Raina.</span>
            </h1>
          </div>

          <div>
            <div className="flex items-baseline justify-between">
              <div className="text-[10px] font-bold tracking-[0.2em] uppercase text-[#0F1D3A]/50">Needs Attention</div>
              <div className="text-3xl font-black text-emerald-600 tabular-nums" style={{ fontFamily: 'Plus Jakarta Sans, Inter, sans-serif' }}>0</div>
            </div>
            <p className="mt-1 text-[12px] text-[#0F1D3A]/60 leading-relaxed">
              All systems optimal. No pending recalls, low-stock alerts, or repairs.
              <span className="text-rose-600 font-semibold"> 2 invoices past due</span> — <a href="#" className="underline underline-offset-2">review</a>.
            </p>
          </div>

          <div>
            <div className="text-[10px] font-bold tracking-[0.2em] uppercase text-[#0F1D3A]/50 mb-3">Quick Actions</div>
            <div className="space-y-2">
              <button className="w-full flex items-center justify-between px-4 py-3 bg-[#0F1D3A] text-white rounded-md hover:bg-[#0F1D3A]/90 transition group">
                <span className="text-sm font-semibold">New appointment</span>
                <ArrowUpRight size={15} className="text-teal-300 group-hover:translate-x-0.5 group-hover:-translate-y-0.5 transition-transform" />
              </button>
              <button className="w-full flex items-center justify-between px-4 py-3 bg-white border border-[#0F1D3A]/10 rounded-md hover:border-teal-400/40 transition group">
                <span className="text-sm font-semibold text-[#0F1D3A]">Register patient</span>
                <ArrowUpRight size={15} className="text-[#0F1D3A]/40 group-hover:text-teal-600 group-hover:translate-x-0.5 group-hover:-translate-y-0.5 transition-all" />
              </button>
              <button className="w-full flex items-center justify-between px-4 py-3 bg-white border border-[#0F1D3A]/10 rounded-md hover:border-teal-400/40 transition group">
                <span className="text-sm font-semibold text-[#0F1D3A]">Start hearing test</span>
                <ArrowUpRight size={15} className="text-[#0F1D3A]/40 group-hover:text-teal-600 group-hover:translate-x-0.5 group-hover:-translate-y-0.5 transition-all" />
              </button>
            </div>
          </div>
        </aside>

        {/* RIGHT · Bento grid */}
        <div className="col-span-12 lg:col-span-8 grid grid-cols-6 gap-4 auto-rows-min">
          {/* Hero KPI — Navy background, spans 3 cols, 2 rows */}
          <div className="col-span-6 sm:col-span-3 row-span-2 bg-[#0F1D3A] rounded-lg p-6 flex flex-col justify-between hover:shadow-lg transition">
            <div>
              <div className="text-[10px] font-bold tracking-[0.2em] uppercase text-teal-300/80">Appointments today</div>
              <div className="mt-3 text-7xl font-black tracking-tighter text-white leading-none" style={{ fontFamily: 'Plus Jakarta Sans, Inter, sans-serif' }}>
                {S.kpis.appointments}
              </div>
              <div className="mt-2 flex items-center gap-1.5 text-[11px] font-semibold text-teal-300">
                <TrendingUp size={11} /> +2 vs yesterday
              </div>
            </div>
            <div className="text-[11px] text-white/50 border-t border-white/10 pt-3">
              <span className="font-semibold text-white/80">Next</span> · 03:00 PM · Aditi P. (PTA)
            </div>
          </div>

          {/* KPI · New Patients */}
          <div className="col-span-3 sm:col-span-3 bg-white border border-[#0F1D3A]/10 rounded-lg p-4">
            <div className="text-[10px] font-bold tracking-[0.2em] uppercase text-[#0F1D3A]/50">New Patients</div>
            <div className="mt-2 text-4xl font-black tracking-tighter text-[#0F1D3A]" style={{ fontFamily: 'Plus Jakarta Sans, Inter, sans-serif' }}>
              {S.kpis.newPatients}
            </div>
          </div>

          {/* Two half-tiles */}
          <div className="col-span-3 sm:col-span-2 bg-white border border-[#0F1D3A]/10 rounded-lg p-4">
            <div className="text-[10px] font-bold tracking-[0.2em] uppercase text-[#0F1D3A]/50">Tests</div>
            <div className="mt-2 text-4xl font-black tracking-tighter text-[#0F1D3A]" style={{ fontFamily: 'Plus Jakarta Sans, Inter, sans-serif' }}>
              {S.kpis.tests}
            </div>
          </div>
          <div className="col-span-3 sm:col-span-1 bg-teal-50 border border-teal-200/60 rounded-lg p-4">
            <div className="text-[10px] font-bold tracking-[0.2em] uppercase text-teal-700">Revenue</div>
            <div className="mt-2 text-2xl font-black tracking-tighter text-teal-900" style={{ fontFamily: 'Plus Jakarta Sans, Inter, sans-serif' }}>
              {fmtINR(S.kpis.revenue)}
            </div>
          </div>

          {/* Live · In Test Now */}
          <div className="col-span-6 bg-white border border-[#0F1D3A]/10 rounded-lg p-5">
            <div className="flex items-center justify-between mb-3">
              <div>
                <div className="text-[10px] font-bold tracking-[0.2em] uppercase text-[#0F1D3A]/50">Live · In Test Now</div>
                <div className="mt-1 text-sm font-semibold text-[#0F1D3A]">3 sessions running</div>
              </div>
              <div className="flex items-center gap-1 text-[11px] font-semibold text-teal-600">
                <Zap size={11} /> Streaming
              </div>
            </div>
            <div className="grid grid-cols-3 gap-3">
              {S.live.map((r) => (
                <div key={r.id} className="p-3 rounded-md bg-[#EEF1FA]/50 border border-[#0F1D3A]/6 hover:border-teal-400/40 transition">
                  <div className="flex items-center justify-between">
                    <span className={`text-[9px] font-black uppercase tracking-wider px-1.5 py-0.5 rounded ${r.status === 'testing' ? 'bg-teal-500 text-white' : r.status === 'waiting' ? 'bg-amber-500/90 text-white' : 'bg-[#0F1D3A]/10 text-[#0F1D3A]/70'}`}>
                      {r.test}
                    </span>
                    <span className="text-[10px] font-semibold text-[#0F1D3A]/50 tabular-nums">{r.mins}m</span>
                  </div>
                  <div className="mt-2 text-[13px] font-semibold text-[#0F1D3A] truncate">{r.name}</div>
                  <div className="text-[10px] text-[#0F1D3A]/50 capitalize">{r.status === 'next' ? 'Next up' : r.status}</div>
                </div>
              ))}
            </div>
          </div>

          {/* Celebrations */}
          <div className="col-span-6 sm:col-span-4 bg-white border border-[#0F1D3A]/10 rounded-lg p-5">
            <div className="text-[10px] font-bold tracking-[0.2em] uppercase text-[#0F1D3A]/50 mb-3">Celebrations this week</div>
            <ul className="space-y-2.5">
              {S.celebrations.map((c) => (
                <li key={c.id} className="flex items-center gap-3">
                  <span className={`w-7 h-7 rounded-md flex items-center justify-center ${c.kind === 'birthday' ? 'bg-pink-50 text-pink-500' : 'bg-rose-50 text-rose-500'}`}>
                    {c.kind === 'birthday' ? <Cake size={13} /> : <Heart size={13} />}
                  </span>
                  <div className="min-w-0">
                    <div className="text-[13px] font-semibold text-[#0F1D3A]">{c.name}</div>
                    <div className="text-[11px] text-[#0F1D3A]/55 capitalize">{c.kind} · {c.when}</div>
                  </div>
                  <button className="ml-auto text-[11px] font-semibold text-teal-700 hover:text-teal-800">
                    Send wishes
                  </button>
                </li>
              ))}
            </ul>
          </div>

          {/* Mini donut */}
          <div className="col-span-6 sm:col-span-2 bg-white border border-[#0F1D3A]/10 rounded-lg p-5">
            <div className="text-[10px] font-bold tracking-[0.2em] uppercase text-[#0F1D3A]/50">Test Mix</div>
            <div className="mt-4 flex items-center gap-3">
              <div className="relative w-16 h-16">
                <div className="absolute inset-0 rounded-full" style={{ background: 'conic-gradient(#14B8A6 0 45%, #F59E0B 45% 70%, #6366F1 70% 90%, #0F1D3A/10 90% 100%)' }} />
                <div className="absolute inset-2 rounded-full bg-white flex items-center justify-center">
                  <span className="text-sm font-black text-[#0F1D3A]">8</span>
                </div>
              </div>
              <div className="text-[10px] text-[#0F1D3A]/60 space-y-0.5">
                <div className="flex items-center gap-1.5"><span className="w-1.5 h-1.5 rounded-full bg-teal-500" />PTA · 4</div>
                <div className="flex items-center gap-1.5"><span className="w-1.5 h-1.5 rounded-full bg-amber-500" />SPEECH · 2</div>
                <div className="flex items-center gap-1.5"><span className="w-1.5 h-1.5 rounded-full bg-indigo-500" />IA · 2</div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ═════════════════════════════════════════════════════════════════════
// Index page — links to all 3 mocks
// ═════════════════════════════════════════════════════════════════════
export default function DashboardMockupsIndex() {
  return (
    <div className="min-h-screen bg-[#EEF1FA] p-10">
      <h1 className="text-2xl font-light tracking-tight text-[#0F1D3A] mb-2">
        <span className="font-semibold">Dashboard mockups</span> · pick one
      </h1>
      <p className="text-sm text-[#0F1D3A]/60 mb-8">Preview each direction, then reply with your choice.</p>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 max-w-4xl">
        {[
          { to: '/mockups/dashboard-a', title: 'A · Command Deck',      tag: 'Dense tactical grid',    hue: 'bg-white' },
          { to: '/mockups/dashboard-b', title: 'B · Focus Feed',        tag: 'Task-first, live pulse', hue: 'bg-white' },
          { to: '/mockups/dashboard-c', title: 'C · Editorial Overview', tag: 'Asymmetric bento',      hue: 'bg-[#0F1D3A] text-white' },
        ].map((c) => (
          <a key={c.to} href={c.to}
             className={`block p-6 border border-[#0F1D3A]/10 rounded-lg hover:-translate-y-0.5 hover:border-teal-400/40 transition ${c.hue}`}>
            <div className="text-[10px] font-bold tracking-[0.2em] uppercase opacity-60">Direction</div>
            <div className="mt-2 text-lg font-semibold">{c.title}</div>
            <div className="mt-1 text-xs opacity-70">{c.tag}</div>
            <div className="mt-4 text-[11px] font-semibold text-teal-500 group-hover:text-teal-400">Open preview →</div>
          </a>
        ))}
      </div>
    </div>
  );
}
