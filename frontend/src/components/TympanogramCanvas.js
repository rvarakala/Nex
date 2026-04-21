import React, { useRef, useEffect } from 'react';

/**
 * Tympanogram curve auto-plotted from (ME pressure, compliance, volume, type).
 *   y(x) = V + C * exp(-((x - P)² / (2σ²)))
 * σ varies with type to mimic clinical shapes:
 *   A:60, As:40, Ad:55, B:(flat), C:60
 *
 * X axis: -400..+200 daPa.  Y axis: 0..(V+C)+buffer.
 */
const TympanogramCanvas = ({ jergerType, mePressure, compliance, earSide = 'right', probeHz = 226 }) => {
  const canvasRef = useRef(null);

  useEffect(() => {
    const cv = canvasRef.current;
    if (!cv) return;
    const ctx = cv.getContext('2d');
    const rect = cv.getBoundingClientRect();
    cv.width = rect.width * window.devicePixelRatio;
    cv.height = rect.height * window.devicePixelRatio;
    ctx.scale(window.devicePixelRatio, window.devicePixelRatio);
    const W = rect.width, H = rect.height;
    const pad = { top: 16, right: 10, bottom: 28, left: 36 };
    const cw = W - pad.left - pad.right;
    const ch = H - pad.top - pad.bottom;
    ctx.clearRect(0, 0, W, H);

    const xMin = -400, xMax = 200;
    const yMin = 0;
    // Volume does NOT affect the curve — only Pressure (peak X) and Compliance (peak Y)
    const C = typeof compliance === 'number' && !Number.isNaN(compliance) ? compliance : null;
    const P = typeof mePressure === 'number' && !Number.isNaN(mePressure) ? mePressure : null;
    // Y-axis max scales with compliance so the peak always fits comfortably
    const yMax = Math.max(1.5, (C ?? 1.0) + 0.5);

    const X = (daPa) => pad.left + ((daPa - xMin) / (xMax - xMin)) * cw;
    const Y = (mL) => pad.top + (1 - (mL - yMin) / (yMax - yMin)) * ch;

    // Grid
    ctx.strokeStyle = '#e5e7eb';
    ctx.lineWidth = 0.5;
    for (let p = xMin; p <= xMax; p += 100) {
      const x = X(p);
      ctx.beginPath(); ctx.moveTo(x, pad.top); ctx.lineTo(x, pad.top + ch); ctx.stroke();
    }
    for (let y = 0; y <= yMax; y += 0.5) {
      const yy = Y(y);
      ctx.beginPath(); ctx.moveTo(pad.left, yy); ctx.lineTo(pad.left + cw, yy); ctx.stroke();
    }
    ctx.strokeStyle = '#94a3b8';
    ctx.lineWidth = 1;
    ctx.strokeRect(pad.left, pad.top, cw, ch);

    // Axis labels
    ctx.fillStyle = '#475569';
    ctx.font = '9px Arial';
    ctx.textAlign = 'center';
    for (let p = xMin; p <= xMax; p += 100) {
      ctx.fillText(String(p), X(p), pad.top + ch + 10);
    }
    ctx.textAlign = 'right';
    for (let y = 0; y <= yMax; y += 0.5) {
      ctx.fillText(y.toFixed(1), pad.left - 4, Y(y) + 3);
    }
    ctx.font = 'bold 9px Arial';
    ctx.textAlign = 'center';
    ctx.fillText('daPa', pad.left + cw / 2, H - 3);
    ctx.save();
    ctx.translate(10, pad.top + ch / 2);
    ctx.rotate(-Math.PI / 2);
    ctx.fillText('mL', 0, 0);
    ctx.restore();

    // Don't plot a curve unless we have the required pressure + compliance
    if (P === null || C === null) {
      ctx.fillStyle = '#9ca3af';
      ctx.font = 'italic 10px Arial';
      ctx.textAlign = 'center';
      ctx.fillText('Enter Pressure · Compliance to plot', pad.left + cw / 2, pad.top + ch / 2);
      return;
    }

    // Type-based sigma — probe Hz also slightly broadens at higher freqs (infant-like)
    const typeSigma = { A: 60, As: 45, Ad: 55, B: 1000, C: 70 };
    const probeBroaden = probeHz >= 678 ? 1.25 : 1;
    const sigma = (typeSigma[jergerType] || 60) * probeBroaden;

    const color = earSide === 'right' ? '#DC2626' : '#2563EB';

    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    ctx.beginPath();
    for (let x = xMin; x <= xMax; x += 2) {
      // Pure Gaussian: peak at (P, C), baseline at 0 — volume has no role
      const y = C * Math.exp(-Math.pow(x - P, 2) / (2 * sigma * sigma));
      const px = X(x), py = Y(y);
      if (x === xMin) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.stroke();

    // Peak marker at (P, C)
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(X(P), Y(C), 3, 0, 2 * Math.PI);
    ctx.fill();

    // Labels
    ctx.font = 'bold 9px Arial';
    ctx.textAlign = 'left';
    ctx.fillStyle = color;
    ctx.fillText(`Type ${jergerType || '—'} · ${probeHz} Hz`, pad.left + 4, pad.top + 10);
    ctx.textAlign = 'right';
    ctx.fillText(`P=${P} · C=${C.toFixed(2)}`, pad.left + cw - 4, pad.top + 10);
  }, [jergerType, mePressure, compliance, earSide, probeHz]);

  return <canvas ref={canvasRef} className="w-full h-full bg-white" style={{ width: '100%', height: '100%' }} />;
};

export default TympanogramCanvas;
