/**
 * Report Preflight Modal — the "Looks good?" check that appears when the
 * audiologist clicks Print.
 *
 * Why this exists: beta users reported PDF layout glitches (clinic name
 * truncated, reports bleeding across page boundaries) only after the
 * patient had already received the report. Catching issues BEFORE the
 * PDF is uploaded to GridFS saves reputation + support tickets.
 *
 * The check is canvas-free and < 10 ms — it reads DOM metrics via
 * analyzeReportLayout() and surfaces:
 *   • Expected page count (nav-time info).
 *   • Warnings: long clinic name, missing logo, oversized single section,
 *     4+ page report, etc.
 *
 * The modal blocks the print pipeline until the audiologist clicks
 * "Looks good, print". A dismissible escape hatch ("Back to edit") lets
 * them return to the builder without any side effects.
 */
import React, { useMemo } from 'react';
import { AlertTriangle, CheckCircle2, FileText, Info, Printer, Wand2, XCircle } from 'lucide-react';
import { analyzeReportLayout } from './captureAndUpload';

export default function ReportPreflightModal({ open, onConfirm, onCancel, onApplyFix, rootElementId = 'report-preview' }) {
  // Analyze every time the modal opens (cheap; ~5 ms).
  const analysis = useMemo(() => {
    if (!open) return null;
    const root = document.getElementById(rootElementId);
    return analyzeReportLayout(root);
  }, [open, rootElementId]);

  if (!open || !analysis) return null;

  const { pageCount, warnings, heightMM } = analysis;
  const hasWarnings = warnings.some((w) => w.level !== 'info');
  const allClean = warnings.length === 0;

  return (
    <div
      className="fixed inset-0 z-[60] bg-slate-900/60 flex items-center justify-center p-4"
      onMouseDown={(e) => { if (e.target === e.currentTarget) onCancel(); }}
      data-testid="report-preflight-modal"
    >
      <div className="bg-white rounded-xl w-full max-w-lg shadow-2xl overflow-hidden">
        {/* ---------- Header ---------- */}
        <div className="px-5 py-3 border-b border-slate-200 bg-slate-50 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <FileText size={16} className="text-indigo-600" />
            <div>
              <h3 className="text-sm font-bold text-slate-900">Looks good?</h3>
              <p className="text-[11px] text-slate-500">Quick layout check before we send the PDF to the patient</p>
            </div>
          </div>
          <button onClick={onCancel} data-testid="preflight-close" className="p-1 text-slate-500 hover:text-slate-900">
            <XCircle size={16} />
          </button>
        </div>

        {/* ---------- Body ---------- */}
        <div className="p-5 space-y-4">
          {/* Page-count stat */}
          <div className="flex items-center gap-3">
            <div
              data-testid="preflight-page-count"
              className={`rounded-lg w-16 h-16 flex items-center justify-center font-extrabold text-2xl ${
                pageCount <= 2 ? 'bg-emerald-100 text-emerald-800' : pageCount === 3 ? 'bg-amber-100 text-amber-800' : 'bg-rose-100 text-rose-800'
              }`}
            >
              {pageCount}
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-sm font-semibold text-slate-900">
                {pageCount} page{pageCount === 1 ? '' : 's'} will be printed
              </div>
              <div className="text-[11px] text-slate-500">Report height ≈ {heightMM} mm (A4 = 297 mm per page)</div>
            </div>
          </div>

          {/* Warnings / info list */}
          {allClean ? (
            <div className="flex items-start gap-2 p-3 bg-emerald-50 border border-emerald-200 rounded" data-testid="preflight-ok">
              <CheckCircle2 size={14} className="text-emerald-700 mt-0.5" />
              <div className="text-xs text-emerald-900">
                <div className="font-semibold">No layout issues detected.</div>
                <div>Pagination looks clean, clinic branding fits, and no section overflows a page.</div>
              </div>
            </div>
          ) : (
            <div className="space-y-2">
              {warnings.map((w, i) => {
                const cfg = w.level === 'error'
                  ? { bg: 'bg-rose-50 border-rose-200', text: 'text-rose-900', iconColor: 'text-rose-700', Icon: XCircle }
                  : w.level === 'warn'
                    ? { bg: 'bg-amber-50 border-amber-200', text: 'text-amber-900', iconColor: 'text-amber-700', Icon: AlertTriangle }
                    : { bg: 'bg-blue-50 border-blue-200', text: 'text-blue-900', iconColor: 'text-blue-700', Icon: Info };
                const Icon = cfg.Icon;
                return (
                  <div key={i} className={`border rounded ${cfg.bg}`} data-testid={`preflight-warn-${w.level}-${i}`}>
                    <div className="flex items-start gap-2 p-2.5">
                      <Icon size={13} className={`${cfg.iconColor} mt-0.5 flex-shrink-0`} />
                      <div className={`flex-1 text-[11px] leading-snug ${cfg.text}`}>{w.message}</div>
                    </div>
                    {w.fixKey && onApplyFix && (
                      <div className="px-2.5 pb-2 -mt-1">
                        <button
                          type="button"
                          onClick={() => onApplyFix(w.fixKey, w.fixLabel)}
                          data-testid={`preflight-fix-${w.fixKey}`}
                          className={`inline-flex items-center gap-1 px-2 py-1 text-[10px] font-semibold rounded border ${cfg.text} bg-white hover:bg-slate-50 border-current/40`}
                        >
                          <Wand2 size={10} /> {w.fixLabel || 'Apply suggested fix'}
                        </button>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {/* Subtle hint for the audiologist. */}
          <div className="text-[10px] text-slate-400 italic">
            Tip: If something looks off in the preview below the modal, click <span className="font-semibold">Back to edit</span>,
            fix it, then re-open Print.
          </div>
        </div>

        {/* ---------- Footer ---------- */}
        <div className="px-5 py-3 border-t border-slate-200 bg-slate-50 flex items-center justify-between gap-2">
          <div className="text-[10px] text-slate-500">
            {hasWarnings ? 'Review the warnings above before proceeding.' : 'Pagination looks clean.'}
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onCancel}
              data-testid="preflight-cancel"
              className="px-3 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-100 rounded"
            >
              Back to edit
            </button>
            <button
              type="button"
              onClick={onConfirm}
              data-testid="preflight-confirm"
              className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-semibold text-white bg-indigo-600 hover:bg-indigo-700 rounded"
            >
              <Printer size={12} /> Looks good, print
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
