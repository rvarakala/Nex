import React, { useRef, useEffect, useState } from 'react';

const AudiogramCanvas = ({ ear, data, onPlotPoint, activeMode, masked, noResponse, extendedFrequency = false, onClearAudiogram, onDeletePoint }) => {
  const canvasRef = useRef(null);
  const [hoveredPoint, setHoveredPoint] = useState(null);
  const [contextMenu, setContextMenu] = useState(null);
  const [contextFrequency, setContextFrequency] = useState(null);
  const [contextDb, setContextDb] = useState(null);
  
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

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    const rect = canvas.getBoundingClientRect();
    
    // Set canvas resolution for high quality
    canvas.width = rect.width * window.devicePixelRatio;
    canvas.height = rect.height * window.devicePixelRatio;
    ctx.scale(window.devicePixelRatio, window.devicePixelRatio);
    
    const width = rect.width;
    const height = rect.height;
    const padding = { top: 20, right: 20, bottom: 40, left: 50 };
    
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
        ctx.fillStyle = '#666';
        ctx.font = '10px Arial';
        ctx.textAlign = 'right';
        ctx.fillText(db.toString(), padding.left - 10, y + 3);
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
        ctx.fillStyle = '#666';
        ctx.font = '10px Arial';
        ctx.textAlign = 'center';
        let label;
        if (freq >= 1000) {
          label = freq === 12500 ? '12.5K' : `${freq / 1000}K`;
        } else {
          label = freq.toString();
        }
        ctx.fillText(label, x, height - 18);
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
    
  }, [data, ear, color]);
  
  const handleCanvasClick = (e) => {
    if (!onPlotPoint) return;
    
    // Close context menu if open
    setContextMenu(null);
    
    const canvas = canvasRef.current;
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    
    const padding = { top: 20, right: 20, bottom: 40, left: 50 };
    const chartWidth = rect.width - padding.left - padding.right;
    const chartHeight = rect.height - padding.top - padding.bottom;
    
    if (x < padding.left || x > rect.width - padding.right || y < padding.top || y > rect.height - padding.bottom) {
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
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    
    // Keep consistent with drawing padding
    const padding = { top: 20, right: 20, bottom: 40, left: 50 };
    
    // Must be inside chart area
    if (
      x < padding.left ||
      x > rect.width - padding.right ||
      y < padding.top ||
      y > rect.height - padding.bottom
    ) {
      return;
    }
    
    const chartWidth = rect.width - padding.left - padding.right;
    const chartHeight = rect.height - padding.top - padding.bottom;
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

  return (
    <div className="relative w-full h-full">
      <canvas
        ref={canvasRef}
        onClick={handleCanvasClick}
        onContextMenu={handleContextMenu}
        className="w-full h-full border border-gray-400 bg-white cursor-crosshair"
        style={{ width: '100%', height: '100%' }}
      />
      
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
