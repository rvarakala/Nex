/**
 * InviteSuccessModal — shown after the founder converts a lead OR adds a
 * tenant. Two modes, driven by which fields are populated on `result`:
 *
 *   • Invite flow  → `result.accept_url` is present → show the secure URL
 *     with copy + WhatsApp + email shortcuts.
 *   • Direct-password flow → `result.direct_login_password` is present →
 *     show email + password with copy-each / copy-both buttons. Password
 *     is only revealed here, so the founder has to copy before closing.
 *
 * Reused from LeadsPage and TenantsPage so the post-create UX is consistent.
 */
import React, { useState } from 'react';
import { Check, Copy, ExternalLink, MessageCircle, Mail, KeyRound } from 'lucide-react';

export default function InviteSuccessModal({ result, onClose }) {
  const [copied, setCopied] = useState('');
  if (!result) return null;

  const isDirect = Boolean(result.direct_login_password);

  const copy = (text, which) => {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(which);
      setTimeout(() => setCopied(''), 1800);
    });
  };

  const wa = !isDirect ? `https://wa.me/?text=${encodeURIComponent(
    `Welcome to AUDINEXA! Click here to set up your clinic account: ${result.accept_url}`,
  )}` : null;

  const mailto = !isDirect ? `mailto:${encodeURIComponent(result.owner_email)}?subject=${encodeURIComponent(
    `Welcome to AUDINEXA — set up ${result.clinic_name}`,
  )}&body=${encodeURIComponent(
    `Hi,\n\nWelcome to AUDINEXA. Click this single-use link to set your password and access ${result.clinic_name}:\n\n${result.accept_url}\n\nThis link expires on ${new Date(result.invite_expires_at).toLocaleDateString()}.\n\n— AUDINEXA team`,
  )}` : null;

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
            {isDirect ? <KeyRound size={18} /> : <Check size={18} strokeWidth={3} />}
          </span>
          <div>
            <h3 className="text-base font-extrabold text-slate-900 tracking-tight">
              {result.converted_from_lead ? 'Lead converted' : 'Tenant created'}
            </h3>
            <p className="text-[11.5px] text-slate-500">
              {result.clinic_name}{result.tier ? ` · ${result.tier}` : ''}
              {isDirect
                ? ' · ready to sign in'
                : ` · invite expires ${new Date(result.invite_expires_at).toLocaleDateString()}`}
            </p>
          </div>
        </div>

        {isDirect ? (
          <>
            <p className="text-[12.5px] text-slate-600 mb-3">
              <strong>{result.direct_login_name || 'Owner'}</strong> can log in immediately with these credentials.
              The password won&apos;t be shown again — copy it now before closing.
            </p>

            <CredRow
              label="Email"
              value={result.owner_email}
              copied={copied === 'email'}
              onCopy={() => copy(result.owner_email, 'email')}
              testidValue="direct-login-email"
            />
            <div className="mt-2">
              <CredRow
                label="Password"
                value={result.direct_login_password}
                copied={copied === 'password'}
                onCopy={() => copy(result.direct_login_password, 'password')}
                mono
                testidValue="direct-login-password"
              />
            </div>

            <div className="mt-4 flex items-center justify-between">
              <button
                type="button"
                onClick={() => copy(
                  `Email: ${result.owner_email}\nPassword: ${result.direct_login_password}`,
                  'both',
                )}
                data-testid="direct-login-copy-both"
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-[11.5px] font-semibold text-indigo-700 border border-indigo-200 bg-indigo-50 hover:bg-indigo-100 rounded"
              >
                <Copy size={12} /> {copied === 'both' ? 'Copied!' : 'Copy both'}
              </button>
              <button
                onClick={onClose}
                data-testid="invite-success-done"
                className="px-4 py-2 text-xs font-semibold bg-slate-900 hover:bg-slate-800 text-white rounded-lg"
              >
                Done
              </button>
            </div>
          </>
        ) : (
          <>
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
                onClick={() => copy(result.accept_url, 'url')}
                data-testid="invite-success-copy"
                className="text-[11px] inline-flex items-center gap-1 px-2 py-1 rounded font-semibold text-white bg-[#0B5FFF] hover:bg-[#094acf]"
              >
                <Copy size={11} /> {copied === 'url' ? 'Copied' : 'Copy'}
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
          </>
        )}
      </div>
    </div>
  );
}

function CredRow({ label, value, copied, onCopy, mono = false, testidValue }) {
  return (
    <div className="border border-slate-200 rounded-lg px-3 py-2 flex items-center justify-between gap-2">
      <div className="min-w-0 flex-1">
        <div className="text-[10px] uppercase tracking-wider font-bold text-slate-500">{label}</div>
        <div
          data-testid={testidValue}
          className={`text-[13px] text-slate-900 truncate ${mono ? 'font-mono' : 'font-semibold'}`}
        >
          {value}
        </div>
      </div>
      <button
        type="button"
        onClick={onCopy}
        className={`shrink-0 inline-flex items-center gap-1 px-2 py-1 text-[11px] font-semibold rounded transition-colors ${
          copied ? 'text-emerald-700 bg-emerald-50 border border-emerald-200' : 'text-slate-600 hover:bg-slate-100 border border-slate-200'
        }`}
      >
        {copied ? <Check size={11} /> : <Copy size={11} />}
        {copied ? 'Copied' : 'Copy'}
      </button>
    </div>
  );
}
