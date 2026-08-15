/**
 * ReportViewerModal — universal in-app PDF viewer popup.
 *
 * Replaces the old "download PDF as attachment" behaviour across the
 * app. Every "View / Print report" CTA now opens this modal instead of
 * kicking a raw PDF download at the browser.
 *
 * Flow:
 *   1. Fetches the PDF via axios (JWT auth headers travel with the
 *      request — matches the pattern used by every other authenticated
 *      PDF download in the app).
 *   2. Renders the PDF inline in an <iframe src=blob:...#toolbar=0>.
 *      Chrome / Edge / Firefox all embed the native PDF viewer.
 *   3. Toolbar exposes Print (opens the browser print dialog → user can
 *      pick "Save as PDF" OR any plugged-in physical printer) and a
 *      fallback Download button.
 *
 * Props:
 *   endpoint     : string   — API path (e.g. `/reports/SES-.../pdf`)
 *   filename     : string?  — download fallback name; defaults to sensible
 *   title        : string?  — toolbar title (default "Report")
 *   subtitle     : string?  — right-of-title muted text
 *   onClose      : () => void
 *
 * Consumers pass the endpoint (relative to `/api`) and the modal
 * handles auth + blob URL lifecycle.
 */
import React, { useEffect, useRef, useState } from 'react';
import axios from 'axios';
import { X, Printer, Download, Loader2, AlertCircle } from 'lucide-react';

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;

export default function ReportViewerModal({
  endpoint,
  filename,
  title = 'Report',
  subtitle,
  onClose,
}) {
  const [blobUrl, setBlobUrl] = useState('');
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');
  const iframeRef = useRef(null);

  // Fetch once per endpoint. Revoke on unmount so we don't leak object
  // URLs across the session.
  useEffect(() => {
    if (!endpoint) return undefined;
    let alive = true;
    let currentUrl = '';
    (async () => {
      setLoading(true); setErr('');
      try {
        const url = endpoint.startsWith('http') ? endpoint : `${API}${endpoint}`;
        const r = await axios.get(url, { responseType: 'blob' });
        const objUrl = URL.createObjectURL(
          new Blob([r.data], { type: 'application/pdf' })
        );
        currentUrl = objUrl;
        if (alive) setBlobUrl(objUrl);
      } catch (e) {
        if (alive) {
          setErr(
            e?.response?.status === 404
              ? 'No PDF report exists for this record yet.'
              : e?.response?.data?.detail || 'Could not open the report.'
          );
        }
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
      if (currentUrl) URL.revokeObjectURL(currentUrl);
    };
  }, [endpoint]);

  // Escape closes the modal + body scroll lock.
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose?.(); };
    window.addEventListener('keydown', onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [onClose]);

  const handlePrint = () => {
    // The embedded PDF viewer has its own print flow. Focus the iframe
    // then trigger print — Chrome/Edge route it to the browser's
    // native print dialog, which is exactly what the audiologist
    // wants (Save as PDF OR physical printer, per operator choice).
    try {
      const iframe = iframeRef.current;
      if (iframe && iframe.contentWindow) {
        iframe.contentWindow.focus();
        iframe.contentWindow.print();
        return;
      }
    } catch {
      /* fall through to open-in-new-tab printing */
    }
    // Fallback: open the blob in a new tab. Every browser's PDF viewer
    // exposes a print button in its own toolbar.
    if (blobUrl) window.open(blobUrl, '_blank', 'noopener,noreferrer');
  };

  const handleDownload = () => {
    if (!blobUrl) return;
    const a = document.createElement('a');
    a.href = blobUrl;
    a.download = filename || 'report.pdf';
    document.body.appendChild(a);
    a.click();
    a.remove();
  };

  return (
    <div
      className="fixed inset-0 z-[70] bg-slate-900/70 flex flex-col"
      data-testid="report-viewer-modal"
      onClick={(e) => { if (e.target === e.currentTarget) onClose?.(); }}
    >
      {/* Toolbar */}
      <div className="bg-slate-900 text-white px-4 py-2 flex items-center justify-between flex-shrink-0 gap-3">
        <div className="min-w-0 flex-1">
          <div className="text-sm font-bold truncate">{title}</div>
          {subtitle && (
            <div className="text-[11px] text-slate-300 truncate">{subtitle}</div>
          )}
        </div>
        <div className="flex items-center gap-1.5 flex-shrink-0">
          <button
            type="button"
            onClick={handlePrint}
            disabled={loading || !blobUrl}
            data-testid="report-viewer-print"
            className="inline-flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded bg-white text-slate-900 hover:bg-slate-100 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <Printer size={13} /> Print
          </button>
          <button
            type="button"
            onClick={handleDownload}
            disabled={loading || !blobUrl}
            data-testid="report-viewer-download"
            title="Download the PDF"
            className="inline-flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded bg-slate-700 text-white hover:bg-slate-600 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <Download size={13} /> Download
          </button>
          <button
            type="button"
            onClick={onClose}
            data-testid="report-viewer-close"
            title="Close (Esc)"
            className="w-8 h-8 rounded hover:bg-white/10 flex items-center justify-center"
          >
            <X size={16} />
          </button>
        </div>
      </div>

      {/* Body */}
      <div className="flex-1 bg-slate-200 relative">
        {loading && (
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="flex items-center gap-2 text-slate-600">
              <Loader2 size={20} className="animate-spin" />
              <span className="text-sm">Loading report…</span>
            </div>
          </div>
        )}
        {err && (
          <div className="absolute inset-0 flex items-center justify-center p-4">
            <div className="max-w-md bg-white border border-rose-200 rounded shadow-lg p-5 text-center">
              <AlertCircle size={22} className="mx-auto text-rose-500 mb-2" />
              <div className="text-sm font-semibold text-slate-800 mb-1">
                Report unavailable
              </div>
              <div className="text-xs text-slate-600">{err}</div>
              <button
                type="button"
                onClick={onClose}
                className="mt-4 text-xs font-semibold px-4 py-1.5 rounded bg-slate-900 text-white hover:bg-slate-800"
              >
                Close
              </button>
            </div>
          </div>
        )}
        {blobUrl && !err && (
          <iframe
            ref={iframeRef}
            title={title}
            src={`${blobUrl}#toolbar=0&navpanes=0`}
            className="w-full h-full border-0"
            data-testid="report-viewer-iframe"
          />
        )}
      </div>
    </div>
  );
}
