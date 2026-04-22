/**
 * SubscriptionContext — pulls /api/subscription/access once per session.
 * Provides: {tier, access: {frontdesk, diagnostics, 'hearing-aids', repair, analytics}, isTrialing}
 *
 * Super-admin always gets full access (bypass=true from backend).
 */
import React, { createContext, useContext, useEffect, useState, useCallback } from 'react';
import axios from 'axios';
import { useAuth } from './AuthContext';

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;

const SubscriptionContext = createContext({
  tier: 'BASIC',
  access: {},
  superAdminBypass: false,
  trialActive: false,
  trialDaysLeft: null,
  loading: true,
  refresh: () => {},
});

export function SubscriptionProvider({ children }) {
  const { user } = useAuth();
  const [state, setState] = useState({
    tier: 'BASIC', access: {}, superAdminBypass: false,
    trialActive: false, trialDaysLeft: null, loading: true,
  });

  const refresh = useCallback(async () => {
    if (!user) {
      setState((s) => ({ ...s, loading: false }));
      return;
    }
    try {
      const [a, m] = await Promise.all([
        axios.get(`${API}/subscription/access`),
        axios.get(`${API}/subscription/my`),
      ]);
      setState({
        tier: a.data.tier,
        access: a.data.access || {},
        superAdminBypass: !!a.data.super_admin_bypass,
        trialActive: !!m.data.trial_active,
        trialDaysLeft: m.data.trial_days_left,
        loading: false,
      });
    } catch {
      setState((s) => ({ ...s, loading: false }));
    }
  }, [user]);

  useEffect(() => { refresh(); }, [refresh]);

  return (
    <SubscriptionContext.Provider value={{ ...state, refresh }}>
      {children}
    </SubscriptionContext.Provider>
  );
}

export function useSubscription() {
  return useContext(SubscriptionContext);
}

/** Gate a component behind a module — shows upgrade card if blocked. */
export function ModuleGate({ module, children }) {
  const { access, tier, superAdminBypass, loading } = useSubscription();
  if (loading) return <div className="p-8 text-center text-slate-400 text-sm">Loading…</div>;
  if (superAdminBypass || access[module]) return children;
  return (
    <div className="p-12 max-w-xl mx-auto text-center" data-testid={`gate-${module}`}>
      <div className="text-6xl mb-4">🔒</div>
      <h1 className="text-2xl font-bold text-slate-800 mb-2">This module is locked</h1>
      <p className="text-slate-500 mb-6">
        The <b className="capitalize">{module.replace('-', ' ')}</b> module isn't included in
        your current <b>{tier}</b> plan. Upgrade to Premium to unlock service & repair,
        full analytics, trade-ins, and multi-branch.
      </p>
      <a href="/#pricing" target="_blank" rel="noreferrer"
         className="inline-block px-5 py-2 bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-bold rounded"
         data-testid={`gate-${module}-upgrade-cta`}>
        See Plans
      </a>
    </div>
  );
}
