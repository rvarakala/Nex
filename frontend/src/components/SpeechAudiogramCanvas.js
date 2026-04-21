import React, { useEffect, useRef } from 'react';

/**
 * Speech Audiogram (%SR / %SD vs dB HL).
 *
 * X-axis : -10 … 120 dB HL (grid every 10 dB, labels every 10)
 * Y-axis : 0 … 100% SR on the LEFT, 0 … 100% SD on the RIGHT
 *
 * Background features:
 *   • Reference curves `m` (masked normal) and `s` (standard/unmasked normal) —
 *     thin logistic S-curves between ~0 and ~45 dB.
 *   • Pink "beyond-comfort" rectangle from 90 dB to 120 dB.
 *
 * Points for each channel are plotted as circles, coloured by ear
 *   right = red · left = blue · soundfield = green · aided = magenta
 * and connected with polyline in ascending dB order.
 *
 * Optional click-to-add via `onAddPoint(dB, percent)`.
 */
const COLORS = {
  right: '#dc2626',
  left: '#2563eb',
  soundfield: '#16a34a',
  soundfield_aided: '#be185d',
};

const SpeechAudiogramCanvas = ({
  points = { right: [], left: [], soundfield: [], soundfield_aided: [] },
  enabledChannels = { right: true, left: true, soundfield: false, soundfield_aided: false },
  activeChannel = 'right',
  onAddPoint, // (db_hl, percent) => void
}) => {
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

    const PL = 42, PR = 42, PT = 16, PB = 30;
    const plotW = W - PL - PR;
    const plotH = H - PT - PB;

    const X_MIN = -10, X_MAX = 120;
    const Y_MIN = 0, Y_MAX = 100;

    const xToPx = (db) => PL + ((db - X_MIN) / (X_MAX - X_MIN)) * plotW;
    const yToPx = (pct) => PT + plotH - ((pct - Y_MIN) / (Y_MAX - Y_MIN)) * plotH;
    const pxToX = (px) => X_MIN + ((px - PL) / plotW) * (X_MAX - X_MIN);
    const pxToY = (py) => Y_MAX - ((py - PT) / plotH) * (Y_MAX - Y_MIN);

    // Background
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(PL, PT, plotW, plotH);

    // Pink "beyond-comfort" region (90 … 120 dB)
    ctx.fillStyle = 'rgba(239, 68, 68, 0.20)';
    ctx.fillRect(xToPx(90), PT, xToPx(120) - xToPx(90), plotH);

    // Grid
    ctx.strokeStyle = '#e5e7eb';
    ctx.lineWidth = 0.5;
    for (let db = -10; db <= 120; db += 10) {
      const x = xToPx(db);
      ctx.beginPath(); ctx.moveTo(x, PT); ctx.lineTo(x, PT + plotH); ctx.stroke();
    }
    for (let pct = 0; pct <= 100; pct += 10) {
      const y = yToPx(pct);
      ctx.beginPath(); ctx.moveTo(PL, y); ctx.lineTo(PL + plotW, y); ctx.stroke();
    }

    // Axes
    ctx.strokeStyle = '#374151';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(PL, PT); ctx.lineTo(PL, PT + plotH); ctx.lineTo(PL + plotW, PT + plotH);
    ctx.moveTo(PL + plotW, PT); ctx.lineTo(PL + plotW, PT + plotH);
    ctx.stroke();

    // X-axis labels (dB HL)
    ctx.fillStyle = '#374151';
    ctx.font = '9px Arial';
    ctx.textAlign = 'center';
    for (let db = -10; db <= 120; db += 10) {
      ctx.fillText(String(db), xToPx(db), PT + plotH + 12);
    }
    ctx.fillStyle = '#6b7280';
    ctx.fillText('dB HL', PL + plotW - 18, PT + plotH + 24);

    // Y-axis labels — LEFT (%SR) and RIGHT (%SD mirrored)
    ctx.fillStyle = '#374151';
    ctx.textAlign = 'right';
    for (let pct = 0; pct <= 100; pct += 10) {
      ctx.fillText(String(pct), PL - 4, yToPx(pct) + 3);
    }
    ctx.fillStyle = '#6b7280';
    ctx.textAlign = 'left';
    ctx.fillText('% SR', 2, PT + 8);

    ctx.fillStyle = '#374151';
    ctx.textAlign = 'left';
    for (let pct = 0; pct <= 100; pct += 10) {
      ctx.fillText(String(100 - pct), PL + plotW + 4, yToPx(pct) + 3);
    }
    ctx.fillStyle = '#6b7280';
    ctx.textAlign = 'right';
    ctx.fillText('% SD', W - 2, PT + 8);

    // Reference S-curves (m, s) — logistic between ~0 and 100%
    const drawReference = (midPoint, label) => {
      ctx.strokeStyle = '#111827';
      ctx.lineWidth = 1;
      ctx.beginPath();
      let first = true;
      for (let db = X_MIN; db <= X_MAX; db += 1) {
        const pct = 100 / (1 + Math.exp(-(db - midPoint) / 4));
        const x = xToPx(db);
        const y = yToPx(pct);
        if (first) { ctx.moveTo(x, y); first = false; } else { ctx.lineTo(x, y); }
      }
      ctx.stroke();
      ctx.fillStyle = '#374151';
      ctx.font = '10px Arial';
      ctx.textAlign = 'center';
      ctx.fillText(label, xToPx(midPoint - 4), yToPx(95));
    };
    drawReference(20, 'm'); // masked reference curve (leftmost)
    drawReference(28, 's'); // standard reference curve

    // Draw each channel
    const drawChannel = (channelKey, channelPoints) => {
      if (!enabledChannels[channelKey]) return;
      const colour = COLORS[channelKey];
      const sorted = [...channelPoints].sort((a, b) => a.db_hl - b.db_hl);
      // Polyline
      if (sorted.length > 1) {
        ctx.strokeStyle = colour;
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        sorted.forEach((pt, i) => {
          const x = xToPx(pt.db_hl);
          const y = yToPx(pt.percent);
          if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
        });
        ctx.stroke();
      }
      // Points
      sorted.forEach((pt) => {
        const x = xToPx(pt.db_hl);
        const y = yToPx(pt.percent);
        ctx.strokeStyle = colour;
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.arc(x, y, 4, 0, Math.PI * 2);
        ctx.stroke();
        if (pt.masked) {
          // Draw a small tick inside for masked markers
          ctx.beginPath();
          ctx.moveTo(x - 2, y - 2);
          ctx.lineTo(x + 2, y + 2);
          ctx.stroke();
        }
      });
    };

    drawChannel('right', points.right || []);
    drawChannel('left', points.left || []);
    drawChannel('soundfield', points.soundfield || []);
    drawChannel('soundfield_aided', points.soundfield_aided || []);

    // Click handler
    const handleClick = (e) => {
      if (!onAddPoint) return;
      const rectNow = canvas.getBoundingClientRect();
      const clickX = e.clientX - rectNow.left;
      const clickY = e.clientY - rectNow.top;
      if (clickX < PL || clickX > PL + plotW || clickY < PT || clickY > PT + plotH) return;
      const db = Math.round(pxToX(clickX) / 5) * 5;
      const pct = Math.round(pxToY(clickY) / 10) * 10;
      const clampedDb = Math.max(X_MIN, Math.min(X_MAX, db));
      const clampedPct = Math.max(Y_MIN, Math.min(Y_MAX, pct));
      onAddPoint(clampedDb, clampedPct);
    };
    canvas.addEventListener('click', handleClick);
    return () => canvas.removeEventListener('click', handleClick);
  }, [points, enabledChannels, activeChannel, onAddPoint]);

  return (
    <canvas
      ref={canvasRef}
      data-testid="speech-audiogram-canvas"
      style={{ width: '100%', height: '100%', display: 'block', cursor: onAddPoint ? 'crosshair' : 'default' }}
    />
  );
};

export default SpeechAudiogramCanvas;
