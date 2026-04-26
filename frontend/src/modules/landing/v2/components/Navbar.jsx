/**
 * Sticky landing-page navbar with glassmorphism.
 * Smooth-scrolls to anchor sections; CTA opens the demo modal.
 * Auth-aware: shows "Open Dashboard" if a token is present in localStorage.
 */
import React, { useEffect, useState } from 'react';
import { Shield, Menu, X } from 'lucide-react';

const links = [
  { label: 'Security',  href: '#security' },
  { label: 'Features',  href: '#features' },
  { label: 'Pricing',   href: '#pricing' },
  { label: 'FAQ',       href: '#faq' },
];

export default function Navbar({ onBookDemo }) {
  const [scrolled, setScrolled] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const isAuthed = typeof window !== 'undefined' && !!localStorage.getItem('acs.token');

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 12);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  const handleAnchor = (href) => (e) => {
    e.preventDefault();
    document.querySelector(href)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    setMobileOpen(false);
  };

  return (
    <header
      data-testid="landing-navbar"
      className={`fixed inset-x-0 top-0 z-50 transition-all duration-300 ${
        scrolled
          ? 'bg-white/85 backdrop-blur-xl border-b border-slate-100 shadow-sm'
          : 'bg-transparent'
      }`}
    >
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
        <a href="#top" onClick={handleAnchor('#top')} className="flex items-center gap-2 group">
          <span className="w-9 h-9 rounded-xl bg-gradient-to-br from-[#0B5FFF] to-[#00C2A8] flex items-center justify-center shadow-md shadow-[#0B5FFF]/30 group-hover:scale-105 transition">
            <Shield size={18} className="text-white" strokeWidth={2.5} />
          </span>
          <span className="font-[Manrope,Inter,sans-serif] font-extrabold text-lg tracking-tight text-[#111827]">AUDINEXA</span>
        </a>

        <nav className="hidden md:flex items-center gap-1" aria-label="Primary">
          {links.map((l) => (
            <a
              key={l.href}
              href={l.href}
              onClick={handleAnchor(l.href)}
              className="px-3.5 py-2 text-sm text-[#475569] hover:text-[#0B5FFF] font-medium rounded-md transition-colors"
            >
              {l.label}
            </a>
          ))}
        </nav>

        <div className="hidden md:flex items-center gap-2">
          {isAuthed ? (
            <a href="/dashboard" className="text-sm text-[#475569] hover:text-[#0B5FFF] font-medium px-3 py-2">Open Dashboard</a>
          ) : (
            <a href="/login" className="text-sm text-[#475569] hover:text-[#0B5FFF] font-medium px-3 py-2" data-testid="navbar-login">Sign in</a>
          )}
          <button
            onClick={onBookDemo}
            data-testid="navbar-book-demo"
            className="bg-[#0B5FFF] hover:bg-[#094acf] text-white px-5 py-2.5 rounded-xl font-medium text-sm shadow-md shadow-[#0B5FFF]/25 hover:shadow-lg hover:shadow-[#0B5FFF]/30 transition-all"
          >
            Book Free Demo
          </button>
        </div>

        <button
          className="md:hidden p-2 text-[#111827]"
          onClick={() => setMobileOpen((v) => !v)}
          aria-label="Toggle menu"
          aria-expanded={mobileOpen}
        >
          {mobileOpen ? <X size={22} /> : <Menu size={22} />}
        </button>
      </div>

      {mobileOpen && (
        <div className="md:hidden bg-white border-t border-slate-100 shadow-lg">
          <nav className="px-4 py-3 flex flex-col gap-1">
            {links.map((l) => (
              <a
                key={l.href}
                href={l.href}
                onClick={handleAnchor(l.href)}
                className="px-3 py-2 text-[#475569] hover:bg-slate-50 rounded-md text-sm font-medium"
              >
                {l.label}
              </a>
            ))}
            {isAuthed ? (
              <a href="/dashboard" className="px-3 py-2 text-[#475569] hover:bg-slate-50 rounded-md text-sm font-medium">Open Dashboard</a>
            ) : (
              <a href="/login" className="px-3 py-2 text-[#475569] hover:bg-slate-50 rounded-md text-sm font-medium">Sign in</a>
            )}
          </nav>
        </div>
      )}
    </header>
  );
}
