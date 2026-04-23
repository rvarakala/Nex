/**
 * Capture the live Report preview DOM → multi-page A4 PDF → upload to backend.
 *
 * This is the single source of truth for "what the patient receives". The
 * audiologist's print dialog and the server-stored archive are both fed from
 * the same html2canvas render, so they match byte-for-byte.
 */
import axios from 'axios';
import html2canvas from 'html2canvas';
import { jsPDF } from 'jspdf';

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;

// A4 @ 72 DPI. jsPDF in `mm` mode works with real millimetres.
const A4_W_MM = 210;
const A4_H_MM = 297;

/**
 * Render a DOM element to a multi-page A4 PDF and POST it to
 * `/api/sessions/{sessionId}/report-pdf`.
 *
 * @param {HTMLElement} element — root element to capture (usually `#report-preview`).
 * @param {string} sessionId — active test session id.
 * @returns {Promise<{ok: true, size_bytes: number} | {ok: false, error: string}>}
 */
export async function captureAndUploadPdf(element, sessionId) {
  if (!element || !sessionId) {
    return { ok: false, error: 'missing element or session id' };
  }

  // Render at 2x for crisp audiogram plots without ballooning file size too much.
  const canvas = await html2canvas(element, {
    scale: 2,
    useCORS: true,
    backgroundColor: '#ffffff',
    logging: false,
    // Capture the whole scrollable height, not just what's on screen.
    windowWidth: element.scrollWidth,
    windowHeight: element.scrollHeight,
  });

  const pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });

  // Map the rendered canvas onto A4 pages. The element is 210mm wide by design,
  // so width scaling is 1:1; page-break by height.
  const imgWidthMM = A4_W_MM;
  const imgHeightMM = (canvas.height * imgWidthMM) / canvas.width;

  // If the full render fits on one page, drop it in and we're done.
  if (imgHeightMM <= A4_H_MM + 0.5) {
    const dataUrl = canvas.toDataURL('image/jpeg', 0.92);
    pdf.addImage(dataUrl, 'JPEG', 0, 0, imgWidthMM, imgHeightMM, undefined, 'FAST');
  } else {
    // Slice the canvas into A4-height chunks.
    const pageHeightPx = Math.floor((A4_H_MM / imgWidthMM) * canvas.width);
    let y = 0;
    let pageIdx = 0;
    while (y < canvas.height) {
      const slice = document.createElement('canvas');
      slice.width = canvas.width;
      slice.height = Math.min(pageHeightPx, canvas.height - y);
      const ctx = slice.getContext('2d');
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, slice.width, slice.height);
      ctx.drawImage(
        canvas,
        0, y, canvas.width, slice.height,
        0, 0, slice.width, slice.height,
      );
      const dataUrl = slice.toDataURL('image/jpeg', 0.92);
      const sliceHeightMM = (slice.height * imgWidthMM) / slice.width;
      if (pageIdx > 0) pdf.addPage();
      pdf.addImage(dataUrl, 'JPEG', 0, 0, imgWidthMM, sliceHeightMM, undefined, 'FAST');
      y += pageHeightPx;
      pageIdx += 1;
    }
  }

  const blob = pdf.output('blob');
  const fd = new FormData();
  fd.append('file', blob, `report-${sessionId}.pdf`);
  const r = await axios.post(`${API}/sessions/${sessionId}/report-pdf`, fd, {
    headers: { 'Content-Type': 'multipart/form-data' },
  });
  return { ok: true, size_bytes: r.data?.size_bytes || blob.size };
}
