/* Compliance Policy Pack viewer + e-sign / adopt workflow.
 *
 * Lives at /settings/compliance — visible to clinic_owner / super_admin
 * (the adopt action itself is gated server-side, but we hide the button for
 * other roles so the UX matches).
 *
 * Three states per policy in the left rail:
 *   ✓ Signed       – active adoption exists for this exact text revision
 *   ⚠ Superseded   – earlier adoption stale because policy text changed
 *   ○ Unsigned     – never adopted
 *
 * Top of the reader pane shows:
 *   • "X of 7 policies adopted" summary banner
 *   • E-Sign & Adopt button (or Signed badge with PDF download)
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import axios from 'axios';
import {
  ShieldCheck, FileText, Download, ExternalLink, RefreshCw,
  CheckCircle2, AlertTriangle, Circle, PenLine, X, Loader2,
} from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import { useAuth } from '../../AuthContext';

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;

export default function CompliancePolicyPack() {
  const { user } = useAuth();
  const canAdopt = user && ['clinic_owner', 'super_admin'].includes(user.role);

  const [policies, setPolicies] = useState([]);
  const [active, setActive] = useState(null);
  const [content, setContent] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  // Adoption state
  const [adoptions, setAdoptions] = useState({ by_policy: {}, summary: {} });
  const [adoptingFor, setAdoptingFor] = useState(null);   // policy_id when modal is open

  const refreshAdoptions = useCallback(async () => {
    try {
      const r = await axios.get(`${API}/legal/adoptions`);
      setAdoptions({
        by_policy: r.data.by_policy || {},
        summary: r.data.summary || {},
      });
    } catch (e) {
      // non-fatal — list still renders, badges just won't show
      // eslint-disable-next-line no-console
      console.warn('adoptions fetch failed', e?.message);
    }
  }, []);

  useEffect(() => {
    (async () => {
      try {
        const r = await axios.get(`${API}/legal/policies`);
        setPolicies(r.data.policies || []);
        if (r.data.policies?.length) {
          loadPolicy(r.data.policies[0].id);
        }
      } catch (e) {
        setError(e?.response?.data?.detail || e.message);
      }
      refreshAdoptions();
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const loadPolicy = async (pid) => {
    setActive(pid); setLoading(true); setError(null);
    try {
      const r = await axios.get(`${API}/legal/policies/${pid}`);
      setContent(r.data);
    } catch (e) {
      setError(e?.response?.data?.detail || e.message);
    } finally { setLoading(false); }
  };

  const downloadPdf = async (pid) => {
    try {
      const r = await axios.get(`${API}/legal/policies/${pid}/pdf`, { responseType: 'blob' });
      const url = window.URL.createObjectURL(new Blob([r.data], { type: 'application/pdf' }));
      const a = document.createElement('a');
      a.href = url; a.download = `${pid}.pdf`;
      document.body.appendChild(a); a.click(); a.remove();
      window.URL.revokeObjectURL(url);
    } catch (e) {
      setError('PDF download failed: ' + (e?.response?.data?.detail || e.message));
    }
  };

  const downloadSignedPdf = async (adoptionId) => {
    try {
      const r = await axios.get(`${API}/legal/adoptions/${adoptionId}/pdf`, { responseType: 'blob' });
      const url = window.URL.createObjectURL(new Blob([r.data], { type: 'application/pdf' }));
      const a = document.createElement('a');
      a.href = url; a.download = `${adoptionId}.pdf`;
      document.body.appendChild(a); a.click(); a.remove();
      window.URL.revokeObjectURL(url);
    } catch (e) {
      setError('Signed PDF download failed: ' + (e?.response?.data?.detail || e.message));
    }
  };

  const adoptionFor = (pid) => adoptions.by_policy?.[pid];
  const policiesTotal = policies.length || (adoptions.summary?.policies_total ?? 0);
  const policiesSigned = adoptions.summary?.policies_signed || 0;
  const allSigned = policiesTotal > 0 && policiesSigned >= policiesTotal;

  const activeAdoption = active ? adoptionFor(active) : null;
  const isActiveSigned = activeAdoption?.status === 'active';
  const isActiveSuperseded = activeAdoption?.status === 'superseded';

  return (
    <div className="p-6 space-y-4 bg-slate-50 min-h-screen" data-testid="compliance-page">
      <header className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 flex items-center gap-2">
            <ShieldCheck size={24} className="text-emerald-600" />
            Compliance · Policy Pack
          </h1>
          <p className="text-xs text-slate-500 mt-1">
            Audit-ready ISO/IEC 27001:2022 + DPDP Act 2023 policies, personalised for your clinic. E-sign once, store the locked PDF, hand to auditors.
          </p>
        </div>
        {content?.context && (
          <div className="text-[11px] text-slate-500 bg-white border border-slate-200 rounded-lg px-3 py-2" data-testid="compliance-context">
            <span className="font-bold text-slate-700">Personalised for:</span> {content.context.clinic_name}
            <span className="mx-1.5 text-slate-300">·</span>
            DPO: {content.context.dpo_name}
            <span className="mx-1.5 text-slate-300">·</span>
            Effective: {content.context.effective_date}
          </div>
        )}
      </header>

      {/* Summary banner */}
      <SummaryBanner
        total={policiesTotal}
        signed={policiesSigned}
        superseded={adoptions.summary?.policies_superseded || 0}
        allSigned={allSigned}
      />

      {error && (
        <div className="rounded-lg border border-rose-300 bg-rose-50 px-3 py-2 text-xs text-rose-800" data-testid="compliance-error">{error}</div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-[300px_1fr] gap-4">
        {/* Policy list */}
        <aside className="bg-white border border-slate-200 rounded-2xl p-3 shadow-sm h-fit sticky top-4" data-testid="compliance-list">
          <div className="text-[10px] uppercase font-bold tracking-wider text-slate-500 px-2 py-1.5">
            {policiesTotal} polic{policiesTotal === 1 ? 'y' : 'ies'}
            <span className="text-slate-400">  ·  </span>
            <span className="text-emerald-700">{policiesSigned} signed</span>
          </div>
          <ul className="space-y-1">
            {policies.map((p) => {
              const a = adoptionFor(p.id);
              return (
                <li key={p.id}>
                  <button
                    onClick={() => loadPolicy(p.id)}
                    data-testid={`policy-${p.id}`}
                    className={`w-full text-left px-3 py-2.5 rounded-lg transition-all flex items-start gap-2 ${
                      active === p.id
                        ? 'bg-emerald-50 border border-emerald-300 shadow-sm'
                        : 'hover:bg-slate-50 border border-transparent'
                    }`}
                  >
                    <PolicyStatusIcon status={a?.status} active={active === p.id} />
                    <div className="min-w-0 flex-1">
                      <div className={`text-[12.5px] font-bold ${active === p.id ? 'text-emerald-900' : 'text-slate-800'}`}>{p.title}</div>
                      <div className="text-[10px] font-mono text-slate-500 mt-0.5">{p.code} · {p.iso}</div>
                      {a?.status === 'active' && (
                        <div className="text-[10px] text-emerald-700 mt-0.5 font-semibold">
                          Signed {new Date(a.signed_at).toLocaleDateString('en-IN')}
                        </div>
                      )}
                      {a?.status === 'superseded' && (
                        <div className="text-[10px] text-amber-700 mt-0.5 font-semibold">
                          Needs re-sign (text updated)
                        </div>
                      )}
                    </div>
                  </button>
                </li>
              );
            })}
          </ul>
        </aside>

        {/* Reader pane */}
        <main className="bg-white border border-slate-200 rounded-2xl p-6 shadow-sm" data-testid="compliance-reader">
          {loading && <div className="text-center py-12 text-slate-400 italic"><RefreshCw size={20} className="animate-spin inline mr-2" />Loading policy…</div>}
          {!loading && content && (
            <>
              {/* Adoption status strip */}
              <AdoptionStatusStrip
                adoption={activeAdoption}
                isSigned={isActiveSigned}
                isSuperseded={isActiveSuperseded}
                onDownloadSigned={() => activeAdoption && downloadSignedPdf(activeAdoption.adoption_id)}
              />

              <div className="flex items-center justify-end gap-2 mb-4 pb-4 border-b border-slate-100 flex-wrap">
                {canAdopt && (!isActiveSigned) && (
                  <button
                    onClick={() => setAdoptingFor(active)}
                    data-testid="adopt-btn"
                    className="px-3 py-1.5 text-xs font-bold bg-blue-600 hover:bg-blue-700 text-white rounded-lg shadow-sm inline-flex items-center gap-1.5"
                  >
                    <PenLine size={13} /> {isActiveSuperseded ? 'Re-Sign & Adopt' : 'E-Sign & Adopt'}
                  </button>
                )}
                <button
                  onClick={() => downloadPdf(active)}
                  data-testid="download-pdf-btn"
                  className="px-3 py-1.5 text-xs font-bold bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg shadow-sm inline-flex items-center gap-1.5">
                  <Download size={13} /> Download PDF
                </button>
                <a
                  href={`${API}/legal/policies/${active}/pdf`}
                  target="_blank"
                  rel="noopener noreferrer"
                  data-testid="view-pdf-btn"
                  className="px-3 py-1.5 text-xs font-semibold bg-white border border-slate-300 hover:bg-slate-50 text-slate-700 rounded-lg inline-flex items-center gap-1.5">
                  <ExternalLink size={13} /> View PDF
                </a>
              </div>
              <article className="prose prose-slate prose-sm max-w-none" data-testid="policy-markdown">
                <ReactMarkdown>{content.markdown}</ReactMarkdown>
              </article>
            </>
          )}
        </main>
      </div>

      {/* Adopt modal */}
      {adoptingFor && (
        <AdoptModal
          policyId={adoptingFor}
          policyMeta={policies.find((p) => p.id === adoptingFor)}
          context={content?.context}
          onClose={() => setAdoptingFor(null)}
          onAdopted={async () => {
            setAdoptingFor(null);
            await refreshAdoptions();
          }}
        />
      )}
    </div>
  );
}


// ─── Sub-components ──────────────────────────────────────────────────

function SummaryBanner({ total, signed, superseded, allSigned }) {
  if (!total) return null;
  const pct = Math.round((signed / total) * 100);
  return (
    <div
      data-testid="compliance-summary-banner"
      className={`rounded-xl px-4 py-3 border flex items-center justify-between gap-3 ${
        allSigned
          ? 'bg-emerald-50 border-emerald-300'
          : 'bg-amber-50 border-amber-300'
      }`}
    >
      <div className="flex items-center gap-3">
        {allSigned
          ? <CheckCircle2 size={20} className="text-emerald-700 flex-shrink-0" />
          : <AlertTriangle size={20} className="text-amber-700 flex-shrink-0" />
        }
        <div>
          <div className={`text-[13px] font-bold ${allSigned ? 'text-emerald-900' : 'text-amber-900'}`} data-testid="summary-headline">
            {signed} of {total} policies adopted
            {superseded > 0 && <span className="text-amber-700"> · {superseded} need re-signing</span>}
          </div>
          <div className={`text-[11px] ${allSigned ? 'text-emerald-700' : 'text-amber-700'}`}>
            {allSigned
              ? 'Audit-ready. Signed PDFs are immutably stored — share with auditors anytime.'
              : 'E-sign each policy below to lock a tamper-evident PDF for your audit trail.'}
          </div>
        </div>
      </div>
      <div className="text-right">
        <div className={`text-2xl font-extrabold tabular-nums ${allSigned ? 'text-emerald-700' : 'text-amber-700'}`}>{pct}%</div>
        <div className="w-24 h-2 bg-white rounded-full overflow-hidden border border-slate-200">
          <div
            className={`h-full ${allSigned ? 'bg-emerald-500' : 'bg-amber-500'}`}
            style={{ width: `${pct}%` }}
          />
        </div>
      </div>
    </div>
  );
}

function PolicyStatusIcon({ status, active }) {
  if (status === 'active') {
    return <CheckCircle2 size={14} className="text-emerald-600 mt-0.5" data-testid="policy-status-signed" />;
  }
  if (status === 'superseded') {
    return <AlertTriangle size={14} className="text-amber-500 mt-0.5" data-testid="policy-status-superseded" />;
  }
  return active
    ? <FileText size={14} className="text-emerald-700 mt-0.5" />
    : <Circle size={14} className="text-slate-300 mt-0.5" data-testid="policy-status-unsigned" />;
}

function AdoptionStatusStrip({ adoption, isSigned, isSuperseded, onDownloadSigned }) {
  if (!adoption) {
    return (
      <div className="bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 mb-4 text-[12px] text-slate-600" data-testid="adoption-strip-unsigned">
        <Circle size={12} className="inline mr-1.5 text-slate-400" />
        This policy has not been adopted yet.
      </div>
    );
  }
  if (isSigned) {
    return (
      <div className="bg-emerald-50 border border-emerald-300 rounded-lg px-3 py-2 mb-4 flex items-center justify-between gap-2 flex-wrap" data-testid="adoption-strip-signed">
        <div className="text-[12px] text-emerald-900">
          <CheckCircle2 size={13} className="inline mr-1.5 text-emerald-700" />
          <b>Signed</b> by <b>{adoption.typed_name}</b> · {adoption.signed_by_email}
          {' · '}
          {new Date(adoption.signed_at).toLocaleString('en-IN')}
          <div className="text-[10px] text-emerald-700/80 mt-0.5 font-mono">
            {adoption.adoption_id} · IP {adoption.ip_address || '—'} · hash {adoption.markdown_hash?.slice(0, 12)}…
          </div>
        </div>
        <button
          onClick={onDownloadSigned}
          data-testid="adopted-pdf-download"
          className="text-[11px] font-bold bg-emerald-600 hover:bg-emerald-700 text-white px-2.5 py-1 rounded inline-flex items-center gap-1"
        >
          <Download size={11} /> Signed PDF
        </button>
      </div>
    );
  }
  if (isSuperseded) {
    return (
      <div className="bg-amber-50 border border-amber-300 rounded-lg px-3 py-2 mb-4 text-[12px] text-amber-900" data-testid="adoption-strip-superseded">
        <AlertTriangle size={13} className="inline mr-1.5 text-amber-700" />
        Earlier adoption is <b>superseded</b> — policy text has been updated. Please re-sign to refresh your audit trail.
      </div>
    );
  }
  return null;
}


// ─── Adopt modal ─────────────────────────────────────────────────────

function AdoptModal({ policyId, policyMeta, context, onClose, onAdopted }) {
  const [typedName, setTypedName] = useState('');
  const [ack, setAck] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const [done, setDone] = useState(null);

  const canSubmit = typedName.trim().length >= 2 && ack && !busy;

  const submit = async () => {
    if (!canSubmit) return;
    setErr(null); setBusy(true);
    try {
      const r = await axios.post(`${API}/legal/policies/${policyId}/adopt`, {
        typed_name: typedName.trim(),
        acknowledge: true,
      });
      setDone(r.data);
    } catch (e) {
      setErr(e?.response?.data?.detail || e.message || 'Adoption failed.');
    } finally {
      setBusy(false);
    }
  };

  const downloadDone = async () => {
    if (!done?.adoption_id) return;
    try {
      const r = await axios.get(`${API}/legal/adoptions/${done.adoption_id}/pdf`, { responseType: 'blob' });
      const url = window.URL.createObjectURL(new Blob([r.data], { type: 'application/pdf' }));
      const a = document.createElement('a');
      a.href = url; a.download = `${done.adoption_id}.pdf`;
      document.body.appendChild(a); a.click(); a.remove();
      window.URL.revokeObjectURL(url);
    } catch (e) {
      setErr('Download failed: ' + (e?.response?.data?.detail || e.message));
    }
  };

  return (
    <div
      className="fixed inset-0 bg-slate-900/60 z-50 flex items-center justify-center p-4"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
      data-testid="adopt-modal"
    >
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-lg overflow-hidden" onClick={(e) => e.stopPropagation()}>
        <div className="bg-gradient-to-r from-blue-600 to-indigo-700 text-white px-5 py-3 flex items-center justify-between">
          <div>
            <h2 className="text-base font-bold flex items-center gap-2"><PenLine size={16} /> E-Sign &amp; Adopt</h2>
            <p className="text-[11px] opacity-90">{policyMeta?.title}</p>
          </div>
          <button onClick={onClose} className="text-white/90 hover:text-white" aria-label="Close"><X size={20} /></button>
        </div>

        {!done ? (
          <div className="p-5 space-y-4">
            <div className="bg-slate-50 border border-slate-200 rounded p-3 text-[12px] text-slate-700 leading-relaxed">
              <p className="mb-2">
                You are about to <b>formally adopt</b> this policy on behalf of{' '}
                <b className="text-slate-900">{context?.clinic_name || 'your clinic'}</b>.
              </p>
              <p className="mb-0">
                The system will generate a tamper-evident PDF stamped with your typed name,
                role, the current date and time, your IP address, and a SHA-256 hash of the
                exact policy text. This PDF is stored immutably and can be shared with auditors.
                Adoption is recorded under <span className="font-mono">DPDP Act 2023 §6 (Notice)</span> and{' '}
                <span className="font-mono">ISO/IEC 27001:2022 A.5.1.1</span>.
              </p>
            </div>

            {err && (
              <div className="bg-rose-50 border border-rose-200 text-rose-700 text-xs rounded px-3 py-2" data-testid="adopt-error">
                {err}
              </div>
            )}

            <label className="block">
              <span className="block text-[10px] uppercase tracking-wider text-slate-500 mb-1 font-semibold">
                Type your full legal name <span className="text-rose-500">*</span>
              </span>
              <input
                value={typedName}
                onChange={(e) => setTypedName(e.target.value)}
                autoFocus
                placeholder="e.g. Dr. Priya Nair"
                data-testid="adopt-typed-name"
                className="w-full border border-slate-300 rounded px-3 py-2 text-sm focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
              />
              <span className="block text-[10px] text-slate-400 mt-0.5">
                This serves as your e-signature. It will appear in the signed PDF exactly as typed.
              </span>
            </label>

            <label className="flex items-start gap-2 text-[12px] text-slate-700 cursor-pointer">
              <input
                type="checkbox"
                checked={ack}
                onChange={(e) => setAck(e.target.checked)}
                data-testid="adopt-ack"
                className="rounded text-blue-600 mt-0.5"
              />
              <span>
                I have read this policy in full and acknowledge it on behalf of{' '}
                <b>{context?.clinic_name || 'my clinic'}</b>. I understand my e-signature is legally
                binding and that this adoption will be logged for audit purposes.
              </span>
            </label>

            <div className="flex justify-end gap-2 pt-2 border-t border-slate-100">
              <button
                onClick={onClose}
                className="px-4 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-100 rounded"
              >
                Cancel
              </button>
              <button
                onClick={submit}
                disabled={!canSubmit}
                data-testid="adopt-submit"
                className="px-4 py-2 text-xs font-bold bg-blue-600 hover:bg-blue-700 disabled:bg-slate-300 text-white rounded shadow-md inline-flex items-center gap-1.5"
              >
                {busy ? <><Loader2 size={13} className="animate-spin" /> Sealing PDF…</> : <><PenLine size={13} /> Sign &amp; Adopt</>}
              </button>
            </div>
          </div>
        ) : (
          <div className="p-5 text-center space-y-3" data-testid="adopt-success">
            <div className="w-14 h-14 mx-auto rounded-full bg-emerald-100 text-emerald-600 flex items-center justify-center">
              <CheckCircle2 size={32} strokeWidth={2.4} />
            </div>
            <h3 className="text-base font-bold text-slate-900">Policy adopted</h3>
            <p className="text-xs text-slate-600 leading-relaxed">
              {done.already_adopted
                ? <>This exact text revision was already adopted earlier. Adoption ID is shown below.</>
                : <>A tamper-evident PDF has been sealed and stored. Share the link with auditors anytime.</>}
            </p>
            <div className="bg-slate-50 border border-slate-200 rounded p-3 text-[11px] text-left font-mono">
              <div><span className="text-slate-500">Adoption ID:</span> <b>{done.adoption_id}</b></div>
              <div><span className="text-slate-500">Signed by:</span> {done.typed_name} · {done.signed_by_email}</div>
              <div><span className="text-slate-500">Signed at:</span> {new Date(done.signed_at).toLocaleString('en-IN')}</div>
              <div><span className="text-slate-500">Hash:</span> {done.markdown_hash?.slice(0, 32)}…</div>
            </div>
            <div className="flex justify-center gap-2 pt-2">
              <button
                onClick={downloadDone}
                data-testid="adopt-success-download"
                className="px-3 py-2 text-xs font-bold bg-emerald-600 hover:bg-emerald-700 text-white rounded inline-flex items-center gap-1.5"
              >
                <Download size={12} /> Download Signed PDF
              </button>
              <button
                onClick={onAdopted}
                data-testid="adopt-success-close"
                className="px-3 py-2 text-xs font-semibold bg-white border border-slate-300 hover:bg-slate-50 text-slate-700 rounded"
              >
                Done
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
