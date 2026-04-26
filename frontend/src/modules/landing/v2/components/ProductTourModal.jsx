/**
 * ProductTourModal — auto-advancing 60-second tour.
 * 6 slides × 10s = 60s. Each slide = caption + visual.
 * Auto-plays on open, with pause/play, prev/next, progress bar, ESC to close.
 */
import React, { useEffect, useRef, useState, useCallback } from 'react';
import { X, Play, Pause, ChevronLeft, ChevronRight, Lock, KeyRound, CalendarDays, Activity, Receipt, ShieldCheck } from 'lucide-react';

const SLIDE_MS = 10_000;

const SLIDES = [
  {
    icon: KeyRound,
    title: 'Sign in & unlock with your clinic key',
    body: 'Standard login + one-time clinic key entry. Data is decrypted only in your browser, only for this session.',
    accent: 'from-emerald-400 to-emerald-600',
    visual: SignInVisual,
  },
  {
    icon: CalendarDays,
    title: 'Manage appointments across branches',
    body: 'Drag-to-reschedule, multi-clinic toggle, queue tokens, and printable receipts — all in one calendar.',
    accent: 'from-[#0B5FFF] to-[#1A3FB8]',
    visual: AppointmentsVisual,
  },
  {
    icon: Activity,
    title: 'Run audiology tests in guided flows',
    body: 'PTA, speech, tymp, OAE — auto-saved drafts so the front desk never loses a test in progress.',
    accent: 'from-[#0B5FFF] to-[#00C2A8]',
    visual: AudiogramVisual,
  },
  {
    icon: Receipt,
    title: 'Bill, invoice, and collect with GST built in',
    body: 'Service catalogue, partial payments, branch-aware GSTIN, signed delivery challans for hearing aids.',
    accent: 'from-amber-400 to-rose-500',
    visual: BillingVisual,
  },
  {
    icon: ShieldCheck,
    title: 'Every record encrypted — even backups',
    body: 'Patient files, audiograms, invoices, daily snapshots — all sealed with your clinic-controlled key.',
    accent: 'from-[#0B5FFF] to-[#00C2A8]',
    visual: EncryptedBackupVisual,
  },
  {
    icon: Lock,
    title: 'Logout = data locked again, instantly',
    body: 'Session key destroyed, local cache cleared. The disk cipher becomes unreadable until your next sign-in.',
    accent: 'from-slate-700 to-slate-900',
    visual: LogoutLockVisual,
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
      className="fixed inset-0 z-[60] flex items-center justify-center p-3 sm:p-6 bg-slate-900/70 backdrop-blur-sm animate-fade-in"
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
            <SlideIcon size={12} /> Slide {idx + 1} / {SLIDES.length}
          </div>
        </div>

        {/* Caption */}
        <div className="px-6 sm:px-8 pt-6 pb-5">
          <h3 id="tour-title" className="font-[Manrope,Inter,sans-serif] font-extrabold text-[#0F172A] text-xl sm:text-2xl tracking-tight">
            {slide.title}
          </h3>
          <p className="mt-2 text-[14px] sm:text-[15px] text-[#475569] leading-relaxed">
            {slide.body}
          </p>
        </div>

        {/* Progress bar */}
        <div className="px-6 sm:px-8">
          <div className="flex gap-1.5">
            {SLIDES.map((_, i) => (
              <div key={i} className="flex-1 h-1 rounded-full bg-slate-200 overflow-hidden">
                <div
                  className={`h-full bg-gradient-to-r from-[#0B5FFF] to-[#00C2A8] transition-[width] ${
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
              {paused ? 'Paused' : 'Auto-playing'} · {Math.max(0, Math.ceil(((SLIDES.length - idx) * SLIDE_MS - (progress / 100) * SLIDE_MS) / 1000))}s left
            </span>
          </div>
          <button
            onClick={() => { onClose?.(); onBookDemo?.(); }}
            data-testid="tour-book-demo"
            className="bg-[#0B5FFF] hover:bg-[#094acf] text-white px-4 sm:px-5 py-2 rounded-lg font-semibold text-[13px] sm:text-[14px] shadow-sm transition"
          >
            Book Free Demo
          </button>
        </div>
      </div>
    </div>
  );
}

/* ---------- Inline SVG visuals (no external assets) ---------- */

function Frame({ children, className = '' }) {
  return (
    <div className={`relative w-full max-w-md mx-auto rounded-xl bg-white shadow-2xl shadow-black/20 border border-white/30 overflow-hidden ${className}`}>
      {children}
    </div>
  );
}

function SignInVisual() {
  return (
    <Frame className="max-w-[320px]">
      <div className="px-6 py-5">
        <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-[#0B5FFF] to-[#00C2A8] mx-auto flex items-center justify-center text-white">
          <KeyRound size={18} />
        </div>
        <div className="mt-3 text-center text-[13px] font-bold text-slate-900">Enter clinic key</div>
        <div className="mt-3 h-9 rounded-lg bg-slate-100" />
        <div className="mt-2 h-9 rounded-lg bg-slate-100 flex items-center px-3 text-[11px] text-slate-400 font-mono tracking-widest">••••••••••••</div>
        <div className="mt-3 h-9 rounded-lg bg-[#0B5FFF] flex items-center justify-center text-white text-[12px] font-bold">Unlock data</div>
        <div className="mt-2 text-center text-[10px] text-emerald-600 font-semibold">Decryption happens in your browser</div>
      </div>
    </Frame>
  );
}

function AppointmentsVisual() {
  return (
    <Frame className="max-w-[420px]">
      <div className="bg-slate-900 px-3 py-2 flex items-center gap-1.5">
        <span className="w-2.5 h-2.5 rounded-full bg-rose-400" />
        <span className="w-2.5 h-2.5 rounded-full bg-amber-300" />
        <span className="w-2.5 h-2.5 rounded-full bg-emerald-400" />
      </div>
      <div className="p-4">
        <div className="text-[12px] font-bold text-slate-900">May 2026 — Today</div>
        <div className="mt-3 grid grid-cols-7 gap-1 text-[10px] text-center">
          {Array.from({ length: 28 }).map((_, i) => (
            <div key={i} className={`h-7 rounded ${i === 14 ? 'bg-[#0B5FFF] text-white font-bold' : 'bg-slate-100 text-slate-500'} flex items-center justify-center`}>
              {i + 1}
            </div>
          ))}
        </div>
        <div className="mt-3 space-y-1.5">
          {[
            { t: '10:00', n: 'Ramesh K.', s: 'PTA' },
            { t: '10:30', n: 'Anita S.',   s: 'Fitting' },
            { t: '11:15', n: 'Vikram P.',  s: 'Follow-up' },
          ].map((x) => (
            <div key={x.t} className="flex items-center justify-between text-[11px] bg-slate-50 rounded px-2 py-1.5">
              <span className="font-bold text-[#0B5FFF]">{x.t}</span>
              <span className="text-slate-700 font-semibold">{x.n}</span>
              <span className="text-slate-400">{x.s}</span>
            </div>
          ))}
        </div>
      </div>
    </Frame>
  );
}

function AudiogramVisual() {
  return (
    <Frame className="max-w-[420px]">
      <div className="p-4">
        <div className="flex items-center justify-between">
          <div className="text-[12px] font-bold text-slate-900">Pure Tone Audiometry</div>
          <div className="text-[10px] text-emerald-600 font-bold">Auto-saved · 2s ago</div>
        </div>
        <svg viewBox="0 0 360 160" className="mt-2 w-full">
          {/* axes */}
          <line x1="36" y1="20" x2="36" y2="140" stroke="#CBD5E1" />
          <line x1="36" y1="140" x2="356" y2="140" stroke="#CBD5E1" />
          {/* horizontal lines */}
          {[0, 1, 2, 3, 4, 5].map((i) => (
            <line key={i} x1="36" y1={20 + i * 24} x2="356" y2={20 + i * 24} stroke="#E2E8F0" strokeDasharray="2 3" />
          ))}
          {/* right ear (red O) */}
          {[
            [60, 36], [110, 44], [160, 60], [210, 80], [260, 95], [310, 105],
          ].map(([x, y], i) => (
            <circle key={`r${i}`} cx={x} cy={y} r="5" stroke="#EF4444" strokeWidth="2" fill="none" />
          ))}
          {/* left ear (blue X) */}
          {[
            [60, 30], [110, 40], [160, 55], [210, 70], [260, 88], [310, 100],
          ].map(([x, y], i) => (
            <g key={`l${i}`} stroke="#2563EB" strokeWidth="2">
              <line x1={x - 4} y1={y - 4} x2={x + 4} y2={y + 4} />
              <line x1={x - 4} y1={y + 4} x2={x + 4} y2={y - 4} />
            </g>
          ))}
          {/* connecting lines */}
          <polyline points="60,36 110,44 160,60 210,80 260,95 310,105" stroke="#EF4444" strokeWidth="1.5" fill="none" />
          <polyline points="60,30 110,40 160,55 210,70 260,88 310,100" stroke="#2563EB" strokeWidth="1.5" fill="none" />
        </svg>
        <div className="mt-1 flex items-center gap-3 text-[10px] text-slate-500">
          <span className="inline-flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-rose-500" /> Right</span>
          <span className="inline-flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-blue-600" /> Left</span>
        </div>
      </div>
    </Frame>
  );
}

function BillingVisual() {
  return (
    <Frame className="max-w-[400px]">
      <div className="p-5">
        <div className="flex items-center justify-between">
          <div className="text-[12px] font-bold text-slate-900">Tax Invoice · INV-2641</div>
          <div className="text-[10px] text-slate-400">GSTIN: 27AAACR…2Z</div>
        </div>
        <div className="mt-3 space-y-1.5 text-[11px]">
          {[
            { d: 'Pure Tone Audiometry',    a: '₹1,200' },
            { d: 'Hearing Aid (Phonak P50)', a: '₹62,000' },
            { d: 'Custom Mould (pair)',      a: '₹3,500' },
          ].map((r) => (
            <div key={r.d} className="flex justify-between bg-slate-50 rounded px-2 py-1.5">
              <span className="text-slate-700">{r.d}</span>
              <span className="font-bold text-slate-900">{r.a}</span>
            </div>
          ))}
        </div>
        <div className="mt-3 pt-2 border-t border-slate-100 flex items-center justify-between text-[12px]">
          <span className="text-slate-500">GST 18%</span>
          <span className="font-bold text-slate-900">₹11,826</span>
        </div>
        <div className="mt-1 flex items-center justify-between">
          <span className="text-[12px] font-bold text-slate-900">Total</span>
          <span className="text-[16px] font-extrabold text-[#0B5FFF]">₹78,526</span>
        </div>
        <div className="mt-3 h-9 rounded-lg bg-emerald-500 flex items-center justify-center text-white text-[12px] font-bold">Mark paid</div>
      </div>
    </Frame>
  );
}

function EncryptedBackupVisual() {
  return (
    <Frame className="max-w-[400px]">
      <div className="p-5">
        <div className="flex items-center gap-2">
          <div className="w-9 h-9 rounded-lg bg-[#0B5FFF]/10 text-[#0B5FFF] flex items-center justify-center">
            <ShieldCheck size={18} />
          </div>
          <div>
            <div className="text-[12px] font-extrabold text-slate-900">Daily backup · Today 02:00</div>
            <div className="text-[10px] text-emerald-600 font-bold">Encrypted with your key</div>
          </div>
        </div>
        <div className="mt-3 space-y-1.5 text-[11px] font-mono">
          {[
            'patients_2026_04_26.enc',
            'audiograms_2026_04_26.enc',
            'invoices_2026_04_26.enc',
            'inventory_2026_04_26.enc',
          ].map((f) => (
            <div key={f} className="flex items-center gap-2 bg-slate-50 rounded px-2 py-1.5">
              <Lock size={12} className="text-[#0B5FFF]" />
              <span className="text-slate-700 truncate">{f}</span>
              <span className="ml-auto text-emerald-600 font-bold">OK</span>
            </div>
          ))}
        </div>
        <div className="mt-3 text-[10px] text-slate-500 text-center">
          Restore requires your clinic key — no shortcut, even for AUDINEXA.
        </div>
      </div>
    </Frame>
  );
}

function LogoutLockVisual() {
  return (
    <Frame className="max-w-[320px]">
      <div className="px-6 py-7 text-center">
        <div className="w-14 h-14 mx-auto rounded-2xl bg-slate-900 flex items-center justify-center text-white">
          <Lock size={24} />
        </div>
        <div className="mt-3 text-[14px] font-extrabold text-slate-900">Session locked</div>
        <div className="mt-1.5 text-[11px] text-slate-500 leading-relaxed">
          Local cache cleared. Disk cipher unreadable until next sign-in.
        </div>
        <div className="mt-4 h-9 rounded-lg bg-slate-900 flex items-center justify-center text-white text-[12px] font-bold">
          Sign in again
        </div>
      </div>
    </Frame>
  );
}
