/**
 * Capture the live Report preview DOM → multi-page A4 PDF → upload to backend.
 *
 * Single source of truth for "what the patient receives". The audiologist's
 * print dialog and the server-stored archive are both fed from the same
 * html2canvas render, so they match byte-for-byte.
 *
 * ## Pagination strategy (v2)
 * The previous implementation rendered the whole report as one giant
 * canvas and then blind-sliced at A4 pixel boundaries. That worked fine
 * when the default clinic header was compact — but as soon as a user
 * uploaded a taller logo / longer clinic address, the pixel boundary
 * started falling mid-audiogram / mid-table, producing the "continuous
 * printing, page breaks ignored" bug a beta tester reported.
 *
 * This version paginates **DOM-aware**:
 *   1. Any direct descendant with class `.report-page-break` is a
 *      **hard break** — the current page is closed and a fresh page starts
 *      on that child.
 *   2. Between hard breaks, we slice only at **direct-child boundaries** of
 *      `#report-preview`. A section/table/audiogram is therefore never
 *      cut mid-element. If one child alone is > A4 (rare; e.g. a massive
 *      audiogram SVG), we fall back to blind slicing *inside that single
 *      child* only.
 *
 * The DOM is NOT mutated — we read layout metrics with `offsetTop` /
 * `offsetHeight` before calling html2canvas.
 */
import axios from 'axios';
import html2canvas from 'html2canvas';
import { jsPDF } from 'jspdf';

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;

// A4 in mm.
const A4_W_MM = 210;
const A4_H_MM = 297;

// A4 aspect in "element pixels" (used by analyzeReportLayout which works
// off the live DOM, no canvas render needed).
const A4_ASPECT = A4_H_MM / A4_W_MM;

// Class names that should trigger a hard page break before the element.
const HARD_BREAK_CLASSES = ['report-page-break', 'page-break-before', 'pagebreak'];

const hasBreakClass = (el) =>
  HARD_BREAK_CLASSES.some((c) => el.classList && el.classList.contains(c));

/**
 * Walk a rendered canvas into a list of [startY, endY] slices such that:
 *   - no slice is taller than one A4 page,
 *   - every cut falls at a safe DOM-child boundary (or at a forced hard-break),
 *   - we fall back to blind-slicing only when a single child is itself > A4.
 *
 * @param {HTMLElement} root       the element that was rendered
 * @param {HTMLCanvasElement} canvas the full-element render
 * @returns {Array<[number, number]>} Y ranges in canvas pixels
 */
function planPageSlices(root, canvas) {
  const children = Array.from(root.children);
  const rootTop = root.offsetTop;
  const scrollHeight = root.scrollHeight;
  const scale = canvas.height / Math.max(scrollHeight, 1);
  const pageHeightPx = Math.floor((A4_H_MM / A4_W_MM) * canvas.width);

  // Each child's TOP and BOTTOM in root coordinates, then scaled to canvas px.
  const childSpans = children.map((c) => {
    const top = c.offsetTop - rootTop;
    const bottom = top + c.offsetHeight;
    return {
      topCv: Math.round(top * scale),
      bottomCv: Math.round(bottom * scale),
      hardBreak: hasBreakClass(c),
    };
  });

  const pageEnds = []; // cumulative Y-coords in canvas px where pages end
  let pageStart = 0;

  for (const span of childSpans) {
    // Hard break BEFORE this child: close current page at the previous
    // content tail, jump the cursor to the top of the break child.
    if (span.hardBreak) {
      if (span.topCv > pageStart) pageEnds.push(span.topCv);
      pageStart = span.topCv;
    }

    // Soft pagination: would this child overflow the current page?
    if (span.bottomCv - pageStart > pageHeightPx) {
      // Close the page at the child's TOP so nothing gets cut mid-section.
      if (span.topCv > pageStart) {
        pageEnds.push(span.topCv);
        pageStart = span.topCv;
      }
      // If the child itself is taller than A4 (rare — oversized audiogram
      // SVG, huge table), blind-slice inside it; outer children are safe.
      while (span.bottomCv - pageStart > pageHeightPx) {
        pageStart += pageHeightPx;
        pageEnds.push(pageStart);
      }
    }
  }
  // Tail: whatever's left after the last child.
  if (pageStart < canvas.height) pageEnds.push(canvas.height);

  // Build [start, end] pairs from the sorted ends.
  const slices = [];
  let s = 0;
  for (const e of pageEnds) {
    // Skip empty / degenerate slices (e.g. two consecutive hard-breaks
    // against each other, or a trailing tail already flushed).
    if (e > s) {
      slices.push([s, e]);
      s = e;
    }
  }
  return slices;
}

/**
 * Fast canvas-free preflight. Walks the same DOM the captureAndUploadPdf
 * function will capture, estimates how many A4 pages the final PDF will
 * have, and surfaces user-actionable warnings (e.g. "a section is taller
 * than an A4 page", "clinic name is very long").
 *
 * Designed to run in < 10 ms so it can power a "Looks good?" modal shown
 * instantly when the audiologist clicks Print.
 *
 * @param {HTMLElement} root — the `#report-preview` div
 * @returns {{
 *   pageCount: number,
 *   warnings: Array<{level: 'info'|'warn'|'error', message: string}>,
 *   pageBoundariesMM: number[],
 *   heightMM: number,
 * }}
 */
export function analyzeReportLayout(root) {
  if (!root) return { pageCount: 0, warnings: [{ level: 'error', message: 'Report preview is not mounted.' }], pageBoundariesMM: [], heightMM: 0 };

  const children = Array.from(root.children);
  const rootTop = root.offsetTop;
  // The #report-preview div is always styled width:210mm so 1px at render
  // time = A4_W_MM / root.offsetWidth mm. We base mm conversion on that.
  const pxPerMM = root.offsetWidth / A4_W_MM;
  const pageHeightPx = A4_ASPECT * root.offsetWidth;

  const warnings = [];

  // --- Warning: clinic name wrapped to smallest font tier (looks tiny) ---
  // ReportHeader shrinks font progressively at > 42 and > 52 chars.
  const nameEl = root.querySelector('header .font-extrabold.text-blue-900');
  if (nameEl) {
    const txt = (nameEl.textContent || '').trim();
    if (txt.length > 52) {
      warnings.push({
        level: 'info',
        message: `Clinic name is ${txt.length} chars — it will render smaller (13px) to fit. Looks fine but verify.`,
      });
    }
  }

  // --- Warning: no clinic logo uploaded ---
  const headerImg = root.querySelector('header img');
  const headerPlaceholder = root.querySelector('header .bg-blue-700.text-white');
  if (!headerImg && headerPlaceholder) {
    warnings.push({
      level: 'info',
      message: 'No clinic logo uploaded — a plain placeholder is shown. Upload a logo in Clinic Settings for a branded report.',
    });
  }

  // --- Paginate with the same rules as the final PDF ---
  const pageEndsPx = [];
  let pageStartPx = 0;
  let anyOversizedChild = false;

  for (const c of children) {
    const topPx = c.offsetTop - rootTop;
    const bottomPx = topPx + c.offsetHeight;
    const hardBreak = hasBreakClass(c);

    if (hardBreak) {
      if (topPx > pageStartPx) pageEndsPx.push(topPx);
      pageStartPx = topPx;
    }
    if (bottomPx - pageStartPx > pageHeightPx) {
      if (topPx > pageStartPx) {
        pageEndsPx.push(topPx);
        pageStartPx = topPx;
      }
      while (bottomPx - pageStartPx > pageHeightPx) {
        pageStartPx += pageHeightPx;
        pageEndsPx.push(pageStartPx);
        anyOversizedChild = true; // single child taller than A4
      }
    }
  }
  const heightPx = root.scrollHeight;
  if (pageStartPx < heightPx) pageEndsPx.push(heightPx);

  const pageBoundariesMM = pageEndsPx.map((px) => Math.round(px / pxPerMM));
  const pageCount = pageBoundariesMM.length;
  const heightMM = Math.round(heightPx / pxPerMM);

  if (anyOversizedChild) {
    warnings.push({
      level: 'warn',
      message: 'A single section is taller than one A4 page and will be split across pages. Consider disabling long sections (e.g. large narrative text) or toggling "Tympanometry on new page" to rebalance.',
    });
  }
  if (pageCount >= 4) {
    warnings.push({
      level: 'warn',
      message: `This report will print as ${pageCount} pages. If that's more than expected, trim sections or disable "Tympanometry on new page" to consolidate.`,
    });
  }

  return { pageCount, warnings, pageBoundariesMM, heightMM };
}

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

  // Render at 2x for crisp audiogram plots without ballooning file size.
  const canvas = await html2canvas(element, {
    scale: 2,
    useCORS: true,
    backgroundColor: '#ffffff',
    logging: false,
    windowWidth: element.scrollWidth,
    windowHeight: element.scrollHeight,
  });

  const pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  const slices = planPageSlices(element, canvas);

  for (let i = 0; i < slices.length; i++) {
    const [start, end] = slices[i];
    const sliceH = end - start;

    const slice = document.createElement('canvas');
    slice.width = canvas.width;
    slice.height = sliceH;
    const ctx = slice.getContext('2d');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, slice.width, slice.height);
    ctx.drawImage(
      canvas,
      0, start, canvas.width, sliceH,
      0, 0, slice.width, sliceH,
    );

    const dataUrl = slice.toDataURL('image/jpeg', 0.92);
    const sliceHeightMM = (sliceH * A4_W_MM) / canvas.width;

    if (i > 0) pdf.addPage();
    // Top-align each slice on the A4 page. White A4 canvas below unused
    // area is fine — we don't stretch content to fill the page.
    pdf.addImage(dataUrl, 'JPEG', 0, 0, A4_W_MM, sliceHeightMM, undefined, 'FAST');
  }

  const blob = pdf.output('blob');
  const fd = new FormData();
  fd.append('file', blob, `report-${sessionId}.pdf`);
  const r = await axios.post(`${API}/sessions/${sessionId}/report-pdf`, fd, {
    headers: { 'Content-Type': 'multipart/form-data' },
  });
  return { ok: true, size_bytes: r.data?.size_bytes || blob.size };
}
