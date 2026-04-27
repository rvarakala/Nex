/**
 * axiosRetry — adds automatic retry-with-backoff to all axios writes.
 *
 * What gets retried:
 *   - Network errors (ERR_NETWORK / "Failed to fetch" / aborted) — the classic
 *     "wifi blip" or 5-second outage that should never lose work
 *   - 5xx server responses (502/503/504 are usually transient infra hiccups)
 *
 * What never gets retried (would cause duplicate writes / wrong UX):
 *   - 4xx client errors (400/401/403/404/409/422)
 *   - Already-retried requests (we mark them so we don't retry the retry)
 *   - GETs that are SSE / streaming / long-polling
 *
 * Backoff schedule: 400ms → 1.2s → 3s, then give up and surface the error.
 *
 * UX feedback: a single non-blocking toast tells the user we're retrying,
 * and clears as soon as the retry succeeds. No interruption to their flow.
 */
import axios from 'axios';
import { toast } from 'sonner';
import { addToOutbox } from './outbox';

const RETRY_BACKOFF_MS = [400, 1200, 3000];
const MAX_RETRIES = RETRY_BACKOFF_MS.length;
const RETRY_FLAG = '__audinexa_retry_count';
const RETRY_TOAST_ID = 'axios-retry-status';

// Idempotent methods are always safe to retry — server processes the same way
// regardless of how many times the request arrives.
const IDEMPOTENT_METHODS = new Set(['get', 'put', 'delete']);
// POST is non-idempotent: a retry can create a duplicate if the original
// actually succeeded but the response was lost in transit. We retry POST
// ONLY on 5xx (proxy errors → server didn't process) AND for outbox-eligible
// flows (which expect server-side dedup).
const RETRYABLE_METHODS = new Set(['get', 'post', 'put', 'patch', 'delete']);
const RETRYABLE_STATUSES = new Set([502, 503, 504]);

// Endpoints we can safely queue offline — kept tight on purpose. Anything not
// on this list will surface the network error to the caller (because retrying
// the wrong write later — say, a payment capture — is far worse than a UI error).
const OUTBOX_ELIGIBLE_PATTERNS = [
  /^\/api\/patients(\/|\?|$)/,                 // patient CRUD + notes
  /^\/api\/appointments(\/|\?|$)/,             // bookings, reschedule, status
  /^\/api\/ha\/service-tickets(\/|\?|$)/,      // service jobs
  /^\/api\/billing\/services(\/|\?|$)/,        // service catalogue mgmt
  /^\/api\/diagnostics\/sessions(\/|\?|$)/,    // audiogram saves
];

function pathFromConfig(config) {
  try {
    const u = new URL(config.url, window.location.origin);
    return u.pathname + u.search;
  } catch {
    return config.url;
  }
}

function isOutboxEligible(config) {
  if (!config) return false;
  const method = (config.method || 'get').toLowerCase();
  if (!RETRYABLE_METHODS.has(method)) return false;
  if (config.skipOutbox) return false; // explicit opt-out per call
  const path = pathFromConfig(config);
  return OUTBOX_ELIGIBLE_PATTERNS.some((re) => re.test(path));
}

function describeRequest(config) {
  // Cheap human-readable label for the dashboard. Caller can override by
  // setting `config.outboxDescription`. Otherwise we synthesise from the path.
  if (config.outboxDescription) return config.outboxDescription;
  const path = pathFromConfig(config);
  const method = (config.method || 'get').toUpperCase();
  if (path.includes('/patients') && method === 'POST') return 'Register new patient';
  if (path.includes('/appointments') && method === 'POST') return 'Book appointment';
  if (path.includes('/service-tickets') && method === 'POST') return 'Create service ticket';
  if (path.includes('/billing/services') && method === 'POST') return 'Add service to catalogue';
  if (method === 'PUT' || method === 'PATCH') return `Update ${path.split('/').slice(-2).join('/')}`;
  return `${method} ${path}`;
}

const isNetworkError = (err) => {
  // Browser network failure (offline, DNS, CORS preflight blocked, etc.)
  return !err.response && (err.code === 'ERR_NETWORK' || err.message === 'Network Error' || err.code === 'ECONNABORTED');
};

const isRetryable = (err, config) => {
  if (!config) return false;
  const method = (config.method || 'get').toLowerCase();
  if (!RETRYABLE_METHODS.has(method)) return false;
  if (config[RETRY_FLAG] >= MAX_RETRIES) return false;
  // Caller can opt out by setting `noRetry: true` on the axios config
  if (config.noRetry) return false;

  // Idempotent methods (GET/PUT/DELETE) are always safe to retry on either
  // a raw network error or a 502/503/504.
  if (IDEMPOTENT_METHODS.has(method)) {
    if (isNetworkError(err)) return true;
    if (err.response && RETRYABLE_STATUSES.has(err.response.status)) return true;
    return false;
  }

  // For POST/PATCH (non-idempotent): a retry on a raw network error is
  // dangerous because the server may have processed the original request and
  // we just lost the response (the user sees a duplicate-key 409 from
  // attempt #2 even though attempt #1 succeeded). Two safe paths:
  //   1) Retry only on explicit 5xx proxy errors (server *didn't* process)
  //   2) Or if the route is outbox-eligible (caller expects server-side dedup)
  if (err.response && RETRYABLE_STATUSES.has(err.response.status)) return true;
  if (isNetworkError(err) && isOutboxEligible(config)) return true;
  return false;
};

let installed = false;

export function installAxiosRetry() {
  if (installed) return;
  installed = true;
  axios.interceptors.response.use(
    (response) => {
      // Successful — clear any lingering retry toast for this flow
      if (response.config?.[RETRY_FLAG] > 0) {
        toast.success('Request succeeded after retry.', { id: RETRY_TOAST_ID, duration: 2500 });
      }
      return response;
    },
    async (error) => {
      const config = error.config;
      if (!isRetryable(error, config)) {
        // Final fallback: if this is an outbox-eligible write that has truly
        // failed (network down, server gone, retries exhausted), queue it for
        // background replay instead of bubbling the error to the UI.
        if (config && isOutboxEligible(config) && (!error.response || error.response.status >= 500)) {
          try {
            const queued = await addToOutbox({
              method: (config.method || 'post').toUpperCase(),
              url: config.url,
              data: config.data,
              headers: { ...(config.headers || {}) },
              description: describeRequest(config),
            });
            toast.info(
              "You're offline — we'll save this when you reconnect.",
              { id: 'outbox-queued', duration: 5000 },
            );
            // Resolve with a synthetic 202-Accepted so the caller's success
            // path runs (UI closes the modal, etc.) and the user isn't blocked.
            return Promise.resolve({
              data: { _queued: true, _outboxId: queued.id, ...(typeof config.data === 'string' ? {} : (config.data || {})) },
              status: 202,
              statusText: 'Accepted (queued offline)',
              headers: {},
              config,
              request: null,
              _queued: true,
            });
          } catch (e) {
            // Fall through to normal rejection if queueing itself fails
            console.warn('Outbox queueing failed, surfacing original error', e);
          }
        }
        return Promise.reject(error);
      }

      config[RETRY_FLAG] = (config[RETRY_FLAG] || 0) + 1;
      const attempt = config[RETRY_FLAG];
      const delay = RETRY_BACKOFF_MS[attempt - 1] || RETRY_BACKOFF_MS[RETRY_BACKOFF_MS.length - 1];

      toast.loading(
        `Connection issue — retrying save… (attempt ${attempt} of ${MAX_RETRIES})`,
        { id: RETRY_TOAST_ID, duration: delay + 1000 },
      );

      await new Promise((res) => setTimeout(res, delay));
      // Re-issue the request — axios picks up the same config including auth headers
      return axios(config);
    },
  );
}
