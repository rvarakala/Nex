import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { Menu, X } from 'lucide-react';

const NAV_LINKS = [
  { href: '#features',  label: 'Features' },
  { href: '#how',       label: 'How it works' },
  { href: '#pricing',   label: 'Pricing' },
  { href: '#security',  label: 'Security' },
  { href: '#faq',       label: 'FAQ' },
];

export default function Navbar({ onBookDemo }) {
  const [scrolled, setScrolled] = useState(false);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 12);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  return (
    <header
      data-testid="landing-navbar"
      className={`fixed top-0 inset-x-0 z-50 transition-[background,backdrop-filter,border-color] duration-300 ${
        scrolled
          ? 'bg-white/80 backdrop-blur-xl border-b border-slate-200/60 shadow-[0_1px_0_rgba(15,82,186,0.04)]'
          : 'bg-transparent border-b border-transparent'
      }`}
    >
      <div className="max-w-7xl mx-auto px-6 md:px-12 h-16 flex items-center justify-between">
        {/* Logo */}
        <Link to="/" data-testid="nav-logo" className="flex items-center gap-2 group">
          <span className="relative inline-flex items-center justify-center h-8 w-8 rounded-lg bg-[#0F52BA] text-white font-display font-bold text-sm tracking-tight ring-1 ring-[#0F52BA]/30">
            A
            <span className="absolute -right-0.5 -bottom-0.5 h-2 w-2 rounded-full bg-emerald-400 ring-2 ring-white" />
          </span>
          <span className="font-display font-bold tracking-supertight text-slate-900 text-lg">
            AUDINEXA
          </span>
        </Link>

        {/* Desktop nav */}
        <nav className="hidden lg:flex items-center gap-9 text-[14px] font-body font-medium text-slate-600">
          {NAV_LINKS.map((l) => (
            <a
              key={l.href}
              href={l.href}
              data-testid={`nav-${l.label.toLowerCase().replace(' ', '-')}`}
              className="relative hover:text-slate-900 transition-colors py-2"
            >
              {l.label}
              <span className="absolute inset-x-0 -bottom-px h-px bg-[#0F52BA] scale-x-0 origin-left transition-transform duration-300 group-hover:scale-x-100 hover:scale-x-100" />
            </a>
          ))}
        </nav>

        {/* Right cluster */}
        <div className="flex items-center gap-2 sm:gap-3">
          <Link
            to="/login"
            data-testid="nav-login"
            className="hidden sm:inline-flex items-center px-3.5 py-2 text-sm font-semibold text-slate-700 hover:text-slate-900 transition-colors"
          >
            Sign in
          </Link>
          <button
            onClick={onBookDemo}
            data-testid="nav-book-demo"
            className="hidden sm:inline-flex items-center px-4 py-2 text-sm font-semibold text-white bg-[#0F52BA] rounded-lg hover:bg-[#0C4399] active:scale-[0.98] transition shadow-[0_8px_20px_-8px_rgba(15,82,186,0.6)]"
          >
            Book demo
            <span className="ml-1.5 opacity-80">→</span>
          </button>
          <button
            onClick={() => setOpen((v) => !v)}
            data-testid="nav-mobile-toggle"
            aria-label="Toggle menu"
            className="lg:hidden p-2 rounded-lg text-slate-700 hover:bg-slate-100"
          >
            {open ? <X size={20} /> : <Menu size={20} />}
          </button>
        </div>
      </div>

      {/* Mobile drawer */}
      {open && (
        <div className="lg:hidden bg-white/95 backdrop-blur-xl border-t border-slate-200" data-testid="nav-mobile-drawer">
          <div className="px-6 py-4 flex flex-col gap-1">
            {NAV_LINKS.map((l) => (
              <a
                key={l.href}
                href={l.href}
                onClick={() => setOpen(false)}
                className="font-body text-slate-700 px-3 py-3 rounded-lg hover:bg-slate-100"
              >
                {l.label}
              </a>
            ))}
            <Link
              to="/login"
              data-testid="nav-mobile-login"
              className="font-body text-slate-700 px-3 py-3 rounded-lg hover:bg-slate-100 border-t border-slate-100 mt-1 pt-3"
            >
              Sign in
            </Link>
            <button
              onClick={() => { setOpen(false); onBookDemo(); }}
              data-testid="nav-mobile-book-demo"
              className="mt-2 px-4 py-3 text-sm font-semibold text-white bg-[#0F52BA] rounded-lg"
            >
              Book demo →
            </button>
          </div>
        </div>
      )}
    </header>
  );
}
