/**
 * ConnectivityContext — central network-status state for the whole app.
 *
 * Tracks 3 states based on:
 *   1. The browser's `navigator.onLine` (cheap, but only catches OS-level offline)
 *   2. A periodic ping to /api/health (catches "internet looks fine but server unreachable")
 *   3. Roundtrip latency of that ping ('slow' if > 2.5s)
 *
 * Components consume this via `useConnectivity()` to:
 *   - Show a banner / pill in AppShell
 *   - Decide whether to retry / queue a failed write
 *   - Pause polling when offline
 *
 * Public API:
 *   const { status, lastChecked, retry } = useConnectivity();
 *   status: 'online' | 'slow' | 'offline'
 */
import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import axios from 'axios';
import { toast, Toaster } from 'sonner';
import { installAxiosRetry } from './axiosRetry';
import { installOfflineCache, onCacheServed } from './offlineCache';

// Install the retry + offline-cache interceptors exactly once at module load.
// Order rationale: retry handles writes (POST/PUT/etc), cache handles reads
// (GET). They don't overlap, so install order doesn't change behavior — but
// we register retry first by convention so its onReject runs before cache's.
installAxiosRetry();
installOfflineCache(axios);

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;
const PING_INTERVAL_MS = 30_000;     // routine check
const PING_FAST_INTERVAL_MS = 5_000; // when offline, check more aggressively to recover quickly
const SLOW_THRESHOLD_MS = 2_500;
const PING_TIMEOUT_MS = 6_000;

const Ctx = createContext({
  status: 'online',
  lastChecked: null,
  latencyMs: 0,
  retry: () => {},
  cacheServedAt: null,
});

export function ConnectivityProvider({ children }) {
  const [status, setStatus] = useState(navigator.onLine ? 'online' : 'offline');
  const [lastChecked, setLastChecked] = useState(null);
  const [latencyMs, setLatencyMs] = useState(0);
  // Bumped to a Date each time the cache layer serves a stale response.
  // Auto-clears when we go back online so the indicator only shows during outages.
  const [cacheServedAt, setCacheServedAt] = useState(null);

  // Hold latest status in a ref to compare without re-running effects on every change
  const prevStatusRef = useRef(status);

  // Listen for cache fallbacks from the offline cache layer
  useEffect(() => onCacheServed(({ cachedAt }) => {
    setCacheServedAt(new Date(cachedAt));
  }), []);

  // Clear the "served from cache" hint as soon as we recover network
  useEffect(() => {
    if (status === 'online' && cacheServedAt) setCacheServedAt(null);
  }, [status, cacheServedAt]);

  const checkNow = useCallback(async () => {
    if (!navigator.onLine) {
      setStatus('offline');
      setLastChecked(new Date());
      return 'offline';
    }
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), PING_TIMEOUT_MS);
    const t0 = performance.now();
    try {
      const resp = await fetch(`${API}/health`, {
        method: 'GET',
        signal: ctrl.signal,
        cache: 'no-store',
      });
      const ms = Math.round(performance.now() - t0);
      setLatencyMs(ms);
      setLastChecked(new Date());
      if (!resp.ok) {
        setStatus('offline');
        return 'offline';
      }
      const next = ms > SLOW_THRESHOLD_MS ? 'slow' : 'online';
      setStatus(next);
      return next;
    } catch {
      setStatus('offline');
      setLastChecked(new Date());
      return 'offline';
    } finally {
      clearTimeout(timer);
    }
  }, []);

  // Browser online/offline events — instant signal (works when laptop wifi off)
  useEffect(() => {
    const onOnline = () => { checkNow(); };
    const onOffline = () => { setStatus('offline'); setLastChecked(new Date()); };
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    return () => {
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
    };
  }, [checkNow]);

  // Periodic ping — interval shortens when we believe we're offline so recovery feels snappy
  useEffect(() => {
    checkNow();
    const id = setInterval(checkNow, status === 'offline' ? PING_FAST_INTERVAL_MS : PING_INTERVAL_MS);
    return () => clearInterval(id);
  }, [status, checkNow]);

  // Notify the user on transitions (offline ⇄ online), not on slow→online flutter
  useEffect(() => {
    const prev = prevStatusRef.current;
    if (prev === status) return;
    if (prev !== 'offline' && status === 'offline') {
      toast.error('You are offline — saves will retry when the connection returns.', {
        id: 'connectivity-status',
        duration: Infinity,
      });
    } else if (prev === 'offline' && status !== 'offline') {
      toast.success('Connection restored.', { id: 'connectivity-status', duration: 4000 });
    }
    prevStatusRef.current = status;
  }, [status]);

  return (
    <Ctx.Provider value={{ status, lastChecked, latencyMs, retry: checkNow, cacheServedAt }}>
      <Toaster position="top-center" richColors closeButton />
      {children}
    </Ctx.Provider>
  );
}

export function useConnectivity() {
  return useContext(Ctx);
}
