/**
 * InviteSuccessModal — shown after the founder converts a lead OR adds a
 * tenant. Displays the shareable invite URL with copy + WhatsApp shortcut.
 *
 * Reused from LeadsPage and TenantsPage so the post-create UX is consistent.
 */
import React, { useState } from 'react';
import { Check, Copy, ExternalLink, MessageCircle, Mail } from 'lucide-react';

export default function InviteSuccessModal({ result, onClose }) {
  const [copied, setCopied] = useState(false);
  if (!result) return null;

  const copy = async () => {
    await navigator.clipboard.writeText(result.accept_url);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const wa = `https://wa.me/?text=${encodeURIComponent(
    `Welcome to AUDINEXA! Click here to set up your clinic account: ${result.accept_url}`,
  )}`;
  const mailto = `mailto:${encodeURIComponent(result.owner_email)}?subject=${encodeURIComponent(
    `Welcome to AUDINEXA — set up ${result.clinic_name}`,
  )}&body=${encodeURIComponent(
    `Hi,\n\nWelcome to AUDINEXA. Click this single-use link to set your password and access ${result.clinic_name}:\n\n${result.accept_url}\n\nThis link expires on ${new Date(result.invite_expires_at).toLocaleDateString()}.\n\n— AUDINEXA team`,
  )}`;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm"
      role="dialog" aria-modal="true"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
      data-testid="invite-success-modal"
    >
      <div className="w-full max-w-lg bg-white rounded-2xl shadow-xl border border-slate-100 p-5 sm:p-6">
        <div className="flex items-center gap-2 mb-3">
          <span className="w-9 h-9 rounded-full bg-emerald-100 text-emerald-700 flex items-center justify-center">
            <Check size={18} strokeWidth={3} />
          </span>
          <div>
            <h3 className="text-base font-extrabold text-slate-900 tracking-tight">
              {result.converted_from_lead ? 'Lead converted' : 'Tenant created'}
            </h3>
            <p className="text-[11.5px] text-slate-500">
              {result.clinic_name} · invite expires {new Date(result.invite_expires_at).toLocaleDateString()}
            </p>
          </div>
        </div>

        <p className="text-[12.5px] text-slate-600 mb-3">
          Share this link with <strong>{result.owner_email}</strong>. They&apos;ll click it,
          choose their own password, and land in their dashboard.
        </p>

        <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 flex items-center gap-2">
          <ExternalLink size={14} className="text-[#0B5FFF] shrink-0" />
          <code
            className="flex-1 text-[10.5px] font-mono text-slate-800 break-all"
            data-testid="invite-success-url"
          >
            {result.accept_url}
          </code>
          <button
            onClick={copy}
            data-testid="invite-success-copy"
            className="text-[11px] inline-flex items-center gap-1 px-2 py-1 rounded font-semibold text-white bg-[#0B5FFF] hover:bg-[#094acf]"
          >
            <Copy size={11} /> {copied ? 'Copied' : 'Copy'}
          </button>
        </div>

        <div className="mt-3 grid grid-cols-2 gap-2">
          <a
            href={wa} target="_blank" rel="noreferrer"
            data-testid="invite-success-whatsapp"
            className="inline-flex items-center justify-center gap-2 bg-emerald-50 text-emerald-700 hover:bg-emerald-100 border border-emerald-200 px-3 py-2 rounded-lg font-semibold text-xs"
          >
            <MessageCircle size={13} /> WhatsApp
          </a>
          <a
            href={mailto}
            data-testid="invite-success-email"
            className="inline-flex items-center justify-center gap-2 bg-blue-50 text-blue-700 hover:bg-blue-100 border border-blue-200 px-3 py-2 rounded-lg font-semibold text-xs"
          >
            <Mail size={13} /> Email
          </a>
        </div>

        <div className="mt-5 flex justify-end">
          <button
            onClick={onClose}
            data-testid="invite-success-done"
            className="px-4 py-2 text-xs font-semibold bg-slate-900 hover:bg-slate-800 text-white rounded-lg"
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
}
