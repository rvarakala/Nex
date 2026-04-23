/**
 * usePageViewTracker — pings /api/activity/pageview on every route change.
 *
 * Fire-and-forget. Never blocks the UI. Backend throttles at 2s per
 * (user, path) so rapid-fire navigation doesn't storm the DB.
 *
 * Silently skips if user is not logged in or on the public landing page.
 */
import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import axios from 'axios';

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;

// Don't track these public paths
const PUBLIC_PREFIXES = ['/', '/login', '/signup', '/portal', '/partner'];

export function usePageViewTracker() {
  const location = useLocation();

  useEffect(() => {
    // Skip if no auth token
    const hasToken = typeof window !== 'undefined' &&
      (localStorage.getItem('acs.token') || localStorage.getItem('token'));
    if (!hasToken) return;

    const path = location.pathname + (location.search || '');
    // Allow admin paths, clinic paths — skip pure landing
    if (PUBLIC_PREFIXES.some((p) => p === path)) return;

    // Fire-and-forget
    axios.post(`${API}/activity/pageview`, { path }).catch(() => {});
  }, [location.pathname, location.search]);
}
