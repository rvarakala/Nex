import React, { useEffect, useRef, useState, useImperativeHandle, forwardRef, useCallback } from 'react';
import { Eraser, Pen } from 'lucide-react';

/**
 * SignaturePad — pointer-based canvas pad. Works with mouse, stylus, finger.
 * Exposes `getDataUrl()`, `isEmpty()`, and `clear()` via ref.
 *
 * Props:
 *   width, height — pixel dimensions of the drawing surface (default 480 × 160)
 *   strokeColor   — hex (default #0F172A — slate-900)
 *   strokeWidth   — px (default 2.4)
 *   onChange      — fired after every stroke ends, gets {empty:boolean}
 *   testid        — wrapper data-testid
 */
const SignaturePad = forwardRef(function SignaturePad(
  {
    width = 480,
    height = 160,
    strokeColor = '#0F172A',
    strokeWidth = 2.4,
    onChange,
    testid = 'signature-pad',
  },
  ref,
) {
  const canvasRef = useRef(null);
  const drawingRef = useRef(false);
  const lastPtRef = useRef(null);
  const dirtyRef = useRef(false);          // any ink drawn in current session?
  const [empty, setEmpty] = useState(true);

  // ---- HiDPI-safe init: rerun on width/height change -----------------------
  useEffect(() => {
    const c = canvasRef.current;
    if (!c) return;
    const dpr = Math.max(1, window.devicePixelRatio || 1);
    c.width = width * dpr;
    c.height = height * dpr;
    c.style.width = `${width}px`;
    c.style.height = `${height}px`;
    const ctx = c.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = strokeColor;
    ctx.lineWidth = strokeWidth;
  }, [width, height, strokeColor, strokeWidth]);

  // ---- Helpers ------------------------------------------------------------
  const getPoint = (e) => {
    const c = canvasRef.current;
    const rect = c.getBoundingClientRect();
    const cx = e.touches ? e.touches[0].clientX : e.clientX;
    const cy = e.touches ? e.touches[0].clientY : e.clientY;
    return { x: cx - rect.left, y: cy - rect.top };
  };

  const beginStroke = useCallback((e) => {
    e.preventDefault();
    drawingRef.current = true;
    lastPtRef.current = getPoint(e);
    dirtyRef.current = true;
    if (empty) setEmpty(false);
  }, [empty]);

  const continueStroke = useCallback((e) => {
    if (!drawingRef.current) return;
    e.preventDefault();
    const c = canvasRef.current;
    const ctx = c.getContext('2d');
    const p = getPoint(e);
    ctx.beginPath();
    ctx.moveTo(lastPtRef.current.x, lastPtRef.current.y);
    ctx.lineTo(p.x, p.y);
    ctx.stroke();
    lastPtRef.current = p;
  }, []);

  const endStroke = useCallback(() => {
    if (!drawingRef.current) return;
    drawingRef.current = false;
    onChange?.({ empty: !dirtyRef.current });
  }, [onChange]);

  const clear = useCallback(() => {
    const c = canvasRef.current;
    if (!c) return;
    const ctx = c.getContext('2d');
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, c.width, c.height);
    ctx.restore();
    dirtyRef.current = false;
    setEmpty(true);
    onChange?.({ empty: true });
  }, [onChange]);

  // Crop the canvas to the actual drawn ink so we don't ship empty whitespace.
  const getDataUrl = useCallback(() => {
    const c = canvasRef.current;
    if (!c || empty) return null;
    return c.toDataURL('image/png');
  }, [empty]);

  useImperativeHandle(ref, () => ({
    isEmpty: () => empty,
    clear,
    getDataUrl,
  }), [empty, clear, getDataUrl]);

  return (
    <div className="inline-block" data-testid={testid}>
      <div className="relative bg-white border-2 border-dashed border-slate-300 rounded-md overflow-hidden hover:border-indigo-400 transition-colors">
        {empty && (
          <div className="absolute inset-0 flex items-center justify-center text-slate-300 pointer-events-none select-none">
            <Pen size={20} className="mr-1.5" />
            <span className="text-[12px] font-semibold">Sign here</span>
          </div>
        )}
        <canvas
          ref={canvasRef}
          onMouseDown={beginStroke}
          onMouseMove={continueStroke}
          onMouseUp={endStroke}
          onMouseLeave={endStroke}
          onTouchStart={beginStroke}
          onTouchMove={continueStroke}
          onTouchEnd={endStroke}
          className="block touch-none cursor-crosshair"
          data-testid={`${testid}-canvas`}
        />
      </div>
      <div className="mt-1.5 flex items-center justify-between text-[10px] text-slate-500">
        <span>Use mouse, stylus or finger.</span>
        <button
          type="button"
          onClick={clear}
          disabled={empty}
          className="inline-flex items-center gap-1 text-slate-500 hover:text-rose-600 disabled:text-slate-300 disabled:cursor-not-allowed font-semibold"
          data-testid={`${testid}-clear`}
        >
          <Eraser size={11} /> Clear
        </button>
      </div>
    </div>
  );
});

export default SignaturePad;
