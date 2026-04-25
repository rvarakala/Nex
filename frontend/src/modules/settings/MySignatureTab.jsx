import React, { useEffect, useRef, useState } from 'react';
import axios from 'axios';
import { Pen, Save, Trash2, AlertCircle, CheckCircle2, RefreshCw } from 'lucide-react';
import SignaturePad from '../../components/SignaturePad';
import { useAuth } from '../../AuthContext';

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;

/**
 * MySignatureTab — self-service signature manager.
 *
 * Every authenticated user can draw + save their own signature once. We also
 * collect the optional license/registration number that prints next to the
 * signature on audiogram reports.
 */
export default function MySignatureTab() {
  const { user } = useAuth();
  const padRef = useRef(null);
  const [licenseNo, setLicenseNo] = useState('');
  const [hasSig, setHasSig] = useState(false);
  const [imgUrl, setImgUrl] = useState(null);   // blob URL of the saved sig
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [savedAt, setSavedAt] = useState(0);    // timestamp to bust the img cache

  // Load existing signature + license from /api/auth/me (already includes user doc)
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const r = await axios.get(`${API}/auth/me`);
        if (!alive) return;
        const u = r.data?.user || r.data;
        const lic = u?.license_no || '';
        setLicenseNo(lic);
        if (u?.signature_image_fs_id) {
          setHasSig(true);
          // Fetch the binary into a blob URL so we can display it next to the pad.
          await refreshPreview(u.user_id || user?.user_id);
        }
      } catch (e) {
        // /auth/me may not return user_id; fall back to context.
        if (user?.signature_image_fs_id) await refreshPreview(user.user_id);
      }
    })();
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const refreshPreview = async (uid) => {
    try {
      const sig = await axios.get(`${API}/settings/users/${uid}/signature`, {
        responseType: 'blob',
      });
      setImgUrl(URL.createObjectURL(sig.data));
      setHasSig(true);
    } catch {
      setImgUrl(null);
      setHasSig(false);
    }
  };

  const save = async () => {
    setErr('');
    if (!padRef.current || padRef.current.isEmpty()) {
      setErr('Please draw your signature first');
      return;
    }
    setBusy(true);
    try {
      const dataUrl = padRef.current.getDataUrl();
      const r = await axios.post(`${API}/settings/me/signature`, {
        image_base64: dataUrl,
        license_no: licenseNo.trim() || null,
      });
      setSavedAt(Date.now());
      setHasSig(true);
      // Refresh preview from server so we see exactly what's stored.
      await refreshPreview(user?.user_id);
      padRef.current?.clear();
    } catch (e) {
      setErr(e?.response?.data?.detail || 'Save failed');
    } finally { setBusy(false); }
  };

  const remove = async () => {
    if (!window.confirm('Remove your saved signature? Reports will fall back to your typed name.')) return;
    setBusy(true); setErr('');
    try {
      await axios.delete(`${API}/settings/me/signature`);
      setHasSig(false);
      setImgUrl(null);
      padRef.current?.clear();
    } catch (e) {
      setErr(e?.response?.data?.detail || 'Delete failed');
    } finally { setBusy(false); }
  };

  return (
    <div className="p-6 max-w-3xl" data-testid="my-signature-tab">
      <div className="flex items-center gap-2 mb-1">
        <Pen size={18} className="text-indigo-600" />
        <h2 className="text-lg font-bold text-slate-800">My signature</h2>
      </div>
      <p className="text-[12px] text-slate-500 mb-6">
        Draw your signature once. AUDINEXA auto-applies it to audiogram reports
        you sign and to delivery-challan receipts you confirm. You can update or
        remove it at any time.
      </p>

      {/* Saved-state preview */}
      {hasSig && imgUrl && (
        <div className="bg-emerald-50 border border-emerald-200 rounded-lg p-4 mb-6" data-testid="my-signature-saved">
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-2 text-[12px] font-bold text-emerald-800">
              <CheckCircle2 size={14} />
              Signature on file
              {savedAt > 0 && <span className="text-[10px] font-normal text-emerald-600">(updated just now)</span>}
            </div>
            <button
              type="button"
              onClick={remove}
              disabled={busy}
              data-testid="my-signature-remove"
              className="inline-flex items-center gap-1 text-[10px] font-semibold text-rose-600 hover:text-rose-800 hover:underline disabled:text-slate-300"
            >
              <Trash2 size={11} /> Remove
            </button>
          </div>
          <div className="bg-white border border-slate-200 rounded p-2 inline-block">
            <img src={imgUrl} alt="Saved signature" className="max-h-[120px] block" data-testid="my-signature-preview" />
          </div>
          {licenseNo && (
            <div className="mt-2 text-[11px] text-emerald-800">
              License / registration: <span className="font-mono font-semibold">{licenseNo}</span>
            </div>
          )}
        </div>
      )}

      {/* New signature pad */}
      <div className="bg-white border border-slate-200 rounded-lg p-5">
        <div className="text-[10px] font-bold uppercase tracking-wider text-slate-600 mb-2">
          {hasSig ? 'Replace signature' : 'Draw your signature'}
        </div>
        <SignaturePad ref={padRef} width={580} height={170} testid="my-signature-pad" />

        <div className="mt-4 pt-4 border-t border-slate-100">
          <label className="text-[10px] font-bold uppercase tracking-wider text-slate-600 mb-1 block">
            License / registration number (optional)
          </label>
          <input
            type="text"
            value={licenseNo}
            onChange={(e) => setLicenseNo(e.target.value)}
            placeholder="e.g. RCI A-12345"
            data-testid="my-signature-license"
            className="w-full max-w-xs px-2 py-1.5 text-xs border border-slate-300 rounded focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-200"
          />
          <p className="text-[10px] text-slate-400 mt-1">
            Printed next to your signature on audiogram reports.
          </p>
        </div>

        {err && (
          <div className="mt-3 flex items-start gap-2 bg-rose-50 border border-rose-200 text-rose-700 text-[11px] px-3 py-2 rounded" data-testid="my-signature-err">
            <AlertCircle size={12} className="flex-shrink-0 mt-0.5" />
            <div>{err}</div>
          </div>
        )}

        <div className="mt-4 flex items-center gap-2">
          <button
            type="button"
            onClick={save}
            disabled={busy}
            data-testid="my-signature-save"
            className="inline-flex items-center gap-1.5 bg-indigo-600 hover:bg-indigo-700 text-white text-[12px] font-bold uppercase tracking-wide px-4 py-2 rounded shadow-sm shadow-indigo-500/30 transition-colors disabled:bg-slate-300"
          >
            {busy ? <RefreshCw size={13} className="animate-spin" /> : <Save size={13} />}
            {busy ? 'Saving…' : (hasSig ? 'Replace signature' : 'Save signature')}
          </button>
          <span className="text-[10px] text-slate-400">
            Drawing only — no photo uploads.
          </span>
        </div>
      </div>
    </div>
  );
}
