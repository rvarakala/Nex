import React, { useEffect, useState } from 'react';
import axios from 'axios';
import { Link } from 'react-router-dom';
import { Pen, X, ArrowRight } from 'lucide-react';
import { useAuth } from '../AuthContext';

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;

// Roles whose name appears on patient-facing artefacts (audiogram report,
// challan, prescription, etc.). For these users we nudge once to upload a
// drawn signature so reports auto-stamp going forward.
const SIGNING_ROLES = new Set(['audiologist', 'clinic_owner']);

const DISMISS_KEY = 'audinexa.signature-nudge-dismissed';

/**
 * SignatureNudgeBanner — slim, friendly reminder shown to audiologists /
 * clinic owners who haven't drawn a signature yet. Self-hides forever once
 * they save one (or click "later"). Sits above the main content; never blocks.
 */
export default function SignatureNudgeBanner() {
  const { user } = useAuth();
  const [dismissed, setDismissed] = useState(() => {
    try { return localStorage.getItem(DISMISS_KEY) === '1'; } catch { return false; }
  });
  const [hasSig, setHasSig] = useState(true); // optimistic — only show banner once we know there's no sig

  useEffect(() => {
    if (!user || !SIGNING_ROLES.has(user.role)) return;
    let alive = true;
    (async () => {
      try {
        const r = await axios.get(`${API}/auth/me`);
        if (!alive) return;
        const u = r.data?.user || r.data;
        setHasSig(!!u?.signature_image_fs_id);
      } catch { /* ignore — keep banner hidden if we can't tell */ }
    })();
    return () => { alive = false; };
  }, [user]);

  if (!user || !SIGNING_ROLES.has(user.role)) return null;
  if (hasSig || dismissed) return null;

  const dismiss = () => {
    try { localStorage.setItem(DISMISS_KEY, '1'); } catch { /* ignore */ }
    setDismissed(true);
  };

  return (
    <div
      className="bg-gradient-to-r from-indigo-50 via-white to-indigo-50 border-b border-indigo-200 px-4 py-2 flex items-center gap-3"
      data-testid="signature-nudge-banner"
    >
      <div className="w-7 h-7 rounded-full bg-indigo-600 text-white flex items-center justify-center flex-shrink-0">
        <Pen size={13} strokeWidth={2.5} />
      </div>
      <div className="flex-1 min-w-0">
        <div className="text-[12px] font-semibold text-slate-800">
          Add your signature once — auto-stamped on every audiogram report and challan you sign.
        </div>
        <div className="text-[11px] text-slate-500 hidden sm:block">
          Takes 10 seconds. Use mouse, stylus or finger.
        </div>
      </div>
      <Link
        to="/settings/signature"
        data-testid="signature-nudge-cta"
        className="inline-flex items-center gap-1 bg-indigo-600 hover:bg-indigo-700 text-white text-[11px] font-bold uppercase tracking-wider px-3 py-1.5 rounded shadow-sm shadow-indigo-500/30 transition-colors"
      >
        Sign now <ArrowRight size={12} />
      </Link>
      <button
        type="button"
        onClick={dismiss}
        data-testid="signature-nudge-dismiss"
        title="Hide"
        className="w-7 h-7 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded flex items-center justify-center"
      >
        <X size={14} />
      </button>
    </div>
  );
}
