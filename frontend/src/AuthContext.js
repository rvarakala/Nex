import React, { createContext, useContext, useEffect, useState, useCallback } from 'react';
import axios from 'axios';

const BACKEND_URL = process.env.REACT_APP_BACKEND_URL;
const API = `${BACKEND_URL}/api`;
const TOKEN_KEY = 'acs.token';

// Attach Bearer token to every axios request
axios.interceptors.request.use((config) => {
  const t = localStorage.getItem(TOKEN_KEY);
  if (t) config.headers = { ...(config.headers || {}), Authorization: `Bearer ${t}` };
  return config;
});

const AuthContext = createContext(null);

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);       // authenticated user object
  const [clinic, setClinic] = useState(null);
  const [loading, setLoading] = useState(true); // initial session check

  const checkSession = useCallback(async () => {
    const t = localStorage.getItem(TOKEN_KEY);
    if (!t) { setLoading(false); return; }
    try {
      const r = await axios.get(`${API}/auth/me`);
      setUser(r.data.user);
      setClinic(r.data.clinic);
    } catch {
      localStorage.removeItem(TOKEN_KEY);
      setUser(null);
      setClinic(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { checkSession(); }, [checkSession]);

  const login = async (email, password) => {
    const r = await axios.post(`${API}/auth/login`, { email, password });
    localStorage.setItem(TOKEN_KEY, r.data.access_token);
    setUser(r.data.user);
    setClinic(r.data.clinic);
    return r.data.user;
  };

  // Seeds an externally-issued JWT (e.g., from /public/clinic-signup) and
  // hydrates the user/clinic from /auth/me so downstream components see a
  // fully-authenticated session.
  const loginWithToken = async (token) => {
    localStorage.setItem(TOKEN_KEY, token);
    try {
      const r = await axios.get(`${API}/auth/me`);
      setUser(r.data.user);
      setClinic(r.data.clinic);
      return r.data.user;
    } catch (e) {
      localStorage.removeItem(TOKEN_KEY);
      setUser(null);
      setClinic(null);
      throw e;
    }
  };

  const logout = () => {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem('acs.activeTest');  // Prevent ghost-context leak between users on shared terminal
    setUser(null);
    setClinic(null);
  };

  const hasRole = (...roles) => {
    if (!user) return false;
    if (user.role === 'super_admin') return true;
    return roles.includes(user.role);
  };

  return (
    <AuthContext.Provider value={{ user, clinic, loading, login, loginWithToken, logout, hasRole }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
};
