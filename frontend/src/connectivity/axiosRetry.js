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

const RETRY_BACKOFF_MS = [400, 1200, 3000];
const MAX_RETRIES = RETRY_BACKOFF_MS.length;
const RETRY_FLAG = '__audinexa_retry_count';
const RETRY_TOAST_ID = 'axios-retry-status';

const RETRYABLE_METHODS = new Set(['post', 'put', 'patch', 'delete']);
const RETRYABLE_STATUSES = new Set([502, 503, 504]);

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
  if (isNetworkError(err)) return true;
  if (err.response && RETRYABLE_STATUSES.has(err.response.status)) return true;
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
      if (!isRetryable(error, config)) return Promise.reject(error);

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
