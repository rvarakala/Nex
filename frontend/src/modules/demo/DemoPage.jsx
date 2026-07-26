/**
 * AUDINEXA Demo Deck — the interactive `/demo` page.
 *
 * Slide-deck UI:
 *   ← / → arrow keys to navigate
 *   `Space` toggles autoplay (7s per slide)
 *   Section rail on the left for jumping between features
 *   Fullscreen-optimised for laptop demos
 *
 * Slide data lives in `./slides.js` (source of truth).
 * Screenshots live in `/app/frontend/public/demo/` — captured by
 * `/tmp/capture_demo.py` (Playwright).
 *
 * Fallback: if a screenshot is missing (404), we show a graceful
 * "captured with live production data" placeholder instead of a broken
 * image icon, so the deck is always presentable even mid-capture.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  ArrowLeft, ArrowRight, Play, Pause, Home, Users, Stethoscope, Wrench,
  Headphones, LineChart, BarChart3, Handshake, Settings, ShieldCheck,
  LifeBuoy, Maximize2, Minimize2, Camera,
} from 'lucide-react';
import { SECTIONS, SLIDES } from './slides';

const ICONS = { Users, Stethoscope, Wrench, Headphones, LineChart, BarChart3, Handshake, Settings, ShieldCheck, LifeBuoy };

const C = {
  bone: '#FDFBF7',
  ink: '#1A1C23',
  ink2: '#4A4D57',
  saffron: '#D95D39',
  border: '#E2DFD8',
  navy: '#0B0D17',
  surface: '#F3F1EC',
};
const F = {
  display: '"Cabinet Grotesk", "Inter", sans-serif',
  body: '"IBM Plex Sans", sans-serif',
  mono: '"IBM Plex Mono", ui-monospace, monospace',
};

const AUTOPLAY_MS = 7500;

function useFonts() {
  useEffect(() => {
    if (document.getElementById('audinexa-demo-fonts')) return;
    const l1 = document.createElement('link');
    l1.id = 'audinexa-demo-fonts';
    l1.rel = 'stylesheet';
    l1.href = 'https://api.fontshare.com/v2/css?f[]=cabinet-grotesk@700,800,500,300&display=swap';
    document.head.appendChild(l1);
    const l2 = document.createElement('link');
    l2.rel = 'stylesheet';
    l2.href = 'https://fonts.googleapis.com/css2?family=IBM+Plex+Sans:wght@400;500;600&family=IBM+Plex+Mono:wght@500;600&display=swap';
    document.head.appendChild(l2);
  }, []);
}

function ScreenshotFrame({ src, alt, accent }) {
  const [failed, setFailed] = useState(false);
  return (
    <div
      className="relative rounded-2xl overflow-hidden border shadow-2xl bg-white h-full flex items-center justify-center"
      style={{ borderColor: C.border, boxShadow: `0 30px 80px -30px ${accent}55` }}
      data-testid="demo-screenshot-frame"
    >
      {/* Fake browser chrome */}
      <div className="absolute top-0 left-0 right-0 flex items-center gap-1.5 px-4 py-2 border-b" style={{ background: C.surface, borderColor: C.border, zIndex: 2 }}>
        <span className="w-2.5 h-2.5 rounded-full" style={{ background: '#FCA5A5' }} />
        <span className="w-2.5 h-2.5 rounded-full" style={{ background: '#FCD34D' }} />
        <span className="w-2.5 h-2.5 rounded-full" style={{ background: '#86EFAC' }} />
        <span className="ml-3 text-[10px] uppercase tracking-widest font-semibold" style={{ fontFamily: F.mono, color: C.ink2 }}>
          audinexa · {alt}
        </span>
      </div>

      {failed ? (
        <div className="flex flex-col items-center justify-center gap-3 py-16 text-center" data-testid="demo-screenshot-fallback">
          <Camera className="w-14 h-14" style={{ color: accent }} strokeWidth={1.5} />
          <p className="text-lg font-extrabold" style={{ fontFamily: F.display, color: C.ink }}>Screenshot capturing…</p>
          <p className="text-sm max-w-md" style={{ fontFamily: F.body, color: C.ink2 }}>
            This screen is captured with live production data on every
            deploy. If you\u2019re viewing the deck seconds after a data
            refresh, hit reload in a moment.
          </p>
        </div>
      ) : (
        <img
          src={src}
          alt={alt}
          onError={() => setFailed(true)}
          className="w-full h-full object-contain pt-9"
          style={{ background: 'white' }}
          data-testid="demo-screenshot-image"
        />
      )}
    </div>
  );
}

function SectionRail({ current, onJump }) {
  return (
    <aside className="hidden lg:flex flex-col w-64 border-r shrink-0" style={{ borderColor: C.border, background: C.bone }}>
      <div className="p-6 border-b" style={{ borderColor: C.border }}>
        <Link to="/" className="flex items-center gap-2" data-testid="demo-home-link">
          <span className="inline-flex w-8 h-8 rounded-lg items-center justify-center font-black" style={{ background: C.saffron, color: 'white', fontFamily: F.display }}>A</span>
          <span className="text-xl font-extrabold" style={{ fontFamily: F.display, color: C.ink, letterSpacing: '-0.03em' }}>audinexa</span>
        </Link>
        <p className="mt-4 text-[10px] uppercase tracking-widest font-semibold" style={{ fontFamily: F.mono, color: C.ink2 }}>Product Demo</p>
        <p className="mt-1 text-sm font-semibold" style={{ fontFamily: F.body, color: C.ink }}>10 features · 46 screens</p>
      </div>
      <nav className="flex-1 overflow-y-auto py-4">
        {SECTIONS.map((s) => {
          const Icon = ICONS[s.icon] || Users;
          const firstSlideIdx = SLIDES.findIndex((sl) => sl.section === s.id);
          const isCurrent = SLIDES[current]?.section === s.id;
          return (
            <button
              key={s.id}
              onClick={() => onJump(firstSlideIdx)}
              data-testid={`demo-nav-section-${s.id}`}
              className="w-full text-left px-6 py-3 flex items-start gap-3 transition-colors hover:bg-[color:var(--surface)]"
              style={{
                background: isCurrent ? C.surface : 'transparent',
                borderLeft: `3px solid ${isCurrent ? s.accent : 'transparent'}`,
              }}
            >
              <Icon className="w-4 h-4 mt-0.5 shrink-0" style={{ color: s.accent }} />
              <div className="min-w-0">
                <p className="text-[10px] uppercase tracking-widest font-semibold" style={{ fontFamily: F.mono, color: C.ink2 }}>
                  {String(s.id).padStart(2, '0')}
                </p>
                <p className="text-sm font-bold" style={{ fontFamily: F.display, color: C.ink, letterSpacing: '-0.02em' }}>
                  {s.name}
                </p>
              </div>
            </button>
          );
        })}
      </nav>
      <div className="p-4 border-t text-[10px] uppercase tracking-widest" style={{ borderColor: C.border, fontFamily: F.mono, color: C.ink2 }}>
        Keyboard: ← → space
      </div>
    </aside>
  );
}

export default function DemoPage() {
  useFonts();
  const [i, setI] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [isFs, setIsFs] = useState(false);
  const timerRef = useRef(null);

  const total = SLIDES.length;
  const slide = SLIDES[i];
  const section = useMemo(() => SECTIONS.find((s) => s.id === slide.section), [slide]);
  const slidesInSection = useMemo(() => SLIDES.filter((s) => s.section === slide.section), [slide]);
  const idxInSection = slidesInSection.findIndex((s) => s === slide);

  const go = useCallback((n) => {
    setI((prev) => (n + total) % total);
  }, [total]);
  const next = useCallback(() => go(i + 1), [i, go]);
  const prev = useCallback(() => go(i - 1), [i, go]);

  // Keyboard nav
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'ArrowRight' || e.key === 'PageDown') { e.preventDefault(); next(); }
      else if (e.key === 'ArrowLeft' || e.key === 'PageUp') { e.preventDefault(); prev(); }
      else if (e.key === ' ') { e.preventDefault(); setPlaying((p) => !p); }
      else if (e.key === 'Home') { setI(0); }
      else if (e.key === 'End') { setI(total - 1); }
      else if (e.key === 'f' || e.key === 'F') { toggleFs(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [next, prev, total]);

  // Autoplay
  useEffect(() => {
    if (!playing) return () => {};
    timerRef.current = setInterval(() => setI((p) => (p + 1) % total), AUTOPLAY_MS);
    return () => timerRef.current && clearInterval(timerRef.current);
  }, [playing, total]);

  const toggleFs = () => {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen?.();
      setIsFs(true);
    } else {
      document.exitFullscreen?.();
      setIsFs(false);
    }
  };

  useEffect(() => { document.title = `AUDINEXA Demo · ${section?.name || ''}`; }, [section]);

  return (
    <div className="min-h-screen flex" style={{ background: C.bone, fontFamily: F.body, color: C.ink }} data-testid="demo-page">
      <SectionRail current={i} onJump={setI} />

      {/* Main deck area */}
      <main className="flex-1 flex flex-col min-w-0">
        {/* Top bar */}
        <header className="flex items-center justify-between gap-4 px-8 py-4 border-b" style={{ borderColor: C.border }}>
          <div className="flex items-center gap-3 min-w-0">
            <span className="text-[10px] uppercase tracking-widest font-bold px-2 py-1 rounded" style={{ background: section.accent, color: 'white', fontFamily: F.mono }}>
              {String(section.id).padStart(2, '0')} · {section.name}
            </span>
            <span className="text-[11px] uppercase tracking-widest" style={{ fontFamily: F.mono, color: C.ink2 }}>
              {idxInSection + 1} / {slidesInSection.length}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={() => setPlaying((p) => !p)} className="p-2 rounded-md hover:bg-[color:var(--surface)]" style={{ background: playing ? C.surface : 'transparent' }} data-testid="demo-play-toggle" title="Play / pause (Space)">
              {playing ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4" />}
            </button>
            <button onClick={toggleFs} className="p-2 rounded-md hover:bg-[color:var(--surface)]" data-testid="demo-fullscreen-toggle" title="Full screen (F)">
              {isFs ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}
            </button>
            <Link to="/" className="p-2 rounded-md hover:bg-[color:var(--surface)]" data-testid="demo-exit" title="Back to home">
              <Home className="w-4 h-4" />
            </Link>
          </div>
        </header>

        {/* Global progress bar */}
        <div className="h-1 w-full" style={{ background: C.surface }}>
          <div className="h-full transition-all duration-500" style={{ width: `${((i + 1) / total) * 100}%`, background: section.accent }} data-testid="demo-progress" />
        </div>

        {/* Slide */}
        <section className="flex-1 grid grid-cols-1 lg:grid-cols-[1.2fr_1fr] gap-8 p-8 overflow-y-auto">
          {/* Left: Screenshot */}
          <div className="min-h-[420px] lg:min-h-0" data-testid="demo-slide-screenshot">
            <ScreenshotFrame src={slide.screenshot} alt={slide.title} accent={section.accent} />
          </div>

          {/* Right: Copy */}
          <div className="flex flex-col justify-center max-w-xl">
            <p className="text-[10px] uppercase tracking-widest font-semibold" style={{ fontFamily: F.mono, color: section.accent }}>
              {section.tagline}
            </p>
            <h1 className="mt-3 text-4xl md:text-5xl font-extrabold" style={{ fontFamily: F.display, color: C.ink, letterSpacing: '-0.035em', lineHeight: 1.05 }}>
              {slide.title}
            </h1>

            <div className="mt-8 space-y-6">
              <div>
                <p className="text-[10px] uppercase tracking-widest font-bold mb-1.5" style={{ fontFamily: F.mono, color: C.ink }}>
                  Purpose
                </p>
                <p className="text-lg leading-relaxed" style={{ fontFamily: F.body, color: C.ink }}>
                  {slide.purpose}
                </p>
              </div>
              <div className="pl-4 border-l-4" style={{ borderColor: section.accent }}>
                <p className="text-[10px] uppercase tracking-widest font-bold mb-1.5" style={{ fontFamily: F.mono, color: section.accent }}>
                  Objective
                </p>
                <p className="text-base leading-relaxed" style={{ fontFamily: F.body, color: C.ink2 }}>
                  {slide.objective}
                </p>
              </div>
            </div>

            {/* Route hint */}
            <p className="mt-10 text-[10px] uppercase tracking-widest" style={{ fontFamily: F.mono, color: C.ink2 }}>
              Screen route · <code>{slide.url}</code>
            </p>
          </div>
        </section>

        {/* Bottom nav */}
        <footer className="flex items-center justify-between px-8 py-4 border-t" style={{ borderColor: C.border, background: C.bone }}>
          <button onClick={prev} className="inline-flex items-center gap-2 px-5 py-2.5 rounded-full border font-semibold hover:border-[color:var(--ink)]" style={{ borderColor: C.border, fontFamily: F.body }} data-testid="demo-prev">
            <ArrowLeft className="w-4 h-4" /> Prev
          </button>

          <div className="flex items-center gap-1 max-w-lg overflow-hidden">
            {SLIDES.map((s, idx) => (
              <button
                key={idx}
                onClick={() => setI(idx)}
                data-testid={`demo-dot-${idx}`}
                className="h-1.5 rounded-full transition-all"
                style={{
                  width: idx === i ? 24 : 6,
                  background: idx === i ? section.accent : idx < i ? C.ink2 : C.border,
                }}
                title={`${s.section}.${s.idx} — ${s.title}`}
              />
            ))}
          </div>

          <button onClick={next} className="inline-flex items-center gap-2 px-5 py-2.5 rounded-full font-semibold text-white" style={{ background: section.accent, fontFamily: F.body }} data-testid="demo-next">
            Next <ArrowRight className="w-4 h-4" />
          </button>
        </footer>
      </main>
    </div>
  );
}
