import React from 'react';

/**
 * Editorial section heading — overline + display title + lede.
 * Used across PainPoints, Features, HowItWorks, Pricing, etc. so every
 * section opens with the same rhythm: tiny eyebrow → big tracked-tight H2 → calm lede.
 */
export default function SectionHeading({
  eyebrow,
  title,
  lede,
  align = 'left',
  testid,
  children,
}) {
  const alignment = align === 'center' ? 'text-center mx-auto' : 'text-left';
  return (
    <div className={`max-w-3xl mb-12 md:mb-16 ${alignment}`} data-testid={testid}>
      {eyebrow && (
        <div className="text-xs tracking-[0.22em] uppercase font-semibold text-[#0F52BA] mb-4">
          <span className="inline-flex items-center gap-2">
            <span className="h-px w-8 bg-[#0F52BA]" /> {eyebrow}
          </span>
        </div>
      )}
      <h2 className="font-display tracking-supertight font-bold text-slate-900 text-3xl sm:text-4xl lg:text-5xl leading-[1.05]">
        {title}
      </h2>
      {lede && (
        <p className="font-body text-base sm:text-lg text-slate-600 leading-relaxed mt-5 max-w-2xl">
          {lede}
        </p>
      )}
      {children}
    </div>
  );
}
