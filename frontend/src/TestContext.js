import React, { createContext, useContext, useState, useCallback } from 'react';

/**
 * TestContext — holds the "active clinical test" handoff from M01 → M02.
 * Populated when user clicks "Start Diagnostics" on a patient.
 * Consumed by M02 (Test Procedures module) to know which patient + session to open.
 */
const TestCtx = createContext(null);

const STORAGE_KEY = 'acs.activeTest';

export const TestContextProvider = ({ children }) => {
  const [activeTest, setActiveTestState] = useState(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch { return null; }
  });

  const setActiveTest = useCallback((ctx) => {
    if (ctx) localStorage.setItem(STORAGE_KEY, JSON.stringify(ctx));
    else localStorage.removeItem(STORAGE_KEY);
    setActiveTestState(ctx);
  }, []);

  const clearActiveTest = useCallback(() => setActiveTest(null), [setActiveTest]);

  return (
    <TestCtx.Provider value={{ activeTest, setActiveTest, clearActiveTest }}>
      {children}
    </TestCtx.Provider>
  );
};

export const useTestContext = () => {
  const ctx = useContext(TestCtx);
  if (!ctx) throw new Error('useTestContext must be used within TestContextProvider');
  return ctx;
};
