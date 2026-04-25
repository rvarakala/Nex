import React, { useEffect, useRef, useState } from 'react';
import { X, Download, Printer, RefreshCw } from 'lucide-react';
import html2canvas from 'html2canvas';
import { jsPDF } from 'jspdf';
import DeliveryChallanDoc from './DeliveryChallanDoc';

/**
 * ChallanPrintModal — preview-and-print frame for a Delivery Challan.
 *
 *  • Renders the A4 doc inside a scrollable preview pane.
 *  • "Print" → `window.print()` of just the doc node (CSS @media print isolates it).
 *  • "Download PDF" → html2canvas → jsPDF, A4, single page (challan rarely > 1 page).
 *
 * We intentionally re-use html2canvas + jsPDF (already in package.json from the
 * audiogram report path) instead of a new dep. No backend rendering needed.
 */
export default function ChallanPrintModal({ transfer, onClose }) {
  const docRef = useRef(null);
  const [busy, setBusy] = useState(false);

  // Briefly delay "ready" so the embedded signature image (async fetch) has a
  // chance to render before the user hits download.
  const [ready, setReady] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setReady(true), 700);
    return () => clearTimeout(t);
  }, []);

  const downloadPdf = async () => {
    if (!docRef.current) return;
    setBusy(true);
    try {
      const canvas = await html2canvas(docRef.current, {
        scale: 2, useCORS: true, backgroundColor: '#ffffff', logging: false,
      });
      const img = canvas.toDataURL('image/png');
      const pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
      const pageW = pdf.internal.pageSize.getWidth();
      const pageH = pdf.internal.pageSize.getHeight();
      // Fit to width, preserve aspect ratio. Most challans are < 1 page.
      const imgW = pageW;
      const imgH = (canvas.height * imgW) / canvas.width;
      let y = 0;
      let remaining = imgH;
      let firstPage = true;
      // If the rendered doc happens to overflow A4, paginate vertically.
      while (remaining > 0) {
        if (!firstPage) pdf.addPage();
        pdf.addImage(img, 'PNG', 0, y > 0 ? -y : 0, imgW, imgH, undefined, 'FAST');
        remaining -= pageH;
        y += pageH;
        firstPage = false;
      }
      pdf.save(`${(transfer.challan_no || transfer.transfer_id).replace(/\//g, '-')}.pdf`);
    } catch (e) {
      window.alert(`PDF generation failed: ${e?.message || e}`);
    } finally { setBusy(false); }
  };

  const printChallan = () => {
    if (!docRef.current) return;
    const win = window.open('', '_blank', 'noopener,width=900,height=1100');
    if (!win) { window.alert('Pop-up blocked. Allow pop-ups to print.'); return; }
    // Build the popup document with safe DOM APIs (no document.write).
    // The challan body is already rendered React markup — we deep-clone the
    // node so any sanitisation React applied (text-escaping etc.) carries over.
    const d = win.document;
    d.title = transfer.challan_no || 'Delivery Challan';
    const style = d.createElement('style');
    style.textContent = '@page{size:A4 portrait;margin:0}html,body{margin:0;padding:0;background:#fff}';
    d.head.appendChild(style);
    const meta = d.createElement('meta');
    meta.setAttribute('charset', 'utf-8');
    d.head.appendChild(meta);
    d.body.appendChild(d.importNode(docRef.current, true));
    setTimeout(() => { win.focus(); win.print(); }, 400);
  };

  return (
    <div
      className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4"
      onClick={(e) => { if (e.target === e.currentTarget) onClose?.(); }}
      data-testid="challan-print-modal"
    >
      <div className="bg-white rounded-xl shadow-2xl w-[900px] max-w-full max-h-[92vh] flex flex-col">
        {/* Toolbar */}
        <div className="px-5 py-3 border-b border-slate-200 flex items-center justify-between bg-slate-50">
          <div>
            <h3 className="text-[14px] font-bold text-slate-900">
              {transfer.challan_no || 'Delivery Challan'}
            </h3>
            <p className="text-[10px] text-slate-500">
              {transfer.from_clinic_name} → {transfer.to_clinic_name}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={printChallan}
              disabled={!ready || busy}
              data-testid="challan-print-btn"
              className="inline-flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wide bg-white border border-slate-300 hover:border-indigo-400 hover:text-indigo-700 text-slate-700 px-3 py-1.5 rounded transition-colors disabled:opacity-50"
            >
              <Printer size={13} /> Print
            </button>
            <button
              type="button"
              onClick={downloadPdf}
              disabled={!ready || busy}
              data-testid="challan-download-btn"
              className="inline-flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wide bg-indigo-600 hover:bg-indigo-700 text-white px-4 py-1.5 rounded shadow-sm shadow-indigo-500/30 transition-colors disabled:bg-slate-300"
            >
              {busy ? <RefreshCw size={13} className="animate-spin" /> : <Download size={13} />}
              {busy ? 'Generating…' : 'Download PDF'}
            </button>
            <button
              onClick={onClose}
              className="w-7 h-7 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded-md flex items-center justify-center"
              data-testid="challan-print-close"
              aria-label="Close"
            >
              <X size={16} />
            </button>
          </div>
        </div>

        {/* Preview pane */}
        <div className="flex-1 overflow-auto bg-slate-200 p-6 flex justify-center">
          <div ref={docRef} style={{ boxShadow: '0 4px 24px rgba(0,0,0,0.08)' }}>
            <DeliveryChallanDoc transfer={transfer} />
          </div>
        </div>
      </div>
    </div>
  );
}
