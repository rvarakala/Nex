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
    let conflictCount = 0;
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
        const httpStatus = err?.response?.status;
        // Conflict resolution rule: server-side version mismatch (409) is a
        // genuine concurrent-edit conflict — never overwrite blindly. Mark
        // separately so the user reviews it from the dashboard. 4xx errors
        // (400/422/etc.) generally mean the request itself is wrong; flip to
        // 'failed' so they don't burn through retries.
        let nextStatus = 'pending';
        if (httpStatus === 409) {
          nextStatus = 'conflict';
          conflictCount += 1;
        } else if (httpStatus && httpStatus >= 400 && httpStatus < 500) {
          nextStatus = 'failed';
          failCount += 1;
        } else if (attempts >= MAX_ATTEMPTS) {
          nextStatus = 'failed';
          failCount += 1;
        } else {
          failCount += 1;
        }
        await updateOutbox(item.id, {
          attempts,
          status: nextStatus,
          lastError: err?.response?.data?.detail || err?.message || 'Unknown error',
        });
        // If we lost connectivity again mid-drain, bail out so the rest of
        // the queue isn't burned unnecessarily.
        if (!err?.response) break;
      }
    }

    if (okCount > 0 && failCount === 0 && conflictCount === 0) {
      toast.success(`Synced ${okCount} pending ${okCount === 1 ? 'change' : 'changes'}.`, {
        id: 'outbox-drain', duration: 4000,
      });
    } else if (conflictCount > 0) {
      toast.warning(`${conflictCount} change${conflictCount === 1 ? '' : 's'} need review (someone else edited the same record). Open Sync to resolve.`, {
        id: 'outbox-drain', duration: 8000,
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
