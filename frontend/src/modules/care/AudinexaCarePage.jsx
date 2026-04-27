/**
 * AUDINEXA Care — client-facing support desk.
 *
 * Features:
 *  - List my clinic's tickets with status / category / priority pills
 *  - "+ New ticket" button opens the create-ticket modal
 *  - Click a ticket → drawer with full thread + reply box
 *  - "Report this error" pre-fill flow: when the URL has ?prefill_diag=…
 *    the create modal auto-opens with the diagnostic attached
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import axios from 'axios';
import { useLocation, useNavigate } from 'react-router-dom';
import ErrorToast, { describeError } from '../../components/ErrorToast';

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;

const STATUS_PILLS = {
  Open:       'bg-amber-100 text-amber-900',
  Pending:    'bg-blue-100 text-blue-900',
  Resolved:   'bg-emerald-100 text-emerald-900',
  Closed:     'bg-slate-200 text-slate-700',
  Escalated:  'bg-rose-100 text-rose-900',
};
const PRIORITY_PILLS = {
  low:    'bg-slate-100 text-slate-700',
  medium: 'bg-amber-100 text-amber-800',
  high:   'bg-rose-200 text-rose-900',
};

const fmtDt = (iso) => {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleString('en-IN', {
      day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit',
    });
  } catch { return String(iso); }
};

export default function AudinexaCarePage() {
  const [list, setList] = useState({ rows: [], open_count: 0, categories: [], priorities: [] });
  const [err, setErr] = useState(null);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [prefill, setPrefill] = useState(null);
  const location = useLocation();
  const navigate = useNavigate();

  const load = useCallback(async () => {
    setLoading(true); setErr(null);
    try {
      const r = await axios.get(`${API}/care/tickets`);
      setList(r.data);
    } catch (e) { setErr(describeError(e, 'Failed to load support tickets')); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  // Handle "Report this error" deep-link
  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const diag = params.get('prefill_diag');
    const subj = params.get('prefill_subject');
    if (diag) {
      setPrefill({ diagnostic: decodeURIComponent(diag),
                   subject: subj ? decodeURIComponent(subj) : 'Reporting an error from AUDINEXA' });
      setCreateOpen(true);
      // Clear the URL so refresh doesn't re-open
      navigate('/care', { replace: true });
    }
  }, [location.search, navigate]);

  return (
    <div className="p-4 md:p-6 max-w-5xl mx-auto" data-testid="audinexa-care-page">
      <div className="flex items-start justify-between mb-4">
        <div>
          <h1 className="text-xl md:text-2xl font-bold text-slate-900 flex items-center gap-2">
            🛟 AUDINEXA Care
          </h1>
          <p className="text-xs md:text-sm text-slate-600 mt-1">
            Submit issues, ask questions, request features — direct line to the team.
          </p>
        </div>
        <button onClick={() => { setPrefill(null); setCreateOpen(true); }}
                data-testid="care-new-ticket"
                className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-sm rounded shadow">
          + New ticket
        </button>
      </div>

      {err && <div className="mb-3"><ErrorToast err={err} testid="care-list-err" /></div>}

      {/* Stats strip */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-5">
        <Stat label="Total" value={list.count || 0} testid="care-stat-total" />
        <Stat label="Open" value={list.open_count || 0} testid="care-stat-open" colorClass="text-amber-700" />
        <Stat label="Resolved"
              value={(list.rows || []).filter(r => r.status === 'Resolved').length}
              testid="care-stat-resolved" colorClass="text-emerald-700" />
        <Stat label="High priority"
              value={(list.rows || []).filter(r => r.priority === 'high' && r.status !== 'Closed').length}
              testid="care-stat-high" colorClass="text-rose-700" />
      </div>

      {/* List */}
      <div className="bg-white border border-slate-200 rounded-lg shadow-sm overflow-hidden">
        {loading ? (
          <div className="p-8 text-center text-sm text-slate-500" data-testid="care-loading">Loading…</div>
        ) : list.rows.length === 0 ? (
          <div className="p-8 text-center" data-testid="care-empty">
            <div className="text-4xl mb-2">🛟</div>
            <div className="text-sm text-slate-700 font-semibold">No tickets yet</div>
            <div className="text-xs text-slate-500 mt-1">When you hit a snag, tap <b>+ New ticket</b> and we'll get on it.</div>
          </div>
        ) : (
          <ul className="divide-y divide-slate-100">
            {list.rows.map((t) => (
              <li key={t.ticket_id}>
                <button onClick={() => setSelected(t)}
                        data-testid={`care-ticket-${t.ticket_id}`}
                        className="w-full text-left px-4 py-3 hover:bg-slate-50 flex items-start gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-mono text-[10px] text-slate-500 font-bold">{t.ticket_id}</span>
                      <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${STATUS_PILLS[t.status] || 'bg-slate-100'}`}>{t.status}</span>
                      <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold uppercase ${PRIORITY_PILLS[t.priority] || ''}`}>{t.priority}</span>
                      <span className="text-[10px] text-slate-500">· {t.category}</span>
                    </div>
                    <div className="font-semibold text-sm text-slate-900 mt-1 truncate">{t.subject}</div>
                    <div className="text-[11px] text-slate-500 mt-0.5">
                      {(t.thread || []).length} message{(t.thread || []).length === 1 ? '' : 's'} · created {fmtDt(t.created_at)}
                    </div>
                  </div>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Modals */}
      {createOpen && (
        <CreateTicketModal
          open={createOpen}
          categories={list.categories}
          priorities={list.priorities}
          prefill={prefill}
          onClose={() => { setCreateOpen(false); setPrefill(null); }}
          onCreated={() => { setCreateOpen(false); setPrefill(null); load(); }}
        />
      )}
      {selected && (
        <TicketDetailDrawer
          ticket={selected}
          onClose={() => setSelected(null)}
          onUpdated={(fresh) => { setSelected(fresh); load(); }}
        />
      )}
    </div>
  );
}

function Stat({ label, value, testid, colorClass = 'text-slate-900' }) {
  return (
    <div className="bg-white border border-slate-200 rounded p-3" data-testid={testid}>
      <div className="text-[10px] uppercase tracking-wider text-slate-500 font-bold">{label}</div>
      <div className={`text-2xl font-bold mt-0.5 ${colorClass}`}>{value}</div>
    </div>
  );
}

function CreateTicketModal({ open, categories, priorities, prefill, onClose, onCreated }) {
  const cats = (categories && categories.length) ? categories
    : ['Bug', 'Feature Request', 'Billing', 'Training', 'Other'];
  const prios = (priorities && priorities.length) ? priorities : ['low', 'medium', 'high'];

  const [category, setCategory] = useState('Bug');
  const [priority, setPriority] = useState(prefill?.diagnostic ? 'high' : 'medium');
  const [subject, setSubject] = useState(prefill?.subject || '');
  const [body, setBody] = useState('');
  const [diagnostic] = useState(prefill?.diagnostic || '');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);

  const submit = async () => {
    setErr(null);
    if (subject.trim().length < 2) { setErr('Please add a subject (at least 2 characters)'); return; }
    if (body.trim().length < 1) { setErr('Please describe what happened'); return; }
    setBusy(true);
    try {
      await axios.post(`${API}/care/tickets`, {
        category, priority,
        subject: subject.trim(),
        body: body.trim(),
        diagnostic: diagnostic || undefined,
      });
      onCreated();
    } catch (e) { setErr(describeError(e, 'Failed to create ticket')); }
    finally { setBusy(false); }
  };

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[80] bg-black/60 flex items-center justify-center p-4" data-testid="care-create-modal">
      <div className="bg-white rounded-lg shadow-2xl max-w-xl w-full max-h-[90vh] overflow-y-auto">
        <div className="border-b border-slate-200 px-5 py-3 flex items-start justify-between">
          <div>
            <div className="font-bold text-base text-slate-900">New support ticket</div>
            <div className="text-[11px] text-slate-500">We typically reply within 24h on medium / 8h on high priority.</div>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-700 text-2xl leading-none"
                  data-testid="care-modal-close">×</button>
        </div>

        <div className="p-4 space-y-3">
          {err && <ErrorToast err={err} testid="care-create-err" />}

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-[10px] uppercase tracking-wider text-slate-600 font-bold mb-1">Category</label>
              <select value={category} onChange={(e) => setCategory(e.target.value)}
                      data-testid="care-create-category"
                      className="w-full border border-slate-300 rounded px-2 py-1.5 text-sm">
                {cats.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-[10px] uppercase tracking-wider text-slate-600 font-bold mb-1">Priority</label>
              <select value={priority} onChange={(e) => setPriority(e.target.value)}
                      data-testid="care-create-priority"
                      className="w-full border border-slate-300 rounded px-2 py-1.5 text-sm">
                {prios.map((p) => <option key={p} value={p}>{p.toUpperCase()}</option>)}
              </select>
            </div>
          </div>

          <div>
            <label className="block text-[10px] uppercase tracking-wider text-slate-600 font-bold mb-1">Subject *</label>
            <input value={subject} onChange={(e) => setSubject(e.target.value)}
                   placeholder="One-line summary"
                   data-testid="care-create-subject"
                   className="w-full border border-slate-300 rounded px-2 py-1.5 text-sm" />
          </div>

          <div>
            <label className="block text-[10px] uppercase tracking-wider text-slate-600 font-bold mb-1">Description *</label>
            <textarea value={body} onChange={(e) => setBody(e.target.value)}
                      rows={6}
                      placeholder="What happened? Steps to reproduce help us fix it faster."
                      data-testid="care-create-body"
                      className="w-full border border-slate-300 rounded px-2 py-1.5 text-sm" />
            <div className="text-[10px] text-slate-500 mt-1">
              Tip: paste any error message you copied with the 📋 button — it speeds up debugging.
            </div>
          </div>

          {diagnostic && (
            <div className="bg-rose-50 border border-rose-200 rounded p-2.5"
                 data-testid="care-create-diagnostic">
              <div className="text-[10px] uppercase tracking-wider font-bold text-rose-900 mb-1">
                ⚠ Auto-attached error diagnostic
              </div>
              <pre className="text-[10px] text-rose-800 font-mono whitespace-pre-wrap max-h-32 overflow-y-auto">{diagnostic}</pre>
            </div>
          )}
        </div>

        <div className="border-t border-slate-200 p-3 flex items-center justify-end gap-2 bg-slate-50">
          <button onClick={onClose}
                  className="px-3 py-1.5 text-sm font-semibold text-slate-700 hover:bg-slate-200 rounded">
            Cancel
          </button>
          <button onClick={submit} disabled={busy}
                  data-testid="care-create-submit"
                  className="px-4 py-1.5 text-sm font-bold bg-indigo-600 hover:bg-indigo-700 disabled:bg-slate-300 text-white rounded shadow">
            {busy ? 'Sending…' : 'Submit ticket'}
          </button>
        </div>
      </div>
    </div>
  );
}

function TicketDetailDrawer({ ticket, onClose, onUpdated }) {
  const [reply, setReply] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const [fresh, setFresh] = useState(ticket);

  const reload = useCallback(async () => {
    try {
      const r = await axios.get(`${API}/care/tickets/${ticket.ticket_id}`);
      setFresh(r.data);
      onUpdated && onUpdated(r.data);
    } catch (e) { setErr(describeError(e, 'Failed to refresh ticket')); }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ticket.ticket_id]);

  useEffect(() => { reload(); /* one-shot fresh fetch on open */ }, [reload]);

  const sendReply = async () => {
    setErr(null);
    if (reply.trim().length < 1) { setErr('Please type a reply'); return; }
    setBusy(true);
    try {
      const r = await axios.post(`${API}/care/tickets/${ticket.ticket_id}/reply`, { text: reply.trim() });
      setFresh(r.data);
      setReply('');
      onUpdated && onUpdated(r.data);
    } catch (e) { setErr(describeError(e, 'Failed to send reply')); }
    finally { setBusy(false); }
  };

  const isClosed = ['Resolved', 'Closed'].includes(fresh?.status);

  return (
    <div className="fixed inset-0 z-[70] bg-black/50 flex items-stretch justify-end" data-testid="care-detail-drawer">
      <div className="bg-white w-full sm:w-[600px] max-w-full flex flex-col shadow-2xl">
        <div className="border-b border-slate-200 px-4 py-3 flex items-start justify-between">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="font-mono text-[11px] text-slate-500 font-bold">{fresh.ticket_id}</span>
              <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${STATUS_PILLS[fresh.status] || 'bg-slate-100'}`}>{fresh.status}</span>
              <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold uppercase ${PRIORITY_PILLS[fresh.priority] || ''}`}>{fresh.priority}</span>
            </div>
            <div className="font-bold text-base text-slate-900 mt-1">{fresh.subject}</div>
            <div className="text-[11px] text-slate-500">{fresh.category} · created {fmtDt(fresh.created_at)}</div>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-700 text-2xl leading-none ml-2"
                  data-testid="care-detail-close">×</button>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-3 bg-slate-50">
          {(fresh.thread || []).map((m, i) => (
            <div key={i}
                 data-testid={`care-thread-msg-${i}`}
                 className={`rounded p-3 text-xs ${
                   m.author_role === 'clinic' ? 'bg-blue-50 border border-blue-100'
                                              : 'bg-white border border-emerald-200'
                 }`}>
              <div className="flex items-center justify-between mb-1">
                <div className="font-bold text-[11px] text-slate-700">
                  {m.author_role === 'clinic' ? '👤 ' : '🛟 '}
                  {m.author || (m.author_role === 'clinic' ? 'You' : 'AUDINEXA Team')}
                  {m.author_role !== 'clinic' && (
                    <span className="ml-1 text-[10px] bg-emerald-100 text-emerald-800 px-1 rounded">TEAM</span>
                  )}
                </div>
                <div className="text-[10px] text-slate-500">{fmtDt(m.at)}</div>
              </div>
              <div className="whitespace-pre-wrap text-slate-800">{m.text}</div>
            </div>
          ))}
        </div>

        <div className="border-t border-slate-200 p-3 bg-white">
          {err && <div className="mb-2"><ErrorToast err={err} testid="care-reply-err" /></div>}
          {isClosed ? (
            <div className="text-center text-xs text-slate-500 italic py-2"
                 data-testid="care-detail-closed">
              This ticket is {fresh.status.toLowerCase()}. Please open a new ticket if you need further help.
            </div>
          ) : (
            <>
              <textarea value={reply} onChange={(e) => setReply(e.target.value)}
                        rows={3} placeholder="Type your reply…"
                        data-testid="care-reply-input"
                        className="w-full border border-slate-300 rounded px-2 py-1.5 text-sm" />
              <div className="flex items-center justify-end gap-2 mt-2">
                <button onClick={sendReply} disabled={busy}
                        data-testid="care-reply-submit"
                        className="px-4 py-1.5 text-sm font-bold bg-indigo-600 hover:bg-indigo-700 disabled:bg-slate-300 text-white rounded">
                  {busy ? 'Sending…' : 'Send reply'}
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
