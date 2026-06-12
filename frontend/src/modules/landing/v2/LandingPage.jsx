/**
 * AUDINEXA Landing Page v2 — security-first, conversion-focused.
 *
 * Composition-only: all sections live in ./components/* so each piece
 * can be edited without touching the others.
 *
 * Renders top-to-bottom: BetaRibbon, Navbar, Hero, Trust, Pain, Security,
 * Features, HowItWorks, FAQ, FinalCTA, Footer + Waitlist modal & sticky
 * mobile CTA.
 *
 * 2026-06-03 — Pricing section removed (beta cohort full, pricing is
 * per-clinic during the sales call). BetaRibbon mounted at the top so
 * every visitor sees the "queue is open" cue instantly. All "Book a
 * demo" CTAs renamed to "Join the waitlist".
 */
import React, { useState, useCallback } from 'react';
import BetaRibbon from './components/BetaRibbon';
import Navbar from './components/Navbar';
import Hero from './components/Hero';
import NumbersStrip from './components/NumbersStrip';
import ComplianceBadges from './components/ComplianceBadges';
import PainPoints from './components/PainPoints';
import SecurityShowcase from './components/SecurityShowcase';
import Features from './components/Features';
import HowItWorks from './components/HowItWorks';
import Testimonials from './components/Testimonials';
import FAQ from './components/FAQ';
import FinalCTA from './components/FinalCTA';
import Footer from './components/Footer';
import DemoModal from './components/DemoModal';
import ProductTourModal from './components/ProductTourModal';

export default function LandingPage() {
  const [demoOpen, setDemoOpen] = useState(false);
  const [demoTier, setDemoTier] = useState(null);
  const [tourOpen, setTourOpen] = useState(false);
  const openDemo = useCallback((tier = null) => { setDemoTier(tier); setDemoOpen(true); }, []);
  const closeDemo = useCallback(() => setDemoOpen(false), []);
  const openTour = useCallback(() => setTourOpen(true), []);
  const closeTour = useCallback(() => setTourOpen(false), []);

  return (
    <div className="bg-white text-[#111827] font-[Inter,system-ui,sans-serif] antialiased selection:bg-[#0F52BA] selection:text-white" data-testid="landing-page">
      {/* Beta-cohort-full banner — fixed at the very top, above the navbar. */}
      <BetaRibbon onJoinWaitlist={() => openDemo()} />
      <Navbar onBookDemo={() => openDemo()} ribbonOffset />
      <main className="pt-9">
        <Hero onBookDemo={() => openDemo()} onWatchTour={openTour} />
        <NumbersStrip />
        <ComplianceBadges />
        <PainPoints />
        <HowItWorks />
        <Features onBookDemo={() => openDemo()} />
        <Testimonials />
        <SecurityShowcase />
        <FAQ />
        <FinalCTA onBookDemo={() => openDemo()} />
      </main>
      <Footer />

      {/* Mobile-only sticky CTA */}
      <div className="fixed bottom-3 inset-x-3 z-40 md:hidden" data-testid="landing-mobile-cta">
        <button
          onClick={() => openDemo()}
          data-testid="landing-mobile-join-waitlist"
          className="w-full bg-[#0F52BA] hover:bg-[#0C4399] text-white py-3.5 rounded-xl font-semibold shadow-2xl shadow-[#0F52BA]/40 active:scale-[0.98] transition"
        >
          Join the waitlist
        </button>
      </div>

      <DemoModal open={demoOpen} onClose={closeDemo} initialTier={demoTier} />
      <ProductTourModal open={tourOpen} onClose={closeTour} onBookDemo={() => openDemo()} />
    </div>
  );
}
