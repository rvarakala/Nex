/**
 * SyncDashboard — visibility into the offline write queue.
 *
 * Renders two pieces:
 *   - <SyncPill />     a tiny header pill: 🟢 synced / 🟡 N pending / 🔴 N failed
 *   - <SyncDrawer />   slide-out side panel with full queue + retry/discard
 *
 * Why both: the pill is always visible (so users feel in control); the drawer
 * is opt-in (so we don't take screen real estate when nothing's queued).
 */
import React, { useEffect, useState } from 'react';
import { CircleCheck, CloudUpload, AlertTriangle, X, RefreshCw, Trash2 } from 'lucide-react';
import { listOutbox, subscribeOutbox, removeOutbox } from './outbox';
import { drainOutbox, retryOutboxItem } from './outboxReplay';
import { useConnectivity } from './ConnectivityContext';

function useOutboxItems() {
  const [items, setItems] = useState([]);
  useEffect(() => {
    const refresh = () => listOutbox().then(setItems);
    refresh();
    const unsub = subscribeOutbox(refresh);
    return unsub;
  }, []);
  const pending = items.filter((i) => i.status === 'pending').length;
  const failed = items.filter((i) => i.status === 'failed').length;
  const conflicts = items.filter((i) => i.status === 'conflict').length;
  return { items, pending, failed, conflicts };
}

export function SyncPill({ onClick }) {
  const { pending, failed, conflicts } = useOutboxItems();
  const total = pending + failed + conflicts;
  if (total === 0) return null; // hide when nothing's queued — keeps the topbar quiet

  let config;
  if (conflicts > 0) {
    config = { color: 'text-amber-900 bg-amber-100 border-amber-300', dot: 'bg-amber-600', icon: AlertTriangle, label: `${conflicts} conflict${conflicts === 1 ? '' : 's'}` };
  } else if (failed > 0) {
    config = { color: 'text-rose-700 bg-rose-50 border-rose-300', dot: 'bg-rose-500', icon: AlertTriangle, label: `${failed} failed` };
  } else {
    config = { color: 'text-amber-800 bg-amber-50 border-amber-200', dot: 'bg-amber-500', icon: CloudUpload, label: `${pending} pending` };
  }
  const Icon = config.icon;

  return (
    <button
      type="button"
      onClick={onClick}
      title="Open sync queue"
      data-testid="sync-pill"
      data-pending={pending}
      data-failed={failed}
      data-conflicts={conflicts}
      className={`flex items-center gap-1.5 text-[10px] font-bold border rounded-full px-2 py-0.5 transition ${config.color} hover:brightness-95`}
    >
      <span className={`w-1.5 h-1.5 rounded-full ${config.dot} animate-pulse`} />
      <Icon size={11} />
      <span>{config.label}</span>
    </button>
  );
}

export function SyncDrawer({ open, onClose }) {
  const { items, pending, failed, conflicts } = useOutboxItems();
  const { status: connStatus } = useConnectivity();

  if (!open) return null;

  return (
    <div
      role="dialog"
      aria-label="Sync queue"
      data-testid="sync-drawer"
      className="fixed inset-0 z-[55] flex justify-end"
    >
      <div className="absolute inset-0 bg-black/30" onClick={onClose} />
      <div className="relative bg-white w-[420px] max-w-full h-full flex flex-col shadow-2xl animate-slide-in">
        <div className="px-4 py-3 border-b border-slate-200 flex items-center justify-between">
          <div>
            <h2 className="text-sm font-bold text-slate-800">Sync Queue</h2>
            <p className="text-[10px] text-slate-500 mt-0.5">
              Changes saved on this device while offline. They sync automatically when the connection returns.
            </p>
          </div>
          <button onClick={onClose} aria-label="Close" data-testid="sync-drawer-close" className="text-slate-500 hover:text-slate-800">
            <X size={16} />
          </button>
        </div>

        {/* Status summary */}
        <div className="px-4 py-2 border-b border-slate-100 flex items-center gap-3 text-[11px] flex-wrap">
          <span className="inline-flex items-center gap-1 text-emerald-700"><CircleCheck size={12} /> Synced</span>
          <span className="inline-flex items-center gap-1 text-amber-700" data-testid="sync-pending-count"><CloudUpload size={12} /> {pending} pending</span>
          {conflicts > 0 && (
            <span className="inline-flex items-center gap-1 text-amber-900 font-semibold" data-testid="sync-conflict-count">
              <AlertTriangle size={12} /> {conflicts} conflict{conflicts === 1 ? '' : 's'}
            </span>
          )}
          <span className="inline-flex items-center gap-1 text-rose-700" data-testid="sync-failed-count"><AlertTriangle size={12} /> {failed} failed</span>
          <button
            onClick={() => drainOutbox()}
            disabled={connStatus === 'offline' || (pending + failed) === 0}
            data-testid="sync-drain-all"
            className="ml-auto text-[10px] font-bold bg-indigo-600 hover:bg-indigo-700 disabled:bg-slate-300 text-white rounded px-2 py-1"
          >
            Sync now
          </button>
        </div>

        {/* Conflict-resolution policy hint — only visible when there's a conflict */}
        {conflicts > 0 && (
          <div className="mx-4 mt-3 bg-amber-50 border border-amber-200 rounded-md p-2.5 text-[11px] text-amber-900 leading-snug" data-testid="sync-conflict-hint">
            <div className="font-bold mb-0.5">Conflict resolution rule</div>
            Someone else edited the same record while your change was offline.
            <b> "Force overwrite" </b> sends your version anyway (last-write-wins).
            <b> "Discard"</b> drops your change and keeps the server version. When in doubt, refresh the record on screen first to compare.
          </div>
        )}

        {/* List */}
        <div className="flex-1 overflow-auto" data-testid="sync-list">
          {items.length === 0 ? (
            <div className="p-8 text-center text-xs text-slate-400 italic flex flex-col items-center gap-2">
              <CircleCheck size={32} className="text-emerald-400" />
              All changes are synced.
            </div>
          ) : (
            <ul className="divide-y divide-slate-100">
              {items.map((it) => (
                <li key={it.id} className="px-4 py-2.5" data-testid={`sync-row-${it.id}`}>
                  <div className="flex items-start gap-2">
                    <div className="flex-1 min-w-0">
                      <div className="text-xs font-semibold text-slate-800 truncate">{it.description}</div>
                      <div className="text-[10px] text-slate-500 mt-0.5">
                        {it.method} · queued {timeAgo(it.createdAt)} · attempts: {it.attempts}
                      </div>
                      {it.lastError && (
                        <div className="text-[10px] text-rose-600 mt-0.5 truncate" title={it.lastError}>
                          ⚠ {it.lastError}
                        </div>
                      )}
                    </div>
                    <span className={`text-[9px] font-bold uppercase px-1.5 py-0.5 rounded ${
                      it.status === 'failed'
                        ? 'bg-rose-100 text-rose-700'
                        : it.status === 'conflict'
                        ? 'bg-amber-200 text-amber-900'
                        : 'bg-amber-100 text-amber-800'
                    }`}>
                      {it.status}
                    </span>
                  </div>
                  <div className="flex items-center gap-2 mt-1.5">
                    {it.status === 'conflict' ? (
                      <button
                        onClick={() => retryOutboxItem(it.id)}
                        disabled={connStatus === 'offline'}
                        data-testid={`sync-force-${it.id}`}
                        className="text-[10px] inline-flex items-center gap-1 text-amber-800 hover:text-amber-950 disabled:text-slate-400 font-semibold"
                      >
                        <RefreshCw size={10} /> Force overwrite
                      </button>
                    ) : (
                      <button
                        onClick={() => retryOutboxItem(it.id)}
                        disabled={connStatus === 'offline'}
                        data-testid={`sync-retry-${it.id}`}
                        className="text-[10px] inline-flex items-center gap-1 text-indigo-700 hover:text-indigo-900 disabled:text-slate-400 font-semibold"
                      >
                        <RefreshCw size={10} /> Retry
                      </button>
                    )}
                    <button
                      onClick={() => { if (confirm('Discard this change permanently?')) removeOutbox(it.id); }}
                      data-testid={`sync-discard-${it.id}`}
                      className="text-[10px] inline-flex items-center gap-1 text-slate-500 hover:text-rose-700 font-semibold"
                    >
                      <Trash2 size={10} /> Discard
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}

function timeAgo(ts) {
  const s = Math.max(1, Math.round((Date.now() - ts) / 1000));
  if (s < 60) return `${s}s ago`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  return `${h}h ago`;
}
