/**
 * DemoModal — beta-waitlist signup modal (rebranded from "demo request"
 * on 2026-06-03 when the public Pricing section was removed because the
 * beta cohort is full).
 *
 * Captures: clinic name, contact name, email (required), city, WhatsApp,
 * notes. The `tier_interest` field is no longer collected here — pricing
 * is per-clinic during the sales call.
 *
 * On submit: POST /api/public/waitlist-signup with source='landing_waitlist'.
 * Backend persists to db.waitlist_signups with stage='Lead' so the lead
 * lands directly in the Founder Command Centre's Leads Kanban.
 *
 * After successful signup, fetches /api/public/waitlist-stats to display
 * "You're position #N in the queue" — turns the form fill into a
 * social-proof moment.
 *
 * Component name kept as DemoModal so existing imports don't break; the
 * UX copy is fully waitlist-flavoured.
 */
import React, { useEffect, useState } from 'react';
import { X, Loader2, Check, ShieldCheck } from 'lucide-react';

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;

const EMPTY_FORM = {
  contact_name: '',
  clinic_name: '',
  email: '',
  whatsapp: '',
  city: '',
  notes: '',
};

export default function DemoModal({ open, onClose, initialTier }) {
  const [form, setForm] = useState(EMPTY_FORM);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);
  const [success, setSuccess] = useState(false);
  // After a successful submission we display "You're #N in the queue"
  // so the social-proof number on the ribbon ties to the user's own
  // signup. Live-fetched from /api/public/waitlist-stats.
  const [queuePosition, setQueuePosition] = useState(null);

  useEffect(() => {
    if (open) {
      setForm({ ...EMPTY_FORM });
      setError(null);
      setSuccess(false);
      setQueuePosition(null);
    }
  }, [open, initialTier]);

  // ESC closes
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
    };
  }, [open, onClose]);

  if (!open) return null;

  const update = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const submit = async (e) => {
    e.preventDefault();
    if (!form.contact_name.trim()) {
      setError('Please enter your name.');
      return;
    }
    if (!form.clinic_name.trim()) {
      setError('Please enter your clinic name.');
      return;
    }
    if (!form.email.trim() || !/.+@.+\..+/.test(form.email)) {
      setError('Please enter a valid email address.');
      return;
    }
    const phoneDigits = form.whatsapp.replace(/\D/g, '');
    if (phoneDigits.length < 10) {
      setError('Please enter a valid phone number (at least 10 digits).');
      return;
    }
    if (!form.city.trim()) {
      setError('Please enter your city.');
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const resp = await fetch(`${API}/public/waitlist-signup`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...Object.fromEntries(Object.entries(form).filter(([, v]) => String(v || '').trim() !== '')),
          source: 'landing_waitlist',
        }),
      });
      if (!resp.ok) {
        const j = await resp.json().catch(() => ({}));
        throw new Error(j.detail || `Request failed (${resp.status})`);
      }
      // Fetch live queue position after successful signup so the success
      // screen shows "You're #N in the queue" — turns the form fill into
      // a moment of social proof, not just a generic confirmation.
      try {
        const statsResp = await fetch(`${API}/public/waitlist-stats`);
        if (statsResp.ok) {
          const s = await statsResp.json();
          setQueuePosition(s.in_queue || null);
        }
      } catch { /* counter is decorative — silent fail */ }
      setSuccess(true);
    } catch (e2) {
      setError(e2.message || 'Something went wrong. Please try again or email hello@audinexa.com.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center p-4 sm:p-6"
      role="dialog"
      aria-label="Join the beta waitlist"
      aria-modal="true"
      data-testid="demo-modal"
    >
      <div className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm animate-[fade-up_0.3s_ease-out]" onClick={onClose} />
      <div className="relative w-full max-w-lg bg-white rounded-2xl shadow-2xl animate-[fade-up_0.4s_cubic-bezier(0.16,1,0.3,1)] max-h-[92vh] overflow-y-auto">
        <button
          onClick={onClose}
          aria-label="Close"
          data-testid="demo-modal-close"
          className="absolute top-3 right-3 p-1.5 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded-md transition z-10"
        >
          <X size={18} />
        </button>

        {success ? (
          <div className="p-8 text-center" data-testid="waitlist-success">
            <div className="w-14 h-14 mx-auto rounded-full bg-gradient-to-br from-[#16A34A] to-[#00C2A8] text-white flex items-center justify-center shadow-lg shadow-emerald-500/30">
              <Check size={26} strokeWidth={3} />
            </div>
            <h3 className="mt-5 font-[Manrope,Inter,sans-serif] font-extrabold text-xl text-[#111827]">You're on the waitlist 🎉</h3>
            {queuePosition !== null ? (
              <p className="mt-2 text-sm text-[#475569] leading-relaxed">
                You're position{' '}
                <span data-testid="waitlist-queue-position" className="font-bold text-[#0F52BA] tabular-nums">
                  #{queuePosition}
                </span>{' '}
                in the queue. We'll reach out the moment the next batch opens.
              </p>
            ) : (
              <p className="mt-2 text-sm text-[#475569] leading-relaxed">
                We've saved your spot. We'll reach out the moment the next batch opens.
              </p>
            )}
            <p className="mt-3 text-[12px] text-[#475569]">
              Check your inbox at <span className="font-semibold text-[#111827]">{form.email}</span> — confirmation is on the way.
            </p>
            <button
              onClick={onClose}
              data-testid="demo-modal-success-close"
              className="mt-6 bg-[#0B5FFF] hover:bg-[#094acf] text-white px-6 py-2.5 rounded-xl font-semibold text-sm transition"
            >
              Done
            </button>
          </div>
        ) : (
          <form onSubmit={submit} className="p-6 sm:p-8">
            <div className="flex items-start gap-3">
              <div className="w-11 h-11 rounded-xl bg-gradient-to-br from-[#0B5FFF] to-[#00C2A8] text-white flex items-center justify-center shadow-md shrink-0">
                <ShieldCheck size={20} strokeWidth={2.4} />
              </div>
              <div>
                <h3 className="font-[Manrope,Inter,sans-serif] font-extrabold text-xl text-[#111827] tracking-tight">Join the beta waitlist</h3>
                <p className="mt-1 text-[13px] text-[#475569]">Current beta cohort is full · We open one batch at a time · You'll hear from us first</p>
              </div>
            </div>

            {error && (
              <div className="mt-5 px-3 py-2 bg-rose-50 border border-rose-200 text-rose-700 rounded-md text-[12.5px]" data-testid="demo-modal-error">
                {error}
              </div>
            )}

            <div className="mt-5 space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <Field label="Your name" required>
                  <input data-testid="demo-input-name" required value={form.contact_name} onChange={update('contact_name')} placeholder="Dr. Priya Nair"
                    className="w-full px-3 py-2.5 text-sm border border-slate-300 rounded-lg focus:outline-none focus:border-[#0B5FFF] focus:ring-2 focus:ring-[#0B5FFF]/15 transition" />
                </Field>
                <Field label="Clinic name" required>
                  <input data-testid="demo-input-clinic" required value={form.clinic_name} onChange={update('clinic_name')} placeholder="The Sound Clinic"
                    className="w-full px-3 py-2.5 text-sm border border-slate-300 rounded-lg focus:outline-none focus:border-[#0B5FFF] focus:ring-2 focus:ring-[#0B5FFF]/15 transition" />
                </Field>
              </div>
              <Field label="Email" required>
                <input data-testid="demo-input-email" type="email" required autoFocus value={form.email} onChange={update('email')} placeholder="you@yourclinic.in"
                  className="w-full px-3 py-2.5 text-sm border border-slate-300 rounded-lg focus:outline-none focus:border-[#0B5FFF] focus:ring-2 focus:ring-[#0B5FFF]/15 transition" />
              </Field>
              <div className="grid grid-cols-2 gap-3">
                <Field label="WhatsApp / Phone" required>
                  <input data-testid="demo-input-whatsapp" required type="tel" value={form.whatsapp} onChange={update('whatsapp')} placeholder="+91 98xxxxxxxx"
                    className="w-full px-3 py-2.5 text-sm border border-slate-300 rounded-lg focus:outline-none focus:border-[#0B5FFF] focus:ring-2 focus:ring-[#0B5FFF]/15 transition" />
                </Field>
                <Field label="City" required>
                  <input data-testid="demo-input-city" required value={form.city} onChange={update('city')} placeholder="Bengaluru"
                    className="w-full px-3 py-2.5 text-sm border border-slate-300 rounded-lg focus:outline-none focus:border-[#0B5FFF] focus:ring-2 focus:ring-[#0B5FFF]/15 transition" />
                </Field>
              </div>
              <Field label="Tell us about your clinic (optional)">
                <textarea data-testid="demo-input-notes" rows={2} value={form.notes} onChange={update('notes')} placeholder="How many staff? How many patients/day? Existing software?"
                  className="w-full px-3 py-2.5 text-sm border border-slate-300 rounded-lg focus:outline-none focus:border-[#0B5FFF] focus:ring-2 focus:ring-[#0B5FFF]/15 transition resize-none" />
              </Field>
            </div>

            <button
              type="submit"
              disabled={submitting}
              data-testid="demo-modal-submit"
              className="mt-6 w-full inline-flex items-center justify-center gap-2 bg-[#0B5FFF] hover:bg-[#094acf] disabled:bg-slate-300 text-white py-3 rounded-xl font-semibold text-sm shadow-md shadow-[#0B5FFF]/25 transition"
            >
              {submitting ? <><Loader2 size={16} className="animate-spin" /> Saving your spot…</> : <>Join the waitlist</>}
            </button>

            <p className="mt-3 text-center text-[11px] text-slate-500">
              By joining, you agree to our terms. We'll never spam — unsubscribe any time.
            </p>
          </form>
        )}
      </div>
    </div>
  );
}

function Field({ label, required, children }) {
  return (
    <div>
      <label className="block text-[11px] font-bold uppercase tracking-wider text-slate-500 mb-1.5">
        {label}{required && <span className="text-rose-500 ml-0.5">*</span>}
      </label>
      {children}
    </div>
  );
}
