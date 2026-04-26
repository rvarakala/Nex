import React from 'react';
import { LogIn, KeyRound, Unlock, LogOut } from 'lucide-react';
import SectionHeading from './SectionHeading';

const STEPS = [
  { num: '01', icon: LogIn,    title: 'User logs in',                      body: 'Standard email + password authentication. Multi-factor optional.' },
  { num: '02', icon: KeyRound, title: 'Authorized clinic enters secret key', body: 'Your master key is derived in the browser — never sent to our servers in plaintext.' },
  { num: '03', icon: Unlock,   title: 'Data unlocks for this session only',  body: 'Patient records, audiograms, billing — decrypted client-side, in memory.' },
  { num: '04', icon: LogOut,   title: 'Logout = data locked again',          body: 'The session key is destroyed. Local cache is cleared. Disk cipher becomes unreadable.' },
];

export default function HowItWorks() {
  return (
    <section id="how-it-works" className="relative py-24 md:py-32 overflow-hidden" data-testid="landing-how">
      <div aria-hidden className="absolute inset-0 -z-10 bg-gradient-to-b from-[#F8FAFC] via-white to-white" />
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <SectionHeading
          kicker="How It Works"
          title="How clinic-controlled security works"
          subtitle="Four steps. No security degree required. Built so the front desk just signs in and gets to work."
        />

        <div className="mt-16 grid md:grid-cols-2 lg:grid-cols-4 gap-5 relative">
          {/* Connecting line for large screens */}
          <div aria-hidden className="hidden lg:block absolute top-9 left-[calc(12.5%+30px)] right-[calc(12.5%+30px)] h-[2px] bg-gradient-to-r from-[#0B5FFF]/20 via-[#00C2A8]/30 to-[#0B5FFF]/20" />

          {STEPS.map(({ num, icon: Icon, title, body }, i) => (
            <div key={num} className="relative bg-white rounded-2xl border border-slate-100 p-6 lg:p-7 shadow-sm hover:shadow-xl transition-shadow">
              <div className="relative w-12 h-12 mx-auto rounded-2xl bg-gradient-to-br from-[#0B5FFF] to-[#00C2A8] text-white flex items-center justify-center shadow-md shadow-[#0B5FFF]/30">
                <Icon size={20} strokeWidth={2.4} />
                <span className="absolute -top-2 -right-2 bg-white text-[#0B5FFF] text-[10px] font-bold rounded-full px-1.5 py-0.5 border border-slate-100 shadow">
                  {num}
                </span>
              </div>
              <h3 className="mt-5 text-center font-[Manrope,Inter,sans-serif] font-extrabold text-[15px] text-[#111827]">{title}</h3>
              <p className="mt-2 text-center text-[12.5px] text-[#475569] leading-relaxed">{body}</p>
              {i < STEPS.length - 1 && (
                <div className="lg:hidden mt-5 h-6 w-[2px] mx-auto bg-gradient-to-b from-[#0B5FFF]/30 to-[#00C2A8]/30 rounded" aria-hidden />
              )}
            </div>
          ))}
        </div>

        <p className="mt-12 text-center text-sm text-[#475569]">
          <span className="font-semibold text-[#111827]">Simple for staff. Powerful for owners.</span>
        </p>
      </div>
    </section>
  );
}
