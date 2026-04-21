import React, { useEffect, useRef } from 'react';

/**
 * ABR Waveform Canvas — synthetic trace visualisation.
 *
 * Reads Wave I / III / V latencies (ms) per ear from the shared `fields` dict
 * and renders a stacked dual-trace display (Right on top, Left on bottom).
 * Each trace is a clinical ABR waveform approximation:
 *   • A baseline drift
 *   • Gaussian bumps at the entered latencies (Wave I, III, V)
 *   • Small negative dips between peaks
 *
 * X-axis: 0 … 10 ms (grid every 1 ms)
 * Y-axis: ±0.5 μV (each trace's local frame)
 *
 * If no latencies are entered for an ear, that trace shows the axes + label
 * "(no data)" so the panel always renders something meaningful.
 */
const ABRWaveformCanvas = ({ fields = {}, height = 240 }) => {
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

    const PL = 36, PR = 12, PT = 14, PB = 22;
    const plotW = W - PL - PR;
    const plotH = H - PT - PB;
    const traceH = plotH / 2; // one trace per ear

    const X_MIN = 0, X_MAX = 10; // ms
    const xToPx = (t) => PL + ((t - X_MIN) / (X_MAX - X_MIN)) * plotW;

    // Background
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(PL, PT, plotW, plotH);

    // Grid (every 1 ms)
    ctx.strokeStyle = '#e5e7eb';
    ctx.lineWidth = 0.5;
    for (let t = 0; t <= 10; t += 1) {
      const x = xToPx(t);
      ctx.beginPath(); ctx.moveTo(x, PT); ctx.lineTo(x, PT + plotH); ctx.stroke();
    }
    // Separator between R and L traces
    ctx.strokeStyle = '#9ca3af';
    ctx.setLineDash([2, 2]);
    ctx.beginPath();
    ctx.moveTo(PL, PT + traceH); ctx.lineTo(PL + plotW, PT + traceH);
    ctx.stroke();
    ctx.setLineDash([]);

    // Axes
    ctx.strokeStyle = '#374151'; ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(PL, PT); ctx.lineTo(PL, PT + plotH); ctx.lineTo(PL + plotW, PT + plotH);
    ctx.stroke();

    // X-axis labels
    ctx.fillStyle = '#374151'; ctx.font = '9px Arial'; ctx.textAlign = 'center';
    for (let t = 0; t <= 10; t += 1) ctx.fillText(`${t}`, xToPx(t), PT + plotH + 12);
    ctx.fillStyle = '#6b7280';
    ctx.fillText('Time (ms)', PL + plotW - 24, PT + plotH + 20);

    // ---- Draw one trace for a given ear ----
    const drawTrace = (earKey, earLabel, earColour, yBase) => {
      // Baseline
      ctx.strokeStyle = '#d1d5db'; ctx.lineWidth = 0.5;
      ctx.beginPath();
      ctx.moveTo(PL, yBase);
      ctx.lineTo(PL + plotW, yBase);
      ctx.stroke();

      // Ear label
      ctx.fillStyle = earColour;
      ctx.font = 'bold 11px Arial';
      ctx.textAlign = 'right';
      ctx.fillText(earLabel, PL - 4, yBase + 3);

      // Parse latencies (ms) — fall back to typical values if missing
      const parseMs = (k) => {
        const v = parseFloat(fields[`abr_${earKey}_${k}`]);
        return Number.isFinite(v) ? v : null;
      };
      const lI   = parseMs('wi');
      const lIII = parseMs('wiii');
      const lV   = parseMs('wv');
      const haveAny = lI !== null || lIII !== null || lV !== null;

      if (!haveAny) {
        ctx.fillStyle = '#9ca3af';
        ctx.font = 'italic 10px Arial'; ctx.textAlign = 'center';
        ctx.fillText('(no data — enter Wave I / III / V latencies)', PL + plotW / 2, yBase + 4);
        return;
      }

      // Build the synthetic trace: sum of 3 positive gaussians + small negative dips.
      const peaks = [
        { t: lI,   amp: 0.18, w: 0.25 },
        { t: lIII, amp: 0.32, w: 0.30 },
        { t: lV,   amp: 0.55, w: 0.35 },
      ].filter((p) => p.t !== null);

      // Negative dips between peaks (~ 60% of peak amp)
      const dips = [];
      for (let i = 0; i < peaks.length - 1; i += 1) {
        dips.push({
          t: (peaks[i].t + peaks[i + 1].t) / 2,
          amp: -0.15,
          w: 0.4,
        });
      }

      const ampScale = traceH * 0.35; // pixels per μV equivalent

      ctx.strokeStyle = earColour; ctx.lineWidth = 1.5;
      ctx.beginPath();
      const STEP = 0.02;
      let first = true;
      for (let t = X_MIN; t <= X_MAX; t += STEP) {
        let y = 0;
        // Small baseline noise (deterministic)
        y += 0.02 * Math.sin(t * 3.7) * Math.sin(t * 2.1);
        for (const p of peaks) y += p.amp * Math.exp(-Math.pow(t - p.t, 2) / (2 * p.w * p.w));
        for (const d of dips) y += d.amp * Math.exp(-Math.pow(t - d.t, 2) / (2 * d.w * d.w));
        const px = xToPx(t);
        const py = yBase - y * ampScale;
        if (first) { ctx.moveTo(px, py); first = false; } else ctx.lineTo(px, py);
      }
      ctx.stroke();

      // Peak markers with labels I / III / V
      [
        { t: lI,   label: 'I' },
        { t: lIII, label: 'III' },
        { t: lV,   label: 'V' },
      ].forEach((p) => {
        if (p.t === null) return;
        const x = xToPx(p.t);
        // Find amplitude at peak (same as curve)
        const amp = peaks.find((pp) => pp.t === p.t)?.amp || 0;
        const y = yBase - amp * ampScale;
        ctx.strokeStyle = earColour;
        ctx.fillStyle = earColour;
        ctx.beginPath();
        ctx.arc(x, y, 2.5, 0, Math.PI * 2);
        ctx.fill();
        ctx.font = 'bold 10px Arial'; ctx.textAlign = 'center';
        ctx.fillText(p.label, x, y - 5);
      });
    };

    drawTrace('right', 'Right', '#dc2626', PT + traceH * 0.5);
    drawTrace('left',  'Left',  '#2563eb', PT + traceH * 1.5);
  }, [fields]);

  return (
    <canvas
      ref={canvasRef}
      data-testid="abr-waveform-canvas"
      style={{ width: '100%', height: `${height}px`, display: 'block' }}
    />
  );
};

export default ABRWaveformCanvas;
