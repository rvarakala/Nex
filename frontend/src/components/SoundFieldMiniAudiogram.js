import React, { useEffect, useRef } from 'react';

/**
 * Sound Field Mini Audiogram.
 *
 * Plots Unaided vs Aided warble-tone thresholds on a single audiogram-style
 * canvas. Data source is the shared `fields` dict using keys:
 *   sf_unaided_<ear>_<freq>  (ear: right|left, freq: Hz)
 *   sf_aided_<ear>_<freq>
 *
 * Because sound field responses aren't ear-specific in most paediatric setups,
 * this chart collapses R & L into a single "better ear" line per curve
 * (picks the lower threshold at each frequency when both are present).
 *
 * Styling mirrors the Pure Tone report chart:
 *   Unaided — dashed grey line, open circles
 *   Aided   — solid orange line, filled squares
 */
const SoundFieldMiniAudiogram = ({ fields = {}, height = 220 }) => {
  const canvasRef = useRef(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;
    ctx.scale(dpr, dpr);

    const W = rect.width, H = rect.height;
    ctx.clearRect(0, 0, W, H);

    const PL = 40, PR = 10, PT = 16, PB = 28;
    const plotW = W - PL - PR;
    const plotH = H - PT - PB;

    const FREQS = [250, 500, 1000, 2000, 4000, 8000];
    const Y_MIN = -10, Y_MAX = 110; // dB HL (inverted — louder at bottom)

    // X is logarithmic across FREQS indices but we use evenly-spaced indices for simplicity.
    const xToPx = (idx) => PL + (idx / (FREQS.length - 1)) * plotW;
    const yToPx = (db) => PT + ((db - Y_MIN) / (Y_MAX - Y_MIN)) * plotH;

    // Background
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(PL, PT, plotW, plotH);

    // Grid (vertical at each freq, horizontal every 10 dB)
    ctx.strokeStyle = '#e5e7eb';
    ctx.lineWidth = 0.5;
    FREQS.forEach((_, i) => {
      const x = xToPx(i);
      ctx.beginPath(); ctx.moveTo(x, PT); ctx.lineTo(x, PT + plotH); ctx.stroke();
    });
    for (let db = Y_MIN; db <= Y_MAX; db += 10) {
      const y = yToPx(db);
      ctx.beginPath(); ctx.moveTo(PL, y); ctx.lineTo(PL + plotW, y); ctx.stroke();
    }

    // Axes
    ctx.strokeStyle = '#374151'; ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(PL, PT); ctx.lineTo(PL, PT + plotH); ctx.lineTo(PL + plotW, PT + plotH);
    ctx.stroke();

    // Labels
    ctx.fillStyle = '#374151'; ctx.font = '9px Arial'; ctx.textAlign = 'center';
    FREQS.forEach((hz, i) => {
      const lbl = hz >= 1000 ? `${hz / 1000}K` : String(hz);
      ctx.fillText(lbl, xToPx(i), PT + plotH + 12);
    });
    ctx.fillStyle = '#6b7280';
    ctx.fillText('Frequency (Hz)', PL + plotW / 2, PT + plotH + 22);

    ctx.fillStyle = '#374151'; ctx.textAlign = 'right';
    for (let db = 0; db <= 100; db += 20) ctx.fillText(String(db), PL - 4, yToPx(db) + 3);
    ctx.fillStyle = '#6b7280';
    ctx.save();
    ctx.translate(10, PT + plotH / 2);
    ctx.rotate(-Math.PI / 2);
    ctx.textAlign = 'center';
    ctx.fillText('Hearing Level (dB HL)', 0, 0);
    ctx.restore();

    // Collapse R + L into best threshold at each freq.
    const bestAtFreq = (prefix, freq) => {
      const r = parseFloat(fields[`${prefix}_right_${freq}`]);
      const l = parseFloat(fields[`${prefix}_left_${freq}`]);
      const vals = [r, l].filter((n) => Number.isFinite(n));
      if (!vals.length) return null;
      return Math.min(...vals);
    };

    // Curve drawer
    const drawCurve = (prefix, colour, { dashed = false, marker = 'circle' } = {}) => {
      const points = FREQS.map((f, i) => ({ idx: i, db: bestAtFreq(prefix, f) })).filter((p) => p.db !== null);
      if (!points.length) return;

      // Line
      ctx.strokeStyle = colour; ctx.lineWidth = 1.6;
      if (dashed) ctx.setLineDash([5, 3]); else ctx.setLineDash([]);
      ctx.beginPath();
      points.forEach((p, i) => {
        const x = xToPx(p.idx); const y = yToPx(p.db);
        if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      });
      ctx.stroke();
      ctx.setLineDash([]);

      // Markers
      points.forEach((p) => {
        const x = xToPx(p.idx); const y = yToPx(p.db);
        ctx.strokeStyle = colour; ctx.fillStyle = colour; ctx.lineWidth = 1.6;
        if (marker === 'circle') {
          ctx.beginPath(); ctx.arc(x, y, 4, 0, Math.PI * 2); ctx.stroke();
        } else if (marker === 'square') {
          ctx.beginPath(); ctx.rect(x - 4, y - 4, 8, 8); ctx.fill();
        }
      });
    };

    drawCurve('sf_unaided', '#6b7280', { dashed: true,  marker: 'circle' });
    drawCurve('sf_aided',   '#ea580c', { dashed: false, marker: 'square' });

    // Legend (top-right corner of plot)
    const lx = PL + plotW - 110;
    const ly = PT + 6;
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(lx - 4, ly - 4, 110, 32);
    ctx.strokeStyle = '#d1d5db';
    ctx.strokeRect(lx - 4, ly - 4, 110, 32);
    ctx.fillStyle = '#374151';
    ctx.font = '9px Arial'; ctx.textAlign = 'left';

    ctx.strokeStyle = '#6b7280'; ctx.setLineDash([5, 3]); ctx.beginPath();
    ctx.moveTo(lx, ly + 5); ctx.lineTo(lx + 14, ly + 5); ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = '#6b7280'; ctx.beginPath(); ctx.arc(lx + 7, ly + 5, 3, 0, Math.PI * 2); ctx.stroke();
    ctx.fillStyle = '#374151'; ctx.fillText('Unaided', lx + 20, ly + 8);

    ctx.strokeStyle = '#ea580c'; ctx.beginPath();
    ctx.moveTo(lx, ly + 20); ctx.lineTo(lx + 14, ly + 20); ctx.stroke();
    ctx.fillStyle = '#ea580c'; ctx.fillRect(lx + 4, ly + 17, 6, 6);
    ctx.fillStyle = '#374151'; ctx.fillText('Aided', lx + 20, ly + 23);
  }, [fields]);

  return (
    <canvas
      ref={canvasRef}
      data-testid="soundfield-mini-audiogram"
      style={{ width: '100%', height: `${height}px`, display: 'block' }}
    />
  );
};

export default SoundFieldMiniAudiogram;
