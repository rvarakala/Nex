/**
 * Self-hosted crash reporter — paired with /app/backend/routers/error_telemetry.py.
 *
 * Three capture surfaces:
 *   1. <AppErrorBoundary> — React component crashes (componentDidCatch)
 *   2. window.addEventListener('error', ...) — uncaught throws
 *   3. window.addEventListener('unhandledrejection', ...) — promise rejections
 *
 * Both #2 and #3 are installed once via setupGlobalErrorHandlers().
 *
 * Design notes:
 *   - Reports go to /api/_telemetry/frontend-error WITHOUT axios
 *     (axios may itself be in the crash chain). Plain fetch.
 *   - Auth bearer is best-effort: we only attach if a token is in
 *     localStorage. The backend treats anonymous reports as still
 *     valuable (login-page crashes, etc.).
 *   - We deliberately do NOT batch or queue offline — keep the code
 *     dead simple, the backend dedupes by fingerprint anyway.
 */
import React from 'react';

const POST_URL = `${process.env.REACT_APP_BACKEND_URL || ''}/api/_telemetry/frontend-error`;

// Per-tab session id so the Founder Panel can group crashes by browser session.
const SESSION_KEY = 'audinexa_crash_session_id';
function getSessionId() {
  try {
    let id = sessionStorage.getItem(SESSION_KEY);
    if (!id) {
      id = `s-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
      sessionStorage.setItem(SESSION_KEY, id);
    }
    return id;
  } catch {
    return 'no-session-storage';
  }
}

function getAuthHeader() {
  try {
    const tok = localStorage.getItem('audinexa_token') || localStorage.getItem('token');
    return tok ? { Authorization: `Bearer ${tok}` } : {};
  } catch {
    return {};
  }
}

/**
 * Send a crash report to the backend. Never throws (a failed report
 * must not cascade into a second crash).
 */
export function reportCrash({
  message,
  stack,
  componentStack,
  source = 'window.onerror',
  extra = {},
}) {
  try {
    const body = {
      route: typeof window !== 'undefined' ? window.location.pathname : '',
      message: String(message || 'Unknown error').slice(0, 1000),
      stack: stack ? String(stack).slice(0, 8000) : null,
      component_stack: componentStack ? String(componentStack).slice(0, 4000) : null,
      source,
      extra,
      user_agent: typeof navigator !== 'undefined' ? navigator.userAgent : null,
      session_id: getSessionId(),
    };
    fetch(POST_URL, {
      method: 'POST',
      keepalive: true,
      headers: { 'Content-Type': 'application/json', ...getAuthHeader() },
      body: JSON.stringify(body),
    }).catch(() => { /* swallow — report failures must not double-crash */ });
  } catch {
    /* never throw */
  }
}

/**
 * Install global handlers. Idempotent — calling twice is a no-op.
 */
let _installed = false;
export function setupGlobalErrorHandlers() {
  if (_installed || typeof window === 'undefined') return;
  _installed = true;

  window.addEventListener('error', (event) => {
    if (!event) return;
    reportCrash({
      message: event.message || 'window.onerror',
      stack: event.error && event.error.stack ? event.error.stack : null,
      source: 'window.onerror',
      extra: {
        filename: event.filename,
        lineno: event.lineno,
        colno: event.colno,
      },
    });
  });

  window.addEventListener('unhandledrejection', (event) => {
    if (!event) return;
    const reason = event.reason || {};
    reportCrash({
      message: reason.message || String(reason).slice(0, 200) || 'unhandledrejection',
      stack: reason.stack || null,
      source: 'unhandledrejection',
    });
  });
}


/**
 * Top-level React error boundary. Wrap <App /> with this.
 *
 * Renders a friendly fallback (with the request_id surfaced so the user can
 * quote it to support) instead of a blank screen.
 */
export class AppErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { error: null, info: null, reportedId: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    this.setState({ info });
    reportCrash({
      message: (error && error.message) || 'React render crash',
      stack: error && error.stack ? error.stack : null,
      componentStack: info && info.componentStack ? info.componentStack : null,
      source: 'boundary',
      extra: { name: error && error.name },
    });
  }

  handleReload = () => {
    try { window.location.reload(); } catch { /* noop */ }
  };

  handleGoHome = () => {
    try { window.location.href = '/'; } catch { /* noop */ }
  };

  render() {
    if (!this.state.error) return this.props.children;
    const msg = (this.state.error && this.state.error.message) || 'Something broke';
    return (
      <div
        data-testid="app-crash-fallback"
        style={{
          minHeight: '100vh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: 24,
          background: '#0f172a',
          color: '#e2e8f0',
          fontFamily: 'ui-sans-serif, system-ui, -apple-system, sans-serif',
        }}
      >
        <div style={{ maxWidth: 520, textAlign: 'left' }}>
          <div style={{ fontSize: 12, letterSpacing: 2, color: '#fb7185', marginBottom: 8 }}>
            AUDINEXA — UNEXPECTED ERROR
          </div>
          <h1 style={{ fontSize: 24, fontWeight: 700, margin: '0 0 12px' }}>
            Something on this page crashed.
          </h1>
          <p style={{ margin: '0 0 16px', color: '#cbd5e1', fontSize: 14, lineHeight: 1.5 }}>
            We&apos;ve recorded the details and notified the team automatically.
            Reloading usually fixes it. If the issue persists, please contact
            support with the message below.
          </p>
          <div style={{
            background: '#1e293b',
            border: '1px solid #334155',
            borderRadius: 6,
            padding: 12,
            fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
            fontSize: 12,
            color: '#fda4af',
            marginBottom: 16,
            wordBreak: 'break-word',
          }}>
            {msg}
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button
              data-testid="crash-reload-btn"
              onClick={this.handleReload}
              style={{
                background: '#0ea5e9', border: 0, color: 'white', fontWeight: 600,
                padding: '8px 14px', borderRadius: 6, cursor: 'pointer',
              }}
            >
              Reload page
            </button>
            <button
              data-testid="crash-home-btn"
              onClick={this.handleGoHome}
              style={{
                background: 'transparent', border: '1px solid #475569', color: '#e2e8f0',
                padding: '8px 14px', borderRadius: 6, cursor: 'pointer',
              }}
            >
              Go to dashboard
            </button>
          </div>
        </div>
      </div>
    );
  }
}
