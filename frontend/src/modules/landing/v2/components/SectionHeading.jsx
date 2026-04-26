/**
 * Section header used across landing sections — small kicker + headline + sub.
 * Centralised so spacing and typography stay perfectly consistent.
 */
import React from 'react';

export default function SectionHeading({ kicker, title, subtitle, align = 'center', accentTo = 'right' }) {
  const wrap = align === 'left' ? 'text-left max-w-2xl' : 'text-center max-w-3xl mx-auto';
  return (
    <div className={`${wrap}`}>
      {kicker && (
        <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full text-[11px] font-bold uppercase tracking-wider bg-[#0B5FFF]/8 text-[#0B5FFF]">
          {kicker}
        </div>
      )}
      <h2 className="mt-4 font-[Manrope,Inter,sans-serif] font-extrabold tracking-tight text-[#111827] text-3xl sm:text-4xl lg:text-5xl leading-tight">
        {title}
      </h2>
      {subtitle && (
        <p className={`mt-4 text-base sm:text-lg text-[#475569] leading-relaxed ${align === 'left' ? '' : 'mx-auto'}`}>
          {subtitle}
        </p>
      )}
    </div>
  );
}
