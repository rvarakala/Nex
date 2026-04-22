import React, { useEffect, useState } from 'react';
import axios from 'axios';

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;

const fmtINR = (n) => `₹${Number(n || 0).toLocaleString('en-IN')}`;

export default function LandingPage() {
  const [tiers, setTiers] = useState([]);
  const [email, setEmail] = useState('');
  const [clinicName, setClinicName] = useState('');
  const [city, setCity] = useState('');
  const [tierInterest, setTierInterest] = useState('PREMIUM');
  const [submitted, setSubmitted] = useState(false);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    axios.get(`${API}/subscription/tiers`).then(r => setTiers(r.data.tiers || []))
      .catch(() => {});
  }, []);

  const submit = async (e) => {
    e.preventDefault();
    setErr(''); setBusy(true);
    try {
      await axios.post(`${API}/public/waitlist-signup`, {
        email, clinic_name: clinicName, city, tier_interest: tierInterest,
      });
      setSubmitted(true);
    } catch (e) {
      setErr(e?.response?.data?.detail || 'Signup failed. Try again?');
    } finally { setBusy(false); }
  };

  return (
    <div className="min-h-screen bg-slate-950 text-white font-sans" data-testid="landing-page">
      {/* Top nav */}
      <header className="max-w-6xl mx-auto px-6 py-5 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 bg-gradient-to-br from-orange-500 to-rose-600 rounded flex items-center justify-center font-black text-sm">A</div>
          <div className="text-xl font-black tracking-tight">AUDINEXA</div>
        </div>
        <div className="flex items-center gap-5 text-sm">
          <a href="#pricing" className="text-slate-400 hover:text-white">Pricing</a>
          <a href="#waitlist" className="text-slate-400 hover:text-white">Waitlist</a>
          <a href="/login" data-testid="landing-login-cta"
             className="px-4 py-1.5 border border-slate-700 hover:border-white rounded text-slate-200">
            Sign in
          </a>
        </div>
      </header>

      {/* HERO */}
      <section className="max-w-6xl mx-auto px-6 pt-16 pb-24">
        <div className="inline-block mb-6 px-3 py-1 text-[11px] font-bold tracking-wider uppercase bg-orange-500/10 text-orange-400 border border-orange-500/30 rounded-full">
          Launching Q2 2026 · Join the waitlist
        </div>
        <h1 className="text-5xl sm:text-6xl lg:text-7xl font-black tracking-tight leading-[1.05] mb-6">
          The Operating System <br />
          for Modern Audiology Clinics.
        </h1>
        <p className="text-xl text-slate-400 max-w-2xl leading-relaxed mb-10">
          AUDINEXA is the operating system for modern audiology clinics in India.
          Registration to repair closure, tracked in one place.
          <span className="text-white font-semibold"> Multi-branch, multi-role, GST-ready.</span>
        </p>
        <div className="flex items-center gap-4">
          <a href="#waitlist" data-testid="landing-hero-cta"
             className="px-6 py-3 bg-white text-slate-950 font-bold rounded hover:bg-orange-100 transition">
            Join the waitlist →
          </a>
          <div className="text-sm text-slate-500">
            30-day free Premium trial at launch · No card required
          </div>
        </div>
      </section>

      {/* What it covers */}
      <section className="max-w-6xl mx-auto px-6 pb-24">
        <div className="grid md:grid-cols-3 gap-5">
          {[
            { t: 'Patient Journey', d: 'Registration · tokens · audiometry · PDF reports · WhatsApp follow-ups. Zero sticky notes.' },
            { t: 'Hearing Aid Commerce', d: 'Quotations · serialised inventory · GST invoices · trade-ins · EMI subscriptions. Fully traceable.' },
            { t: 'Service & Repair', d: 'Courier dispatch · loaner allocation · vendor estimates · customer approvals · auto-close on handover.' },
          ].map(x => (
            <div key={x.t} className="bg-slate-900 border border-slate-800 rounded-lg p-6">
              <div className="text-[10px] uppercase tracking-widest text-orange-400 mb-2 font-semibold">Module</div>
              <div className="text-lg font-bold mb-2">{x.t}</div>
              <p className="text-sm text-slate-400 leading-relaxed">{x.d}</p>
            </div>
          ))}
        </div>
      </section>

      {/* PRICING */}
      <section id="pricing" className="max-w-6xl mx-auto px-6 pb-24 scroll-mt-20">
        <div className="mb-10">
          <div className="text-[11px] uppercase tracking-widest text-orange-400 font-bold mb-1">Pricing</div>
          <h2 className="text-4xl sm:text-5xl font-black mb-3">Pick your clinic size.</h2>
          <p className="text-slate-400 text-lg">Annual gives you up to 18% off quarterly. Upgrade or downgrade anytime.</p>
        </div>

        <div className="grid md:grid-cols-3 gap-5">
          {tiers.length === 0 && <div className="col-span-3 h-64 bg-slate-900 animate-pulse rounded-lg" />}
          {tiers.map((t, i) => {
            const featured = t.code === 'PREMIUM';
            const mods = {
              frontdesk: 'Front Desk · Patient registration',
              diagnostics: 'Audiometry · PDF reports · Appointments',
              'hearing-aids': 'Hearing Aid commerce · Inventory · Trials · Trade-ins',
              repair: 'Service & Repair · Loaners · Courier · Estimates',
              analytics: 'Owner Analytics · Multi-branch · CSV export',
            };
            return (
              <div key={t.code} data-testid={`pricing-tier-${t.code}`}
                   className={`rounded-lg p-6 border ${featured ? 'border-orange-500/60 bg-gradient-to-br from-orange-500/10 to-rose-500/5' : 'border-slate-800 bg-slate-900'}`}>
                {featured && <div className="text-[10px] uppercase tracking-widest text-orange-400 font-bold mb-2">Most Popular</div>}
                <div className="text-sm font-bold text-slate-400 uppercase tracking-wider">{t.name}</div>
                <div className="mt-4 mb-1">
                  <span className="text-5xl font-black">{fmtINR(t.prices.annual)}</span>
                  <span className="text-slate-500 text-sm"> /year</span>
                </div>
                <div className="text-xs text-slate-500 mb-5">
                  or {fmtINR(t.prices.quarterly)}/quarter · {fmtINR(t.prices.half_yearly)}/6mo
                </div>
                <ul className="space-y-2 text-sm text-slate-300 mb-6">
                  {t.modules.map(m => (
                    <li key={m} className="flex items-start gap-2">
                      <span className="text-orange-400 mt-0.5">✓</span>
                      <span>{mods[m] || m}</span>
                    </li>
                  ))}
                  {i < tiers.length - 1 && (
                    <>
                      {(() => {
                        const nextMods = tiers[i + 1]?.modules || [];
                        const missing = nextMods.filter(m => !t.modules.includes(m));
                        return missing.map(m => (
                          <li key={`m-${m}`} className="flex items-start gap-2 text-slate-600 line-through">
                            <span className="mt-0.5">—</span>
                            <span>{mods[m] || m}</span>
                          </li>
                        ));
                      })()}
                    </>
                  )}
                </ul>
                <a href="#waitlist"
                   data-testid={`pricing-${t.code}-cta`}
                   className={`block text-center py-2.5 rounded font-bold text-sm ${featured ? 'bg-white text-slate-950 hover:bg-orange-100' : 'border border-slate-700 hover:border-white'}`}>
                  Join waitlist
                </a>
              </div>
            );
          })}
        </div>

        <div className="text-center text-xs text-slate-500 mt-6">
          All clinics get a <b className="text-white">30-day Premium trial</b> at launch. Cancel any time — no contracts.
        </div>
      </section>

      {/* WAITLIST */}
      <section id="waitlist" className="max-w-2xl mx-auto px-6 pb-24 scroll-mt-20">
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-8">
          <h2 className="text-3xl font-black mb-2">Join the waitlist</h2>
          <p className="text-slate-400 mb-6 text-sm">
            We'll email you when AUDINEXA opens to your clinic + a 30-day free Premium trial.
          </p>
          {submitted ? (
            <div className="bg-emerald-500/10 border border-emerald-500/40 text-emerald-300 rounded p-5 text-center" data-testid="waitlist-success">
              <div className="text-3xl mb-2">✓</div>
              <div className="font-bold mb-1">You're on the list.</div>
              <div className="text-sm">We'll email <b>{email}</b> when we launch.</div>
            </div>
          ) : (
            <form onSubmit={submit} className="space-y-3" data-testid="waitlist-form">
              <input type="email" required value={email}
                     onChange={(e) => setEmail(e.target.value)}
                     placeholder="Work email"
                     data-testid="waitlist-email"
                     className="w-full bg-slate-800 border border-slate-700 rounded px-4 py-3 text-sm focus:border-orange-500 outline-none" />
              <div className="grid grid-cols-2 gap-3">
                <input value={clinicName}
                       onChange={(e) => setClinicName(e.target.value)}
                       placeholder="Clinic name"
                       data-testid="waitlist-clinic"
                       className="bg-slate-800 border border-slate-700 rounded px-4 py-3 text-sm focus:border-orange-500 outline-none" />
                <input value={city}
                       onChange={(e) => setCity(e.target.value)}
                       placeholder="City"
                       data-testid="waitlist-city"
                       className="bg-slate-800 border border-slate-700 rounded px-4 py-3 text-sm focus:border-orange-500 outline-none" />
              </div>
              <select value={tierInterest} onChange={(e) => setTierInterest(e.target.value)}
                      data-testid="waitlist-tier"
                      className="w-full bg-slate-800 border border-slate-700 rounded px-4 py-3 text-sm focus:border-orange-500 outline-none">
                <option value="">Plan you're interested in (optional)</option>
                <option value="BASIC">Basic — Front desk + diagnostics</option>
                <option value="STANDARD">Standard — + Hearing aid commerce</option>
                <option value="PREMIUM">Premium — Full suite (everything)</option>
              </select>
              {err && <div className="bg-rose-500/10 text-rose-300 text-xs p-2 rounded">{err}</div>}
              <button type="submit" disabled={busy}
                      data-testid="waitlist-submit"
                      className="w-full bg-white text-slate-950 font-bold py-3 rounded hover:bg-orange-100 disabled:bg-slate-700 disabled:text-slate-500 transition">
                {busy ? 'Submitting…' : 'Join the waitlist →'}
              </button>
              <div className="text-[10px] text-center text-slate-500 pt-1">
                We'll never spam you. Unsubscribe with one click.
              </div>
            </form>
          )}
        </div>
      </section>

      {/* FOOTER */}
      <footer className="border-t border-slate-900 py-8 text-center text-xs text-slate-600">
        © {new Date().getFullYear()} AUDINEXA · Built for audiologists.
        <span className="mx-2">·</span>
        <a href="/login" className="hover:text-slate-400">Staff sign in</a>
      </footer>
    </div>
  );
}
