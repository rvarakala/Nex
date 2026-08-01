/**
 * BlankAudiogramTemplate — clean, printable, hand-fillable audiogram.
 *
 * Designed for audiologists who want to:
 *   1. Take printouts ahead of a test session and plot the audiogram by hand.
 *   2. Hand a blank chart to a trainee or visiting consultant.
 *
 * Layout (A4 portrait):
 *   • Top:   clinic logo + name + address + GSTIN  (from /clinics/me)
 *   • Below: blank patient demographic fields (Name / MRD / Age / Date)
 *   • Two audiogram charts side-by-side — Right (red, O) + Left (blue, X)
 *   • Standard symbols legend
 *   • PTA / BC / masking notes + audiologist signature row
 *
 * Print path: `window.print()`. We isolate the page with `print-page` /
 * `print-only` CSS so the surrounding shell (sidebar/header) is hidden.
 */
import React, { useEffect, useState, useRef, useMemo } from 'react';
import axios from 'axios';
import { Printer, Settings as SettingsIcon } from 'lucide-react';
import { useNavigate } from 'react-router-dom';

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;

/* -------- Audiogram geometry -------- */
const FREQS = [125, 250, 500, 750, 1000, 1500, 2000, 3000, 4000, 6000, 8000]; // 11 ticks
const INTEROCT = new Set([750, 1500, 3000, 6000]);
const DB_MIN = -10;
const DB_MAX = 120;
const DB_STEP = 10;
const DB_TICKS = (() => {
  const a = [];
  for (let d = DB_MIN; d <= DB_MAX; d += DB_STEP) a.push(d);
  return a;
})();

function fmtFreq(f) {
  if (f >= 1000) return `${f / 1000}k`;
  return String(f);
}

/* -------- Single audiogram chart (SVG) -------- */
function AudiogramChart({ side, accent, symbol }) {
  // SVG coordinate space — fixed, scales via viewBox.
  const W = 360;
  const H = 360;
  const PAD_L = 38;
  const PAD_R = 14;
  const PAD_T = 30;
  const PAD_B = 28;
  const innerW = W - PAD_L - PAD_R;
  const innerH = H - PAD_T - PAD_B;

  const fx = (i) => PAD_L + (innerW * i) / (FREQS.length - 1);
  const dy = (db) => PAD_T + (innerH * (db - DB_MIN)) / (DB_MAX - DB_MIN);

  return (
    <div className="border border-black p-2 print:p-2">
      <div className="flex items-center justify-between mb-1">
        <div className="text-[11px] font-bold uppercase tracking-wider">
          {side} Ear
        </div>
        <div
          className="text-[10px] font-bold flex items-center gap-1"
          style={{ color: accent }}
        >
          <span>Symbol: {symbol}</span>
          <span
            className="inline-block w-3 h-3 border"
            style={{ borderColor: accent, color: accent }}
          />
        </div>
      </div>

      <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto" style={{ display: 'block' }}>
        {/* Outer axes */}
        <rect
          x={PAD_L}
          y={PAD_T}
          width={innerW}
          height={innerH}
          fill="white"
          stroke="#000"
          strokeWidth="1.2"
        />

        {/* Horizontal dB grid */}
        {DB_TICKS.map((db) => {
          const y = dy(db);
          const isMajor = db % 20 === 0;
          return (
            <g key={`h${db}`}>
              <line
                x1={PAD_L}
                y1={y}
                x2={W - PAD_R}
                y2={y}
                stroke={db === 0 ? '#000' : isMajor ? '#666' : '#bbb'}
                strokeWidth={db === 0 ? 1 : 0.4}
                strokeDasharray={db === 0 ? '' : isMajor ? '' : '2 2'}
              />
              <text
                x={PAD_L - 4}
                y={y + 3}
                fontSize="9"
                textAnchor="end"
                fill="#000"
                fontWeight={isMajor ? 700 : 400}
              >
                {db}
              </text>
            </g>
          );
        })}

        {/* Vertical frequency grid */}
        {FREQS.map((f, i) => {
          const x = fx(i);
          const isInter = INTEROCT.has(f);
          return (
            <g key={`v${f}`}>
              <line
                x1={x}
                y1={PAD_T}
                x2={x}
                y2={H - PAD_B}
                stroke={isInter ? '#bbb' : '#666'}
                strokeWidth={isInter ? 0.4 : 0.7}
                strokeDasharray={isInter ? '2 2' : ''}
              />
              <text
                x={x}
                y={PAD_T - 6}
                fontSize="9"
                textAnchor="middle"
                fontWeight={isInter ? 400 : 700}
                fill="#000"
              >
                {fmtFreq(f)}
              </text>
            </g>
          );
        })}

        {/* Bottom axis label */}
        <text
          x={W / 2}
          y={H - 6}
          fontSize="9"
          textAnchor="middle"
          fontWeight="700"
        >
          Frequency (Hz)
        </text>
        {/* Y-axis title (rotated) */}
        <text
          x={10}
          y={H / 2}
          fontSize="9"
          textAnchor="middle"
          fontWeight="700"
          transform={`rotate(-90 10 ${H / 2})`}
        >
          Hearing Level (dB HL · ANSI 2010)
        </text>
      </svg>
    </div>
  );
}

/* -------- Demographic / notes line -------- */
function Field({ label, w = 'w-44', placeholder = '' }) {
  return (
    <div className={`flex items-end ${w}`}>
      <span className="text-[10px] font-bold uppercase tracking-wider mr-2 whitespace-nowrap">
        {label}
      </span>
      <span className="flex-1 border-b border-black h-[18px] inline-block text-[11px] text-slate-400 italic">
        {placeholder}
      </span>
    </div>
  );
}

/* -------- Symbol legend cell -------- */
function LegendRow({ sym, label, color = '#000' }) {
  return (
    <div className="flex items-center gap-2 text-[10px]">
      <span
        className="inline-flex items-center justify-center w-5 h-5 font-bold"
        style={{ color }}
      >
        {sym}
      </span>
      <span className="text-[10px]">{label}</span>
    </div>
  );
}

/* ==================== PAGE ==================== */
export default function BlankAudiogramTemplate() {
  const navigate = useNavigate();
  const [clinic, setClinic] = useState(null);
  const printRef = useRef(null);

  useEffect(() => {
    axios
      .get(`${API}/settings/clinic`)
      .then((r) => setClinic(r.data))
      .catch(() => setClinic(null));
  }, []);

  const handlePrint = () => window.print();

  const logoSrc = useMemo(
    () => (clinic ? `${API}/settings/clinic/logo?v=${Date.now()}` : null),
    [clinic],
  );

  const headerLine2 = useMemo(() => {
    if (!clinic) return '';
    const parts = [clinic.address, clinic.city, clinic.state, clinic.pincode]
      .filter(Boolean)
      .join(', ');
    return parts;
  }, [clinic]);

  return (
    <div className="bg-slate-100 min-h-full">
      {/* ── Print-mode CSS ──
          Canonical "print only this element" pattern: hide *everything*
          via visibility:hidden, then bring back only the printable A4
          page and its descendants. This sidesteps the shell's
          `h-screen overflow-hidden` flexbox constraints reliably.       */}
      <style>{`
        @media print {
          @page { size: A4 portrait; margin: 0; }

          html, body, #root {
            background: white !important;
            height: auto !important;
            overflow: visible !important;
          }

          body * {
            visibility: hidden !important;
          }
          .print-page,
          .print-page * {
            visibility: visible !important;
          }

          .print-page {
            position: absolute !important;
            left: 0 !important;
            top: 0 !important;
            margin: 0 !important;
            padding: 8mm !important;
            box-shadow: none !important;
            width: 210mm !important;
            min-height: 297mm !important;
            background: white !important;
          }
        }
      `}</style>

      {/* ── Toolbar (print-hide) ── */}
      <div className="print-hide bg-white border-b border-slate-200 sticky top-0 z-10 px-5 py-3 flex items-center justify-between" data-testid="print-templates-toolbar">
        <div>
          <div className="flex items-center gap-2 text-[11px] text-slate-500">
            <SettingsIcon size={12} />
            <span>Settings</span>
            <span>›</span>
            <span>Print Templates</span>
            <span>›</span>
            <span className="text-slate-800 font-semibold">Blank Audiogram</span>
          </div>
          <h1 className="font-bold text-lg text-slate-900 mt-0.5">Blank Audiogram Template</h1>
          <p className="text-[12px] text-slate-500">
            A4 portrait · 2 charts (R + L) · standard symbols · ready to hand-fill.
            <span className="ml-2 text-slate-400">Tip: in the print dialog, choose <b>Save as PDF</b>.</span>
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            data-testid="print-templates-back"
            onClick={() => navigate('/settings/templates')}
            className="px-3 py-2 text-xs font-semibold rounded border border-slate-300 hover:bg-slate-50 text-slate-700"
          >
            ← Back to templates
          </button>
          <button
            data-testid="print-templates-print-audiogram"
            onClick={handlePrint}
            className="px-4 py-2 text-sm font-bold rounded bg-[#0F52BA] hover:bg-[#0C4399] text-white inline-flex items-center gap-2 shadow"
          >
            <Printer size={14} />
            Print / Save as PDF
          </button>
        </div>
      </div>

      {/* ── A4 page ── */}
      <div className="flex justify-center py-6">
        <div
          ref={printRef}
          className="print-page bg-white text-black"
          style={{
            width: '210mm',
            minHeight: '297mm',
            padding: '12mm 12mm 12mm 12mm',
            boxShadow: '0 4px 20px -4px rgba(0,0,0,0.15)',
            // `template_font` is the clinic-level typography choice from
            // Settings → Clinic Details → Typography. Falls back to
            // Helvetica when the clinic hasn't picked one.
            fontFamily: clinic?.template_font || 'Helvetica, Arial, sans-serif',
            fontSize: '11px',
            lineHeight: '1.35',
          }}
          data-testid="blank-audiogram-page"
        >
          {/* ── Header (clinic letterhead) ── */}
          <header className="flex items-start gap-3 pb-2 border-b-2 border-black">
            {logoSrc && (
              <img
                src={logoSrc}
                alt=""
                onError={(e) => { e.currentTarget.style.display = 'none'; }}
                style={{ height: '46px', objectFit: 'contain' }}
              />
            )}
            <div className="flex-1">
              <div className="font-bold text-[16px] tracking-tight uppercase" data-testid="blank-audiogram-clinic-name">
                {clinic?.name || 'Your Clinic Name'}
              </div>
              {clinic?.tagline && (
                <div
                  className="text-[10px] text-slate-700 italic mt-0.5"
                  data-testid="blank-audiogram-tagline"
                >
                  {clinic.tagline}
                </div>
              )}
              {headerLine2 && (
                <div className="text-[10px] text-slate-700 mt-0.5">
                  {headerLine2}
                </div>
              )}
              <div className="text-[10px] text-slate-700 mt-0.5 flex gap-3 flex-wrap">
                {clinic?.phone && <span>Phone: {clinic.phone}</span>}
                {clinic?.email && <span>Email: {clinic.email}</span>}
                {clinic?.gstin && <span>GSTIN: {clinic.gstin}</span>}
              </div>
            </div>
            <div className="text-right">
              <div className="text-[11px] font-bold uppercase tracking-widest border border-black px-2 py-0.5">
                Audiogram · PTA
              </div>
              <div className="text-[9px] text-slate-600 mt-1">ANSI S3.6 · 2010</div>
            </div>
          </header>

          {/* ── Demographic row 1 ── */}
          <section className="grid grid-cols-3 gap-3 mt-3">
            <Field label="Name" w="w-full" />
            <Field label="MRD #" w="w-full" />
            <Field label="Date" w="w-full" />
          </section>
          <section className="grid grid-cols-4 gap-3 mt-2">
            <Field label="Age" w="w-full" />
            <Field label="Sex" w="w-full" placeholder="M / F / Other" />
            <Field label="Referred By" w="w-full" />
            <Field label="Audiologist" w="w-full" />
          </section>

          {/* ── Chief complaint / history strip ── */}
          <section className="mt-3 border border-black p-2">
            <div className="text-[10px] font-bold uppercase tracking-wider mb-1">
              Chief Complaint / Brief History
            </div>
            <div className="h-[34px] border-b border-dashed border-slate-400" />
            <div className="h-[14px] border-b border-dashed border-slate-400 mt-1" />
          </section>

          {/* ── Two audiograms ── */}
          <section className="grid grid-cols-2 gap-3 mt-3">
            <AudiogramChart side="Right" accent="#B91C1C" symbol="O / Δ" />
            <AudiogramChart side="Left" accent="#1D4ED8" symbol="X / □" />
          </section>

          {/* ── Symbols legend + PTA strip ── */}
          <section className="grid grid-cols-12 gap-3 mt-3 text-[10px]">
            <div className="col-span-8 border border-black p-2">
              <div className="text-[10px] font-bold uppercase tracking-wider mb-1.5">
                Standard Audiometric Symbols
              </div>
              <div className="grid grid-cols-3 gap-y-1 gap-x-2">
                <LegendRow sym="O" label="AC unmasked — Right" color="#B91C1C" />
                <LegendRow sym="X" label="AC unmasked — Left"  color="#1D4ED8" />
                <LegendRow sym="Δ" label="AC masked — Right"   color="#B91C1C" />
                <LegendRow sym="☐" label="AC masked — Left"    color="#1D4ED8" />
                <LegendRow sym="<" label="BC unmasked — Right" color="#B91C1C" />
                <LegendRow sym=">" label="BC unmasked — Left"  color="#1D4ED8" />
                <LegendRow sym="[" label="BC masked — Right"   color="#B91C1C" />
                <LegendRow sym="]" label="BC masked — Left"    color="#1D4ED8" />
                <LegendRow sym="↓" label="No response (NR)"    color="#000" />
              </div>
            </div>
            <div className="col-span-4 border border-black p-2">
              <div className="text-[10px] font-bold uppercase tracking-wider mb-1.5">
                PTA Summary
              </div>
              <div className="space-y-1.5">
                <div className="flex items-center justify-between text-[10px]">
                  <span>Right PTA (.5/1/2k):</span>
                  <span className="border-b border-black inline-block w-16 h-[16px]" />
                  <span className="ml-1">dB</span>
                </div>
                <div className="flex items-center justify-between text-[10px]">
                  <span>Left PTA (.5/1/2k):</span>
                  <span className="border-b border-black inline-block w-16 h-[16px]" />
                  <span className="ml-1">dB</span>
                </div>
                <div className="flex items-center justify-between text-[10px] pt-1">
                  <span>SRT R:</span>
                  <span className="border-b border-black inline-block w-12 h-[16px]" />
                  <span>SRT L:</span>
                  <span className="border-b border-black inline-block w-12 h-[16px]" />
                </div>
                <div className="flex items-center justify-between text-[10px]">
                  <span>WRS R:</span>
                  <span className="border-b border-black inline-block w-12 h-[16px]" />
                  <span>WRS L:</span>
                  <span className="border-b border-black inline-block w-12 h-[16px]" />
                </div>
              </div>
            </div>
          </section>

          {/* ── Impressions + recommendations ── */}
          <section className="grid grid-cols-2 gap-3 mt-3">
            <div className="border border-black p-2">
              <div className="text-[10px] font-bold uppercase tracking-wider mb-1">
                Impressions / Diagnosis
              </div>
              {[0, 1, 2].map((i) => (
                <div key={i} className="h-[18px] border-b border-dashed border-slate-400" />
              ))}
            </div>
            <div className="border border-black p-2">
              <div className="text-[10px] font-bold uppercase tracking-wider mb-1">
                Recommendations
              </div>
              {[0, 1, 2].map((i) => (
                <div key={i} className="h-[18px] border-b border-dashed border-slate-400" />
              ))}
            </div>
          </section>

          {/* ── Footer / signature ── */}
          <footer className="mt-4 flex items-end justify-between text-[10px]">
            <div className="flex-1">
              <div className="border-b border-black w-56 h-[22px]" />
              <div className="text-[9px] text-slate-600 mt-0.5">
                Audiologist Signature / Name / Reg. No.
              </div>
            </div>
            <div className="text-[9px] text-slate-500 text-right">
              <div>Generated via AUDINEXA · Print → Save as PDF</div>
              <div className="font-mono">audinexa.com</div>
            </div>
          </footer>
        </div>
      </div>
    </div>
  );
}
