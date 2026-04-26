/**
 * outboxReplay.js — drains the offline write queue once connectivity returns.
 *
 * Replay strategy:
 *   - Items are processed in FIFO order (oldest write first) so dependent
 *     writes (e.g. create patient → book appointment) keep their ordering.
 *   - One in-flight at a time. Concurrency would be faster but breaks ordering.
 *   - Each replay attempt is a fresh axios call that DOES NOT re-enter the
 *     outbox layer (we set `skipOutbox: true`). Successes remove the item;
 *     failures bump `attempts` and mark the item `failed` after 3 strikes
 *     so the user can intervene from the dashboard.
 *
 * The dashboard subscribes to `subscribeOutbox` for live UI updates.
 */
import axios from 'axios';
import { toast } from 'sonner';
import { listOutbox, removeOutbox, updateOutbox } from './outbox';

const MAX_ATTEMPTS = 3;
let _draining = false;

export async function drainOutbox() {
  if (_draining) return; // single-flight
  _draining = true;
  try {
    const items = await listOutbox();
    const replayable = items.filter((it) => it.status === 'pending' && it.attempts < MAX_ATTEMPTS);
    if (!replayable.length) return;

    let okCount = 0;
    let failCount = 0;
    for (const item of replayable) {
      try {
        await axios({
          method: item.method,
          url: item.url,
          data: item.data,
          headers: item.headers,
          // Critical: avoid recursion into the outbox layer; if THIS retry
          // fails we want to bubble out and re-queue manually below
          skipOutbox: true,
          noRetry: false,
        });
        await removeOutbox(item.id);
        okCount += 1;
      } catch (err) {
        const attempts = (item.attempts || 0) + 1;
        const isFinal = attempts >= MAX_ATTEMPTS;
        await updateOutbox(item.id, {
          attempts,
          status: isFinal ? 'failed' : 'pending',
          lastError: err?.response?.data?.detail || err?.message || 'Unknown error',
        });
        failCount += 1;
        // If a single replay failed because we're offline again, stop the
        // drain so we don't burn through attempts in a still-broken state.
        if (!err?.response) break;
      }
    }

    if (okCount > 0 && failCount === 0) {
      toast.success(`Synced ${okCount} pending ${okCount === 1 ? 'change' : 'changes'}.`, {
        id: 'outbox-drain', duration: 4000,
      });
    } else if (okCount > 0 && failCount > 0) {
      toast.warning(`Synced ${okCount}, but ${failCount} failed. Open Sync to review.`, {
        id: 'outbox-drain', duration: 6000,
      });
    } else if (okCount === 0 && failCount > 0) {
      toast.error(`${failCount} pending change${failCount === 1 ? '' : 's'} could not sync.`, {
        id: 'outbox-drain', duration: 6000,
      });
    }
  } finally {
    _draining = false;
  }
}

/**
 * Manual retry path used by the Sync dashboard's "Retry" button. Resets the
 * item to pending (clears prior failed status / attempts) and re-drains.
 */
export async function retryOutboxItem(id) {
  await updateOutbox(id, { status: 'pending', attempts: 0, lastError: null });
  drainOutbox();
}
