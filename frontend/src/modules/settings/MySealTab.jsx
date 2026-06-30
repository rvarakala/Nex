import React, { useEffect, useRef, useState } from 'react';
import axios from 'axios';
import {
  Stamp, Upload, Trash2, AlertCircle, CheckCircle2, RefreshCw, Image as ImageIcon,
} from 'lucide-react';
import { useAuth } from '../../AuthContext';

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;

/**
 * MySealTab — self-service company seal / stamp manager.
 *
 * Mirrors MySignatureTab in shape (preview + replace + remove) but differs in
 * INPUT MODE: signatures are drawn freehand on a canvas pad, whereas a seal
 * is almost always a pre-existing designed or scanned image. So this tab
 * accepts a file upload (drag-drop or browse) instead of a canvas.
 *
 * Accepted: PNG / JPEG / WEBP, up to 3 MB. The image is base64-encoded in
 * the browser and POSTed to /api/settings/me/seal — same wire-shape as the
 * signature endpoint so backend handling stays uniform.
 */
const MAX_BYTES = 3_000_000;
const ALLOWED = ['image/png', 'image/jpeg', 'image/jpg', 'image/webp'];

export default function MySealTab() {
  const { user } = useAuth();
  const fileRef = useRef(null);
  const [hasSeal, setHasSeal] = useState(false);
  const [imgUrl, setImgUrl] = useState(null);          // saved-seal blob URL
  const [stagedFile, setStagedFile] = useState(null);  // chosen-but-not-saved File
  const [stagedPreview, setStagedPreview] = useState(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [savedAt, setSavedAt] = useState(0);
  const [dragOver, setDragOver] = useState(false);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const r = await axios.get(`${API}/auth/me`);
        if (!alive) return;
        const u = r.data?.user || r.data;
        if (u?.seal_image_fs_id) await refreshPreview(u.user_id || user?.user_id);
      } catch {
        if (user?.seal_image_fs_id) await refreshPreview(user.user_id);
      }
    })();
    return () => { alive = false; };
  }, []);

  // Revoke object URLs on unmount so we don't leak memory in long sessions.
  useEffect(() => () => {
    if (imgUrl) URL.revokeObjectURL(imgUrl);
    if (stagedPreview) URL.revokeObjectURL(stagedPreview);
  }, [imgUrl, stagedPreview]);

  const refreshPreview = async (uid) => {
    try {
      const r = await axios.get(`${API}/settings/users/${uid}/seal`, { responseType: 'blob' });
      setImgUrl((prev) => { if (prev) URL.revokeObjectURL(prev); return URL.createObjectURL(r.data); });
      setHasSeal(true);
    } catch {
      setImgUrl(null);
      setHasSeal(false);
    }
  };

  const validateFile = (f) => {
    if (!f) return 'No file selected';
    if (!ALLOWED.includes(f.type)) return 'Only PNG, JPEG, or WEBP files are accepted';
    if (f.size > MAX_BYTES) return `File too large (max ${Math.round(MAX_BYTES / 1_000_000)} MB)`;
    return null;
  };

  const stageFile = (f) => {
    const error = validateFile(f);
    if (error) { setErr(error); return; }
    setErr('');
    setStagedFile(f);
    setStagedPreview((prev) => { if (prev) URL.revokeObjectURL(prev); return URL.createObjectURL(f); });
  };

  const onFileChange = (e) => {
    const f = e.target.files?.[0];
    if (f) stageFile(f);
    // Reset input so the same file can be re-picked after a removal.
    if (fileRef.current) fileRef.current.value = '';
  };

  const onDrop = (e) => {
    e.preventDefault();
    setDragOver(false);
    const f = e.dataTransfer.files?.[0];
    if (f) stageFile(f);
  };

  const fileToDataUrl = (file) => new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error);
    reader.onload = () => resolve(reader.result);
    reader.readAsDataURL(file);
  });

  const save = async () => {
    setErr('');
    if (!stagedFile) { setErr('Please choose an image first'); return; }
    setBusy(true);
    try {
      const dataUrl = await fileToDataUrl(stagedFile);
      await axios.post(`${API}/settings/me/seal`, { image_base64: dataUrl });
      setSavedAt(Date.now());
      setHasSeal(true);
      // Clear staged file so the upload zone resets after success
      if (stagedPreview) URL.revokeObjectURL(stagedPreview);
      setStagedFile(null);
      setStagedPreview(null);
      await refreshPreview(user?.user_id);
    } catch (e) {
      const detail = e?.response?.data?.detail;
      setErr(typeof detail === 'string' ? detail : 'Save failed — please try again.');
    } finally { setBusy(false); }
  };

  const remove = async () => {
    if (!window.confirm('Remove your saved seal? Reports will print without a seal until you re-upload one.')) return;
    setBusy(true); setErr('');
    try {
      await axios.delete(`${API}/settings/me/seal`);
      if (imgUrl) URL.revokeObjectURL(imgUrl);
      setHasSeal(false);
      setImgUrl(null);
    } catch (e) {
      setErr(e?.response?.data?.detail || 'Delete failed');
    } finally { setBusy(false); }
  };

  const cancelStaged = () => {
    if (stagedPreview) URL.revokeObjectURL(stagedPreview);
    setStagedFile(null);
    setStagedPreview(null);
    setErr('');
  };

  return (
    <div className="p-6 max-w-3xl" data-testid="my-seal-tab">
      <div className="flex items-center gap-2 mb-1">
        <Stamp size={18} className="text-indigo-600" />
        <h2 className="text-lg font-bold text-slate-800">My seal / stamp</h2>
      </div>
      <p className="text-[12px] text-slate-500 mb-6">
        Upload your official seal or company stamp. AUDINEXA will be able to
        include it on signed reports, invoices, and delivery challans (rendered
        next to your signature). PNG, JPEG, or WEBP up to 3 MB.
      </p>

      {/* Saved-state preview */}
      {hasSeal && imgUrl && (
        <div
          className="bg-emerald-50 border border-emerald-200 rounded-lg p-4 mb-6"
          data-testid="my-seal-saved"
        >
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-2 text-[12px] font-bold text-emerald-800">
              <CheckCircle2 size={14} />
              Seal on file
              {savedAt > 0 && (
                <span className="text-[10px] font-normal text-emerald-600">(updated just now)</span>
              )}
            </div>
            <button
              type="button"
              onClick={remove}
              disabled={busy}
              data-testid="my-seal-remove"
              className="inline-flex items-center gap-1 text-[10px] font-semibold text-rose-600 hover:text-rose-800 hover:underline disabled:text-slate-300"
            >
              <Trash2 size={11} /> Remove
            </button>
          </div>
          <div className="bg-white border border-slate-200 rounded p-3 inline-block">
            <img
              src={imgUrl}
              alt="Saved seal"
              className="max-h-[200px] max-w-[260px] block object-contain"
              data-testid="my-seal-preview"
            />
          </div>
        </div>
      )}

      {/* Upload zone */}
      <div className="bg-white border border-slate-200 rounded-lg p-5">
        <div className="text-[10px] font-bold uppercase tracking-wider text-slate-600 mb-3">
          {hasSeal ? 'Replace seal' : 'Upload seal image'}
        </div>

        {!stagedFile ? (
          <label
            htmlFor="seal-file-input"
            onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
            onDragLeave={() => setDragOver(false)}
            onDrop={onDrop}
            data-testid="my-seal-dropzone"
            className={`flex flex-col items-center justify-center w-full cursor-pointer rounded-lg border-2 border-dashed transition-colors px-6 py-10 ${
              dragOver
                ? 'border-indigo-500 bg-indigo-50/60'
                : 'border-slate-300 bg-slate-50 hover:border-indigo-400 hover:bg-indigo-50/40'
            }`}
          >
            <Upload size={28} className={dragOver ? 'text-indigo-600' : 'text-slate-400'} />
            <div className="mt-3 text-[13px] font-semibold text-slate-700">
              Drag & drop your seal here, or <span className="text-indigo-600 underline">browse</span>
            </div>
            <div className="mt-1 text-[10px] text-slate-400">
              PNG, JPEG, or WEBP · transparent background recommended · max 3 MB
            </div>
            <input
              ref={fileRef}
              id="seal-file-input"
              type="file"
              accept="image/png,image/jpeg,image/jpg,image/webp"
              onChange={onFileChange}
              data-testid="my-seal-file-input"
              className="hidden"
            />
          </label>
        ) : (
          <div className="flex items-start gap-4 bg-indigo-50/40 border border-indigo-200 rounded-lg p-4" data-testid="my-seal-staged">
            <div className="bg-white border border-slate-200 rounded p-2 shrink-0">
              <img
                src={stagedPreview}
                alt="Selected seal"
                className="max-h-[160px] max-w-[160px] object-contain block"
                data-testid="my-seal-staged-preview"
              />
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-1.5 text-[12px] font-semibold text-slate-800">
                <ImageIcon size={12} className="text-indigo-600" />
                <span className="truncate">{stagedFile.name}</span>
              </div>
              <div className="text-[10px] text-slate-500 mt-0.5">
                {(stagedFile.size / 1024).toFixed(1)} KB · {stagedFile.type.replace('image/', '').toUpperCase()}
              </div>
              <button
                type="button"
                onClick={cancelStaged}
                disabled={busy}
                data-testid="my-seal-cancel-staged"
                className="mt-3 text-[10px] font-semibold text-slate-500 hover:text-rose-600 hover:underline disabled:text-slate-300"
              >
                ← Choose a different image
              </button>
            </div>
          </div>
        )}

        {err && (
          <div
            className="mt-3 flex items-start gap-2 bg-rose-50 border border-rose-200 text-rose-700 text-[11px] px-3 py-2 rounded"
            data-testid="my-seal-err"
          >
            <AlertCircle size={12} className="flex-shrink-0 mt-0.5" />
            <div>{err}</div>
          </div>
        )}

        <div className="mt-4 flex items-center gap-2">
          <button
            type="button"
            onClick={save}
            disabled={busy || !stagedFile}
            data-testid="my-seal-save"
            className="inline-flex items-center gap-1.5 bg-indigo-600 hover:bg-indigo-700 text-white text-[12px] font-bold uppercase tracking-wide px-4 py-2 rounded shadow-sm shadow-indigo-500/30 transition-colors disabled:bg-slate-300 disabled:shadow-none"
          >
            {busy ? <RefreshCw size={13} className="animate-spin" /> : <Upload size={13} />}
            {busy ? 'Uploading…' : (hasSeal ? 'Replace seal' : 'Save seal')}
          </button>
          <span className="text-[10px] text-slate-400">
            Tip: a PNG with a transparent background prints best on receipts.
          </span>
        </div>
      </div>
    </div>
  );
}
