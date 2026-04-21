import React, { useEffect, useRef, useState } from 'react';

/**
 * Speech Audiogram (%SR / %SD vs dB HL).
 *
 * - X-axis  : -10 … 120 dB HL (grid every 10 dB, labels every 10)
 * - Y-axis  : 0 … 100% SR on the LEFT, 0 … 100% SD on the RIGHT
 * - Pink "beyond-comfort" rectangle from 90 dB to 120 dB.
 * - Reference logistic curves `m` and `s`.
 *
 * Symbols match Pure Tone audiometry conventions:
 *   Right   — O (unmasked) / △ (masked) — red
 *   Left    — X (unmasked) / □ (masked) — blue
 *   Soundfield       — S — green
 *   Soundfield Aided — A — magenta
 *
 * Plotting behaviour mirrors Pure Tone:
 *   • Left-click places/replaces a point for the active channel (snap to 5 dB × 10 %).
 *   • Right-click shows a context menu with:
 *       – Plot No Response (NR) at the cursor dB/%
 *       – Delete point at cursor dB
 *       – Clear active channel
 */
const COLOURS = {
  right: '#dc2626',
  left: '#2563eb',
  soundfield: '#16a34a',
  soundfield_aided: '#be185d',
};

// Draw the channel-specific symbol (Pure Tone convention) centred at (x, y).
const drawSymbol = (ctx, x, y, channel, masked) => {
  const c = COLOURS[channel];
  ctx.strokeStyle = c;
  ctx.fillStyle = c;
  ctx.lineWidth = 1.8;

  if (channel === 'right') {
    if (masked) {
      // △ — upright triangle (masked right AC)
      ctx.beginPath();
      ctx.moveTo(x, y - 6);
      ctx.lineTo(x - 6, y + 5);
      ctx.lineTo(x + 6, y + 5);
      ctx.closePath();
      ctx.stroke();
    } else {
      // O — circle (unmasked right AC)
      ctx.beginPath();
      ctx.arc(x, y, 5, 0, Math.PI * 2);
      ctx.stroke();
    }
  } else if (channel === 'left') {
    if (masked) {
      // □ — square (masked left AC)
      ctx.beginPath();
      ctx.rect(x - 5, y - 5, 10, 10);
      ctx.stroke();
    } else {
      // X
      ctx.beginPath();
      ctx.moveTo(x - 5, y - 5);
      ctx.lineTo(x + 5, y + 5);
      ctx.moveTo(x + 5, y - 5);
      ctx.lineTo(x - 5, y + 5);
      ctx.stroke();
    }
  } else if (channel === 'soundfield') {
    // S — bold letter marker
    ctx.font = 'bold 12px Arial';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('S', x, y + 1);
  } else if (channel === 'soundfield_aided') {
    // A — aided soundfield letter marker
    ctx.font = 'bold 12px Arial';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('A', x, y + 1);
  }
};

const SpeechAudiogramCanvas = ({
  points = { right: [], left: [], soundfield: [], soundfield_aided: [] },
  enabledChannels = { right: true, left: true, soundfield: false, soundfield_aided: false },
  activeChannel = 'right',
  masked = false,
  noResponseMode = false,
  onPlotPoint,       // (db_hl, percent, { masked, noResponse }) => void
  onDeletePoint,     // (db_hl) => void
  onClearChannel,    // () => void
}) => {
  const canvasRef = useRef(null);
  const [contextMenu, setContextMenu] = useState(null); // { x, y, db, pct }

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

    // Background + pink beyond-comfort zone
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(PL, PT, plotW, plotH);
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

    // Axes + labels
    ctx.strokeStyle = '#374151'; ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(PL, PT); ctx.lineTo(PL, PT + plotH); ctx.lineTo(PL + plotW, PT + plotH);
    ctx.moveTo(PL + plotW, PT); ctx.lineTo(PL + plotW, PT + plotH);
    ctx.stroke();

    ctx.fillStyle = '#374151'; ctx.font = '9px Arial'; ctx.textAlign = 'center';
    for (let db = -10; db <= 120; db += 10) ctx.fillText(String(db), xToPx(db), PT + plotH + 12);
    ctx.fillStyle = '#6b7280';
    ctx.fillText('dB HL', PL + plotW - 18, PT + plotH + 24);

    ctx.fillStyle = '#374151'; ctx.textAlign = 'right';
    for (let pct = 0; pct <= 100; pct += 10) ctx.fillText(String(pct), PL - 4, yToPx(pct) + 3);
    ctx.fillStyle = '#6b7280'; ctx.textAlign = 'left';
    ctx.fillText('% SR', 2, PT + 8);

    ctx.fillStyle = '#374151'; ctx.textAlign = 'left';
    for (let pct = 0; pct <= 100; pct += 10) ctx.fillText(String(100 - pct), PL + plotW + 4, yToPx(pct) + 3);
    ctx.fillStyle = '#6b7280'; ctx.textAlign = 'right';
    ctx.fillText('% SD', W - 2, PT + 8);

    // Reference logistic S-curves
    const drawRef = (midPoint, label) => {
      ctx.strokeStyle = '#111827'; ctx.lineWidth = 1;
      ctx.beginPath();
      let first = true;
      for (let db = X_MIN; db <= X_MAX; db += 1) {
        const pct = 100 / (1 + Math.exp(-(db - midPoint) / 4));
        const x = xToPx(db); const y = yToPx(pct);
        if (first) { ctx.moveTo(x, y); first = false; } else ctx.lineTo(x, y);
      }
      ctx.stroke();
      ctx.fillStyle = '#374151'; ctx.font = '10px Arial'; ctx.textAlign = 'center';
      ctx.fillText(label, xToPx(midPoint - 4), yToPx(95));
    };
    drawRef(20, 'm');
    drawRef(28, 's');

    // Channel plotting
    const drawChannel = (channelKey, channelPoints) => {
      if (!enabledChannels[channelKey]) return;
      const colour = COLOURS[channelKey];
      const sorted = [...channelPoints].sort((a, b) => a.db_hl - b.db_hl);
      // Connect non-NR points with polyline
      const plotPts = sorted.filter((p) => !p.no_response);
      if (plotPts.length > 1) {
        ctx.strokeStyle = colour; ctx.lineWidth = 1.5;
        ctx.beginPath();
        plotPts.forEach((pt, i) => {
          const x = xToPx(pt.db_hl); const y = yToPx(pt.percent);
          if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
        });
        ctx.stroke();
      }
      // Individual symbols
      sorted.forEach((pt) => {
        const x = xToPx(pt.db_hl); const y = yToPx(pt.percent);
        if (pt.no_response) {
          // NR: down-right arrow beside the symbol (↘)
          drawSymbol(ctx, x, y, channelKey, pt.masked);
          ctx.strokeStyle = colour; ctx.lineWidth = 1.5;
          ctx.beginPath();
          ctx.moveTo(x + 6, y + 6); ctx.lineTo(x + 14, y + 14);
          ctx.moveTo(x + 14, y + 14); ctx.lineTo(x + 10, y + 14);
          ctx.moveTo(x + 14, y + 14); ctx.lineTo(x + 14, y + 10);
          ctx.stroke();
        } else {
          drawSymbol(ctx, x, y, channelKey, pt.masked);
        }
      });
    };

    ['right', 'left', 'soundfield', 'soundfield_aided'].forEach((k) =>
      drawChannel(k, points[k] || [])
    );

    // Helpers that close over the plot area for click/contextmenu handlers.
    const pxToClamped = (e) => {
      const r = canvas.getBoundingClientRect();
      const clickX = e.clientX - r.left;
      const clickY = e.clientY - r.top;
      if (clickX < PL || clickX > PL + plotW || clickY < PT || clickY > PT + plotH) return null;
      const rawDb = X_MIN + ((clickX - PL) / plotW) * (X_MAX - X_MIN);
      const rawPct = Y_MAX - ((clickY - PT) / plotH) * (Y_MAX - Y_MIN);
      const db = Math.round(rawDb / 5) * 5;
      const pct = Math.round(rawPct / 10) * 10;
      return {
        db: Math.max(X_MIN, Math.min(X_MAX, db)),
        pct: Math.max(Y_MIN, Math.min(Y_MAX, pct)),
      };
    };

    const handleClick = (e) => {
      if (!onPlotPoint) return;
      const snap = pxToClamped(e);
      if (!snap) return;
      onPlotPoint(snap.db, snap.pct, { masked, noResponse: noResponseMode });
    };
    const handleCtx = (e) => {
      e.preventDefault();
      const snap = pxToClamped(e);
      if (!snap) return;
      setContextMenu({ x: e.clientX, y: e.clientY, db: snap.db, pct: snap.pct });
    };

    canvas.addEventListener('click', handleClick);
    canvas.addEventListener('contextmenu', handleCtx);
    return () => {
      canvas.removeEventListener('click', handleClick);
      canvas.removeEventListener('contextmenu', handleCtx);
    };
  }, [points, enabledChannels, activeChannel, masked, noResponseMode, onPlotPoint]);

  // Dismiss context menu on outside click
  useEffect(() => {
    if (!contextMenu) return;
    const close = () => setContextMenu(null);
    document.addEventListener('click', close);
    return () => document.removeEventListener('click', close);
  }, [contextMenu]);

  return (
    <div className="relative w-full h-full">
      <canvas
        ref={canvasRef}
        data-testid="speech-audiogram-canvas"
        style={{ width: '100%', height: '100%', display: 'block', cursor: onPlotPoint ? 'crosshair' : 'default' }}
      />
      {contextMenu && (
        <div
          className="fixed bg-white border border-gray-400 shadow-lg rounded py-1 z-50"
          style={{ left: contextMenu.x, top: contextMenu.y, minWidth: '220px' }}
          onClick={(e) => e.stopPropagation()}
        >
          <button
            onClick={() => {
              if (onPlotPoint) onPlotPoint(contextMenu.db, contextMenu.pct, { masked, noResponse: true });
              setContextMenu(null);
            }}
            data-testid="speech-ctx-nr"
            className="w-full px-4 py-2 text-left text-sm hover:bg-gray-100 text-gray-700"
          >
            Plot No Response @ {contextMenu.db} dB, {contextMenu.pct}%
          </button>
          <button
            onClick={() => {
              if (onDeletePoint) onDeletePoint(contextMenu.db);
              setContextMenu(null);
            }}
            data-testid="speech-ctx-delete"
            className="w-full px-4 py-2 text-left text-sm hover:bg-gray-100 text-red-600"
          >
            Delete point @ {contextMenu.db} dB
          </button>
          <button
            onClick={() => {
              if (onClearChannel) onClearChannel();
              setContextMenu(null);
            }}
            data-testid="speech-ctx-clear"
            className="w-full px-4 py-2 text-left text-sm hover:bg-gray-100 text-red-600 font-medium border-t border-gray-200"
          >
            Clear active channel
          </button>
        </div>
      )}
    </div>
  );
};

export default SpeechAudiogramCanvas;
