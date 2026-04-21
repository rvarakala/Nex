import React from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from '../AuthContext';

export const ProtectedRoute = ({ children }) => {
  const { user, loading } = useAuth();
  if (loading) {
    return (
      <div className="h-screen flex items-center justify-center bg-slate-100">
        <div className="text-sm text-slate-500 animate-pulse">Loading session…</div>
      </div>
    );
  }
  if (!user) return <Navigate to="/login" replace />;
  return children;
};

export const RoleGate = ({ allow, children, fallback = null }) => {
  const { hasRole } = useAuth();
  if (!hasRole(...allow)) return fallback;
  return children;
};
