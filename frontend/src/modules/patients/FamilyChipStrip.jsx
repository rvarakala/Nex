/**
 * FamilyChipStrip — Renders the current patient's family group as a
 * horizontal strip of tap-to-navigate chips.
 *
 * Sits directly under the profile header on `PatientProfilePage`. Two
 * states:
 *   - Not linked: renders a subtle "Link family member" button (any
 *     role — front-desk gets this too because linking family is a
 *     workflow, not a destructive admin action).
 *   - Linked: shows one indigo chip per OTHER family member (the
 *     current patient's own chip is skipped). Each chip navigates to
 *     that member's profile on click, and shows the relationship
 *     label ("spouse", "child", …) as a small caption.
 *
 * The strip auto-hides when there are 0 other members so a solo group
 * (which shouldn't exist, but the backend dissolves those) never
 * renders an empty row.
 */
import React, { useEffect, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import axios from 'axios';
import { Users, Plus, X, Search, Loader2 } from 'lucide-react';

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;

// Fixed relationship set the UI offers. Backend stores whatever we send
// so this is safe to extend in the future without a migration.
const RELATIONSHIPS = ['spouse', 'parent', 'child', 'sibling', 'other'];

// Color hash so each family member gets a stable accent. Same input
// always maps to same shade — the UI feels less noisy this way.
const CHIP_TONES = [
  'bg-indigo-50 text-indigo-800 border-indigo-200 hover:border-indigo-400',
  'bg-emerald-50 text-emerald-800 border-emerald-200 hover:border-emerald-400',
  'bg-amber-50 text-amber-800 border-amber-200 hover:border-amber-400',
  'bg-sky-50 text-sky-800 border-sky-200 hover:border-sky-400',
  'bg-fuchsia-50 text-fuchsia-800 border-fuchsia-200 hover:border-fuchsia-400',
];
const toneFor = (id) => {
  let h = 0;
  for (const ch of String(id || '')) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return CHIP_TONES[h % CHIP_TONES.length];
};

export default function FamilyChipStrip({ patient, onChange }) {
  const [group, setGroup] = useState(null);
  const [loading, setLoading] = useState(true);
  const [showLink, setShowLink] = useState(false);
  const navigate = useNavigate();

  const load = useCallback(async () => {
    if (!patient?.patient_id) return;
    setLoading(true);
    try {
      const r = await axios.get(`${API}/patients/${patient.patient_id}/family`);
      setGroup(r.data?.group || null);
    } catch {
      setGroup(null);
    } finally {
      setLoading(false);
    }
  }, [patient?.patient_id]);

  useEffect(() => { load(); }, [load]);

  if (loading) return null;

  const others = (group?.members || []).filter((m) => m.patient_id !== patient.patient_id);

  return (
    <div className="px-4 sm:px-6 pt-3" data-testid="family-chip-strip">
      {showLink && (
        <LinkFamilyModal
          currentPatient={patient}
          currentGroupName={group?.name}
          onClose={() => setShowLink(false)}
          onLinked={async () => { setShowLink(false); await load(); onChange?.(); }}
        />
      )}

      {group ? (
        <div className="flex flex-wrap items-center gap-2">
          <div className="inline-flex items-center gap-1.5 text-[10px] font-bold text-slate-500 uppercase tracking-wider">
            <Users size={11} />
            {group.name}
          </div>
          {others.map((m) => (
            <button
              key={m.patient_id}
              type="button"
              onClick={() => navigate(`/patients/${m.patient_id}`)}
              data-testid={`family-chip-${m.patient_id}`}
              className={`inline-flex items-center gap-1.5 border rounded-full px-2.5 py-1 text-[11.5px] font-semibold transition ${toneFor(m.patient_id)}`}
              title={`Open ${m.name}'s profile`}
            >
              <span>{m.name}</span>
              {m.relationship && (
                <span className="opacity-70 text-[10px] font-medium">· {m.relationship}</span>
              )}
            </button>
          ))}
          <button
            type="button"
            onClick={() => setShowLink(true)}
            data-testid="family-link-more-btn"
            className="inline-flex items-center gap-1 border border-dashed border-slate-300 hover:border-indigo-400 hover:text-indigo-700 rounded-full px-2.5 py-1 text-[11px] text-slate-500 font-semibold transition"
          >
            <Plus size={10} /> Add member
          </button>
          <UnlinkButton patient={patient} onUnlinked={async () => { await load(); onChange?.(); }} />
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setShowLink(true)}
          data-testid="family-link-empty-btn"
          className="inline-flex items-center gap-1.5 border border-dashed border-slate-200 hover:border-indigo-400 hover:text-indigo-700 rounded-full px-3 py-1 text-[11.5px] font-semibold text-slate-500 transition"
        >
          <Users size={12} /> Link family member
        </button>
      )}
    </div>
  );
}

function UnlinkButton({ patient, onUnlinked }) {
  const [busy, setBusy] = useState(false);
  const doUnlink = async () => {
    if (!window.confirm(`Remove ${patient.name} from this family group?`)) return;
    setBusy(true);
    try {
      await axios.post(`${API}/patients/${patient.patient_id}/family/unlink`);
      onUnlinked?.();
    } catch {
      /* toast handled by caller */
    } finally { setBusy(false); }
  };
  return (
    <button
      type="button"
      disabled={busy}
      onClick={doUnlink}
      data-testid="family-unlink-btn"
      className="inline-flex items-center gap-1 text-[10.5px] text-slate-400 hover:text-rose-600 underline underline-offset-2 ml-1 disabled:opacity-50"
      title="Remove this patient from the family group"
    >
      Leave family
    </button>
  );
}

function LinkFamilyModal({ currentPatient, currentGroupName, onClose, onLinked }) {
  const [query, setQuery] = useState('');
  const [candidates, setCandidates] = useState([]);
  const [searching, setSearching] = useState(false);
  const [picked, setPicked] = useState(null);
  const [relationship, setRelationship] = useState('spouse');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  // 300ms debounced search — same pattern as MergePatientsModal so
  // the front-desk's typing experience feels consistent across the
  // duplicate-management surface.
  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) { setCandidates([]); return; }
    let alive = true;
    setSearching(true);
    const t = setTimeout(async () => {
      try {
        const r = await axios.get(`${API}/patients`, { params: { search: q, limit: 8 } });
        if (!alive) return;
        const rows = Array.isArray(r.data) ? r.data : (r.data?.items || []);
        setCandidates(rows.filter((p) => p.patient_id !== currentPatient.patient_id));
      } catch {
        if (alive) setCandidates([]);
      } finally {
        if (alive) setSearching(false);
      }
    }, 300);
    return () => { alive = false; clearTimeout(t); };
  }, [query, currentPatient.patient_id]);

  const doLink = async () => {
    if (!picked) return;
    setBusy(true); setErr('');
    try {
      await axios.post(`${API}/patients/${currentPatient.patient_id}/family/link`, {
        other_patient_id: picked.patient_id,
        relationship,
      });
      onLinked?.();
    } catch (e) {
      const detail = e?.response?.data?.detail;
      setErr(typeof detail === 'string' ? detail : (detail?.message || 'Link failed'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4 pb-24 md:pb-4"
      onClick={(e) => { if (e.target === e.currentTarget) onClose?.(); }}
      data-testid="family-link-modal"
    >
      <div className="bg-white rounded-xl shadow-2xl w-[560px] max-w-full max-h-[calc(100dvh-96px)] sm:max-h-[85vh] flex flex-col">
        <header className="px-4 py-3 border-b border-slate-200 flex items-center justify-between flex-shrink-0">
          <h3 className="text-sm font-bold text-slate-900 flex items-center gap-2">
            <Users size={16} className="text-indigo-600" />
            {currentGroupName ? `Add member to ${currentGroupName}` : 'Link family member'}
          </h3>
          <button onClick={onClose} data-testid="family-link-close" className="p-1 hover:bg-slate-100 rounded text-slate-500">
            <X size={16} />
          </button>
        </header>

        <div className="flex-1 overflow-y-auto p-4 space-y-3">
          <div className="border border-slate-200 bg-slate-50 rounded-lg p-3">
            <div className="text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1">Current patient</div>
            <div className="text-sm font-semibold text-slate-900">{currentPatient.name}</div>
            <div className="text-[11px] text-slate-500 mt-0.5">
              MRD <span className="font-mono">{currentPatient.mrd || currentPatient.patient_id}</span>
              {currentPatient.mobile && <> · 📱 {currentPatient.mobile}</>}
            </div>
          </div>

          {!picked && (
            <div>
              <label className="text-[11px] font-semibold text-slate-700 mb-1 block">
                Search for the family member to link
              </label>
              <div className="relative">
                <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
                <input
                  type="text"
                  autoFocus
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Name, phone or MRD…"
                  data-testid="family-link-search"
                  className="w-full pl-8 pr-3 py-2 text-[13px] border border-slate-300 rounded-md focus:outline-none focus:ring-2 focus:ring-indigo-400"
                />
              </div>
              <div className="mt-2 space-y-1 min-h-[40px]">
                {searching && <div className="text-[11px] text-slate-400 italic px-2 py-1.5">Searching…</div>}
                {!searching && query.length >= 2 && candidates.length === 0 && (
                  <div className="text-[11px] text-slate-500 italic px-2 py-1.5">No matching patients found.</div>
                )}
                {candidates.map((c) => (
                  <button
                    key={c.patient_id}
                    type="button"
                    onClick={() => setPicked(c)}
                    data-testid={`family-candidate-${c.patient_id}`}
                    className="w-full text-left border border-slate-200 hover:border-indigo-400 hover:bg-indigo-50 rounded-md px-3 py-2 transition"
                  >
                    <div className="text-[13px] font-semibold text-slate-900">{c.name}</div>
                    <div className="text-[11px] text-slate-500 mt-0.5">
                      MRD <span className="font-mono">{c.mrd || c.patient_id}</span>
                      {c.mobile && <> · 📱 {c.mobile}</>}
                      {c.age && <> · {c.age}y</>}
                      {c.gender && <> · {c.gender}</>}
                    </div>
                  </button>
                ))}
              </div>
            </div>
          )}

          {picked && (
            <div className="space-y-3">
              <div className="border border-indigo-200 bg-indigo-50/40 rounded-lg p-3" data-testid="family-picked">
                <div className="text-[10px] font-bold text-indigo-700 uppercase tracking-wider mb-1">Linking to</div>
                <div className="text-sm font-semibold text-slate-900">{picked.name}</div>
                <div className="text-[11px] text-slate-500 mt-0.5">
                  MRD <span className="font-mono">{picked.mrd || picked.patient_id}</span>
                  {picked.mobile && <> · 📱 {picked.mobile}</>}
                </div>
                <button
                  type="button"
                  onClick={() => setPicked(null)}
                  data-testid="family-change-pick"
                  className="text-[10px] font-semibold text-slate-500 hover:text-slate-800 underline mt-1.5"
                >Change</button>
              </div>

              <div>
                <label className="text-[11px] font-semibold text-slate-700 mb-1 block">Relationship</label>
                <div className="flex flex-wrap gap-1.5">
                  {RELATIONSHIPS.map((r) => (
                    <button
                      key={r}
                      type="button"
                      onClick={() => setRelationship(r)}
                      data-testid={`family-relationship-${r}`}
                      className={`px-3 py-1 rounded-full border text-[11.5px] font-semibold capitalize transition ${
                        relationship === r
                          ? 'bg-indigo-600 text-white border-indigo-600'
                          : 'bg-white text-slate-700 border-slate-300 hover:border-indigo-400'
                      }`}
                    >
                      {r}
                    </button>
                  ))}
                </div>
                <p className="text-[10.5px] text-slate-500 mt-1.5 italic">
                  Relationship is <b>as {picked?.name?.split(' ')?.[0] || 'they'} are to {currentPatient?.name?.split(' ')?.[0] || 'this patient'}</b>.
                </p>
              </div>
            </div>
          )}

          {err && (
            <div className="text-[12px] text-rose-700 bg-rose-50 border border-rose-200 rounded-md px-3 py-2" data-testid="family-link-error">
              {err}
            </div>
          )}
        </div>

        <footer className="px-4 py-2.5 border-t border-slate-200 bg-slate-50 flex items-center justify-between gap-2 flex-shrink-0">
          <button
            type="button"
            onClick={onClose}
            data-testid="family-link-cancel"
            className="px-3 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-200 rounded"
          >Cancel</button>
          <button
            type="button"
            disabled={!picked || busy}
            onClick={doLink}
            data-testid="family-link-confirm"
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-white bg-indigo-600 hover:bg-indigo-700 rounded disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {busy ? <Loader2 size={12} className="animate-spin" /> : <Users size={12} />}
            {busy ? 'Linking…' : 'Link as family'}
          </button>
        </footer>
      </div>
    </div>
  );
}
