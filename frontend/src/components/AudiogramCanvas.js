import React, { useRef, useEffect, useState } from 'react';

const AudiogramCanvas = ({ ear, data, onPlotPoint, activeMode, masked, noResponse, extendedFrequency = false, onClearAudiogram, onDeletePoint, ghostData = null, ghostLabel = null }) => {
  const canvasRef = useRef(null);
  const [hoveredPoint, setHoveredPoint] = useState(null);
  const [contextMenu, setContextMenu] = useState(null);
  const [contextFrequency, setContextFrequency] = useState(null);
  const [contextDb, setContextDb] = useState(null);

  // ---- Pinch-to-zoom & pan (mobile precision plotting) --------------------
  // CSS transform keeps this simple: we scale/translate the canvas element,
  // and translate incoming click coordinates back to the logical canvas
  // coordinate space using the ratio canvas.offsetWidth / rect.width (which
  // is transform-agnostic). Zoom is clamped [1, 4].
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const gestureRef = useRef({
    // Set on 2-finger touchstart to remember initial pinch distance + zoom.
    initialPinchDistance: 0,
    initialZoom: 1,
    // Set on 1-finger touchstart while zoomed to remember pan drag origin.
    panStart: null,
    // Set to true whenever any touch caused movement, so we suppress the
    // synthetic `click` event that fires on touchend and would otherwise
    // drop a stray audiogram point where the user was pinching.
    movedDuringTouch: false,
  });

  const clampPan = (nextPan, nextZoom) => {
    // Prevent the user from panning the canvas completely off-screen.
    const canvas = canvasRef.current;
    if (!canvas) return nextPan;
    const w = canvas.offsetWidth || 1;
    const h = canvas.offsetHeight || 1;
    const maxX = Math.max(0, (nextZoom - 1) * w) / nextZoom;
    const maxY = Math.max(0, (nextZoom - 1) * h) / nextZoom;
    return {
      x: Math.max(-maxX, Math.min(0, nextPan.x)),
      y: Math.max(-maxY, Math.min(0, nextPan.y)),
    };
  };

  const applyZoom = (nextZoom) => {
    const clamped = Math.max(1, Math.min(4, nextZoom));
    setZoom(clamped);
    setPan((p) => clampPan(p, clamped));
  };
  const resetZoom = () => { setZoom(1); setPan({ x: 0, y: 0 }); };
  
  // Standard octave frequencies (major - with labels)
  const standardMajorFreqs = [125, 250, 500, 1000, 2000, 4000, 8000];
  const extendedMajorFreqs = [125, 250, 500, 1000, 2000, 4000, 8000, 10000, 12500, 16000];
  
  // Mid-frequencies (dotted lines at halfway points - NO labels)
  const standardMidFreqs = [750, 1500, 3000, 6000];
  const extendedMidFreqs = [750, 1500, 3000, 6000];
  
  // All frequencies for plotting and grid
  const standardAllFreqs = [...standardMajorFreqs, ...standardMidFreqs].sort((a, b) => a - b);
  const extendedAllFreqs = [...extendedMajorFreqs, ...extendedMidFreqs].sort((a, b) => a - b);
  
  const majorFrequencies = extendedFrequency ? extendedMajorFreqs : standardMajorFreqs;
  const midFrequencies = extendedFrequency ? extendedMidFreqs : standardMidFreqs;
  const frequencies = extendedFrequency ? extendedAllFreqs : standardAllFreqs;
  
  // All dB levels for grid lines (5 dB precision)
  const allDbLevels = Array.from({ length: 27 }, (_, i) => -10 + i * 5);
  
  // Major dB levels for labels (10 dB steps for readability)
  const majorDbLevels = Array.from({ length: 14 }, (_, i) => -10 + i * 10);
  
  const dbLevels = allDbLevels;

  // Helper function for logarithmic positioning - defined at component level
  const getLogPosition = (freq) => {
    const minFreq = frequencies[0];
    const maxFreq = frequencies[frequencies.length - 1];
    const logRatio = (Math.log10(freq) - Math.log10(minFreq)) / (Math.log10(maxFreq) - Math.log10(minFreq));
    return logRatio;
  };
  
  const colors = {
    right: { main: '#DC3545', light: '#FFE5E5' },
    left: { main: '#007BFF', light: '#E5F2FF' },
  };

  const color = colors[ear];

  // ---- Responsive padding helper (shared by draw + click handlers) --------
  // On phones (< 480 px) we widen the padding so the bigger axis labels have
  // room to breathe. Both the useEffect drawing loop and the click / context
  // menu handlers must agree on this number, else taps land on the wrong
  // frequency/dB.
  const getPadding = (canvasWidth) => (
    canvasWidth < 480
      ? { top: 22, right: 22, bottom: 52, left: 60 }
      : { top: 20, right: 20, bottom: 40, left: 50 }
  );

  // Force re-draw on window resize (rotation, split-screen, browser resize).
  const [, setResizeTick] = useState(0);
  useEffect(() => {
    const onResize = () => setResizeTick((n) => n + 1);
    window.addEventListener('resize', onResize);
    window.addEventListener('orientationchange', onResize);
    return () => {
      window.removeEventListener('resize', onResize);
      window.removeEventListener('orientationchange', onResize);
    };
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    // IMPORTANT: use offsetWidth/Height (pre-CSS-transform layout size), not
    // getBoundingClientRect (post-transform). Otherwise a pinch-zoom to 2×
    // would balloon the internal buffer to 4× memory + trigger a re-draw
    // loop that fights the CSS transform.
    const layoutW = canvas.offsetWidth;
    const layoutH = canvas.offsetHeight;
    if (!layoutW || !layoutH) return;

    // Set canvas resolution for high quality
    canvas.width = layoutW * window.devicePixelRatio;
    canvas.height = layoutH * window.devicePixelRatio;
    ctx.scale(window.devicePixelRatio, window.devicePixelRatio);

    const width = layoutW;
    const height = layoutH;

    // ---- Responsive typography ---------------------------------------------
    // On a phone (canvas < 480px wide) the 10px light-grey axis labels get
    // physically ~2mm tall and disappear under bright lighting. Scale up the
    // font size, darken the ink, add a subtle stroke halo so the numbers
    // remain readable against the pale grid lines, and give the axis labels
    // more breathing room in the padding zones.
    const isCompact = width < 480;
    const axisFontSize = isCompact ? 13 : 10;
    const axisFontWeight = isCompact ? 'bold' : 'normal';
    const axisColour = isCompact ? '#0f172a' : '#666';   // near-black on mobile
    const padding = getPadding(width);

    const chartWidth = width - padding.left - padding.right;
    const chartHeight = height - padding.top - padding.bottom;

    // Clear canvas
    ctx.clearRect(0, 0, width, height);

    // Draw grid
    ctx.strokeStyle = '#e0e0e0';
    ctx.lineWidth = 0.5;

    // Horizontal lines (dB levels) - draw all for 5dB precision
    allDbLevels.forEach((db, i) => {
      const y = padding.top + (i / (allDbLevels.length - 1)) * chartHeight;
      const isMajor = majorDbLevels.includes(db);

      // Draw grid line
      ctx.strokeStyle = isMajor ? '#d0d0d0' : '#f0f0f0'; // Darker for major, lighter for minor
      ctx.lineWidth = isMajor ? 0.8 : 0.3;
      ctx.beginPath();
      ctx.moveTo(padding.left, y);
      ctx.lineTo(padding.left + chartWidth, y);
      ctx.stroke();

      // Y-axis labels - only for major intervals (10 dB)
      if (isMajor) {
        ctx.fillStyle = axisColour;
        ctx.font = `${axisFontWeight} ${axisFontSize}px Arial`;
        ctx.textAlign = 'right';
        ctx.fillText(db.toString(), padding.left - 10, y + 4);
      }
    });

    // Vertical lines (frequencies) - logarithmic spacing
    frequencies.forEach((freq) => {
      const logPos = getLogPosition(freq);
      const x = padding.left + logPos * chartWidth;
      const isMajor = majorFrequencies.includes(freq);

      // Set line style
      if (isMajor) {
        // Solid line for major frequencies
        ctx.strokeStyle = '#d0d0d0';
        ctx.lineWidth = 0.8;
        ctx.setLineDash([]);
      } else {
        // Dotted line for mid-frequencies
        ctx.strokeStyle = '#e0e0e0';
        ctx.lineWidth = 0.5;
        ctx.setLineDash([2, 2]);
      }

      ctx.beginPath();
      ctx.moveTo(x, padding.top);
      ctx.lineTo(x, padding.top + chartHeight);
      ctx.stroke();
      ctx.setLineDash([]); // Reset

      // X-axis labels - ONLY for major frequencies
      if (isMajor) {
        ctx.fillStyle = axisColour;
        ctx.font = `${axisFontWeight} ${axisFontSize}px Arial`;
        ctx.textAlign = 'center';
        let label;
        if (freq >= 1000) {
          label = freq === 12500 ? '12.5K' : `${freq / 1000}K`;
        } else {
          label = freq.toString();
        }
        ctx.fillText(label, x, height - (isCompact ? 22 : 18));
      }
    });
    
    // Draw extended frequency background (blue tint) if in extended mode
    if (extendedFrequency && frequencies.length > 10) {
      const extendedStartIndex = 10; // After 8000 Hz
      const extendedX = padding.left + (extendedStartIndex / (frequencies.length - 1)) * chartWidth;
      const extendedWidth = chartWidth - (extendedStartIndex / (frequencies.length - 1)) * chartWidth;
      
      ctx.fillStyle = 'rgba(173, 216, 230, 0.15)'; // Light blue tint
      ctx.fillRect(extendedX, padding.top, extendedWidth, chartHeight);
    }
    
    // Draw border
    ctx.strokeStyle = '#666';
    ctx.lineWidth = 1.5;
    ctx.strokeRect(padding.left, padding.top, chartWidth, chartHeight);
    
    // Helper function to get canvas coordinates with logarithmic X-axis
    const getCoords = (freq, db) => {
      const freqIndex = frequencies.indexOf(freq);
      const dbIndex = dbLevels.indexOf(db);
      
      if (freqIndex === -1 || dbIndex === -1) return null;
      
      // Use logarithmic positioning for X coordinate
      const logPos = getLogPosition(freq);
      const x = padding.left + logPos * chartWidth;
      const y = padding.top + (dbIndex / (dbLevels.length - 1)) * chartHeight;
      
      return { x, y };
    };
    
    // Helper: draw diagonal "No Response" arrow attached to a symbol.
    // Right ear -> arrow points down-left (↙); Left ear -> down-right (↘).
    // Arrow is isolated and never connected to other points via a line.
    const drawNRArrow = (ctx, x, y, earSide, strokeColor) => {
      ctx.strokeStyle = strokeColor;
      ctx.fillStyle = strokeColor;
      ctx.lineWidth = 2;
      ctx.setLineDash([]);
      
      const shaftLen = 16;
      const headLen = 6;
      const diag = Math.SQRT1_2; // cos(45°) = sin(45°)
      
      // Start just outside the symbol edge (~7px)
      const offset = 7;
      let startX, startY, dx, dy;
      if (earSide === 'right') {
        // ↙ down-left
        startX = x - offset * diag;
        startY = y + offset * diag;
        dx = -diag;
        dy = diag;
      } else {
        // ↘ down-right
        startX = x + offset * diag;
        startY = y + offset * diag;
        dx = diag;
        dy = diag;
      }
      const endX = startX + shaftLen * dx;
      const endY = startY + shaftLen * dy;
      
      // Shaft
      ctx.beginPath();
      ctx.moveTo(startX, startY);
      ctx.lineTo(endX, endY);
      ctx.stroke();
      
      // Arrow head (two short strokes from tip)
      const angle = Math.atan2(dy, dx);
      const spread = Math.PI / 6; // 30°
      ctx.beginPath();
      ctx.moveTo(endX, endY);
      ctx.lineTo(
        endX - headLen * Math.cos(angle - spread),
        endY - headLen * Math.sin(angle - spread)
      );
      ctx.moveTo(endX, endY);
      ctx.lineTo(
        endX - headLen * Math.cos(angle + spread),
        endY - headLen * Math.sin(angle + spread)
      );
      ctx.stroke();
    };
    
    // Helper: draw connecting polyline that lifts the pen at any NR point,
    // so NR points are never joined to adjacent thresholds.
    const drawConnectingLine = (points, dashed = false) => {
      ctx.strokeStyle = color.main;
      ctx.lineWidth = 2.5;
      if (dashed) ctx.setLineDash([5, 3]); else ctx.setLineDash([]);
      ctx.beginPath();
      let penUp = true;
      points.forEach((point) => {
        const coords = getCoords(point.freq, point.db);
        if (!coords) return;
        if (point.no_response) {
          penUp = true;
          return;
        }
        if (penUp) {
          ctx.moveTo(coords.x, coords.y);
          penUp = false;
        } else {
          ctx.lineTo(coords.x, coords.y);
        }
      });
      ctx.stroke();
      ctx.setLineDash([]);
    };
    
    // ==================== GHOST OVERLAY (previous visit) ====================
    // Drawn BEFORE current-session AC/BC so real thresholds always render on top.
    if (ghostData && (ghostData.ac_measurements?.length || ghostData.bc_measurements?.length)) {
      const drawGhostChannel = (measurements, dashed) => {
        if (!measurements || measurements.length === 0) return;
        const pts = measurements
          .filter((m) => m.threshold_db !== null && m.threshold_db !== undefined && !m.no_response)
          .map((m) => ({ freq: m.frequency, db: m.threshold_db }))
          .sort((a, b) => a.freq - b.freq);
        if (pts.length === 0) return;

        ctx.save();
        ctx.globalAlpha = 0.55;
        ctx.strokeStyle = '#6b7280';  // neutral grey — de-emphasises past data vs ear-coloured current
        ctx.fillStyle = '#ffffff';
        ctx.lineWidth = 1.5;
        ctx.setLineDash(dashed ? [3, 3] : [5, 3]);

        // Connecting polyline
        ctx.beginPath();
        pts.forEach((p, i) => {
          const c = getCoords(p.freq, p.db);
          if (!c) return;
          if (i === 0) ctx.moveTo(c.x, c.y);
          else ctx.lineTo(c.x, c.y);
        });
        ctx.stroke();
        ctx.setLineDash([]);

        // Small hollow circles at each threshold
        pts.forEach((p) => {
          const c = getCoords(p.freq, p.db);
          if (!c) return;
          ctx.beginPath();
          ctx.arc(c.x, c.y, 3, 0, Math.PI * 2);
          ctx.fillStyle = '#ffffff';
          ctx.fill();
          ctx.stroke();
        });
        ctx.restore();
      };
      drawGhostChannel(ghostData.ac_measurements, false);
      drawGhostChannel(ghostData.bc_measurements, true);

      // Ghost label — small badge top-left of chart area
      if (ghostLabel) {
        ctx.save();
        ctx.globalAlpha = 0.85;
        ctx.font = 'italic 9px Arial';
        ctx.fillStyle = '#6b7280';
        ctx.textAlign = 'left';
        ctx.textBaseline = 'top';
        ctx.fillText(`◌ prev: ${ghostLabel}`, padding.left + 4, padding.top + 2);
        ctx.restore();
      }
    }

    // Draw AC line and symbols
    if (data && data.ac_measurements && data.ac_measurements.length > 0) {
      const acPoints = data.ac_measurements
        .filter(m => m.threshold_db !== null && m.threshold_db !== undefined)
        .map(m => ({
          freq: m.frequency,
          db: m.threshold_db,
          masked: m.masked,
          no_response: m.no_response === true,
        }))
        .sort((a, b) => a.freq - b.freq);
      
      if (acPoints.length > 0) {
        // Connecting line (skips NR points entirely)
        drawConnectingLine(acPoints, false);
        
        // Draw symbols
        acPoints.forEach((point) => {
          const coords = getCoords(point.freq, point.db);
          if (!coords) return;
          
          ctx.strokeStyle = color.main;
          ctx.fillStyle = point.masked ? color.main : 'transparent';
          ctx.lineWidth = 2.5;
          
          if (point.masked) {
            // Masked AC: filled triangle (right) or square (left)
            if (ear === 'right') {
              ctx.beginPath();
              ctx.moveTo(coords.x, coords.y - 6);
              ctx.lineTo(coords.x + 6, coords.y + 6);
              ctx.lineTo(coords.x - 6, coords.y + 6);
              ctx.closePath();
              ctx.fill();
              ctx.stroke();
            } else {
              ctx.fillRect(coords.x - 5, coords.y - 5, 10, 10);
              ctx.strokeRect(coords.x - 5, coords.y - 5, 10, 10);
            }
          } else {
            // Unmasked AC: circle (right) or X (left)
            if (ear === 'right') {
              ctx.beginPath();
              ctx.arc(coords.x, coords.y, 6, 0, Math.PI * 2);
              ctx.stroke();
            } else {
              ctx.beginPath();
              ctx.moveTo(coords.x - 6, coords.y - 6);
              ctx.lineTo(coords.x + 6, coords.y + 6);
              ctx.moveTo(coords.x + 6, coords.y - 6);
              ctx.lineTo(coords.x - 6, coords.y + 6);
              ctx.stroke();
            }
          }
          
          // Attach diagonal NR arrow when no response
          if (point.no_response) {
            drawNRArrow(ctx, coords.x, coords.y, ear, color.main);
          }
        });
      }
    }
    
    // Draw BC line and symbols
    if (data && data.bc_measurements && data.bc_measurements.length > 0) {
      const bcPoints = data.bc_measurements
        .filter(m => m.threshold_db !== null && m.threshold_db !== undefined)
        .map(m => ({
          freq: m.frequency,
          db: m.threshold_db,
          masked: m.masked,
          no_response: m.no_response === true,
        }))
        .sort((a, b) => a.freq - b.freq);
      
      if (bcPoints.length > 0) {
        // Connecting line (dashed, skips NR points entirely)
        drawConnectingLine(bcPoints, true);
        
        // Draw symbols
        bcPoints.forEach((point) => {
          const coords = getCoords(point.freq, point.db);
          if (!coords) return;
          
          ctx.fillStyle = color.main;
          ctx.strokeStyle = color.main;
          ctx.lineWidth = 2.5;
          ctx.font = 'bold 15px Arial';
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          
          if (point.masked) {
            ctx.fillText(ear === 'right' ? '[' : ']', coords.x, coords.y);
          } else {
            ctx.fillText(ear === 'right' ? '<' : '>', coords.x, coords.y);
          }
          
          // Attach diagonal NR arrow when no response
          if (point.no_response) {
            drawNRArrow(ctx, coords.x, coords.y, ear, color.main);
          }
        });
      }
    }
    
    // Draw MCL measurements (Most Comfortable Level)
    if (data && data.mcl_measurements && data.mcl_measurements.length > 0) {
      data.mcl_measurements.forEach(m => {
        if (m.threshold_db === null || m.threshold_db === undefined) return;
        const coords = getCoords(m.frequency, m.threshold_db);
        if (!coords) return;
        
        ctx.fillStyle = color.main;
        ctx.font = 'bold 12px Arial';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('M', coords.x, coords.y);
      });
    }
    
    // Draw UCL measurements (Uncomfortable Loudness Level)
    if (data && data.ucl_measurements && data.ucl_measurements.length > 0) {
      data.ucl_measurements.forEach(m => {
        if (m.threshold_db === null || m.threshold_db === undefined) return;
        const coords = getCoords(m.frequency, m.threshold_db);
        if (!coords) return;
        
        ctx.fillStyle = color.main;
        ctx.font = 'bold 12px Arial';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(ear === 'right' ? 'L' : 'J', coords.x, coords.y);
      });
    }
    
    // Draw FF measurements (Field Free)
    if (data && data.ff_measurements && data.ff_measurements.length > 0) {
      data.ff_measurements.forEach(m => {
        if (m.threshold_db === null || m.threshold_db === undefined) return;
        const coords = getCoords(m.frequency, m.threshold_db);
        if (!coords) return;
        
        ctx.strokeStyle = color.main;
        ctx.lineWidth = 2.5;
        
        if (ear === 'right') {
          // Circle
          ctx.beginPath();
          ctx.arc(coords.x, coords.y, 6, 0, Math.PI * 2);
          ctx.stroke();
        } else {
          // X
          ctx.beginPath();
          ctx.moveTo(coords.x - 6, coords.y - 6);
          ctx.lineTo(coords.x + 6, coords.y + 6);
          ctx.moveTo(coords.x + 6, coords.y - 6);
          ctx.lineTo(coords.x - 6, coords.y + 6);
          ctx.stroke();
        }
      });
    }
    
    // Draw FF-A measurements (Field Free Aided)
    if (data && data.ffa_measurements && data.ffa_measurements.length > 0) {
      data.ffa_measurements.forEach(m => {
        if (m.threshold_db === null || m.threshold_db === undefined) return;
        const coords = getCoords(m.frequency, m.threshold_db);
        if (!coords) return;
        
        ctx.strokeStyle = color.main;
        ctx.lineWidth = 2.5;
        
        // Diamond symbol (◊)
        ctx.beginPath();
        ctx.moveTo(coords.x, coords.y - 6);
        ctx.lineTo(coords.x + 6, coords.y);
        ctx.lineTo(coords.x, coords.y + 6);
        ctx.lineTo(coords.x - 6, coords.y);
        ctx.closePath();
        ctx.stroke();
      });
    }
    
  }, [data, ear, color, ghostData, ghostLabel, extendedFrequency]);
  
  const handleCanvasClick = (e) => {
    if (!onPlotPoint) return;
    // If the user was pinching / panning, ignore the synthetic click that
    // fires when the last finger lifts — else a stray point lands on the
    // audiogram at the release position.
    if (gestureRef.current.movedDuringTouch) {
      gestureRef.current.movedDuringTouch = false;
      return;
    }

    // Close context menu if open
    setContextMenu(null);

    const canvas = canvasRef.current;
    const rect = canvas.getBoundingClientRect();
    // Convert screen click back to LOGICAL canvas coordinates. `rect` is
    // post-CSS-transform; `canvas.offsetWidth/Height` is pre-transform.
    // This ratio bakes in any pinch-zoom scale automatically.
    const scaleX = canvas.offsetWidth / rect.width;
    const scaleY = canvas.offsetHeight / rect.height;
    const x = (e.clientX - rect.left) * scaleX;
    const y = (e.clientY - rect.top) * scaleY;

    const padding = getPadding(canvas.offsetWidth);
    const chartWidth = canvas.offsetWidth - padding.left - padding.right;
    const chartHeight = canvas.offsetHeight - padding.top - padding.bottom;

    if (x < padding.left || x > canvas.offsetWidth - padding.right || y < padding.top || y > canvas.offsetHeight - padding.bottom) {
      return;
    }
    
    const freqRatio = (x - padding.left) / chartWidth;
    
    // Find closest frequency using logarithmic spacing
    let closestFreq = frequencies[0];
    let minDiff = Math.abs(getLogPosition(frequencies[0]) - freqRatio);
    
    frequencies.forEach(freq => {
      const diff = Math.abs(getLogPosition(freq) - freqRatio);
      if (diff < minDiff) {
        minDiff = diff;
        closestFreq = freq;
      }
    });
    
    const frequency = closestFreq;
    
    const dbRatio = (y - padding.top) / chartHeight;
    const dbIndex = Math.round(dbRatio * (dbLevels.length - 1));
    const db = dbLevels[dbIndex];
    
    onPlotPoint(frequency, db);
  };
  
  const handleContextMenu = (e) => {
    e.preventDefault();

    const canvas = canvasRef.current;
    const rect = canvas.getBoundingClientRect();
    // Same transform-inverse math as handleCanvasClick so right-click on a
    // zoomed audiogram still lands on the right point.
    const scaleX = canvas.offsetWidth / rect.width;
    const scaleY = canvas.offsetHeight / rect.height;
    const x = (e.clientX - rect.left) * scaleX;
    const y = (e.clientY - rect.top) * scaleY;

    // Keep consistent with drawing padding (responsive on mobile)
    const padding = getPadding(canvas.offsetWidth);

    // Must be inside chart area
    if (
      x < padding.left ||
      x > canvas.offsetWidth - padding.right ||
      y < padding.top ||
      y > canvas.offsetHeight - padding.bottom
    ) {
      return;
    }

    const chartWidth = canvas.offsetWidth - padding.left - padding.right;
    const chartHeight = canvas.offsetHeight - padding.top - padding.bottom;
    const freqRatio = (x - padding.left) / chartWidth;
    
    // Find closest frequency (log spacing)
    let closestFreq = frequencies[0];
    let minDiff = Math.abs(getLogPosition(frequencies[0]) - freqRatio);
    frequencies.forEach(freq => {
      const diff = Math.abs(getLogPosition(freq) - freqRatio);
      if (diff < minDiff) {
        minDiff = diff;
        closestFreq = freq;
      }
    });
    
    // Find closest dB level under cursor (snaps to 5 dB grid)
    const dbRatio = (y - padding.top) / chartHeight;
    const dbIndex = Math.max(0, Math.min(dbLevels.length - 1, Math.round(dbRatio * (dbLevels.length - 1))));
    const closestDb = dbLevels[dbIndex];
    
    setContextFrequency(closestFreq);
    setContextDb(closestDb);
    setContextMenu({ x: e.clientX, y: e.clientY });
  };
  
  const handleClearAudiogram = () => {
    if (onClearAudiogram) {
      onClearAudiogram(ear);
    }
    setContextMenu(null);
  };
  
  const handlePlotNoResponse = () => {
    if (onPlotPoint && contextFrequency !== null && contextDb !== null) {
      // Plot NR at the exact dB where the user right-clicked
      onPlotPoint(contextFrequency, contextDb, true);
    }
    setContextMenu(null);
  };
  
  const handleDeletePointClick = () => {
    if (onDeletePoint && contextFrequency) {
      onDeletePoint(ear, contextFrequency);
    }
    setContextMenu(null);
  };
  
  // Close context menu when clicking outside
  useEffect(() => {
    const handleClickOutside = () => setContextMenu(null);
    if (contextMenu) {
      document.addEventListener('click', handleClickOutside);
      return () => document.removeEventListener('click', handleClickOutside);
    }
  }, [contextMenu]);

  // ---- Touch handlers for pinch-zoom + pan --------------------------------
  const distance = (t1, t2) => Math.hypot(t2.clientX - t1.clientX, t2.clientY - t1.clientY);

  const handleTouchStart = (e) => {
    if (e.touches.length === 2) {
      // Two fingers: begin pinch
      gestureRef.current.initialPinchDistance = distance(e.touches[0], e.touches[1]);
      gestureRef.current.initialZoom = zoom;
      gestureRef.current.panStart = null;
      gestureRef.current.movedDuringTouch = false;
    } else if (e.touches.length === 1 && zoom > 1) {
      // One finger while zoomed: begin pan drag
      gestureRef.current.panStart = {
        x: e.touches[0].clientX,
        y: e.touches[0].clientY,
        pan: { ...pan },
      };
      gestureRef.current.movedDuringTouch = false;
    } else {
      gestureRef.current.movedDuringTouch = false;
    }
  };

  const handleTouchMove = (e) => {
    if (e.touches.length === 2 && gestureRef.current.initialPinchDistance > 0) {
      const d = distance(e.touches[0], e.touches[1]);
      const nextZoom = gestureRef.current.initialZoom * (d / gestureRef.current.initialPinchDistance);
      applyZoom(nextZoom);
      gestureRef.current.movedDuringTouch = true;
      e.preventDefault();
    } else if (e.touches.length === 1 && gestureRef.current.panStart && zoom > 1) {
      const start = gestureRef.current.panStart;
      const dx = e.touches[0].clientX - start.x;
      const dy = e.touches[0].clientY - start.y;
      // Divide by zoom so panning feels 1:1 with finger movement.
      const next = { x: start.pan.x + dx / zoom, y: start.pan.y + dy / zoom };
      setPan(clampPan(next, zoom));
      if (Math.abs(dx) > 5 || Math.abs(dy) > 5) gestureRef.current.movedDuringTouch = true;
      e.preventDefault();
    }
  };

  const handleTouchEnd = () => {
    gestureRef.current.initialPinchDistance = 0;
    gestureRef.current.panStart = null;
    // movedDuringTouch is checked by handleCanvasClick then cleared there.
  };

  const handleWheel = (e) => {
    // Ctrl/Cmd + wheel = zoom on desktop (matches Figma / VS Code convention).
    if (!(e.ctrlKey || e.metaKey)) return;
    e.preventDefault();
    const delta = -e.deltaY * 0.005;
    applyZoom(zoom * (1 + delta));
  };

  return (
    <div className="relative w-full h-full overflow-hidden" data-testid="audiogram-canvas-wrap">
      <canvas
        ref={canvasRef}
        onClick={handleCanvasClick}
        onContextMenu={handleContextMenu}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
        onWheel={handleWheel}
        className="w-full border border-gray-400 bg-white cursor-crosshair touch-manipulation"
        // On phones the parent AudiogramPanel is scrolled inside a stack of
        // other cards, so h-full collapses to zero. Enforce a minimum of
        // 340px (≈ 6× axis label height) so the audiogram never renders
        // unreadably small.
        style={{
          width: '100%',
          height: '100%',
          minHeight: '340px',
          transform: `scale(${zoom}) translate(${pan.x}px, ${pan.y}px)`,
          transformOrigin: '0 0',
          transition: gestureRef.current.initialPinchDistance || gestureRef.current.panStart
            ? 'none' : 'transform 120ms ease-out',
          touchAction: 'none',   // let JS own pinch/pan
        }}
      />

      {/* Zoom controls — visible only when the audiogram is interactive */}
      {onPlotPoint && (
        <div
          className="absolute top-2 right-2 flex flex-col gap-1 bg-white/95 border border-gray-300 rounded shadow-sm p-1 z-10"
          data-testid="audiogram-zoom-controls"
        >
          <button
            type="button"
            onClick={() => applyZoom(zoom * 1.4)}
            disabled={zoom >= 4}
            className="w-8 h-8 text-lg font-semibold text-gray-700 hover:bg-gray-100 rounded disabled:opacity-40"
            title="Zoom in (or pinch)"
            data-testid="audiogram-zoom-in"
          >+</button>
          <button
            type="button"
            onClick={() => applyZoom(zoom / 1.4)}
            disabled={zoom <= 1}
            className="w-8 h-8 text-lg font-semibold text-gray-700 hover:bg-gray-100 rounded disabled:opacity-40"
            title="Zoom out"
            data-testid="audiogram-zoom-out"
          >−</button>
          <button
            type="button"
            onClick={resetZoom}
            disabled={zoom === 1 && pan.x === 0 && pan.y === 0}
            className="w-8 h-7 text-[10px] font-bold text-gray-700 hover:bg-gray-100 rounded disabled:opacity-40"
            title="Fit"
            data-testid="audiogram-zoom-fit"
          >FIT</button>
          {zoom > 1.05 && (
            <div className="text-[10px] text-center text-slate-500 font-mono" data-testid="audiogram-zoom-level">
              {zoom.toFixed(1)}×
            </div>
          )}
        </div>
      )}
      
      {/* Context Menu */}
      {contextMenu && (
        <div 
          className="fixed bg-white border border-gray-400 shadow-lg rounded py-1 z-50"
          style={{ left: contextMenu.x, top: contextMenu.y, minWidth: '180px' }}
          onClick={(e) => e.stopPropagation()}
        >
          <button
            onClick={handleClearAudiogram}
            className="w-full px-4 py-2 text-left text-sm hover:bg-gray-100 text-gray-700 font-medium"
          >
            Clear Audiogram
          </button>
          <button
            onClick={handlePlotNoResponse}
            className="w-full px-4 py-2 text-left text-sm hover:bg-gray-100 text-gray-700"
          >
            Plot No Response @ {contextFrequency}Hz, {contextDb}dB HL
          </button>
          <button
            onClick={handleDeletePointClick}
            className="w-full px-4 py-2 text-left text-sm hover:bg-gray-100 text-red-600"
          >
            Delete Point @ {contextFrequency}Hz
          </button>
        </div>
      )}
    </div>
  );
};

export default AudiogramCanvas;
