/**
 * MyProfileTab — self-service profile manager for every authenticated user.
 *
 * Industry context: clinics typically need to print or display the
 * audiologist's professional credentials on reports & invoices — RCI
 * registration number, qualifications (MASLP / M.Sc. Audiology), license
 * number, specialization, years of experience. We collect all of it here
 * once instead of asking on every report.
 *
 * The page also exposes:
 *   • Avatar / photo upload (GridFS via /api/settings/me/avatar)
 *   • Self-service change-password (consumes admin-set temp password)
 *   • Read-only view of clinic identity (Clinic ID, Tier, MRD prefix, GST)
 *   • Banner if `must_change_password` is set on the user
 */
import React, { useEffect, useRef, useState } from 'react';
import axios from 'axios';
import { toast } from 'sonner';
import {
  User, Camera, Trash2, KeyRound, CheckCircle2, AlertTriangle, Save, Loader2,
  Building2, Shield, Eye, EyeOff,
} from 'lucide-react';
import { useAuth } from '../../AuthContext';
import { useNavigate } from 'react-router-dom';

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;

const COMMON_LANGUAGES = ['English', 'Hindi', 'Kannada', 'Tamil', 'Telugu', 'Malayalam', 'Marathi', 'Bengali', 'Gujarati', 'Punjabi'];

export default function MyProfileTab() {
  const { user: authUser, refreshUser, logout } = useAuth();
  const navigate = useNavigate();

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [profile, setProfile] = useState(null);
  const [clinic, setClinic] = useState(null);
  const [form, setForm] = useState({});
  const [avatarVer, setAvatarVer] = useState(0); // bust cache after upload

  const fileRef = useRef(null);

  const load = async () => {
    setLoading(true);
    try {
      const r = await axios.get(`${API}/settings/me/profile`);
      // Session-mismatch guard: if the profile returned belongs to a
      // different user than the one AuthContext thinks is logged in, the
      // cookie was swapped by a peer tab (or a stale bearer). Force a
      // full re-auth so nobody sees another user's data.
      if (authUser?.user_id && r.data.user?.user_id && r.data.user.user_id !== authUser.user_id) {
        toast.error('Your session changed in another tab. Please sign in again.');
        try { await logout(); } catch { /* fall through */ }
        navigate('/login', { replace: true });
        return;
      }
      setProfile(r.data.user);
      setClinic(r.data.clinic);
      setForm({
        name:                  r.data.user.name || '',
        phone:                 r.data.user.phone || '',
        designation:           r.data.user.designation || '',
        qualifications:        r.data.user.qualifications || '',
        license_no:            r.data.user.license_no || '',
        rci_registration_no:   r.data.user.rci_registration_no || '',
        specialization:        r.data.user.specialization || '',
        years_of_experience:   r.data.user.years_of_experience ?? '',
        languages:             Array.isArray(r.data.user.languages) ? r.data.user.languages : [],
        bio:                   r.data.user.bio || '',
      });
    } catch (err) {
      toast.error(err?.response?.data?.detail || 'Could not load profile');
    } finally { setLoading(false); }
  };
  // Also force a fresh /auth/me hydration when the profile page mounts —
  // any stale AuthContext (e.g. after a peer-tab login) is corrected before
  // the user tries to edit their own record.
  useEffect(() => { refreshUser?.(); load(); }, []);

  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));
  const toggleLang = (lang) =>
    setForm((f) => ({ ...f,
      languages: f.languages.includes(lang)
        ? f.languages.filter((x) => x !== lang)
        : [...f.languages, lang],
    }));

  const save = async () => {
    setSaving(true);
    try {
      const body = { ...form };
      // Convert empty-string years to null so backend treats it as "unchanged".
      if (body.years_of_experience === '') body.years_of_experience = null;
      else body.years_of_experience = parseInt(body.years_of_experience, 10) || 0;
      await axios.patch(`${API}/settings/me/profile`, body);
      toast.success('Profile saved');
      load();
      refreshUser?.();
    } catch (err) {
      toast.error(err?.response?.data?.detail || 'Save failed');
    } finally { setSaving(false); }
  };

  const onAvatarPick = async (e) => {
    const f = e.target.files?.[0];
    if (!f) return;
    if (f.size > 2 * 1024 * 1024) { toast.error('Image must be under 2 MB'); return; }
    const fd = new FormData(); fd.append('file', f);
    try {
      await axios.post(`${API}/settings/me/avatar`, fd, { headers: { 'Content-Type': 'multipart/form-data' } });
      toast.success('Profile photo updated');
      setAvatarVer((v) => v + 1);
      load();
    } catch (err) {
      toast.error(err?.response?.data?.detail || 'Upload failed');
    } finally { if (fileRef.current) fileRef.current.value = ''; }
  };

  const removeAvatar = async () => {
    if (!profile?.avatar_fs_id) return;
    if (!window.confirm('Remove profile photo?')) return;
    try {
      await axios.delete(`${API}/settings/me/avatar`);
      toast.success('Photo removed');
      setAvatarVer((v) => v + 1);
      load();
    } catch (err) {
      toast.error(err?.response?.data?.detail || 'Could not remove');
    }
  };

  if (loading) return <div className="p-6 text-sm text-slate-500">Loading…</div>;
  if (!profile) return null;

  const avatarUrl = profile.avatar_fs_id
    ? `${API}/settings/users/${profile.user_id}/avatar?v=${avatarVer}`
    : null;
  const initials = (profile.name || profile.email || '?').split(' ').map((s) => s[0]).join('').slice(0, 2).toUpperCase();

  return (
    <div className="p-6 max-w-4xl mx-auto space-y-6" data-testid="my-profile-tab">
      <header>
        <h1 className="text-xl font-bold text-slate-800 flex items-center gap-2">
          <User size={20} className="text-indigo-600" />
          My Profile
        </h1>
        <p className="text-sm text-slate-500 mt-1">
          Your professional credentials appear on signed audiogram reports, invoice footers, and the patient portal.
        </p>
      </header>

      {profile.must_change_password && (
        <div className="rounded-xl bg-amber-50 border border-amber-200 px-4 py-3 flex items-start gap-2" data-testid="must-change-pw-banner">
          <AlertTriangle size={16} className="text-amber-700 mt-0.5 shrink-0" />
          <div className="text-[13px] text-amber-900">
            <b>Action required:</b> your password was set by an administrator. Please change it below before continuing.
          </div>
        </div>
      )}

      {/* Identity card — avatar + read-only IDs */}
      <section className="rounded-xl border border-slate-200 bg-white p-5">
        <div className="flex items-start gap-5">
          <div className="relative shrink-0">
            <div className="w-24 h-24 rounded-2xl bg-gradient-to-br from-indigo-500 to-cyan-500 text-white flex items-center justify-center font-bold text-3xl ring-4 ring-white shadow-lg overflow-hidden">
              {avatarUrl
                ? <img src={avatarUrl} alt="avatar" data-testid="my-avatar-img" className="w-full h-full object-cover" />
                : <span data-testid="my-avatar-initials">{initials}</span>}
            </div>
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              data-testid="my-avatar-upload"
              className="absolute -bottom-2 -right-2 w-9 h-9 rounded-full bg-white border-2 border-indigo-500 text-indigo-600 hover:bg-indigo-50 shadow flex items-center justify-center"
              title="Change profile photo"
            >
              <Camera size={15} />
            </button>
            <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp" className="hidden" onChange={onAvatarPick} />
          </div>

          <div className="flex-1 min-w-0">
            <div className="flex items-baseline gap-2">
              <h2 className="text-lg font-bold text-slate-900 truncate">{profile.name}</h2>
              <span className="px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider rounded bg-indigo-100 text-indigo-700">
                {profile.role.replace('_', ' ')}
              </span>
            </div>
            <div className="text-sm text-slate-500">{profile.email}</div>
            <div className="mt-3 grid grid-cols-2 sm:grid-cols-3 gap-3">
              <ReadOnlyField icon={<Shield size={11} />} label="User ID"   value={profile.user_id} mono />
              <ReadOnlyField icon={<Building2 size={11} />} label="Clinic ID" value={clinic?.clinic_id} mono />
              <ReadOnlyField icon={<Building2 size={11} />} label="Clinic"  value={clinic?.name} />
              {clinic?.subscription_tier && (
                <ReadOnlyField label="Tier" value={clinic.subscription_tier} />
              )}
              {clinic?.mrd_prefix && (
                <ReadOnlyField label="MRD Prefix" value={clinic.mrd_prefix} mono />
              )}
              {clinic?.gst_no && (
                <ReadOnlyField label="GST" value={clinic.gst_no} mono />
              )}
            </div>
            {profile.avatar_fs_id && (
              <button onClick={removeAvatar} data-testid="my-avatar-remove"
                className="mt-3 inline-flex items-center gap-1 text-[11px] font-semibold text-rose-600 hover:text-rose-800">
                <Trash2 size={11} /> Remove photo
              </button>
            )}
          </div>
        </div>
      </section>

      {/* Professional details form */}
      <section className="rounded-xl border border-slate-200 bg-white p-5">
        <h3 className="text-[13px] font-bold text-slate-800 mb-4">Professional details</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Field label="Full name *">
            <input value={form.name} onChange={(e) => set('name', e.target.value)}
              data-testid="profile-name"
              className="w-full px-2 py-1.5 text-sm border border-slate-300 rounded" />
          </Field>
          <Field label="Phone (with country code)">
            <input value={form.phone} onChange={(e) => set('phone', e.target.value)}
              data-testid="profile-phone"
              placeholder="+91…"
              className="w-full px-2 py-1.5 text-sm border border-slate-300 rounded" />
          </Field>
          <Field label="Designation" hint="Senior Audiologist · Director · Clinic Manager">
            <input value={form.designation} onChange={(e) => set('designation', e.target.value)}
              data-testid="profile-designation"
              className="w-full px-2 py-1.5 text-sm border border-slate-300 rounded" />
          </Field>
          <Field label="Qualifications" hint="MASLP, M.Sc. Audiology">
            <input value={form.qualifications} onChange={(e) => set('qualifications', e.target.value)}
              data-testid="profile-qualifications"
              className="w-full px-2 py-1.5 text-sm border border-slate-300 rounded" />
          </Field>
          <Field label="RCI Registration No." hint="Rehabilitation Council of India — printed on reports">
            <input value={form.rci_registration_no} onChange={(e) => set('rci_registration_no', e.target.value)}
              data-testid="profile-rci"
              placeholder="A-12345"
              className="w-full px-2 py-1.5 text-sm font-mono border border-slate-300 rounded" />
          </Field>
          <Field label="State / Council License No." hint="Optional secondary credential">
            <input value={form.license_no} onChange={(e) => set('license_no', e.target.value)}
              data-testid="profile-license"
              className="w-full px-2 py-1.5 text-sm font-mono border border-slate-300 rounded" />
          </Field>
          <Field label="Specialization" hint="Pediatric audiology, hearing-aid fitting…">
            <input value={form.specialization} onChange={(e) => set('specialization', e.target.value)}
              data-testid="profile-specialization"
              className="w-full px-2 py-1.5 text-sm border border-slate-300 rounded" />
          </Field>
          <Field label="Years of experience">
            <input type="number" min={0} max={70} value={form.years_of_experience}
              onChange={(e) => set('years_of_experience', e.target.value)}
              data-testid="profile-experience"
              className="w-full px-2 py-1.5 text-sm border border-slate-300 rounded" />
          </Field>
        </div>

        <div className="mt-4">
          <label className="block text-[10.5px] uppercase tracking-wider font-bold text-slate-600 mb-1">Languages spoken</label>
          <div className="flex flex-wrap gap-1.5" data-testid="profile-languages">
            {COMMON_LANGUAGES.map((lang) => {
              const active = form.languages.includes(lang);
              return (
                <button key={lang} type="button" onClick={() => toggleLang(lang)}
                  data-testid={`profile-lang-${lang}`}
                  className={`text-[11px] font-semibold px-2.5 py-1 rounded-full border transition-colors ${
                    active
                      ? 'bg-indigo-600 text-white border-indigo-600'
                      : 'bg-white text-slate-700 border-slate-300 hover:border-indigo-400'
                  }`}>
                  {lang}
                </button>
              );
            })}
          </div>
        </div>

        <div className="mt-4">
          <Field label="Bio (optional)" hint="Shown on the patient portal next to your name">
            <textarea value={form.bio} onChange={(e) => set('bio', e.target.value)}
              data-testid="profile-bio" rows={3} maxLength={500}
              className="w-full px-2 py-1.5 text-sm border border-slate-300 rounded resize-none" />
          </Field>
        </div>

        <div className="mt-4 flex justify-end">
          <button onClick={save} disabled={saving} data-testid="profile-save"
            className="inline-flex items-center gap-1.5 px-4 py-2 text-sm font-semibold text-white bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 rounded">
            {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
            Save profile
          </button>
        </div>
      </section>

      {/* Change password */}
      <ChangePasswordCard mustChange={profile.must_change_password} onChanged={refreshUser} />

      {/* Audit / activity teaser */}
      <section className="rounded-xl border border-slate-200 bg-slate-50/60 p-4 text-[11.5px] text-slate-600">
        <div className="font-bold text-slate-700 mb-1">Account activity</div>
        Last password change: <b>{profile.password_changed_at ? new Date(profile.password_changed_at).toLocaleString() : '— never (still using initial password)'}</b><br />
        Member since: <b>{profile.created_at ? new Date(profile.created_at).toLocaleDateString() : '—'}</b>
      </section>
    </div>
  );
}

// --------------- Change password card ----------------------------------------
function ChangePasswordCard({ mustChange, onChanged }) {
  const [cur, setCur] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [showCur, setShowCur] = useState(false);
  const [showNext, setShowNext] = useState(false);
  const [busy, setBusy] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    if (next.length < 8) { toast.error('New password must be at least 8 characters'); return; }
    if (next !== confirm) { toast.error('Passwords do not match'); return; }
    if (next === cur) { toast.error('New password must be different from current'); return; }

    setBusy(true);
    try {
      await axios.post(`${API}/settings/me/change-password`, { current_password: cur, new_password: next });
      toast.success('Password changed. Other sessions have been signed out.');
      setCur(''); setNext(''); setConfirm('');
      onChanged?.();
    } catch (err) {
      toast.error(err?.response?.data?.detail || 'Change failed');
    } finally { setBusy(false); }
  };

  // Lightweight strength meter — for visual feedback only.
  const strength = (() => {
    let s = 0;
    if (next.length >= 8) s += 1;
    if (next.length >= 12) s += 1;
    if (/[A-Z]/.test(next) && /[a-z]/.test(next)) s += 1;
    if (/[0-9]/.test(next)) s += 1;
    if (/[^A-Za-z0-9]/.test(next)) s += 1;
    return s;
  })();
  const strengthLabel = ['Too weak', 'Weak', 'Fair', 'Good', 'Strong', 'Excellent'][strength];
  const strengthColor = ['bg-rose-500', 'bg-rose-400', 'bg-amber-400', 'bg-yellow-400', 'bg-emerald-500', 'bg-emerald-600'][strength];

  return (
    <section
      className={`rounded-xl border p-5 ${mustChange ? 'border-amber-300 bg-amber-50/40' : 'border-slate-200 bg-white'}`}
      data-testid="change-password-card"
    >
      <h3 className="text-[13px] font-bold text-slate-800 flex items-center gap-2 mb-4">
        <KeyRound size={14} className="text-indigo-600" />
        Change password
        {mustChange && <span className="text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded bg-amber-200 text-amber-800">Required</span>}
      </h3>
      <form onSubmit={submit} className="space-y-3 max-w-md">
        <PasswordRow label="Current password" value={cur} setValue={setCur} show={showCur} setShow={setShowCur} testid="cp-current" />
        <PasswordRow label="New password" value={next} setValue={setNext} show={showNext} setShow={setShowNext} testid="cp-new" minLen={8} />
        {next.length > 0 && (
          <div>
            <div className="h-1 rounded-full bg-slate-200 overflow-hidden">
              <div className={`h-full ${strengthColor} transition-all`} style={{ width: `${(strength / 5) * 100}%` }} />
            </div>
            <div className="text-[10px] text-slate-500 mt-1">Strength: <b>{strengthLabel}</b></div>
          </div>
        )}
        <PasswordRow label="Confirm new password" value={confirm} setValue={setConfirm} show={showNext} setShow={setShowNext} testid="cp-confirm" minLen={8} />

        <div className="flex justify-end pt-1">
          <button disabled={busy} data-testid="cp-submit"
            className="inline-flex items-center gap-1.5 px-4 py-2 text-sm font-semibold text-white bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 rounded">
            {busy ? <Loader2 size={14} className="animate-spin" /> : <CheckCircle2 size={14} />}
            Update password
          </button>
        </div>
        <p className="text-[10.5px] text-slate-500">Other browser sessions will be signed out for security.</p>
      </form>
    </section>
  );
}

function PasswordRow({ label, value, setValue, show, setShow, testid, minLen }) {
  return (
    <label className="block">
      <span className="block text-[10.5px] uppercase tracking-wider font-bold text-slate-600 mb-1">{label}</span>
      <div className="relative">
        <input
          type={show ? 'text' : 'password'}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          minLength={minLen}
          required
          data-testid={testid}
          className="w-full px-2 py-1.5 pr-9 text-sm border border-slate-300 rounded font-mono"
        />
        <button type="button" onClick={() => setShow((v) => !v)}
          className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-700"
          tabIndex={-1}>
          {show ? <EyeOff size={14} /> : <Eye size={14} />}
        </button>
      </div>
    </label>
  );
}

// ----- shared -----
function Field({ label, hint, children }) {
  return (
    <label className="block">
      <span className="block text-[10.5px] uppercase tracking-wider font-bold text-slate-600 mb-1">
        {label}
        {hint && <span className="ml-1 text-[10px] font-normal text-slate-400 normal-case tracking-normal">· {hint}</span>}
      </span>
      {children}
    </label>
  );
}

function ReadOnlyField({ icon, label, value, mono = false }) {
  if (!value) return null;
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wider font-bold text-slate-500 flex items-center gap-1">
        {icon}
        {label}
      </div>
      <div className={`text-[12px] text-slate-800 truncate ${mono ? 'font-mono' : 'font-semibold'}`}>{value}</div>
    </div>
  );
}
