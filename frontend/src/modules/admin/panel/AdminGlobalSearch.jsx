/**
 * AdminGlobalSearch — the ⌘K / "Search…" widget in the Super Admin topbar.
 *
 * Full-screen modal overlay with 3 result groups: Tenants, Leads, Users.
 * Debounced, keyboard navigable (↑↓ / Enter to open, Esc to close).
 */
import React, { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import axios from 'axios';
import { Search, X, Building2, Flame, Users as UsersIcon, CornerDownLeft } from 'lucide-react';

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;

export default function AdminGlobalSearch() {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [results, setResults] = useState({ tenants: [], leads: [], users: [], total: 0 });
  const [loading, setLoading] = useState(false);
  const [highlight, setHighlight] = useState(0);
  const inputRef = useRef(null);
  const debRef = useRef(null);
  const navigate = useNavigate();

  // Flat list of navigable items for arrow-key selection
  const flat = useMemo(() => [
    ...results.tenants.map((r) => ({ type: 'tenant', id: r.clinic_id, label: r.name, sub: `${r.city || ''} · ${r.subscription_tier || ''}`, to: `/admin/tenants/${r.clinic_id}` })),
    ...results.leads.map((r) => ({ type: 'lead', id: r.email, label: r.clinic_name || r.email, sub: `${r.contact_name || ''} · ${r.email}`, to: '/admin/leads' })),
    ...results.users.map((r) => ({ type: 'user', id: r.user_id, label: r.name || r.email, sub: `${r.role || ''} · ${r.clinic_name || r.email}`, to: '/admin/users' })),
  ], [results]);

  // Global keyboard shortcut: ⌘K / Ctrl+K to open
  useEffect(() => {
    const h = (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        // Only intercept if focus isn't already in a text field outside our modal
        e.preventDefault();
        setOpen((o) => !o);
      } else if (e.key === 'Escape' && open) {
        setOpen(false);
      }
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [open]);

  useEffect(() => {
    if (open) setTimeout(() => inputRef.current?.focus(), 50);
    else { setQ(''); setResults({ tenants: [], leads: [], users: [], total: 0 }); setHighlight(0); }
  }, [open]);

  // Debounced fetch
  useEffect(() => {
    if (debRef.current) clearTimeout(debRef.current);
    if (!open || q.trim().length < 2) {
      setResults({ tenants: [], leads: [], users: [], total: 0 });
      return;
    }
    setLoading(true);
    debRef.current = setTimeout(async () => {
      try {
        const r = await axios.get(`${API}/admin/v2/search`, { params: { q, limit: 8 } });
        setResults(r.data || { tenants: [], leads: [], users: [], total: 0 });
        setHighlight(0);
      } catch {
        setResults({ tenants: [], leads: [], users: [], total: 0 });
      } finally {
        setLoading(false);
      }
    }, 200);
    return () => { if (debRef.current) clearTimeout(debRef.current); };
  }, [q, open]);

  const handleKey = useCallback((e) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setHighlight((h) => Math.min(flat.length - 1, h + 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setHighlight((h) => Math.max(0, h - 1));
    } else if (e.key === 'Enter' && flat[highlight]) {
      e.preventDefault();
      setOpen(false);
      navigate(flat[highlight].to);
    }
  }, [flat, highlight, navigate]);

  return (
    <>
      {/* Trigger button in topbar */}
      <button
        onClick={() => setOpen(true)}
        data-testid="admin-global-search-trigger"
        className="flex items-center gap-2 text-[11px] text-slate-500 hover:text-slate-900 bg-slate-50 hover:bg-slate-100 border border-slate-200 hover:border-slate-300 rounded-md px-2.5 py-1 transition-colors"
        title="Global search (Cmd/Ctrl + K)"
      >
        <Search size={12} />
        <span className="hidden sm:inline">Search tenants, leads, users…</span>
        <span className="ml-2 font-mono bg-white border border-slate-300 text-slate-600 rounded px-1 text-[9px]">⌘K</span>
      </button>

      {/* Modal */}
      {open && (
        <div
          className="fixed inset-0 z-[100] bg-slate-900/60 backdrop-blur-sm flex items-start justify-center p-4 pt-[15vh]"
          onClick={() => setOpen(false)}
          data-testid="admin-global-search-modal"
        >
          <div
            className="w-full max-w-2xl bg-white rounded-xl shadow-2xl overflow-hidden animate-in fade-in slide-in-from-top-4"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Input */}
            <div className="flex items-center gap-3 px-4 py-3 border-b border-slate-200">
              <Search size={18} className="text-slate-400 flex-shrink-0" />
              <input
                ref={inputRef}
                value={q}
                onChange={(e) => setQ(e.target.value)}
                onKeyDown={handleKey}
                placeholder="Search tenants, leads, users…"
                data-testid="admin-global-search-input"
                className="flex-1 text-sm outline-none text-slate-900 placeholder-slate-400"
              />
              {loading && (
                <div className="w-4 h-4 border-2 border-orange-400 border-t-transparent rounded-full animate-spin" />
              )}
              <button
                onClick={() => setOpen(false)}
                className="text-slate-400 hover:text-slate-700 p-0.5 rounded hover:bg-slate-100"
                data-testid="admin-global-search-close"
              >
                <X size={16} />
              </button>
            </div>

            {/* Results */}
            <div className="max-h-[60vh] overflow-auto" data-testid="admin-global-search-results">
              {q.trim().length < 2 ? (
                <div className="px-6 py-12 text-center text-slate-400">
                  <div className="text-xs mb-2">Type at least 2 characters to search</div>
                  <div className="text-[10px] text-slate-500 space-x-3">
                    <span><kbd className="px-1.5 py-0.5 bg-slate-100 border border-slate-300 rounded font-mono">↑↓</kbd> navigate</span>
                    <span><kbd className="px-1.5 py-0.5 bg-slate-100 border border-slate-300 rounded font-mono">↵</kbd> open</span>
                    <span><kbd className="px-1.5 py-0.5 bg-slate-100 border border-slate-300 rounded font-mono">Esc</kbd> close</span>
                  </div>
                </div>
              ) : results.total === 0 && !loading ? (
                <div className="px-6 py-12 text-center text-slate-500 text-sm italic">
                  No results for "<b>{q}</b>"
                </div>
              ) : (
                <SearchGroups results={results} highlight={highlight} setHighlight={setHighlight} flat={flat} onSelect={(to) => { setOpen(false); navigate(to); }} />
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}

const GROUP_META = {
  tenants: { label: 'Tenants', Icon: Building2, color: 'text-indigo-500' },
  leads:   { label: 'Leads',   Icon: Flame,     color: 'text-orange-500' },
  users:   { label: 'Users',   Icon: UsersIcon, color: 'text-emerald-500' },
};

function SearchGroups({ results, highlight, setHighlight, flat, onSelect }) {
  // Build group sections with correct absolute indexes into `flat`
  let idx = 0;
  const sections = [];
  if (results.tenants?.length) {
    sections.push({ key: 'tenants', items: results.tenants.map((r) => ({ ...r, _i: idx++ })) });
  }
  if (results.leads?.length) {
    sections.push({ key: 'leads', items: results.leads.map((r) => ({ ...r, _i: idx++ })) });
  }
  if (results.users?.length) {
    sections.push({ key: 'users', items: results.users.map((r) => ({ ...r, _i: idx++ })) });
  }

  return (
    <div className="py-1">
      {sections.map((s) => {
        const M = GROUP_META[s.key];
        return (
          <div key={s.key} className="mb-1">
            <div className="px-4 py-1 text-[10px] uppercase tracking-[0.15em] font-bold text-slate-500 flex items-center gap-1.5">
              <M.Icon size={10} className={M.color} />
              {M.label}
            </div>
            {s.items.map((r) => {
              const fr = flat[r._i];
              const active = r._i === highlight;
              return (
                <button
                  key={r._i}
                  onMouseEnter={() => setHighlight(r._i)}
                  onClick={() => onSelect(fr.to)}
                  data-testid={`admin-search-result-${s.key}-${r._i}`}
                  className={`w-full flex items-center gap-3 px-4 py-2 text-left transition-colors ${
                    active ? 'bg-indigo-50' : 'hover:bg-slate-50'
                  }`}
                >
                  <M.Icon size={14} className={`${M.color} flex-shrink-0`} />
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-semibold text-slate-900 truncate">{fr.label}</div>
                    <div className="text-[11px] text-slate-500 truncate">{fr.sub}</div>
                  </div>
                  {active && <CornerDownLeft size={12} className="text-indigo-400 flex-shrink-0" />}
                </button>
              );
            })}
          </div>
        );
      })}
    </div>
  );
}
