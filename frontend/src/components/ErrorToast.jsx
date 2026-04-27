/**
 * ErrorToast + describeError — shared error UX primitives.
 *
 * Use this everywhere instead of the dreaded `<div>{err?.response?.data?.detail || 'Failed'}</div>`
 * pattern. Two pieces:
 *
 *   1. `describeError(e, fallback)` — turns an axios error into:
 *        { display:    "AWB AWB1234567 already booked (CSH-2026-0145)",
 *          diagnostic: "[AUDINEXA error] 2026-04-27T08:30:11.234Z\n
 *                       Action: Failed to book shipment\n
 *                       Display: AWB ... already booked\n
 *                       POST https://…/api/ha/couriers\n
 *                       HTTP 409\n
 *                       Body: {\"detail\":\"AWB ...\"}" }
 *      The diagnostic blob is what the Copy button writes to the clipboard
 *      so users can paste a complete forensic record into a support ticket.
 *
 *   2. `<ErrorToast err={err} testid="…" />` renders the message + a tiny
 *      "📋 Copy" button. Accepts both string and object shapes for back-compat
 *      with legacy callers that haven't switched to describeError yet.
 *
 * Conventions:
 *   - Always set `testid` for testability.
 *   - Pass the result of `describeError` straight into setState; the toast
 *     unwraps it.
 *   - Always supply a meaningful `fallback` string — it's the action verb
 *     that ends up in the diagnostic blob (e.g. "Failed to save patient").
 */
import React from 'react';

export function describeError(e, fallback = 'Request failed') {
  // Always log so the developer can grep DevTools when end-users complain
  // eslint-disable-next-line no-console
  console.error('[audinexa]', fallback, e?.response?.status, e?.response?.data, e);

  let display;
  if (!e?.response) {
    display = `${fallback} — connection problem (check internet, then retry).`;
  } else {
    const status = e.response.status;
    const detail = e.response.data?.detail;
    if (status === 401) display = 'Session expired — please sign in again.';
    else if (status === 403) display = 'You do not have permission to do this.';
    else if (typeof detail === 'string') display = detail;
    else if (detail && typeof detail === 'object' && detail.detail) display = detail.detail;
    else if (Array.isArray(detail) && detail[0]?.msg) {
      // Pydantic 422 validation array
      display = detail.map((d) => `${(d.loc || []).slice(-1)[0] || 'field'}: ${d.msg}`).join('; ');
    } else if (detail) display = JSON.stringify(detail);
    else display = `${fallback} (HTTP ${status})`;
  }

  const diagnostic = [
    `[AUDINEXA error] ${new Date().toISOString()}`,
    `Action: ${fallback}`,
    `Display: ${display}`,
    e?.config?.method && `${e.config.method.toUpperCase()} ${e.config.url || ''}`.trim(),
    e?.response?.status && `HTTP ${e.response.status}`,
    e?.response?.data && `Body: ${JSON.stringify(e.response.data).slice(0, 500)}`,
  ].filter(Boolean).join('\n');

  return { display, diagnostic };
}

export default function ErrorToast({ err, testid, className = '', allowReport = true }) {
  if (!err) return null;
  const { display, diagnostic } = typeof err === 'string'
    ? { display: err, diagnostic: err } : err;

  const onCopy = async (ev) => {
    ev.stopPropagation();
    const text = diagnostic || display;
    try {
      await navigator.clipboard.writeText(text);
      // eslint-disable-next-line no-console
      console.info('[audinexa] error copied to clipboard');
      // Briefly flash a hint in the button itself
      const btn = ev.currentTarget;
      const orig = btn.innerText;
      btn.innerText = '✓ Copied';
      setTimeout(() => { btn.innerText = orig; }, 1200);
    } catch {
      // Older browsers / no clipboard permission → fall back to execCommand
      const ta = document.createElement('textarea');
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      try { document.execCommand('copy'); } catch (_) { /* noop */ }
      document.body.removeChild(ta);
    }
  };

  // "🛟 Report" — pre-fill an AUDINEXA Care ticket with the diagnostic blob.
  // Routes via query string so we don't need a global event bus.
  const onReport = (ev) => {
    ev.stopPropagation();
    const subj = `Error: ${display.slice(0, 100)}`;
    const params = new URLSearchParams({
      prefill_diag: encodeURIComponent(diagnostic || display),
      prefill_subject: encodeURIComponent(subj),
    });
    window.location.assign(`/care?${params.toString()}`);
  };

  return (
    <div className={`bg-rose-100 text-rose-800 p-2 rounded text-[12px] font-semibold flex items-start gap-2 ${className}`}
         data-testid={testid}>
      <span className="flex-1 leading-snug">⚠ {display}</span>
      <div className="flex items-center gap-1 shrink-0">
        <button onClick={onCopy}
                data-testid={testid ? `${testid}-copy` : 'audinexa-error-copy'}
                title="Copy full error to clipboard"
                className="px-1.5 py-0.5 text-[10px] bg-rose-200 hover:bg-rose-300 text-rose-900 rounded font-bold whitespace-nowrap">
          📋 Copy
        </button>
        {allowReport && (
          <button onClick={onReport}
                  data-testid={testid ? `${testid}-report` : 'audinexa-error-report'}
                  title="Report this to AUDINEXA Care (opens a pre-filled support ticket)"
                  className="px-1.5 py-0.5 text-[10px] bg-rose-600 hover:bg-rose-700 text-white rounded font-bold whitespace-nowrap">
            🛟 Report
          </button>
        )}
      </div>
    </div>
  );
}
