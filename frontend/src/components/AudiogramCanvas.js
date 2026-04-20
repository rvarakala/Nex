import React, { useRef, useEffect, useState } from 'react';

const AudiogramCanvas = ({ ear, data, onPlotPoint, activeMode, masked, noResponse, extendedFrequency = false }) => {
  const canvasRef = useRef(null);
  const [hoveredPoint, setHoveredPoint] = useState(null);
  
  // Major frequencies (with labels)
  const standardMajorFreqs = [250, 500, 1000, 2000, 4000, 8000];
  const extendedMajorFreqs = [250, 500, 1000, 2000, 4000, 8000, 10000, 12500, 16000];
  
  // Mid frequencies (dotted lines, NO labels)
  const standardMidFreqs = [750, 1500, 3000, 6000];
  const extendedMidFreqs = [750, 1500, 3000, 6000];
  
  // All frequencies combined for plotting logic
  const standardAllFreqs = [...standardMajorFreqs, ...standardMidFreqs].sort((a, b) => a - b);
  const extendedAllFreqs = [...extendedMajorFreqs, ...extendedMidFreqs].sort((a, b) => a - b);
  
  const majorFrequencies = extendedFrequency ? extendedMajorFreqs : standardMajorFreqs;
  const midFrequencies = extendedFrequency ? extendedMidFreqs : standardMidFreqs;
  const frequencies = extendedFrequency ? extendedAllFreqs : standardAllFreqs;
  
  // All dB levels for grid lines (5 dB precision)
  const allDbLevels = Array.from({ length: 27 }, (_, i) => -10 + i * 5); // -10 to 120 in 5dB steps
  
  // Major dB levels for labels (10 dB steps for readability)
  const majorDbLevels = Array.from({ length: 14 }, (_, i) => -10 + i * 10); // -10, 0, 10, 20... 120
  
  const dbLevels = allDbLevels; // Use all levels for plotting precision
  
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
    
    // Vertical lines (frequencies)
    frequencies.forEach((freq, i) => {
      const x = padding.left + (i / (frequencies.length - 1)) * chartWidth;
      const isMajor = majorFrequencies.includes(freq);
      
      // Set line style
      if (isMajor) {
        // Solid line for major frequencies
        ctx.strokeStyle = '#e0e0e0';
        ctx.lineWidth = 0.8;
        ctx.setLineDash([]);
      } else {
        // Dotted line for mid-frequencies
        ctx.strokeStyle = '#d0d0d0';
        ctx.lineWidth = 0.5;
        ctx.setLineDash([3, 3]);
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
    
    // Helper function to get canvas coordinates
    const getCoords = (freq, db) => {
      const freqIndex = frequencies.indexOf(freq);
      const dbIndex = dbLevels.indexOf(db);
      
      if (freqIndex === -1 || dbIndex === -1) return null;
      
      const x = padding.left + (freqIndex / (frequencies.length - 1)) * chartWidth;
      const y = padding.top + (dbIndex / (dbLevels.length - 1)) * chartHeight;
      
      return { x, y };
    };
    
    // Draw AC line and symbols
    if (data && data.ac_measurements && data.ac_measurements.length > 0) {
      const acPoints = data.ac_measurements
        .filter(m => m.threshold_db !== null && m.threshold_db !== undefined)
        .map(m => ({ freq: m.frequency, db: m.threshold_db, masked: m.masked }))
        .sort((a, b) => a.freq - b.freq);
      
      if (acPoints.length > 0) {
        // Draw connecting line
        ctx.strokeStyle = color.main;
        ctx.lineWidth = 2.5;
        ctx.beginPath();
        
        acPoints.forEach((point, i) => {
          const coords = getCoords(point.freq, point.db);
          if (coords) {
            if (i === 0) ctx.moveTo(coords.x, coords.y);
            else ctx.lineTo(coords.x, coords.y);
          }
        });
        ctx.stroke();
        
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
        });
      }
    }
    
    // Draw BC line and symbols
    if (data && data.bc_measurements && data.bc_measurements.length > 0) {
      const bcPoints = data.bc_measurements
        .filter(m => m.threshold_db !== null && m.threshold_db !== undefined)
        .map(m => ({ freq: m.frequency, db: m.threshold_db, masked: m.masked }))
        .sort((a, b) => a.freq - b.freq);
      
      if (bcPoints.length > 0) {
        // Draw connecting line (dashed)
        ctx.strokeStyle = color.main;
        ctx.lineWidth = 2.5;
        ctx.setLineDash([5, 3]);
        ctx.beginPath();
        
        bcPoints.forEach((point, i) => {
          const coords = getCoords(point.freq, point.db);
          if (coords) {
            if (i === 0) ctx.moveTo(coords.x, coords.y);
            else ctx.lineTo(coords.x, coords.y);
          }
        });
        ctx.stroke();
        ctx.setLineDash([]);
        
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
            if (ear === 'right') {
              ctx.fillText('[', coords.x, coords.y);
            } else {
              ctx.fillText(']', coords.x, coords.y);
            }
          } else {
            if (ear === 'right') {
              ctx.fillText('<', coords.x, coords.y);
            } else {
              ctx.fillText('>', coords.x, coords.y);
            }
          }
        });
      }
    }
    
  }, [data, ear, color]);
  
  const handleCanvasClick = (e) => {
    if (!onPlotPoint) return;
    
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
    const freqIndex = Math.round(freqRatio * (frequencies.length - 1));
    const frequency = frequencies[freqIndex];
    
    const dbRatio = (y - padding.top) / chartHeight;
    const dbIndex = Math.round(dbRatio * (dbLevels.length - 1));
    const db = dbLevels[dbIndex];
    
    onPlotPoint(frequency, db);
  };
  
  return (
    <div className="relative w-full h-96">
      <canvas
        ref={canvasRef}
        onClick={handleCanvasClick}
        className="w-full h-full border border-gray-400 bg-white cursor-crosshair"
        style={{ width: '100%', height: '100%' }}
      />
    </div>
  );
};

export default AudiogramCanvas;
;
