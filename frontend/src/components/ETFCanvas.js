import React, { useEffect, useRef } from 'react';

/**
 * ETF-Intact TM (Williams) canvas.
 *
 * Plots up to THREE Gaussian tympanogram curves on a single chart:
 *   • curve 1 (red)   — baseline peak at `pressure_1`
 *   • curve 2 (blue)  — post-Valsalva peak at `pressure_2`
 *   • curve 3 (green) — post-Toynbee peak at `pressure_3`
 *
 * The X-axis spans -600…+400 daPa, Y-axis 0…3.0 mL.
 * A translucent "normal range" rectangle is drawn across -150…+100 daPa,
 * 0.3…1.8 mL — the band where ETF-intact peaks typically land.
 *
 * `earSide` ("right" | "left") only tints the normal-range rectangle.
 */
const ETFCanvas = ({ volume, pressure_1, pressure_2, pressure_3, earSide = 'right' }) => {
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

    // Plot area
    const PL = 34, PR = 10, PT = 10, PB = 26;
    const plotW = W - PL - PR;
    const plotH = H - PT - PB;

    const X_MIN = -600, X_MAX = 400;
    const Y_MIN = 0, Y_MAX = 3.0;

    const xToPx = (daPa) => PL + ((daPa - X_MIN) / (X_MAX - X_MIN)) * plotW;
    const yToPx = (mL)   => PT + plotH - ((mL - Y_MIN) / (Y_MAX - Y_MIN)) * plotH;

    // Background
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(PL, PT, plotW, plotH);

    // Normal-range rectangle (tinted by ear)
    const normX1 = xToPx(-150);
    const normX2 = xToPx(100);
    const normY1 = yToPx(1.8);
    const normY2 = yToPx(0.3);
    ctx.fillStyle = earSide === 'right' ? 'rgba(252, 165, 165, 0.30)' : 'rgba(147, 197, 253, 0.30)';
    ctx.fillRect(normX1, normY1, normX2 - normX1, normY2 - normY1);
    ctx.strokeStyle = earSide === 'right' ? 'rgba(239, 68, 68, 0.45)' : 'rgba(59, 130, 246, 0.45)';
    ctx.lineWidth = 1;
    ctx.strokeRect(normX1, normY1, normX2 - normX1, normY2 - normY1);

    // Grid — vertical at every 200 daPa, dashed at 0
    ctx.strokeStyle = '#e5e7eb';
    ctx.lineWidth = 0.5;
    for (let v = -600; v <= 400; v += 200) {
      const x = xToPx(v);
      ctx.beginPath(); ctx.moveTo(x, PT); ctx.lineTo(x, PT + plotH); ctx.stroke();
    }
    // Horizontal grid at every 1.0 mL, plus 0.5 for finer scale
    for (let mL = 0; mL <= 3.0; mL += 0.5) {
      const y = yToPx(mL);
      ctx.beginPath(); ctx.moveTo(PL, y); ctx.lineTo(PL + plotW, y); ctx.stroke();
    }
    // Dashed x=0 line
    ctx.strokeStyle = '#9ca3af';
    ctx.setLineDash([3, 3]);
    ctx.beginPath();
    ctx.moveTo(xToPx(0), PT);
    ctx.lineTo(xToPx(0), PT + plotH);
    ctx.stroke();
    ctx.setLineDash([]);

    // Axes
    ctx.strokeStyle = '#374151';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(PL, PT); ctx.lineTo(PL, PT + plotH); ctx.lineTo(PL + plotW, PT + plotH);
    ctx.stroke();

    // Axis labels
    ctx.fillStyle = '#374151';
    ctx.font = '9px Arial';
    ctx.textAlign = 'center';
    for (let v = -600; v <= 400; v += 200) {
      ctx.fillText(String(v), xToPx(v), PT + plotH + 12);
    }
    ctx.textAlign = 'right';
    for (let mL = 0; mL <= 3.0; mL += 1.0) {
      ctx.fillText(mL.toFixed(1), PL - 4, yToPx(mL) + 3);
    }
    // Axis titles
    ctx.textAlign = 'center';
    ctx.fillStyle = '#6b7280';
    ctx.font = '9px Arial';
    ctx.fillText('(daPa)', PL + plotW - 18, PT + plotH + 22);
    ctx.save();
    ctx.translate(10, PT + 14);
    ctx.fillText('(ml)', 0, 0);
    ctx.restore();

    // Gaussian curve drawer
    const peakAmp = volume != null ? Math.max(0.3, Math.min(2.2, Number(volume) * 1.6)) : 1.4;
    const sigma = 60; // daPa — fixed width for 226 Hz-style tymp peak

    const drawCurve = (peakDaPa, strokeStyle) => {
      if (peakDaPa === null || peakDaPa === undefined || Number.isNaN(Number(peakDaPa))) return;
      ctx.strokeStyle = strokeStyle;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      const STEP = 4; // daPa resolution
      let first = true;
      for (let daPa = X_MIN; daPa <= X_MAX; daPa += STEP) {
        const amp = peakAmp * Math.exp(-Math.pow(daPa - peakDaPa, 2) / (2 * sigma * sigma));
        const x = xToPx(daPa);
        const y = yToPx(Math.min(Y_MAX, amp));
        if (first) { ctx.moveTo(x, y); first = false; } else { ctx.lineTo(x, y); }
      }
      ctx.stroke();

      // Peak marker dot
      ctx.fillStyle = strokeStyle;
      ctx.beginPath();
      ctx.arc(xToPx(peakDaPa), yToPx(peakAmp), 2.5, 0, Math.PI * 2);
      ctx.fill();
    };

    // Draw the 3 curves in classic tymp-overlay palette (red, blue, green)
    drawCurve(pressure_1, '#dc2626'); // red
    drawCurve(pressure_2, '#2563eb'); // blue
    drawCurve(pressure_3, '#16a34a'); // green

    // Empty-state hint
    if (
      (pressure_1 === null || pressure_1 === undefined) &&
      (pressure_2 === null || pressure_2 === undefined) &&
      (pressure_3 === null || pressure_3 === undefined)
    ) {
      ctx.fillStyle = '#9ca3af';
      ctx.font = 'italic 10px Arial';
      ctx.textAlign = 'center';
      ctx.fillText('Enter Pressures 1–3 to plot curves', PL + plotW / 2, PT + plotH / 2);
    }
  }, [volume, pressure_1, pressure_2, pressure_3, earSide]);

  return (
    <canvas
      ref={canvasRef}
      data-testid={`etf-canvas-${earSide}`}
      style={{ width: '100%', height: '100%', display: 'block' }}
    />
  );
};

export default ETFCanvas;
