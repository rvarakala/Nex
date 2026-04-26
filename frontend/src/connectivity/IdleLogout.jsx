/**
 * IdleLogout — auto-logout after inactivity.
 *
 * Why: clinic terminals (front desk especially) are often shared between
 * shifts; an unattended laptop can leak patient data. After N minutes
 * of no mouse/keyboard/touch activity we sign the user out and surface a
 * neutral "session expired" toast.
 *
 * Default: 30 min. Override per-clinic from the user's role:
 *   - `front_desk` → 15 min (highest churn, most-shared)
 *   - `clinic_owner` / `super_admin` → 60 min (less risk of leaving unattended)
 *
 * Activity sources: mousemove (throttled), keydown, touchstart, click,
 * visibilitychange→visible. We deliberately ignore axios traffic so a
 * browser-tab left open with polling doesn't keep the session alive.
 */
import { useEffect, useRef } from 'react';
import { toast } from 'sonner';
import { useAuth } from '../AuthContext';

const ROLE_TIMEOUT_MIN = {
  front_desk: 15,
  technician: 30,
  audiologist: 30,
  accounts: 30,
  clinic_owner: 60,
  super_admin: 60,
  founder: 60,
};
const DEFAULT_TIMEOUT_MIN = 30;
const ACTIVITY_THROTTLE_MS = 5_000; // batch mousemove updates

export default function IdleLogout() {
  const { user, logout } = useAuth();
  const lastActivityRef = useRef(Date.now());

  useEffect(() => {
    if (!user) return undefined;

    const timeoutMs = (ROLE_TIMEOUT_MIN[user.role] || DEFAULT_TIMEOUT_MIN) * 60 * 1000;
    let throttleTimer = 0;

    const bumpActivity = () => {
      const now = Date.now();
      if (now - throttleTimer < ACTIVITY_THROTTLE_MS) return;
      throttleTimer = now;
      lastActivityRef.current = now;
    };

    const onVisible = () => {
      if (document.visibilityState === 'visible') bumpActivity();
    };

    ['mousedown', 'keydown', 'touchstart', 'click'].forEach((evt) =>
      window.addEventListener(evt, bumpActivity, { passive: true }),
    );
    window.addEventListener('mousemove', bumpActivity, { passive: true });
    document.addEventListener('visibilitychange', onVisible);

    const tick = setInterval(() => {
      const idleMs = Date.now() - lastActivityRef.current;
      if (idleMs >= timeoutMs) {
        toast.warning('Signed out for inactivity. Please log in again.', {
          id: 'idle-logout', duration: 8000,
        });
        try { logout(); } catch { /* noop */ }
      }
    }, 30_000);

    return () => {
      ['mousedown', 'keydown', 'touchstart', 'click'].forEach((evt) =>
        window.removeEventListener(evt, bumpActivity),
      );
      window.removeEventListener('mousemove', bumpActivity);
      document.removeEventListener('visibilitychange', onVisible);
      clearInterval(tick);
    };
  }, [user, logout]);

  return null;
}
