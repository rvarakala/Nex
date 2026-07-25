/**
 * DashboardMockups — targeted "before / after" preview showing ONLY the
 * three changes the clinic owner requested:
 *   1. Remove the "Overview" H1
 *   2. Remove the duplicate page-level search bar
 *   3. Compact "NEEDS ATTENTION" (label + 3 tiles + REVIEW ALL) into ONE line
 * Same palette + same components as the live dashboard so the preview is 1:1
 * with what will ship. This file is deleted once the change is approved.
 */
import React from 'react';
import {
  Calendar, Bell, Search, AlertTriangle, ChevronRight,
  Clock, Box, Wrench,
} from 'lucide-react';

// Sample counts identical to the user's screenshot
const RECALLS = 0;
const LOW_STOCK = 0;
const REPAIRS = 0;

// ── Existing card component copied verbatim from ModernDashboard so the
//    "BEFORE" screenshot is a faithful reproduction of what ships today. ──
function NAHero({ borderColor, iconBg, iconColor, icon, title, sub, count, unit, live, onClick, testid }) {
  return (
    <button
      onClick={onClick}
      data-testid={testid}
      className="group relative w-full text-left bg-white rounded-2xl p-4 sm:p-5 flex items-center gap-4 border border-slate-100 shadow-[0_2px_10px_-4px_rgba(15,23,42,0.08)] hover:shadow-[0_10px_24px_-8px_rgba(15,29,58,0.18)] hover:-translate-y-0.5 transition-all overflow-hidden"
      style={{ borderLeft: `4px solid ${borderColor}` }}
    >
      <span className="w-11 h-11 rounded-xl flex items-center justify-center shrink-0" style={{ background: iconBg, color: iconColor }}>
        {icon}
      </span>
      <span className="flex-1 min-w-0">
        <span className="flex items-center gap-1.5">
          <span className="block text-[15px] sm:text-[16px] font-extrabold text-slate-900 tracking-tight">{title}</span>
          {live && count > 0 && <span className="inline-block w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse" />}
        </span>
        <span className="block text-[10.5px] font-bold uppercase tracking-wider text-slate-500 mt-0.5">{sub}</span>
        <span className="block text-[24px] sm:text-[26px] font-black text-slate-900 leading-none mt-1.5 tracking-tight">
          {count}
          <span className="text-[12px] font-semibold text-slate-500 tracking-normal ml-1.5">{unit}</span>
        </span>
      </span>
      <ChevronRight size={16} className="text-slate-300 shrink-0" />
    </button>
  );
}

// ═════════════════════════════════════════════════════════════════════
// BEFORE — pixel-faithful copy of the current dashboard top section
// ═════════════════════════════════════════════════════════════════════
function BeforeMock() {
  return (
    <div className="p-4 sm:p-6 lg:p-8 space-y-5 max-w-[1500px] mx-auto rounded-xl" style={{ background: '#EEF1FA' }}>
      {/* Overview + duplicated search */}
      <div className="hidden lg:flex items-center justify-between">
        <h1 className="text-[26px] font-extrabold tracking-tight text-slate-900">Overview</h1>
        <div className="flex items-center gap-3">
          <div className="relative">
            <Search size={14} className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" />
            <input readOnly placeholder="Search Appointment, Patient or etc…"
                   className="pl-10 pr-4 py-2.5 text-[13px] bg-white rounded-full shadow-sm border border-transparent w-[340px]" />
          </div>
          <button className="w-10 h-10 rounded-full bg-white shadow-sm flex items-center justify-center relative">
            <Bell size={18} className="text-slate-700" />
            <span className="absolute -top-0.5 -right-0.5 w-2.5 h-2.5 rounded-full bg-red-500 ring-2 ring-white" />
          </button>
        </div>
      </div>

      {/* Welcome hero + date */}
      <div className="flex items-end justify-between flex-wrap gap-3">
        <div>
          <div className="text-[22px] sm:text-[26px] font-extrabold text-slate-900 tracking-tight">
            Good Evening, Dr. Suresh Raina
          </div>
          <div className="text-[13px] text-slate-500 mt-1 font-medium">Have a nice day at great work</div>
        </div>
        <div className="bg-white rounded-xl shadow-sm px-4 py-2.5 flex items-center gap-2">
          <div className="text-[13px] font-semibold text-slate-800">25 July 2026</div>
          <Calendar size={16} className="text-cyan-500" strokeWidth={2.2} />
        </div>
      </div>

      {/* Needs Attention — 2 rows (label row + 3 stacked cards) */}
      <div>
        <div className="flex items-center justify-between mb-3 px-1">
          <div className="flex items-center gap-2.5">
            <AlertTriangle size={18} className="text-amber-600" strokeWidth={2.5} />
            <h3 className="text-[11px] font-extrabold tracking-[0.14em] text-amber-800 uppercase">Needs Attention</h3>
          </div>
          <button className="text-[12px] font-extrabold text-amber-800 flex items-center gap-0.5">
            REVIEW ALL <ChevronRight size={14} strokeWidth={2.6} />
          </button>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3 lg:gap-4">
          <NAHero borderColor="#F97316" iconBg="#FFEDD5" iconColor="#EA580C" icon={<Clock size={22} strokeWidth={2.2} />}
                  title="Recall Reminders" sub="Follow-ups due" count={RECALLS} unit="patients" />
          <NAHero borderColor="#EF4444" iconBg="#FEE2E2" iconColor="#DC2626" icon={<Box size={22} strokeWidth={2.2} />}
                  title="Low Stock Alert" sub="HA models running low" count={LOW_STOCK} unit="SKUs" />
          <NAHero borderColor="#0EA5E9" iconBg="#DBEAFE" iconColor="#2563EB" icon={<Wrench size={22} strokeWidth={2.2} />}
                  title="Device Pending" sub="Repairs ready to deliver" count={REPAIRS} unit="devices" />
        </div>
      </div>
    </div>
  );
}

// ═════════════════════════════════════════════════════════════════════
// AFTER — the 3 requested changes applied
//   1. "Overview" removed
//   2. Duplicate search bar removed (top-nav ⌘K stays)
//   3. NEEDS ATTENTION collapsed into a SINGLE horizontal row
// ═════════════════════════════════════════════════════════════════════
function AfterMock() {
  return (
    <div className="p-4 sm:p-6 lg:p-8 space-y-5 max-w-[1500px] mx-auto rounded-xl" style={{ background: '#EEF1FA' }}>

      {/* Welcome hero + date — SAME as before, but "Overview" is gone */}
      <div className="flex items-end justify-between flex-wrap gap-3">
        <div>
          <div className="text-[22px] sm:text-[26px] font-extrabold text-slate-900 tracking-tight">
            Good Evening, Dr. Suresh Raina
          </div>
          <div className="text-[13px] text-slate-500 mt-1 font-medium">Have a nice day at great work</div>
        </div>
        <div className="bg-white rounded-xl shadow-sm px-4 py-2.5 flex items-center gap-2">
          <div className="text-[13px] font-semibold text-slate-800">25 July 2026</div>
          <Calendar size={16} className="text-cyan-500" strokeWidth={2.2} />
        </div>
      </div>

      {/* NEEDS ATTENTION — SINGLE ROW.
          Label + 3 compact chips + REVIEW ALL. All on one horizontal line.
          Each chip is still clickable + keeps its brand colour + count.
          Reclaims ~120 px of vertical space vs the current 2-row layout. */}
      <div className="flex items-center gap-3 flex-wrap" data-testid="na-single-line">
        <div className="flex items-center gap-2 shrink-0">
          <AlertTriangle size={16} className="text-amber-600" strokeWidth={2.5} />
          <h3 className="text-[11px] font-extrabold tracking-[0.14em] text-amber-800 uppercase whitespace-nowrap">
            Needs Attention
          </h3>
        </div>

        <div className="flex items-center gap-2 flex-1 min-w-0 overflow-x-auto no-scrollbar">
          {/* Recall Reminders */}
          <button className="group inline-flex items-center gap-2.5 bg-white rounded-full pl-1.5 pr-3 py-1.5 border border-slate-100 shadow-[0_1px_6px_-2px_rgba(15,23,42,0.08)] hover:shadow-[0_6px_16px_-6px_rgba(15,29,58,0.18)] hover:-translate-y-px transition-all whitespace-nowrap"
                  style={{ borderLeft: '3px solid #F97316' }}>
            <span className="w-6 h-6 rounded-full flex items-center justify-center shrink-0" style={{ background: '#FFEDD5', color: '#EA580C' }}>
              <Clock size={13} strokeWidth={2.4} />
            </span>
            <span className="text-[12.5px] font-bold text-slate-800">Recall Reminders</span>
            <span className="text-[11px] font-black text-slate-900 tabular-nums bg-slate-100 rounded-full px-1.5">
              {RECALLS}
            </span>
          </button>

          {/* Low Stock */}
          <button className="group inline-flex items-center gap-2.5 bg-white rounded-full pl-1.5 pr-3 py-1.5 border border-slate-100 shadow-[0_1px_6px_-2px_rgba(15,23,42,0.08)] hover:shadow-[0_6px_16px_-6px_rgba(15,29,58,0.18)] hover:-translate-y-px transition-all whitespace-nowrap"
                  style={{ borderLeft: '3px solid #EF4444' }}>
            <span className="w-6 h-6 rounded-full flex items-center justify-center shrink-0" style={{ background: '#FEE2E2', color: '#DC2626' }}>
              <Box size={13} strokeWidth={2.4} />
            </span>
            <span className="text-[12.5px] font-bold text-slate-800">Low Stock Alert</span>
            <span className="text-[11px] font-black text-slate-900 tabular-nums bg-slate-100 rounded-full px-1.5">
              {LOW_STOCK}
            </span>
          </button>

          {/* Device Pending */}
          <button className="group inline-flex items-center gap-2.5 bg-white rounded-full pl-1.5 pr-3 py-1.5 border border-slate-100 shadow-[0_1px_6px_-2px_rgba(15,23,42,0.08)] hover:shadow-[0_6px_16px_-6px_rgba(15,29,58,0.18)] hover:-translate-y-px transition-all whitespace-nowrap"
                  style={{ borderLeft: '3px solid #0EA5E9' }}>
            <span className="w-6 h-6 rounded-full flex items-center justify-center shrink-0" style={{ background: '#DBEAFE', color: '#2563EB' }}>
              <Wrench size={13} strokeWidth={2.4} />
            </span>
            <span className="text-[12.5px] font-bold text-slate-800">Device Pending</span>
            <span className="text-[11px] font-black text-slate-900 tabular-nums bg-slate-100 rounded-full px-1.5">
              {REPAIRS}
            </span>
          </button>
        </div>

        <button className="text-[11.5px] font-extrabold text-amber-800 hover:text-amber-900 flex items-center gap-0.5 shrink-0 ml-auto">
          REVIEW ALL <ChevronRight size={13} strokeWidth={2.6} />
        </button>
      </div>
    </div>
  );
}

// ═════════════════════════════════════════════════════════════════════
// Side-by-side page
// ═════════════════════════════════════════════════════════════════════
export default function DashboardCompactPreview() {
  return (
    <div className="min-h-screen bg-slate-100 p-6 sm:p-10" data-testid="dashboard-compact-preview">
      <div className="max-w-[1500px] mx-auto space-y-8">
        <div>
          <div className="text-[11px] font-bold tracking-[0.2em] uppercase text-slate-500">Before</div>
          <div className="text-lg font-semibold text-slate-900 mb-3">
            Current dashboard — &quot;Overview&quot; heading, duplicate search bar, two-row Needs Attention
          </div>
          <BeforeMock />
        </div>

        <div>
          <div className="text-[11px] font-bold tracking-[0.2em] uppercase text-emerald-700">After · Proposed</div>
          <div className="text-lg font-semibold text-slate-900 mb-3">
            &quot;Overview&quot; removed · page search removed (top-nav ⌘K stays) · Needs Attention collapsed to one line
          </div>
          <AfterMock />
        </div>

        <div className="bg-white rounded-lg border border-slate-200 p-5 text-[13px] text-slate-700 space-y-2">
          <div className="font-bold text-slate-900 text-sm">What&#39;s changing (and what isn&#39;t)</div>
          <ul className="list-disc pl-5 space-y-1">
            <li><b>Removed</b>: page-level H1 &quot;Overview&quot; (kept only in the browser tab title).</li>
            <li><b>Removed</b>: the page-level &quot;Search Appointment, Patient or etc…&quot; input <i>and</i> the bell icon next to it. The global top-nav <kbd>⌘K</kbd> search on the header already covers this.</li>
            <li><b>Kept unchanged</b>: greeting, subtitle &quot;Have a nice day at great work&quot;, date pill.</li>
            <li><b>Collapsed</b>: &quot;Needs Attention&quot; section from 2 rows (label + 3 big cards) into <b>a single horizontal row</b> of pill-style chips — same brand colours (orange / red / blue left-borders), same icons, same clickable behaviour, same counts. Reclaims ~120px of vertical space so more of your KPIs + timeline sit above the fold.</li>
            <li><b>Not changing</b>: the 4 KPI tiles below (Appointments / New Patients / Tests / Collections), Today&#39;s Appointments, In Test Now, Quick Actions, Recent Registrations, Test Mix — all untouched.</li>
          </ul>
        </div>
      </div>
    </div>
  );
}
