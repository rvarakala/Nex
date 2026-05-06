/* Compliance Policy Pack viewer.
 * Lists ISO 27001 / DPDP policies for the current tenant with clinic-specific
 * placeholders rendered. Each policy can be viewed inline as Markdown or
 * downloaded as a PDF for auditors.
 *
 * Lives at /settings/compliance — visible to clinic_owner / super_admin.
 */
import React, { useEffect, useState } from 'react';
import axios from 'axios';
import { ShieldCheck, FileText, Download, ExternalLink, RefreshCw } from 'lucide-react';
import ReactMarkdown from 'react-markdown';

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;

export default function CompliancePolicyPack() {
  const [policies, setPolicies] = useState([]);
  const [active, setActive] = useState(null);
  const [content, setContent] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

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

  return (
    <div className="p-6 space-y-4 bg-slate-50 min-h-screen" data-testid="compliance-page">
      <header className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 flex items-center gap-2">
            <ShieldCheck size={24} className="text-emerald-600" />
            Compliance · Policy Pack
          </h1>
          <p className="text-xs text-slate-500 mt-1">
            Audit-ready ISO/IEC 27001:2022 + DPDP Act 2023 policies, personalised for your clinic. Print, sign, file.
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

      {error && (
        <div className="rounded-lg border border-rose-300 bg-rose-50 px-3 py-2 text-xs text-rose-800" data-testid="compliance-error">{error}</div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-[300px_1fr] gap-4">
        {/* Policy list */}
        <aside className="bg-white border border-slate-200 rounded-2xl p-3 shadow-sm h-fit sticky top-4" data-testid="compliance-list">
          <div className="text-[10px] uppercase font-bold tracking-wider text-slate-500 px-2 py-1.5">7 policies</div>
          <ul className="space-y-1">
            {policies.map((p) => (
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
                  <FileText size={14} className={active === p.id ? 'text-emerald-700 mt-0.5' : 'text-slate-400 mt-0.5'} />
                  <div className="min-w-0 flex-1">
                    <div className={`text-[12.5px] font-bold ${active === p.id ? 'text-emerald-900' : 'text-slate-800'}`}>{p.title}</div>
                    <div className="text-[10px] font-mono text-slate-500 mt-0.5">{p.code} · {p.iso}</div>
                  </div>
                </button>
              </li>
            ))}
          </ul>
        </aside>

        {/* Reader pane */}
        <main className="bg-white border border-slate-200 rounded-2xl p-6 shadow-sm" data-testid="compliance-reader">
          {loading && <div className="text-center py-12 text-slate-400 italic"><RefreshCw size={20} className="animate-spin inline mr-2" />Loading policy…</div>}
          {!loading && content && (
            <>
              <div className="flex items-center justify-end gap-2 mb-4 pb-4 border-b border-slate-100">
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
    </div>
  );
}
