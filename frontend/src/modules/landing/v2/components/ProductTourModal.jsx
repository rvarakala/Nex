/**
 * ProductTourModal — auto-advancing 12-slide tour following the exact
 * audiology workflow the user requested:
 *   1. Login
 *   2. Create patient
 *   3. Appointment
 *   4. Testing (Audiogram + Tympanogram)
 *   5. Hearing aid trial
 *   6. Quotation
 *   7. Fitting
 *   8. Patient clinic visit timeline
 *   9. Settings — assign RBAC
 *  10. Import existing data
 *  11. Analytics
 *  12. Data security
 */
import React, { useEffect, useRef, useState, useCallback } from 'react';
import {
  X, Play, Pause, ChevronLeft, ChevronRight,
  KeyRound, UserPlus, CalendarDays, Activity, Headphones, FileSignature,
  Wrench, History, ShieldCheck, Upload, BarChart3, Lock, Waves,
} from 'lucide-react';

const SLIDE_MS = 8_500; // ~1m 42s for 12 slides

const SLIDES = [
  {
    icon: KeyRound,
    title: '1. Sign in to your clinic workspace',
    body: 'Owner, audiologist, front desk and accounts each get their own login. Brute-force protection + 2FA on owner accounts.',
    accent: 'from-slate-700 to-slate-900',
    visual: LoginVisual,
  },
  {
    icon: UserPlus,
    title: '2. Create the patient — once.',
    body: 'MRD, mobile, age, area, referrer. AUDINEXA dedupes by mobile + name. From here every test, bill, fitting and follow-up is auto-linked.',
    accent: 'from-[#0F52BA] to-[#1E3A8A]',
    visual: CreatePatientVisual,
  },
  {
    icon: CalendarDays,
    title: '3. Book the appointment',
    body: 'Multi-test chips (PTA, Impedance, OAE…) auto-sum the duration. Clinic + per-audiologist working hours respected. SMS / WhatsApp confirmation to the patient.',
    accent: 'from-[#0F52BA] to-[#0EA5E9]',
    visual: AppointmentVisual,
  },
  {
    icon: Activity,
    title: '4. Run testing — audiogram + tympanogram inside the app',
    body: 'Plot the audiogram and tymp directly in AUDINEXA. No paper, no second screen, no re-typing. Auto-saves to the patient record every few seconds.',
    accent: 'from-[#0F52BA] to-[#06B6D4]',
    visual: TestingVisual,
  },
  {
    icon: Headphones,
    title: '5. Issue a hearing-aid trial',
    body: 'Pick the aid from inventory, mark side (L / R / both), capture the trial period & deposit. Loaner serial flips to "On trial" automatically.',
    accent: 'from-[#0F52BA] to-[#10B981]',
    visual: TrialVisual,
  },
  {
    icon: FileSignature,
    title: '6. Generate the quotation',
    body: 'Pre-filled with patient + recommended aid + accessories. Bilateral pair handled in one click. Share as PDF / WhatsApp.',
    accent: 'from-[#0F52BA] to-[#22C55E]',
    visual: QuoteVisual,
  },
  {
    icon: Wrench,
    title: '7. Fitting → Sale → GST invoice',
    body: 'Convert quote → sale → invoice in one step. Inventory auto-decrements, AMC starts, GST split happens automatically.',
    accent: 'from-emerald-500 to-emerald-700',
    visual: FittingVisual,
  },
  {
    icon: History,
    title: '8. The patient\'s clinic-visit timeline',
    body: 'Every visit, test, fitting, invoice, follow-up — in chronological order on one screen. Exportable as a single PDF for the patient or a referring doctor.',
    accent: 'from-indigo-500 to-violet-700',
    visual: TimelineVisual,
  },
  {
    icon: ShieldCheck,
    title: '9. Settings → assign roles (RBAC)',
    body: 'Owner sets exactly what front desk, audiologists, technicians and accounts can see and do. Branch-restricted users only see their own branch.',
    accent: 'from-slate-700 to-slate-900',
    visual: RbacVisual,
  },
  {
    icon: Upload,
    title: '10. Bring your existing data with you',
    body: 'Import patients, past visits, billing history from your old Excel / CSV / Tally. We dedupe, validate, and keep your existing MRD numbers.',
    accent: 'from-amber-400 to-orange-600',
    visual: ImportVisual,
  },
  {
    icon: BarChart3,
    title: '11. Analytics that actually answer questions',
    body: 'Daily revenue, fittings vs trials, top referrers, AMC renewals due, inactive patients — KPIs you can act on this morning.',
    accent: 'from-[#0F52BA] to-[#0EA5E9]',
    visual: AnalyticsVisual,
  },
  {
    icon: Lock,
    title: '12. Your data — secure, private, yours',
    body: 'AES-256 encryption at rest, daily encrypted backups, India-resident servers, DPDPA-aligned audit logs. Your data is never sold or shared.',
    accent: 'from-emerald-500 to-emerald-700',
    visual: SecurityVisual,
  },
];

export default function ProductTourModal({ open, onClose, onBookDemo }) {
  const [idx, setIdx] = useState(0);
  const [paused, setPaused] = useState(false);
  const [progress, setProgress] = useState(0);
  const tickRef = useRef(null);
  const startedAtRef = useRef(0);
  const elapsedRef = useRef(0);

  const goTo = useCallback((next) => {
    setIdx((curr) => {
      const n = SLIDES.length;
      const v = ((next ?? curr + 1) % n + n) % n;
      return v;
    });
    elapsedRef.current = 0;
    setProgress(0);
    startedAtRef.current = performance.now();
  }, []);

  // Auto-advance ticker
  useEffect(() => {
    if (!open || paused) return undefined;
    startedAtRef.current = performance.now() - elapsedRef.current;
    tickRef.current = window.setInterval(() => {
      const elapsed = performance.now() - startedAtRef.current;
      elapsedRef.current = elapsed;
      const pct = Math.min(100, (elapsed / SLIDE_MS) * 100);
      setProgress(pct);
      if (elapsed >= SLIDE_MS) {
        elapsedRef.current = 0;
        setProgress(0);
        setIdx((c) => (c + 1) % SLIDES.length);
        startedAtRef.current = performance.now();
      }
    }, 80);
    return () => window.clearInterval(tickRef.current);
  }, [open, paused, idx]);

  // Reset on open/close
  useEffect(() => {
    if (open) {
      setIdx(0);
      setProgress(0);
      setPaused(false);
      elapsedRef.current = 0;
    }
  }, [open]);

  // ESC + arrow keys
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => {
      if (e.key === 'Escape') onClose?.();
      if (e.key === 'ArrowRight') goTo(idx + 1);
      if (e.key === 'ArrowLeft') goTo(idx - 1);
      if (e.key === ' ') { e.preventDefault(); setPaused((p) => !p); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, idx, onClose, goTo]);

  if (!open) return null;
  const slide = SLIDES[idx];
  const Visual = slide.visual;
  const SlideIcon = slide.icon;

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center p-3 sm:p-6 bg-slate-900/70 backdrop-blur-sm animate-fade-up"
      role="dialog"
      aria-modal="true"
      aria-labelledby="tour-title"
      data-testid="product-tour-modal"
      onClick={(e) => { if (e.target === e.currentTarget) onClose?.(); }}
    >
      <div className="relative w-full max-w-3xl bg-white rounded-2xl shadow-2xl overflow-hidden">
        {/* Close */}
        <button
          onClick={onClose}
          aria-label="Close tour"
          data-testid="tour-close"
          className="absolute right-3 top-3 z-10 w-9 h-9 rounded-full bg-white/90 hover:bg-white text-slate-600 hover:text-slate-900 border border-slate-200 flex items-center justify-center shadow-sm"
        >
          <X size={18} />
        </button>

        {/* Visual stage */}
        <div className={`relative h-[260px] sm:h-[300px] bg-gradient-to-br ${slide.accent} overflow-hidden`}>
          <div aria-hidden className="absolute inset-0 opacity-20 [background-image:radial-gradient(rgba(255,255,255,0.4)_1px,transparent_1px)] [background-size:18px_18px]" />
          <div className="absolute inset-0 flex items-center justify-center px-8">
            <Visual />
          </div>
          {/* Slide pill */}
          <div className="absolute top-4 left-4 inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-white/15 border border-white/25 text-white text-[11px] font-bold uppercase tracking-wider backdrop-blur-sm">
            <SlideIcon size={12} /> Step {idx + 1} / {SLIDES.length}
          </div>
        </div>

        {/* Caption */}
        <div className="px-6 sm:px-8 pt-6 pb-5">
          <h3 id="tour-title" className="font-display tracking-supertight font-bold text-slate-900 text-xl sm:text-2xl">
            {slide.title}
          </h3>
          <p className="mt-2 font-body text-[14px] sm:text-[15px] text-slate-600 leading-relaxed">
            {slide.body}
          </p>
        </div>

        {/* Progress bar */}
        <div className="px-6 sm:px-8">
          <div className="flex gap-1">
            {SLIDES.map((_, i) => (
              <div key={i} className="flex-1 h-1 rounded-full bg-slate-200 overflow-hidden">
                <div
                  className={`h-full bg-[#0F52BA] transition-[width] ${
                    i === idx ? '' : i < idx ? 'w-full' : 'w-0'
                  }`}
                  style={i === idx ? { width: `${progress}%` } : undefined}
                />
              </div>
            ))}
          </div>
        </div>

        {/* Controls */}
        <div className="px-6 sm:px-8 py-4 flex items-center justify-between gap-3 border-t border-slate-100 mt-4">
          <div className="flex items-center gap-1.5">
            <button
              onClick={() => goTo(idx - 1)}
              data-testid="tour-prev"
              className="w-9 h-9 rounded-lg border border-slate-200 hover:border-slate-300 hover:bg-slate-50 flex items-center justify-center text-slate-600"
              aria-label="Previous slide"
            >
              <ChevronLeft size={16} />
            </button>
            <button
              onClick={() => setPaused((p) => !p)}
              data-testid="tour-toggle-play"
              className="w-9 h-9 rounded-lg border border-slate-200 hover:border-slate-300 hover:bg-slate-50 flex items-center justify-center text-slate-600"
              aria-label={paused ? 'Play tour' : 'Pause tour'}
            >
              {paused ? <Play size={15} /> : <Pause size={15} />}
            </button>
            <button
              onClick={() => goTo(idx + 1)}
              data-testid="tour-next"
              className="w-9 h-9 rounded-lg border border-slate-200 hover:border-slate-300 hover:bg-slate-50 flex items-center justify-center text-slate-600"
              aria-label="Next slide"
            >
              <ChevronRight size={16} />
            </button>
            <span className="ml-2 text-[12px] text-slate-500 hidden sm:inline">
              {paused ? 'Paused' : 'Auto-playing'} · Step {idx + 1} of {SLIDES.length}
            </span>
          </div>
          <button
            onClick={() => { onClose?.(); onBookDemo?.(); }}
            data-testid="tour-join-waitlist"
            className="bg-[#0F52BA] hover:bg-[#0C4399] text-white px-4 sm:px-5 py-2 rounded-lg font-semibold text-[13px] sm:text-[14px] shadow-sm transition"
          >
            Join the beta waitlist
          </button>
        </div>
      </div>
    </div>
  );
}

/* ====== Inline SVG visuals (no external assets) ====== */

function Frame({ children, className = '' }) {
  return (
    <div className={`relative w-full max-w-md mx-auto rounded-xl bg-white shadow-2xl shadow-black/20 border border-white/30 overflow-hidden ${className}`}>
      {children}
    </div>
  );
}

function LoginVisual() {
  return (
    <Frame className="max-w-[320px]">
      <div className="px-6 py-5">
        <div className="w-10 h-10 rounded-xl bg-[#0F52BA] mx-auto flex items-center justify-center text-white">
          <KeyRound size={18} />
        </div>
        <div className="mt-3 text-center text-[13px] font-bold text-slate-900">Sign in to AUDINEXA</div>
        <div className="mt-3 h-9 rounded-lg bg-slate-100 flex items-center px-3 text-[11px] text-slate-500">owner@yourclinic.in</div>
        <div className="mt-2 h-9 rounded-lg bg-slate-100 flex items-center px-3 text-[11px] text-slate-400 font-mono tracking-widest">••••••••</div>
        <div className="mt-3 h-9 rounded-lg bg-[#0F52BA] flex items-center justify-center text-white text-[12px] font-bold">Continue</div>
        <div className="mt-2 text-center text-[10px] text-emerald-600 font-semibold">Brute-force protected · 2FA on owner</div>
      </div>
    </Frame>
  );
}

function CreatePatientVisual() {
  return (
    <Frame className="max-w-[420px]">
      <div className="p-4">
        <div className="text-[12px] font-bold text-slate-900">New patient</div>
        <div className="grid grid-cols-2 gap-2 mt-3">
          <div className="h-8 rounded bg-slate-100 px-2 flex items-center text-[10.5px] text-slate-500">Ramesh K.</div>
          <div className="h-8 rounded bg-slate-100 px-2 flex items-center text-[10.5px] text-slate-500">+91 98765 43210</div>
          <div className="h-8 rounded bg-slate-100 px-2 flex items-center text-[10.5px] text-slate-500">58 yrs · M</div>
          <div className="h-8 rounded bg-slate-100 px-2 flex items-center text-[10.5px] text-slate-500">Andheri W.</div>
        </div>
        <div className="mt-3 text-[10px] text-slate-400">MRD generated → <span className="font-mono text-[#0F52BA] font-bold">ACS-2026-002641</span></div>
        <div className="mt-3 h-8 rounded bg-[#0F52BA] flex items-center justify-center text-white text-[11px] font-bold">Save patient</div>
        <div className="mt-2 text-[10px] text-emerald-600 font-semibold text-center">Auto-deduped on mobile + name</div>
      </div>
    </Frame>
  );
}

function AppointmentVisual() {
  return (
    <Frame className="max-w-[420px]">
      <div className="p-4">
        <div className="text-[12px] font-bold text-slate-900">Book appointment · Today 11:15</div>
        <div className="mt-2 text-[10.5px] text-slate-500">Ramesh K. · MRD-2641</div>
        <div className="mt-3 flex flex-wrap gap-1.5">
          {[
            ['PTA', '₹1,250', true],
            ['Impedance', '₹500', true],
            ['OAE', '₹800', false],
            ['Speech', '₹600', false],
          ].map(([t, p, on]) => (
            <span
              key={t}
              className={`text-[10px] px-2 py-1 rounded-full border font-semibold ${
                on ? 'bg-[#0F52BA] text-white border-[#0F52BA]' : 'bg-white text-slate-600 border-slate-200'
              }`}
            >
              {t} · {p}
            </span>
          ))}
        </div>
        <div className="mt-3 grid grid-cols-2 gap-2 text-[10.5px]">
          <div className="bg-slate-50 rounded px-2 py-1.5 text-slate-600">Duration: <b className="text-slate-900">45 min</b></div>
          <div className="bg-slate-50 rounded px-2 py-1.5 text-slate-600">Audiologist: <b className="text-slate-900">Dr. P</b></div>
        </div>
        <div className="mt-3 h-8 rounded bg-emerald-500 flex items-center justify-center text-white text-[11px] font-bold">Confirm + send WhatsApp</div>
      </div>
    </Frame>
  );
}

function TestingVisual() {
  return (
    <Frame className="max-w-[440px]">
      <div className="p-3">
        <div className="flex items-center justify-between">
          <div className="text-[11px] font-bold text-slate-900 inline-flex items-center gap-1.5"><Activity size={12} className="text-[#0F52BA]" /> PTA + Tymp · live plot</div>
          <div className="text-[9.5px] text-emerald-600 font-bold">Auto-saved</div>
        </div>
        <div className="grid grid-cols-2 gap-2 mt-2">
          {/* Audiogram mini */}
          <svg viewBox="0 0 200 110" className="w-full bg-slate-50 rounded">
            <line x1="20" y1="10" x2="20" y2="100" stroke="#CBD5E1" />
            <line x1="20" y1="100" x2="195" y2="100" stroke="#CBD5E1" />
            {[0, 1, 2, 3].map((i) => (
              <line key={i} x1="20" y1={25 + i * 22} x2="195" y2={25 + i * 22} stroke="#E2E8F0" strokeDasharray="2 3" />
            ))}
            <polyline points="40,30 80,40 120,55 160,72 188,82" stroke="#2563EB" strokeWidth="1.5" fill="none" />
            <polyline points="40,38 80,48 120,65 160,82 188,90" stroke="#EF4444" strokeWidth="1.5" fill="none" />
            {[[40,30],[80,40],[120,55],[160,72],[188,82]].map(([x,y],i)=>(
              <g key={i} stroke="#2563EB" strokeWidth="1.5"><line x1={x-3} y1={y-3} x2={x+3} y2={y+3}/><line x1={x-3} y1={y+3} x2={x+3} y2={y-3}/></g>
            ))}
            {[[40,38],[80,48],[120,65],[160,82],[188,90]].map(([x,y],i)=>(
              <circle key={i} cx={x} cy={y} r="3" stroke="#EF4444" strokeWidth="1.5" fill="white" />
            ))}
          </svg>
          {/* Tympanogram mini */}
          <svg viewBox="0 0 200 110" className="w-full bg-slate-50 rounded">
            <line x1="20" y1="10" x2="20" y2="100" stroke="#CBD5E1" />
            <line x1="20" y1="100" x2="195" y2="100" stroke="#CBD5E1" />
            <path d="M 25 98 Q 70 98, 95 95 T 110 22 T 130 95 Q 165 98, 195 98" stroke="#0F52BA" strokeWidth="2" fill="none" />
            <path d="M 25 98 Q 70 98, 95 95 T 110 22 T 130 95 Q 165 98, 195 98 L 195 100 L 25 100 Z" fill="rgba(15,82,186,0.12)" />
            <circle cx="110" cy="22" r="3" stroke="#0F52BA" strokeWidth="1.5" fill="white" />
            <text x="115" y="20" fontSize="7" fill="#0F52BA" fontWeight="700">Type A</text>
          </svg>
        </div>
        <div className="mt-2 flex items-center justify-between text-[9.5px] text-slate-500">
          <span className="inline-flex items-center gap-1"><Waves size={10} className="text-[#0F52BA]" /> Plotted in AUDINEXA · no paper</span>
          <span className="font-bold text-emerald-600">→ saved to MRD-2641</span>
        </div>
      </div>
    </Frame>
  );
}

function TrialVisual() {
  return (
    <Frame className="max-w-[400px]">
      <div className="p-4">
        <div className="text-[12px] font-bold text-slate-900">HA trial · Phonak Audeo P50</div>
        <div className="mt-3 grid grid-cols-2 gap-2 text-[10.5px]">
          <div className="bg-slate-50 rounded px-2 py-1.5">Side: <b className="text-slate-900">Both</b></div>
          <div className="bg-slate-50 rounded px-2 py-1.5">Period: <b className="text-slate-900">7 days</b></div>
          <div className="bg-slate-50 rounded px-2 py-1.5">Serial L: <b className="font-mono text-[#0F52BA]">PHN-L-220419</b></div>
          <div className="bg-slate-50 rounded px-2 py-1.5">Serial R: <b className="font-mono text-[#0F52BA]">PHN-R-220420</b></div>
          <div className="bg-slate-50 rounded px-2 py-1.5">Deposit: <b className="text-slate-900">₹5,000</b></div>
          <div className="bg-emerald-50 rounded px-2 py-1.5 text-emerald-700">Status: <b>On trial</b></div>
        </div>
        <div className="mt-3 h-8 rounded bg-[#0F52BA] flex items-center justify-center text-white text-[11px] font-bold">Issue trial + print receipt</div>
      </div>
    </Frame>
  );
}

function QuoteVisual() {
  return (
    <Frame className="max-w-[400px]">
      <div className="p-4">
        <div className="flex items-center justify-between">
          <div className="text-[12px] font-bold text-slate-900">Quotation · QTE-2026-0041</div>
          <div className="text-[10px] text-emerald-600 font-bold">Bilateral pair</div>
        </div>
        <div className="mt-2 space-y-1.5 text-[11px]">
          {[
            ['Phonak Audeo P50 · Left',  '₹62,000'],
            ['Phonak Audeo P50 · Right', '₹62,000'],
            ['Custom mould (pair)',      '₹3,500'],
          ].map(([d, a]) => (
            <div key={d} className="flex justify-between bg-slate-50 rounded px-2 py-1.5">
              <span className="text-slate-700">{d}</span>
              <span className="font-bold text-slate-900">{a}</span>
            </div>
          ))}
        </div>
        <div className="mt-2 flex items-center justify-between text-[12px]">
          <span className="text-slate-500">Total + GST 18%</span>
          <span className="font-bold text-[#0F52BA]">₹1,51,510</span>
        </div>
        <div className="mt-3 h-8 rounded bg-emerald-500 flex items-center justify-center text-white text-[11px] font-bold">Send via WhatsApp / PDF</div>
      </div>
    </Frame>
  );
}

function FittingVisual() {
  return (
    <Frame className="max-w-[400px]">
      <div className="p-4">
        <div className="text-[12px] font-bold text-slate-900">Fitting → Sale → Invoice</div>
        <div className="mt-3 space-y-1.5 text-[10.5px]">
          {[
            ['Quote QTE-0041',   'Accepted',   '#0F52BA'],
            ['Sale SAL-2026-12', 'Created',    '#10B981'],
            ['Invoice INV-241',  'Generated',  '#10B981'],
            ['AMC starts',       '2-yr cover', '#0F52BA'],
            ['Inventory',        '-2 units',   '#E11D48'],
          ].map(([k, v, c]) => (
            <div key={k} className="flex items-center justify-between bg-slate-50 rounded px-2 py-1.5">
              <span className="text-slate-700">{k}</span>
              <span className="font-bold" style={{ color: c }}>{v}</span>
            </div>
          ))}
        </div>
        <div className="mt-3 h-8 rounded bg-[#0F52BA] flex items-center justify-center text-white text-[11px] font-bold">Print + share GST invoice</div>
      </div>
    </Frame>
  );
}

function TimelineVisual() {
  return (
    <Frame className="max-w-[420px]">
      <div className="p-4">
        <div className="text-[12px] font-bold text-slate-900">Ramesh K. · clinic visits</div>
        <ol className="mt-3 relative ml-2 border-l-2 border-slate-200 space-y-2.5">
          {[
            ['12 Jan',  'PTA + tymp',          '#0F52BA'],
            ['19 Jan',  'HA trial issued',     '#10B981'],
            ['26 Jan',  'Quotation accepted',  '#0F52BA'],
            ['02 Feb',  'Fitting + invoice',   '#10B981'],
            ['16 Feb',  'Follow-up call',      '#94A3B8'],
          ].map(([d, t, c], i) => (
            <li key={i} className="pl-4 relative">
              <span
                className="absolute -left-[7px] top-1 w-3 h-3 rounded-full border-2 border-white"
                style={{ background: c }}
              />
              <div className="text-[10.5px] text-slate-500">{d}</div>
              <div className="text-[12px] text-slate-900 font-semibold">{t}</div>
            </li>
          ))}
        </ol>
      </div>
    </Frame>
  );
}

function RbacVisual() {
  return (
    <Frame className="max-w-[420px]">
      <div className="p-4">
        <div className="text-[12px] font-bold text-slate-900">Settings → Roles & Access</div>
        <table className="w-full mt-3 text-[10.5px]">
          <thead>
            <tr className="text-slate-500">
              <th className="text-left font-semibold pb-1.5">Role</th>
              <th className="text-center font-semibold pb-1.5">Patients</th>
              <th className="text-center font-semibold pb-1.5">Billing</th>
              <th className="text-center font-semibold pb-1.5">HA Inv.</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {[
              ['Owner',        true,  true,  true],
              ['Audiologist',  true,  false, false],
              ['Front desk',   true,  true,  false],
              ['Accounts',     false, true,  false],
            ].map(([r, ...perms]) => (
              <tr key={r}>
                <td className="py-1.5 font-bold text-slate-700">{r}</td>
                {perms.map((p, i) => (
                  <td key={i} className="text-center py-1.5">
                    {p ? (
                      <span className="inline-block w-2 h-2 rounded-full bg-emerald-500" />
                    ) : (
                      <span className="inline-block w-3 h-px bg-slate-300" />
                    )}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
        <div className="mt-3 text-[10px] text-slate-500 text-center">
          Branch-restricted users see only their branch.
        </div>
      </div>
    </Frame>
  );
}

function ImportVisual() {
  return (
    <Frame className="max-w-[400px]">
      <div className="p-4">
        <div className="text-[12px] font-bold text-slate-900">Import existing data</div>
        <div className="mt-3 grid grid-cols-3 gap-2">
          {['Excel', 'CSV', 'Tally'].map((s) => (
            <div key={s} className="bg-slate-50 rounded px-2 py-2.5 text-center">
              <div className="text-[10px] font-bold text-[#0F52BA]">{s}</div>
              <div className="text-[9px] text-slate-500 mt-0.5">supported</div>
            </div>
          ))}
        </div>
        <div className="mt-3 space-y-1 text-[10.5px]">
          {[
            ['Patients',     '1,284 rows', 'New + follow-ups merged'],
            ['Past visits',  '3,961 rows', 'Linked to existing MRDs'],
            ['Invoices',     '952 rows',   'GST split preserved'],
          ].map(([k, c, n]) => (
            <div key={k} className="flex items-center justify-between bg-emerald-50 rounded px-2 py-1.5">
              <span className="text-slate-700"><b>{k}</b> · {c}</span>
              <span className="text-emerald-700 font-semibold">{n}</span>
            </div>
          ))}
        </div>
        <div className="mt-2 text-[10px] text-slate-500 text-center">Your existing MRD numbers preserved.</div>
      </div>
    </Frame>
  );
}

function AnalyticsVisual() {
  return (
    <Frame className="max-w-[420px]">
      <div className="p-4">
        <div className="text-[12px] font-bold text-slate-900">Analytics · this month</div>
        <div className="mt-3 grid grid-cols-3 gap-2 text-center">
          {[
            ['₹6.8L', 'Revenue',    '#0F52BA'],
            ['142',   'Fittings',   '#10B981'],
            ['38',    'AMC due',    '#F59E0B'],
          ].map(([v, l, c]) => (
            <div key={l} className="bg-slate-50 rounded px-2 py-2.5">
              <div className="font-display font-extrabold text-base" style={{ color: c }}>{v}</div>
              <div className="text-[9.5px] text-slate-500">{l}</div>
            </div>
          ))}
        </div>
        <svg viewBox="0 0 320 60" className="mt-3 w-full">
          <polyline points="0,45 30,40 60,42 90,30 120,32 150,22 180,28 210,18 240,22 270,12 300,18 320,10"
            stroke="#0F52BA" strokeWidth="2" fill="none" />
          <polyline points="0,45 30,40 60,42 90,30 120,32 150,22 180,28 210,18 240,22 270,12 300,18 320,10 320,60 0,60"
            fill="rgba(15,82,186,0.12)" stroke="none" />
        </svg>
        <div className="mt-2 text-[10px] text-slate-500">Top referrer: <b className="text-slate-900">Dr. Rao (ENT)</b> · 24 patients</div>
      </div>
    </Frame>
  );
}

function SecurityVisual() {
  return (
    <Frame className="max-w-[400px]">
      <div className="p-5">
        <div className="flex items-center gap-2">
          <div className="w-9 h-9 rounded-lg bg-emerald-500/15 text-emerald-600 flex items-center justify-center">
            <ShieldCheck size={18} />
          </div>
          <div>
            <div className="text-[12px] font-extrabold text-slate-900">Your data · secured</div>
            <div className="text-[10px] text-emerald-600 font-bold">DPDPA-aligned · India-resident</div>
          </div>
        </div>
        <div className="mt-3 space-y-1.5 text-[11px]">
          {[
            ['AES-256 encryption at rest',     'ON'],
            ['Daily encrypted backups',         'ON'],
            ['Tamper-proof audit log',          'ON'],
            ['Role-based access control',       'ON'],
            ['Multi-factor on owner accounts',  'ON'],
          ].map(([k, v]) => (
            <div key={k} className="flex items-center justify-between bg-slate-50 rounded px-2 py-1.5">
              <span className="text-slate-700">{k}</span>
              <span className="text-emerald-600 font-bold">{v}</span>
            </div>
          ))}
        </div>
        <div className="mt-3 text-[10px] text-slate-500 text-center">
          Your patient data is never sold, shared, or used for ads.
        </div>
      </div>
    </Frame>
  );
}
