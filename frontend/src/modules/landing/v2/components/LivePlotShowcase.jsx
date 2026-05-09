import React from 'react';
import { Activity, Waves, Sparkles } from 'lucide-react';

/**
 * LivePlotShowcase — CSS-only "GIF" replacement.
 * Demonstrates AUDINEXA plotting an audiogram + tympanogram in real time,
 * looping every 6s. Side-by-side dual-pane laptop frame for the Hero.
 */
export default function LivePlotShowcase() {
  // Right ear (red O)
  const right = [
    { x: 60,  y: 38,  d: '0s'   },
    { x: 110, y: 50,  d: '0.4s' },
    { x: 160, y: 72,  d: '0.8s' },
    { x: 210, y: 92,  d: '1.2s' },
    { x: 260, y: 108, d: '1.6s' },
    { x: 310, y: 118, d: '2.0s' },
  ];
  // Left ear (blue X)
  const left = [
    { x: 60,  y: 32,  d: '0.2s' },
    { x: 110, y: 44,  d: '0.6s' },
    { x: 160, y: 64,  d: '1.0s' },
    { x: 210, y: 80,  d: '1.4s' },
    { x: 260, y: 98,  d: '1.8s' },
    { x: 310, y: 112, d: '2.2s' },
  ];

  return (
    <div data-testid="live-plot-showcase" className="relative">
      {/* Browser / laptop chrome */}
      <div className="relative rounded-3xl overflow-hidden shadow-2xl shadow-slate-900/15 ring-1 ring-slate-900/10 bg-white">
        {/* Title bar */}
        <div className="flex items-center justify-between bg-slate-900 px-4 py-2.5">
          <div className="flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-full bg-rose-400" />
            <span className="w-2.5 h-2.5 rounded-full bg-amber-300" />
            <span className="w-2.5 h-2.5 rounded-full bg-emerald-400" />
          </div>
          <div className="text-[10.5px] font-semibold tracking-wider uppercase text-slate-300">
            audinexa.com / patient · MRD-2641
          </div>
          <div className="inline-flex items-center gap-1.5 text-[10.5px] text-emerald-300 font-semibold">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" />
            Live plot
          </div>
        </div>

        {/* Dual-pane content */}
        <div className="grid grid-cols-1 sm:grid-cols-2 divide-y sm:divide-y-0 sm:divide-x divide-slate-200">
          {/* ── Audiogram pane ── */}
          <div className="p-4 sm:p-5">
            <div className="flex items-center justify-between">
              <div className="inline-flex items-center gap-1.5 text-[11px] font-bold tracking-wider uppercase text-[#0F52BA]">
                <Activity size={13} /> Audiogram · PTA
              </div>
              <span className="text-[10px] text-slate-400 font-mono">125 – 8000 Hz</span>
            </div>

            <div className="relative mt-2">
              <svg viewBox="0 0 360 160" className="w-full h-[150px] sm:h-[170px]">
                {/* axes */}
                <line x1="36" y1="20" x2="36" y2="140" stroke="#CBD5E1" />
                <line x1="36" y1="140" x2="356" y2="140" stroke="#CBD5E1" />
                {/* horizontal grid */}
                {[0, 1, 2, 3, 4, 5].map((i) => (
                  <line
                    key={i}
                    x1="36"
                    y1={20 + i * 24}
                    x2="356"
                    y2={20 + i * 24}
                    stroke="#E2E8F0"
                    strokeDasharray="2 3"
                  />
                ))}
                {/* dB labels */}
                {[0, 20, 40, 60, 80, 100].map((db, i) => (
                  <text key={db} x="6" y={24 + i * 24} fontSize="8" fill="#94A3B8">{db}</text>
                ))}
                {/* Hz labels */}
                {[
                  ['0.25k', 60],
                  ['0.5k', 110],
                  ['1k', 160],
                  ['2k', 210],
                  ['4k', 260],
                  ['8k', 310],
                ].map(([t, x]) => (
                  <text key={t} x={x - 8} y="155" fontSize="8" fill="#94A3B8">{t}</text>
                ))}

                {/* connecting polylines */}
                <polyline
                  className="plot-line"
                  points="60,38 110,50 160,72 210,92 260,108 310,118"
                  stroke="#EF4444"
                  strokeWidth="1.6"
                  fill="none"
                  strokeLinecap="round"
                />
                <polyline
                  className="plot-line"
                  style={{ animationDelay: '0.2s' }}
                  points="60,32 110,44 160,64 210,80 260,98 310,112"
                  stroke="#2563EB"
                  strokeWidth="1.6"
                  fill="none"
                  strokeLinecap="round"
                />

                {/* Right ear (red O) — pop in */}
                {right.map((p, i) => (
                  <circle
                    key={`r${i}`}
                    className="plot-point"
                    style={{ animationDelay: p.d }}
                    cx={p.x}
                    cy={p.y}
                    r="5"
                    stroke="#EF4444"
                    strokeWidth="2"
                    fill="white"
                  />
                ))}
                {/* Left ear (blue X) — pop in */}
                {left.map((p, i) => (
                  <g
                    key={`l${i}`}
                    className="plot-point"
                    style={{ animationDelay: p.d }}
                    stroke="#2563EB"
                    strokeWidth="2"
                  >
                    <line x1={p.x - 5} y1={p.y - 5} x2={p.x + 5} y2={p.y + 5} />
                    <line x1={p.x - 5} y1={p.y + 5} x2={p.x + 5} y2={p.y - 5} />
                  </g>
                ))}

                {/* Sweeping cursor */}
                <g className="audinexa-cursor">
                  <line x1="36" y1="18" x2="36" y2="142" stroke="#0F52BA" strokeWidth="1" strokeDasharray="2 2" opacity="0.6" />
                </g>
              </svg>

              <div className="mt-1 flex items-center gap-3 text-[10px] text-slate-500">
                <span className="inline-flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-rose-500" /> Right (O)</span>
                <span className="inline-flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-blue-600" /> Left (X)</span>
                <span className="ml-auto inline-flex items-center gap-1 text-emerald-600 font-semibold">
                  <Sparkles size={10} /> Auto-saved
                </span>
              </div>
            </div>
          </div>

          {/* ── Tympanogram pane ── */}
          <div className="p-4 sm:p-5 bg-slate-50/40">
            <div className="flex items-center justify-between">
              <div className="inline-flex items-center gap-1.5 text-[11px] font-bold tracking-wider uppercase text-[#0F52BA]">
                <Waves size={13} /> Tympanogram · 226 Hz
              </div>
              <span className="text-[10px] text-slate-400 font-mono">Type A · Right ear</span>
            </div>

            <div className="relative mt-2">
              <svg viewBox="0 0 360 160" className="w-full h-[150px] sm:h-[170px]">
                {/* axes */}
                <line x1="36" y1="140" x2="356" y2="140" stroke="#CBD5E1" />
                <line x1="36" y1="20" x2="36" y2="140" stroke="#CBD5E1" />
                {/* grid lines */}
                {[0, 1, 2, 3, 4].map((i) => (
                  <line
                    key={i}
                    x1="36"
                    y1={28 + i * 28}
                    x2="356"
                    y2={28 + i * 28}
                    stroke="#E2E8F0"
                    strokeDasharray="2 3"
                  />
                ))}
                {/* daPa axis labels */}
                {[
                  ['-400', 60],
                  ['-200', 130],
                  ['0',    200],
                  ['+200', 270],
                  ['+400', 330],
                ].map(([t, x]) => (
                  <text key={t} x={x - 10} y="155" fontSize="8" fill="#94A3B8">{t}</text>
                ))}
                {/* compliance label */}
                <text x="6" y="28" fontSize="8" fill="#94A3B8">1.4</text>
                <text x="6" y="84" fontSize="8" fill="#94A3B8">0.7</text>
                <text x="6" y="138" fontSize="8" fill="#94A3B8">0.0</text>

                {/* Type A bell curve drawn progressively */}
                <path
                  className="tymp-curve"
                  d="M 50 138 Q 110 138, 160 134 T 200 36 T 240 134 Q 290 138, 350 138"
                  stroke="#0F52BA"
                  strokeWidth="2.2"
                  fill="none"
                  strokeLinecap="round"
                />
                {/* Soft fill underneath, fades in */}
                <path
                  className="tymp-curve"
                  style={{ animationDelay: '0.4s' }}
                  d="M 50 138 Q 110 138, 160 134 T 200 36 T 240 134 Q 290 138, 350 138 L 350 140 L 50 140 Z"
                  fill="rgba(15,82,186,0.08)"
                  stroke="none"
                />

                {/* Peak marker */}
                <g className="plot-point" style={{ animationDelay: '2.5s' }}>
                  <circle cx="200" cy="36" r="5" stroke="#0F52BA" strokeWidth="2" fill="white" />
                  <text x="208" y="32" fontSize="9" fill="#0F52BA" fontWeight="700">Peak · -10 daPa</text>
                </g>

                {/* Sweeping cursor */}
                <g className="audinexa-cursor">
                  <line x1="36" y1="18" x2="36" y2="142" stroke="#0F52BA" strokeWidth="1" strokeDasharray="2 2" opacity="0.6" />
                </g>
              </svg>

              <div className="mt-1 flex items-center justify-between text-[10px] text-slate-500">
                <span>Pressure (daPa)</span>
                <span className="inline-flex items-center gap-1 text-emerald-600 font-semibold">
                  <Sparkles size={10} /> Interpreted: Normal
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* footer status bar */}
        <div className="bg-white border-t border-slate-200 px-4 py-2 flex items-center justify-between text-[10.5px] font-medium">
          <span className="text-slate-500">
            Patient: <span className="text-slate-800">Ramesh K. · 58y · M</span> · Room 2
          </span>
          <span className="inline-flex items-center gap-1.5 text-[#0F52BA] font-semibold">
            <span className="w-1.5 h-1.5 rounded-full bg-[#0F52BA]" />
            Plotted directly inside AUDINEXA — no paper, no extra app.
          </span>
        </div>
      </div>

      {/* Floating glass badges */}
      <div className="absolute -top-3 -left-3 hidden md:inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white shadow-md border border-slate-200">
        <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
        <span className="text-[10.5px] font-semibold text-slate-700">No re-typing. No second screen.</span>
      </div>
      <div className="absolute -bottom-3 -right-3 hidden md:inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#0F52BA] text-white shadow-md">
        <span className="text-[10.5px] font-semibold tracking-wide">Plot · Save · Bill — 1 screen.</span>
      </div>
    </div>
  );
}
