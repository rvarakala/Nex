/**
 * MfaEnforcementBanner — top-of-app banner for platform admins
 * (super_admin / founder) whose 2FA is not yet enabled.
 *
 * Two states:
 *   • Inside the 7-day grace → amber warning with countdown + CTA.
 *   • Past the grace         → rose "Enable 2FA to continue" banner. The
 *                              app is also server-side blocked, so most
 *                              endpoints will be 403'ing already; this
 *                              just explains why.
 *
 * Hidden for clinic_owner / staff / referral_partner roles — they have
 * their own optional 2FA UX but no enforcement.
 */
import React from 'react';
import { Link, useLocation } from 'react-router-dom';
import { ShieldAlert, ShieldX, ArrowRight, X } from 'lucide-react';
import { useAuth } from '../AuthContext';

const HIDE_ON_PATHS = ['/settings/security', '/login', '/forgot-password'];

export default function MfaEnforcementBanner() {
  const { user } = useAuth();
  const { pathname } = useLocation();
  const [dismissed, setDismissed] = React.useState(false);

  if (!user) return null;
  const enf = user.mfa_enforcement;
  if (!enf || !enf.required || enf.enabled) return null;
  if (HIDE_ON_PATHS.some((p) => pathname.startsWith(p))) return null;

  const blocked = !!enf.blocked;
  const daysLeft = enf.grace_days_left;

  if (!blocked && dismissed) return null;

  const wrapClass = blocked
    ? 'bg-rose-50 border-b border-rose-300 text-rose-900'
    : 'bg-amber-50 border-b border-amber-300 text-amber-900';
  const Icon = blocked ? ShieldX : ShieldAlert;

  return (
    <div
      data-testid="mfa-enforcement-banner"
      className={`${wrapClass} px-4 py-2.5 flex items-center gap-3 text-[13px]`}
    >
      <Icon size={18} className="shrink-0" />
      <div className="flex-1 leading-snug">
        {blocked ? (
          <>
            <b>Two-factor authentication is required.</b>{' '}
            Your 7-day grace window has elapsed — most of the app is now blocked for your account
            until you finish 2FA setup.
          </>
        ) : (
          <>
            <b>Your account needs 2FA within {daysLeft} day{daysLeft === 1 ? '' : 's'}.</b>{' '}
            Platform admins (founder / super_admin) must enable two-factor authentication. After
            the grace period, you'll be blocked from non-2FA endpoints until you finish setup.
          </>
        )}
      </div>
      <Link
        to="/settings/security"
        data-testid="mfa-enforcement-cta"
        className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-[12px] font-bold rounded shadow-sm ${
          blocked
            ? 'bg-rose-600 hover:bg-rose-700 text-white'
            : 'bg-amber-600 hover:bg-amber-700 text-white'
        }`}
      >
        Set up 2FA <ArrowRight size={13} />
      </Link>
      {!blocked && (
        <button
          onClick={() => setDismissed(true)}
          data-testid="mfa-enforcement-dismiss"
          aria-label="Dismiss"
          className="opacity-60 hover:opacity-100 p-1"
        >
          <X size={15} />
        </button>
      )}
    </div>
  );
}
