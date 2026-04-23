/**
 * Inline SVG illustrations used on the landing page's "Diagnostics Suite" section.
 * Kept here (not stock images) so they always render, load instantly, and stay
 * on-brand with the dark Audinexa theme.
 */
import React from 'react';

/** Audiogram miniature — mimics a real PTA plot with two symbol traces. */
export const AudiogramIllustration = ({ className = '' }) => (
  <svg viewBox="0 0 320 240" className={className} role="img" aria-label="Audiogram plot preview">
    <defs>
      <linearGradient id="aud-bg" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%"  stopColor="#0f172a" />
        <stop offset="100%" stopColor="#020617" />
      </linearGradient>
    </defs>
    <rect width="320" height="240" rx="12" fill="url(#aud-bg)" />
    {/* axes */}
    <g stroke="#334155" strokeWidth="1">
      <line x1="40" y1="20"  x2="40"  y2="210" />
      <line x1="40" y1="210" x2="305" y2="210" />
      {/* horizontal dB lines */}
      {[0, 20, 40, 60, 80, 100, 120].map((v, i) => (
        <line key={v} x1="40" y1={20 + i * 28} x2="305" y2={20 + i * 28} strokeOpacity={i === 0 ? 0.9 : 0.35} />
      ))}
      {/* vertical freq lines */}
      {[0, 1, 2, 3, 4, 5, 6].map((i) => (
        <line key={i} x1={40 + (i + 1) * 38} y1="20" x2={40 + (i + 1) * 38} y2="210" strokeOpacity={0.25} />
      ))}
    </g>
    {/* dB labels */}
    <g fill="#64748b" fontSize="7" fontFamily="ui-monospace, monospace">
      {[0, 20, 40, 60, 80, 100, 120].map((v, i) => (
        <text key={v} x="18" y={24 + i * 28}>{v}</text>
      ))}
    </g>
    {/* freq labels */}
    <g fill="#64748b" fontSize="7" fontFamily="ui-monospace, monospace">
      {['250', '500', '1k', '2k', '4k', '8k'].map((f, i) => (
        <text key={f} x={24 + (i + 1) * 38} y="224">{f}</text>
      ))}
    </g>
    {/* Right ear: red circles (O) - mild-to-moderate sloping loss */}
    <g stroke="#ef4444" strokeWidth="2" fill="none">
      {[[78,60],[116,72],[154,88],[192,110],[230,134],[268,150]].map(([x,y], i, arr) => (
        <React.Fragment key={`R${i}`}>
          <circle cx={x} cy={y} r="6" />
          {i < arr.length - 1 && (
            <line x1={x} y1={y} x2={arr[i+1][0]} y2={arr[i+1][1]} />
          )}
        </React.Fragment>
      ))}
    </g>
    {/* Left ear: blue X marks */}
    <g stroke="#3b82f6" strokeWidth="2">
      {[[78,66],[116,78],[154,96],[192,116],[230,140],[268,160]].map(([x,y], i, arr) => (
        <React.Fragment key={`L${i}`}>
          <line x1={x-5} y1={y-5} x2={x+5} y2={y+5} />
          <line x1={x-5} y1={y+5} x2={x+5} y2={y-5} />
          {i < arr.length - 1 && (
            <line x1={x} y1={y} x2={arr[i+1][0]} y2={arr[i+1][1]} fill="none" />
          )}
        </React.Fragment>
      ))}
    </g>
    {/* title */}
    <text x="16" y="14" fill="#e2e8f0" fontSize="9" fontWeight="700">AUDIOGRAM — PTA (AC)</text>
    {/* legend */}
    <g fontSize="8" fontFamily="ui-sans-serif">
      <circle cx="230" cy="12" r="3" stroke="#ef4444" strokeWidth="1.5" fill="none" />
      <text x="237" y="15" fill="#fca5a5">Right</text>
      <line x1="265" y1="9"  x2="273" y2="17" stroke="#3b82f6" strokeWidth="1.5" />
      <line x1="265" y1="17" x2="273" y2="9"  stroke="#3b82f6" strokeWidth="1.5" />
      <text x="280" y="15" fill="#93c5fd">Left</text>
    </g>
  </svg>
);

/** Tympanogram miniature — shows Type A, As and B curves with pressure axis. */
export const TympanogramIllustration = ({ className = '' }) => (
  <svg viewBox="0 0 320 240" className={className} role="img" aria-label="Tympanogram curve preview">
    <defs>
      <linearGradient id="tym-bg" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%"  stopColor="#0f172a" />
        <stop offset="100%" stopColor="#020617" />
      </linearGradient>
    </defs>
    <rect width="320" height="240" rx="12" fill="url(#tym-bg)" />
    {/* grid */}
    <g stroke="#334155" strokeWidth="1" strokeOpacity="0.35">
      {[0, 1, 2, 3, 4].map((i) => (
        <line key={`h${i}`} x1="40" y1={40 + i * 35} x2="305" y2={40 + i * 35} />
      ))}
      {[0, 1, 2, 3, 4, 5, 6].map((i) => (
        <line key={`v${i}`} x1={40 + i * 44} y1="40" x2={40 + i * 44} y2="210" />
      ))}
    </g>
    {/* axes */}
    <g stroke="#475569" strokeWidth="1">
      <line x1="40" y1="40"  x2="40"  y2="210" />
      <line x1="40" y1="210" x2="305" y2="210" />
    </g>
    {/* pressure labels daPa */}
    <g fill="#64748b" fontSize="7" fontFamily="ui-monospace, monospace">
      {['-400','-200','0','+200','+400'].map((v, i) => (
        <text key={v} x={18 + i * 62} y="224">{v}</text>
      ))}
    </g>
    {/* compliance labels */}
    <g fill="#64748b" fontSize="7" fontFamily="ui-monospace, monospace">
      {['1.5','1.0','0.5','0.0'].map((v, i) => (
        <text key={v} x="16" y={48 + i * 42}>{v}</text>
      ))}
    </g>
    {/* Type A curve — green (normal) */}
    <path
      d="M 52 200 Q 90 195 128 165 Q 160 85 192 165 Q 230 195 305 200"
      fill="none" stroke="#10b981" strokeWidth="2.4"
    />
    <text x="170" y="78" fill="#6ee7b7" fontSize="8" fontWeight="700">Type A · Normal</text>
    {/* Type As curve — amber (stiffness) */}
    <path
      d="M 52 200 Q 90 198 128 185 Q 160 160 192 185 Q 230 198 305 200"
      fill="none" stroke="#f59e0b" strokeWidth="2" strokeDasharray="4 3"
    />
    <text x="196" y="155" fill="#fbbf24" fontSize="7">Type As</text>
    {/* Type B curve — red (flat, effusion) */}
    <path
      d="M 52 200 L 128 200 L 192 200 L 305 200"
      fill="none" stroke="#ef4444" strokeWidth="2" strokeDasharray="2 3"
    />
    <text x="56" y="208" fill="#fca5a5" fontSize="7">Type B</text>
    {/* title + axis-label */}
    <text x="16" y="16" fill="#e2e8f0" fontSize="9" fontWeight="700">TYMPANOGRAM — 226 Hz</text>
    <text x="16" y="30" fill="#94a3b8" fontSize="7">Compliance (ml) vs Pressure (daPa)</text>
  </svg>
);
