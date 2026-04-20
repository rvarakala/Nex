import React, { useRef, useEffect } from 'react';

/**
 * Single overlaid audiogram for report preview (both ears on one chart).
 * Non-interactive. Renders air-conduction symbols + connecting polylines,
 * skips NR points from connecting lines and attaches diagonal NR arrows
 * matching the Pure Tone tab conventions.
 */
const ReportAudiogram = ({ rightEarData, leftEarData }) => {
  const canvasRef = useRef(null);

  const frequencies = [125, 250, 500, 750, 1000, 1500, 2000, 3000, 4000, 6000, 8000];
  const majorFreqs = [125, 250, 500, 1000, 2000, 4000, 8000];
  const dbLevels = Array.from({ length: 27 }, (_, i) => -10 + i * 5);
  const majorDbLevels = Array.from({ length: 14 }, (_, i) => -10 + i * 10);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const rect = canvas.getBoundingClientRect();
    canvas.width = rect.width * window.devicePixelRatio;
    canvas.height = rect.height * window.devicePixelRatio;
    ctx.scale(window.devicePixelRatio, window.devicePixelRatio);

    const W = rect.width;
    const H = rect.height;
    const pad = { top: 24, right: 16, bottom: 32, left: 40 };
    const cw = W - pad.left - pad.right;
    const ch = H - pad.top - pad.bottom;

    ctx.clearRect(0, 0, W, H);

    const getLogX = (freq) => {
      const minF = frequencies[0];
      const maxF = frequencies[frequencies.length - 1];
      const r = (Math.log10(freq) - Math.log10(minF)) / (Math.log10(maxF) - Math.log10(minF));
      return pad.left + r * cw;
    };
    const getY = (db) => {
      const idx = dbLevels.indexOf(db);
      return pad.top + (idx / (dbLevels.length - 1)) * ch;
    };

    // Grid
    dbLevels.forEach((db) => {
      const y = getY(db);
      const major = majorDbLevels.includes(db);
      ctx.strokeStyle = major ? '#c0c0c0' : '#ececec';
      ctx.lineWidth = major ? 0.6 : 0.3;
      ctx.beginPath();
      ctx.moveTo(pad.left, y);
      ctx.lineTo(pad.left + cw, y);
      ctx.stroke();
      if (major) {
        ctx.fillStyle = '#444';
        ctx.font = '9px Arial';
        ctx.textAlign = 'right';
        ctx.fillText(db.toString(), pad.left - 6, y + 3);
      }
    });
    frequencies.forEach((f) => {
      const x = getLogX(f);
      const major = majorFreqs.includes(f);
      ctx.strokeStyle = major ? '#c0c0c0' : '#ececec';
      ctx.lineWidth = major ? 0.6 : 0.3;
      ctx.setLineDash(major ? [] : [2, 2]);
      ctx.beginPath();
      ctx.moveTo(x, pad.top);
      ctx.lineTo(x, pad.top + ch);
      ctx.stroke();
      ctx.setLineDash([]);
      if (major) {
        ctx.fillStyle = '#444';
        ctx.font = '9px Arial';
        ctx.textAlign = 'center';
        const label = f >= 1000 ? `${f / 1000}K` : `${f}`;
        ctx.fillText(label, x, H - 12);
      }
    });
    ctx.strokeStyle = '#666';
    ctx.lineWidth = 1;
    ctx.strokeRect(pad.left, pad.top, cw, ch);

    // Axis titles
    ctx.fillStyle = '#333';
    ctx.font = 'bold 9px Arial';
    ctx.textAlign = 'center';
    ctx.fillText('Frequency (Hz)', pad.left + cw / 2, H - 2);
    ctx.save();
    ctx.translate(10, pad.top + ch / 2);
    ctx.rotate(-Math.PI / 2);
    ctx.fillText('Hearing Level (dB HL)', 0, 0);
    ctx.restore();

    const drawNRArrow = (x, y, earSide, color) => {
      ctx.strokeStyle = color;
      ctx.lineWidth = 1.5;
      const diag = Math.SQRT1_2;
      const offset = 6;
      const shaft = 12;
      const head = 5;
      const dx = earSide === 'right' ? -diag : diag;
      const dy = diag;
      const sx = x + offset * dx;
      const sy = y + offset * dy;
      const ex = sx + shaft * dx;
      const ey = sy + shaft * dy;
      ctx.beginPath();
      ctx.moveTo(sx, sy);
      ctx.lineTo(ex, ey);
      ctx.stroke();
      const ang = Math.atan2(dy, dx);
      const sp = Math.PI / 6;
      ctx.beginPath();
      ctx.moveTo(ex, ey);
      ctx.lineTo(ex - head * Math.cos(ang - sp), ey - head * Math.sin(ang - sp));
      ctx.moveTo(ex, ey);
      ctx.lineTo(ex - head * Math.cos(ang + sp), ey - head * Math.sin(ang + sp));
      ctx.stroke();
    };

    const drawEar = (data, earSide) => {
      if (!data) return;
      const color = earSide === 'right' ? '#DC3545' : '#007BFF';
      // AC line + symbols
      const ac = (data.ac_measurements || [])
        .filter((m) => m.threshold_db !== null && m.threshold_db !== undefined)
        .sort((a, b) => a.frequency - b.frequency);
      if (ac.length) {
        ctx.strokeStyle = color;
        ctx.lineWidth = 2;
        ctx.beginPath();
        let penUp = true;
        ac.forEach((p) => {
          if (!frequencies.includes(p.frequency)) return;
          if (p.no_response) { penUp = true; return; }
          const x = getLogX(p.frequency);
          const y = getY(p.threshold_db);
          if (penUp) { ctx.moveTo(x, y); penUp = false; } else { ctx.lineTo(x, y); }
        });
        ctx.stroke();
        ac.forEach((p) => {
          if (!frequencies.includes(p.frequency)) return;
          const x = getLogX(p.frequency);
          const y = getY(p.threshold_db);
          ctx.strokeStyle = color;
          ctx.fillStyle = p.masked ? color : 'transparent';
          ctx.lineWidth = 2;
          if (p.masked) {
            if (earSide === 'right') {
              ctx.beginPath();
              ctx.moveTo(x, y - 5);
              ctx.lineTo(x + 5, y + 5);
              ctx.lineTo(x - 5, y + 5);
              ctx.closePath();
              ctx.fill();
              ctx.stroke();
            } else {
              ctx.fillRect(x - 4, y - 4, 8, 8);
              ctx.strokeRect(x - 4, y - 4, 8, 8);
            }
          } else {
            if (earSide === 'right') {
              ctx.beginPath();
              ctx.arc(x, y, 5, 0, Math.PI * 2);
              ctx.stroke();
            } else {
              ctx.beginPath();
              ctx.moveTo(x - 5, y - 5);
              ctx.lineTo(x + 5, y + 5);
              ctx.moveTo(x + 5, y - 5);
              ctx.lineTo(x - 5, y + 5);
              ctx.stroke();
            }
          }
          if (p.no_response) drawNRArrow(x, y, earSide, color);
        });
      }
      // BC symbols (dashed line)
      const bc = (data.bc_measurements || [])
        .filter((m) => m.threshold_db !== null && m.threshold_db !== undefined)
        .sort((a, b) => a.frequency - b.frequency);
      if (bc.length) {
        ctx.strokeStyle = color;
        ctx.lineWidth = 1.8;
        ctx.setLineDash([4, 3]);
        ctx.beginPath();
        let penUp = true;
        bc.forEach((p) => {
          if (!frequencies.includes(p.frequency)) return;
          if (p.no_response) { penUp = true; return; }
          const x = getLogX(p.frequency);
          const y = getY(p.threshold_db);
          if (penUp) { ctx.moveTo(x, y); penUp = false; } else { ctx.lineTo(x, y); }
        });
        ctx.stroke();
        ctx.setLineDash([]);
        bc.forEach((p) => {
          if (!frequencies.includes(p.frequency)) return;
          const x = getLogX(p.frequency);
          const y = getY(p.threshold_db);
          ctx.fillStyle = color;
          ctx.font = 'bold 13px Arial';
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          const sym = p.masked
            ? (earSide === 'right' ? '[' : ']')
            : (earSide === 'right' ? '<' : '>');
          ctx.fillText(sym, x, y);
          if (p.no_response) drawNRArrow(x, y, earSide, color);
        });
      }
    };

    drawEar(rightEarData, 'right');
    drawEar(leftEarData, 'left');
  }, [rightEarData, leftEarData]);

  return (
    <canvas
      ref={canvasRef}
      className="w-full h-full border border-gray-400 bg-white"
      style={{ width: '100%', height: '100%' }}
    />
  );
};

export default ReportAudiogram;
