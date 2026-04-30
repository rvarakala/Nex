/**
 * Features — Apple-style bento grid (Option C).
 *
 * Replaces the flat 5×2 icon-tile grid with a true bento composition: tiles
 * of varying sizes and treatments, each showing a *visual hint* of the actual
 * feature instead of just an icon. Mix of light and dark tiles for rhythm.
 *
 * 8 tiles arranged in a 6-column grid:
 *   [ ─── Patient EMR ─── ] [ Audiology ]
 *   [ Calendar    ] [ Billing ]   [ Reminders ]
 *   [ Inventory ] [ Multi-branch ] [ Reports ]
 */
import React from 'react';
import {
  CalendarDays, Stethoscope, Activity, Receipt, Boxes,
  Bell, BarChart3, Building2, ArrowRight, IndianRupee,
} from 'lucide-react';

export default function Features({ onBookDemo }) {
  return (
    <section id="features" className="py-20 md:py-28 bg-[#FAFAFB]" data-testid="landing-features">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="text-center max-w-3xl mx-auto">
          <span className="inline-flex items-center gap-2 px-3 py-1 rounded-full text-xs font-semibold bg-[#0B5FFF]/8 border border-[#0B5FFF]/15 text-[#0B5FFF]">
            One platform · Everything you need
          </span>
          <h2 className="mt-4 font-[Manrope,Inter,sans-serif] font-extrabold tracking-tight text-[#0F172A] text-3xl sm:text-4xl lg:text-[44px] leading-[1.05]">
            A clinic-OS that <span className="bg-gradient-to-r from-[#0B5FFF] to-[#00C2A8] bg-clip-text text-transparent">runs every workflow</span>
          </h2>
          <p className="mt-4 text-base text-[#475569] leading-relaxed">
            From the front desk to the audiometry booth to the accountant's desk — every step lives on AUDINEXA, fully encrypted and beautifully designed.
          </p>
        </div>

        {/* Bento grid */}
        <div className="mt-12 grid grid-cols-6 auto-rows-[160px] gap-3 sm:gap-4">
          <PatientEMRTile />
          <AudiologyTile />
          <CalendarTile />
          <BillingTile />
          <RemindersTile />
          <InventoryTile />
          <MultiBranchTile />
          <ReportsTile />
        </div>

        <div className="mt-10 flex justify-center">
          <button
            onClick={onBookDemo}
            data-testid="features-explore-cta"
            className="inline-flex items-center gap-2 bg-[#0B5FFF] hover:bg-[#094acf] text-white px-7 py-3.5 rounded-xl font-semibold shadow-md shadow-[#0B5FFF]/25 hover:shadow-lg hover:shadow-[#0B5FFF]/35 transition-all"
          >
            See it in action <ArrowRight size={18} />
          </button>
        </div>
      </div>
    </section>
  );
}

// ============================================================================
// Tile shells — every tile shares hover lift + rounded chrome
// ============================================================================
const TILE_BASE =
  'group relative overflow-hidden rounded-2xl border transition-all duration-300 hover:-translate-y-0.5';

// ---- Big featured: Patient EMR (4-col, 2-row) -----------------------------
function PatientEMRTile() {
  return (
    <div
      data-testid="ftile-emr"
      className={`${TILE_BASE} col-span-6 lg:col-span-4 row-span-2 bg-white border-slate-200 p-6 sm:p-7 hover:shadow-xl flex flex-col`}
    >
      <div className="flex items-start gap-3">
        <div className="w-10 h-10 rounded-xl bg-[#0B5FFF]/10 text-[#0B5FFF] flex items-center justify-center">
          <Stethoscope size={18} strokeWidth={2.4} />
        </div>
        <div>
          <h3 className="font-[Manrope,Inter,sans-serif] font-bold text-[#0F172A] text-[17px] leading-tight">Patient EMR</h3>
          <p className="text-[12.5px] text-[#64748B] mt-0.5">Full longitudinal record · From first visit to fitting.</p>
        </div>
      </div>

      {/* Mock patient card */}
      <div className="mt-5 flex-1 grid grid-cols-3 gap-3">
        <div className="col-span-1 bg-gradient-to-br from-[#0B5FFF] to-[#22D3EE] text-white rounded-xl p-3 flex flex-col justify-between">
          <div>
            <div className="text-[10px] uppercase tracking-wider font-bold opacity-80">MRD</div>
            <div className="text-[13px] font-mono mt-0.5">ACS-2026<br/>-001234</div>
          </div>
          <div className="text-[10px] opacity-90">Encrypted ✓</div>
        </div>
        <div className="col-span-2 bg-slate-50 rounded-xl p-3">
          <div className="text-[11px] font-bold text-[#0F172A]">Anita Sharma · 58 · F</div>
          <div className="text-[10px] text-slate-500 mt-0.5">Bilateral SNHL · 4 visits</div>
          <div className="mt-2 grid grid-cols-4 gap-1">
            {['PTA', 'Imp', 'OAE', 'Fit'].map((label, i) => (
              <div key={label} className="rounded bg-white border border-slate-200 px-1.5 py-1 text-center">
                <div className="text-[8px] font-bold text-slate-500 uppercase">{label}</div>
                <div className={`text-[10px] font-bold ${i < 3 ? 'text-emerald-600' : 'text-amber-600'}`}>{i < 3 ? '✓' : '…'}</div>
              </div>
            ))}
          </div>
          <div className="mt-2 h-1 bg-slate-200 rounded-full overflow-hidden">
            <div className="h-full bg-gradient-to-r from-[#0B5FFF] to-[#00C2A8] rounded-full"
              style={{ width: '75%', animation: 'progressGrow 1.2s cubic-bezier(0.16,1,0.3,1) both' }} />
          </div>
        </div>
      </div>

      <style>{`@keyframes progressGrow { from { width: 0; } }`}</style>
    </div>
  );
}

// ---- Audiology (2-col, 2-row dark) ---------------------------------------
function AudiologyTile() {
  // Simple curve to suggest a frequency response.
  return (
    <div
      data-testid="ftile-audiology"
      className={`${TILE_BASE} col-span-6 sm:col-span-3 lg:col-span-2 row-span-2 bg-[#0F172A] text-white border-transparent p-5 hover:shadow-2xl hover:shadow-[#0B5FFF]/30`}
    >
      <div aria-hidden className="absolute inset-0 bg-[radial-gradient(ellipse_at_top_right,rgba(34,211,238,0.18),transparent_60%)]" />
      <div className="relative">
        <div className="flex items-center gap-2.5">
          <div className="w-9 h-9 rounded-xl bg-[#22D3EE]/15 text-[#67E8F9] flex items-center justify-center ring-1 ring-[#22D3EE]/20">
            <Activity size={16} strokeWidth={2.4} />
          </div>
          <div>
            <h3 className="font-bold text-[15px]">Audiology Tests</h3>
            <p className="text-[11px] text-slate-400">PTA · Imp · OAE · ABR</p>
          </div>
        </div>

        {/* Animated waveform */}
        <svg viewBox="0 0 240 100" className="mt-4 w-full">
          <defs>
            <linearGradient id="ag-grad" x1="0" y1="0" x2="1" y2="0">
              <stop offset="0%" stopColor="#22D3EE" />
              <stop offset="100%" stopColor="#0B5FFF" />
            </linearGradient>
          </defs>
          {/* Soft ribbon */}
          <path d="M 0,55 Q 30,30 60,55 T 120,55 T 180,55 T 240,55 L 240,100 L 0,100 Z"
            fill="url(#ag-grad)" opacity="0.18" />
          {/* Stroked wave — animated phase */}
          <path d="M 0,55 Q 30,30 60,55 T 120,55 T 180,55 T 240,55"
            fill="none" stroke="url(#ag-grad)" strokeWidth="2.5" strokeLinecap="round"
            style={{ filter: 'drop-shadow(0 0 8px rgba(34,211,238,0.5))' }}
          />
          {/* Vertical equaliser bars */}
          {[20, 60, 100, 140, 180, 220].map((x, i) => (
            <rect key={x} x={x - 3} y={55 - 4 - i % 3 * 6} width="6" height={20 + i * 3}
              rx="2" fill="#67E8F9" opacity="0.85"
              style={{ animation: `eqBar 1.2s ease-in-out ${i * 0.1}s infinite alternate` }}
            />
          ))}
        </svg>

        <div className="absolute bottom-0 left-0 right-0 mt-4 flex items-center justify-between">
          <div className="text-[11px] text-slate-400">Auto-rendered audiograms</div>
          <span className="text-[10px] text-emerald-400 font-bold">PDF ready</span>
        </div>
      </div>

      <style>{`@keyframes eqBar { from { transform: scaleY(0.5); transform-origin: center; } to { transform: scaleY(1.4); transform-origin: center; } }`}</style>
    </div>
  );
}

// ---- Calendar (2-col, 2-row) ---------------------------------------------
function CalendarTile() {
  return (
    <div
      data-testid="ftile-calendar"
      className={`${TILE_BASE} col-span-3 sm:col-span-3 lg:col-span-2 row-span-2 bg-white border-slate-200 p-5 hover:shadow-xl flex flex-col`}
    >
      <div className="flex items-center gap-2.5">
        <div className="w-9 h-9 rounded-xl bg-amber-50 text-amber-600 flex items-center justify-center">
          <CalendarDays size={16} strokeWidth={2.4} />
        </div>
        <div>
          <h3 className="font-bold text-[15px] text-[#0F172A]">Smart Calendar</h3>
          <p className="text-[11px] text-slate-500">Drag · Reschedule · Conflict-free</p>
        </div>
      </div>

      {/* Mini month grid */}
      <div className="mt-4 grid grid-cols-7 gap-1 flex-1 content-start">
        {Array.from({ length: 28 }, (_, i) => {
          const isToday = i === 14;
          const hasAppt = [3, 7, 10, 12, 14, 17, 21, 24].includes(i);
          return (
            <div
              key={i}
              className={`aspect-square rounded text-[9px] font-bold flex items-center justify-center transition-colors ${
                isToday
                  ? 'bg-[#0B5FFF] text-white shadow-md shadow-[#0B5FFF]/40'
                  : hasAppt
                  ? 'bg-amber-50 text-amber-700 ring-1 ring-amber-200'
                  : 'text-slate-400 hover:bg-slate-100'
              }`}
            >
              {i + 1}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ---- Billing (2-col, 1-row) ----------------------------------------------
function BillingTile() {
  return (
    <div
      data-testid="ftile-billing"
      className={`${TILE_BASE} col-span-3 sm:col-span-3 lg:col-span-2 row-span-1 bg-gradient-to-br from-emerald-50 to-teal-50 border-emerald-200 p-5 hover:shadow-xl`}
    >
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-2.5">
          <div className="w-9 h-9 rounded-xl bg-emerald-500 text-white flex items-center justify-center shadow-md shadow-emerald-500/30">
            <Receipt size={16} strokeWidth={2.4} />
          </div>
          <div>
            <h3 className="font-bold text-[15px] text-[#0F172A]">GST Billing</h3>
            <p className="text-[11px] text-emerald-700">Invoices · Razorpay · UPI</p>
          </div>
        </div>
        <div className="text-right">
          <div className="text-[10px] uppercase font-bold text-emerald-700 tracking-wider">Today</div>
          <div className="text-[16px] font-extrabold text-[#0F172A] flex items-center justify-end gap-0.5"><IndianRupee size={13} strokeWidth={2.6} />48,200</div>
        </div>
      </div>
    </div>
  );
}

// ---- Reminders (2-col, 1-row) --------------------------------------------
function RemindersTile() {
  return (
    <div
      data-testid="ftile-reminders"
      className={`${TILE_BASE} col-span-3 sm:col-span-3 lg:col-span-2 row-span-1 bg-white border-slate-200 p-5 hover:shadow-xl`}
    >
      <div className="flex items-center gap-2.5">
        <div className="relative w-9 h-9 rounded-xl bg-rose-50 text-rose-600 flex items-center justify-center">
          <Bell size={16} strokeWidth={2.4} />
          <span className="absolute -top-0.5 -right-0.5 w-3 h-3 rounded-full bg-rose-500 ring-2 ring-white text-[7px] text-white font-bold flex items-center justify-center animate-pulse">3</span>
        </div>
        <div>
          <h3 className="font-bold text-[15px] text-[#0F172A]">Reminders</h3>
          <p className="text-[11px] text-slate-500">WhatsApp · SMS · Auto-recall</p>
        </div>
      </div>
      <div className="mt-3 inline-flex items-center gap-1 rounded-md bg-emerald-50 px-2 py-0.5 text-[10px] font-bold text-emerald-700 ring-1 ring-emerald-200">
        <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" /> 247 sent today
      </div>
    </div>
  );
}

// ---- Inventory (2-col, 1-row) --------------------------------------------
function InventoryTile() {
  return (
    <div
      data-testid="ftile-inventory"
      className={`${TILE_BASE} col-span-3 sm:col-span-3 lg:col-span-2 row-span-1 bg-white border-slate-200 p-5 hover:shadow-xl`}
    >
      <div className="flex items-center gap-2.5">
        <div className="w-9 h-9 rounded-xl bg-violet-50 text-violet-600 flex items-center justify-center">
          <Boxes size={16} strokeWidth={2.4} />
        </div>
        <div>
          <h3 className="font-bold text-[15px] text-[#0F172A]">Inventory</h3>
          <p className="text-[11px] text-slate-500">Hearing aids · Serial · Warranty</p>
        </div>
      </div>
      <div className="mt-3 flex gap-1.5">
        {['Phonak', 'Signia', 'ReSound', 'Widex'].map((b, i) => (
          <span key={b} className="text-[10px] font-bold px-2 py-0.5 rounded-md bg-violet-50 text-violet-700 ring-1 ring-violet-200" style={{ opacity: 0, animation: `popIn 0.4s ease-out ${0.1 + i * 0.08}s forwards` }}>{b}</span>
        ))}
      </div>
      <style>{`@keyframes popIn { from { opacity:0; transform: translateY(4px);} to { opacity: 1; transform: translateY(0);} }`}</style>
    </div>
  );
}

// ---- Multi-Branch (2-col, 1-row, dark) ------------------------------------
function MultiBranchTile() {
  return (
    <div
      data-testid="ftile-multibranch"
      className={`${TILE_BASE} col-span-3 sm:col-span-3 lg:col-span-2 row-span-1 bg-[#0F172A] text-white border-transparent p-5 hover:shadow-xl`}
    >
      <div className="flex items-center gap-2.5">
        <div className="w-9 h-9 rounded-xl bg-white/8 text-[#67E8F9] flex items-center justify-center ring-1 ring-white/10">
          <Building2 size={16} strokeWidth={2.4} />
        </div>
        <div>
          <h3 className="font-bold text-[15px]">Multi-Branch</h3>
          <p className="text-[11px] text-slate-400">One login · All locations</p>
        </div>
      </div>
      <div className="mt-3 flex items-center gap-1.5">
        {['MUM', 'BLR', 'DEL', '+5'].map((c, i) => (
          <span key={c} className={`text-[10px] font-bold px-2 py-0.5 rounded-md ${i === 3 ? 'bg-[#22D3EE]/20 text-[#67E8F9]' : 'bg-white/10 text-slate-300 ring-1 ring-white/10'}`}>{c}</span>
        ))}
      </div>
    </div>
  );
}

// ---- Reports (2-col, 1-row) -----------------------------------------------
function ReportsTile() {
  return (
    <div
      data-testid="ftile-reports"
      className={`${TILE_BASE} col-span-3 sm:col-span-3 lg:col-span-2 row-span-1 bg-gradient-to-br from-[#0B5FFF] to-[#22D3EE] text-white border-transparent p-5 hover:shadow-xl hover:shadow-[#0B5FFF]/40`}
    >
      <div className="flex items-center gap-2.5">
        <div className="w-9 h-9 rounded-xl bg-white/15 flex items-center justify-center ring-1 ring-white/20">
          <BarChart3 size={16} strokeWidth={2.4} />
        </div>
        <div>
          <h3 className="font-bold text-[15px]">Analytics</h3>
          <p className="text-[11px] text-white/80">Revenue · Conversion · Trends</p>
        </div>
      </div>
      <div className="mt-3 flex items-end gap-1 h-7">
        {[40, 55, 35, 70, 50, 80, 65].map((h, i) => (
          <div key={i} className="flex-1 rounded-t bg-white/40 group-hover:bg-white/70 transition-colors" style={{ height: `${h}%` }} />
        ))}
      </div>
    </div>
  );
}
