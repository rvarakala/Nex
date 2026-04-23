/**
 * Thin orange progress bar at the very top of the page.
 *
 * Triggers:
 *   1. Every time the route changes (appears briefly, completes in ~500ms)
 *   2. Every in-flight axios request (appears as long as any request is pending)
 *
 * Uses two signals OR'd together so it stays visible during both navigation
 * and data fetching — mimicking GitHub's/Linear's loading UX.
 */
import React, { useEffect, useState, useRef } from 'react';
import { useLocation } from 'react-router-dom';
import axios from 'axios';

export default function TopProgressBar() {
  const location = useLocation();
  const [activeRequests, setActiveRequests] = useState(0);
  const [navLoading, setNavLoading] = useState(false);
  const reqIdRef = useRef(0);

  // 1. Axios interceptors — count in-flight requests
  useEffect(() => {
    const reqI = axios.interceptors.request.use((config) => {
      setActiveRequests((n) => n + 1);
      return config;
    });
    const resI = axios.interceptors.response.use(
      (r) => { setActiveRequests((n) => Math.max(0, n - 1)); return r; },
      (e) => { setActiveRequests((n) => Math.max(0, n - 1)); return Promise.reject(e); }
    );
    return () => {
      axios.interceptors.request.eject(reqI);
      axios.interceptors.response.eject(resI);
    };
  }, []);

  // 2. Navigation loading — quick fade-in/out on every route change
  useEffect(() => {
    setNavLoading(true);
    const id = ++reqIdRef.current;
    const t = setTimeout(() => {
      if (reqIdRef.current === id) setNavLoading(false);
    }, 450);
    return () => clearTimeout(t);
  }, [location.pathname]);

  const isLoading = activeRequests > 0 || navLoading;

  return (
    <div
      data-testid="top-progress"
      className="fixed top-0 left-0 right-0 z-[9999] pointer-events-none"
      style={{ height: isLoading ? '3px' : '0px', transition: 'height 150ms ease-out' }}
    >
      <div
        className="h-full bg-gradient-to-r from-orange-400 via-rose-500 to-fuchsia-500 shadow-[0_0_10px_rgba(251,146,60,0.6)]"
        style={{
          width: isLoading ? '100%' : '0%',
          transition: isLoading ? 'width 1.2s cubic-bezier(0.1, 0.8, 0.2, 1)' : 'width 200ms ease-out',
          animation: isLoading ? 'topbar-shimmer 1.2s linear infinite' : 'none',
        }}
      />
      <style>{`
        @keyframes topbar-shimmer {
          0%   { opacity: 0.85; }
          50%  { opacity: 1; }
          100% { opacity: 0.85; }
        }
      `}</style>
    </div>
  );
}
