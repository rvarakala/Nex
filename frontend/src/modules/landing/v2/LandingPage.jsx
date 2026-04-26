/**
 * AUDINEXA Landing Page v2 — security-first, conversion-focused.
 *
 * Composition-only: all sections live in ./components/* so each piece
 * can be edited without touching the others.
 *
 * Renders top-to-bottom: Navbar, Hero, Trust, Pain, Security, Features,
 * HowItWorks, Pricing, FAQ, FinalCTA, Footer + Demo modal & sticky mobile CTA.
 */
import React, { useState, useCallback } from 'react';
import Navbar from './components/Navbar';
import Hero from './components/Hero';
import TrustSection from './components/TrustSection';
import PainPoints from './components/PainPoints';
import SecurityShowcase from './components/SecurityShowcase';
import Features from './components/Features';
import HowItWorks from './components/HowItWorks';
import Pricing from './components/Pricing';
import FAQ from './components/FAQ';
import FinalCTA from './components/FinalCTA';
import Footer from './components/Footer';
import DemoModal from './components/DemoModal';

export default function LandingPage() {
  const [demoOpen, setDemoOpen] = useState(false);
  const [demoTier, setDemoTier] = useState(null);
  const openDemo = useCallback((tier = null) => { setDemoTier(tier); setDemoOpen(true); }, []);
  const closeDemo = useCallback(() => setDemoOpen(false), []);

  return (
    <div className="bg-white text-[#111827] font-[Inter,system-ui,sans-serif] antialiased selection:bg-[#0B5FFF] selection:text-white" data-testid="landing-page">
      <Navbar onBookDemo={() => openDemo()} />
      <main>
        <Hero onBookDemo={() => openDemo()} />
        <TrustSection />
        <PainPoints />
        <SecurityShowcase />
        <Features />
        <HowItWorks />
        <Pricing onBookDemo={openDemo} />
        <FAQ />
        <FinalCTA onBookDemo={() => openDemo()} />
      </main>
      <Footer />

      {/* Mobile-only sticky CTA — only visible on small screens, hides on scroll-up */}
      <div className="fixed bottom-3 inset-x-3 z-40 md:hidden" data-testid="landing-mobile-cta">
        <button
          onClick={() => openDemo()}
          className="w-full bg-[#0B5FFF] hover:bg-[#094acf] text-white py-3.5 rounded-xl font-semibold shadow-2xl shadow-[#0B5FFF]/40 active:scale-[0.98] transition"
        >
          Book Free Demo
        </button>
      </div>

      <DemoModal open={demoOpen} onClose={closeDemo} initialTier={demoTier} />
    </div>
  );
}
