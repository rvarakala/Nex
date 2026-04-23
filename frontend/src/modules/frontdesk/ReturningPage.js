import React, { useEffect, useState, useRef } from 'react';
import axios from 'axios';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useTestContext } from '../../TestContext';
import Pagination, { DEFAULT_PAGE_SIZE, usePaginationSlice } from '../../components/Pagination';
import PatientDrawer from '../../components/PatientDrawer';

const BACKEND_URL = process.env.REACT_APP_BACKEND_URL;
const API = `${BACKEND_URL}/api`;

export default function ReturningPage() {
  const navigate = useNavigate();
  const { setActiveTest } = useTestContext();
  const [params] = useSearchParams();
  const [query, setQuery] = useState(params.get('q') || '');
  const [results, setResults] = useState([]);
  const [selected, setSelected] = useState(null);
  const [sessions, setSessions] = useState([]);
  const [loadingResults, setLoadingResults] = useState(false);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [page, setPage] = useState(1);
  const pagedResults = usePaginationSlice(results, page, DEFAULT_PAGE_SIZE);
  useEffect(() => { setPage(1); }, [query, results.length]);
  const debounceRef = useRef(null);
  const [historyPatientId, setHistoryPatientId] = useState(null);

  // Debounced search
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(async () => {
      if (!query.trim()) { setResults([]); return; }
      setLoadingResults(true);
      try {
        const r = await axios.get(`${API}/patients`, { params: { search: query, limit: 200 } });
        setResults(r.data || []);
      } catch (e) { console.error(e); }
      finally { setLoadingResults(false); }
    }, 250);
    return () => debounceRef.current && clearTimeout(debounceRef.current);
  }, [query]);

  // Load details for selected patient
  useEffect(() => {
    if (!selected) { setSessions([]); return; }
    setLoadingDetail(true);
    axios.get(`${API}/sessions`, { params: { patient_id: selected.patient_id, limit: 20 } })
      .then((r) => setSessions(r.data || []))
      .catch(() => setSessions([]))
      .finally(() => setLoadingDetail(false));
  }, [selected]);

  const checkIn = async () => {
    if (!selected) return;
    const tk = await axios.post(`${API}/tokens`, { patient_id: selected.patient_id, service: 'Follow-up' });
    navigate(`/token/${tk.data.token_id}`);
  };

  const startDiagnostics = async () => {
    if (!selected) return;
    const session = await axios.post(`${API}/sessions`, {
      patient_id: selected.patient_id,
      audiologist_name: 'Audiologist',
      test_reliability: 'good',
      test_methods: ['headphones'],
    });
    await axios.post(`${API}/tokens`, { patient_id: selected.patient_id, service: 'PTA' });
    setActiveTest({ patient: selected, sessionId: session.data.session_id });
    navigate('/test');
  };

  const openLastReport = (session_id) => {
    // For now, reopen the existing session in M02+M03. M03 PDF export remains in reports tab.
    setActiveTest({ patient: selected, sessionId: session_id });
    navigate('/test');
  };

  const fmtDate = (iso) => {
    try { return new Date(iso).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }); }
    catch { return iso; }
  };

  return (
    <div className="p-4 flex gap-3 h-full" data-testid="returning-page">
      {/* Left: search + results list */}
      <div className="w-[380px] flex-shrink-0 bg-white border border-slate-200 rounded-lg shadow-sm flex flex-col">
        <div className="p-2 border-b border-slate-200">
          <div className="text-[11px] font-bold text-slate-700 mb-1">Returning Patient Search</div>
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Mobile · MRD · Name"
            autoFocus
            data-testid="ret-search"
            className="w-full px-2.5 py-1.5 text-sm border border-slate-300 rounded focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
          />
        </div>
        <div className="flex-1 overflow-auto">
          {loadingResults && <div className="p-4 text-center text-[11px] text-slate-400 italic">Searching…</div>}
          {!loadingResults && query.trim() && results.length === 0 && (
            <div className="p-4 text-center">
              <div className="text-[11px] text-slate-400 italic mb-2">No matches</div>
              <button
                onClick={() => navigate('/frontdesk/new')}
                data-testid="ret-new-patient"
                className="text-[11px] bg-blue-600 hover:bg-blue-700 text-white font-semibold px-3 py-1 rounded"
              >+ Register as New</button>
            </div>
          )}
          {pagedResults.map((p) => (
            <div
              key={p.patient_id}
              data-testid={`ret-result-${p.patient_id}`}
              className={`w-full flex items-center border-b border-slate-100 transition-colors ${
                selected?.patient_id === p.patient_id ? 'bg-blue-50 border-l-2 border-l-blue-600' : 'hover:bg-blue-50'
              }`}
            >
              <button
                type="button"
                onClick={() => setSelected(p)}
                className="flex-1 text-left px-3 py-2"
              >
                <div className="font-semibold text-[12px] text-slate-800">{p.name}</div>
                <div className="text-[10px] text-slate-500 flex items-center gap-1.5 mt-0.5">
                  <span>{p.mrd || p.patient_id}</span>
                  <span>·</span>
                  <span>{p.age}{(p.gender || '')[0]}</span>
                  {p.mobile && <><span>·</span><span>{p.mobile}</span></>}
                </div>
              </button>
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); setHistoryPatientId(p.patient_id); }}
                data-testid={`ret-history-${p.patient_id}`}
                title="View past sessions / invoices"
                className="mx-2 px-2 py-1 text-[10px] font-semibold text-indigo-700 border border-indigo-200 bg-white hover:bg-indigo-50 rounded"
              >
                History
              </button>
            </div>
          ))}
        </div>
        {results.length > DEFAULT_PAGE_SIZE && (
          <Pagination page={page} setPage={setPage} total={results.length} testidPrefix="ret-pagination" />
        )}
      </div>

      {/* Right: detail card */}
      <div className="flex-1 min-w-0">
        {!selected ? (
          <div className="h-full flex items-center justify-center bg-white border border-slate-200 rounded-lg">
            <div className="text-center text-slate-400">
              <div className="text-sm">Select a patient from the left</div>
              <div className="text-[11px] mt-1">Search by mobile, MRD, or name</div>
            </div>
          </div>
        ) : (
          <div className="bg-white border border-slate-200 rounded-lg shadow-sm h-full flex flex-col" data-testid="ret-detail">
            <div className="px-4 py-2.5 border-b border-slate-200 bg-gradient-to-r from-slate-50 to-white flex items-start justify-between">
              <div>
                <div className="text-lg font-bold text-slate-800">{selected.name}</div>
                <div className="text-[11px] text-slate-500 flex gap-2 mt-0.5">
                  <span><b>{selected.mrd || selected.patient_id}</b></span>
                  <span>·</span>
                  <span>{selected.age}{(selected.gender || '')[0]} · {selected.gender}</span>
                  {selected.mobile && <><span>·</span><span>{selected.mobile}</span></>}
                </div>
              </div>
              <span className="text-[9px] bg-slate-100 border border-slate-200 text-slate-600 px-1.5 py-0.5 rounded uppercase tracking-wider">
                {selected.insurance_scheme || 'Cash'}
              </span>
            </div>

            <div className="flex-1 overflow-auto p-3 space-y-3">
              {/* Profile summary */}
              <div className="grid grid-cols-3 gap-2 text-[11px]">
                <Cell label="Registered" value={fmtDate(selected.created_at)} />
                <Cell label="Chief complaint" value={selected.chief_complaint || '—'} />
                <Cell label="Duration" value={selected.complaint_duration || '—'} />
                <Cell label="Ear side" value={selected.ear_side || '—'} />
                <Cell label="Referred by" value={selected.referring_physician || selected.referral_source || '—'} />
                <Cell label="City" value={selected.city || '—'} />
              </div>

              {/* Visits */}
              <div>
                <div className="text-[10px] font-bold text-slate-600 uppercase tracking-wider mb-1">Previous Visits ({sessions.length})</div>
                {loadingDetail && <div className="text-[11px] text-slate-400 italic">Loading…</div>}
                {!loadingDetail && sessions.length === 0 && (
                  <div className="text-[11px] text-slate-400 italic bg-slate-50 rounded px-2 py-1.5">No previous visits — this is a first test.</div>
                )}
                <div className="space-y-1">
                  {sessions.slice(0, 8).map((s) => {
                    const hasReport = !!s.right_ear_audiogram?.ac_measurements?.length || !!s.left_ear_audiogram?.ac_measurements?.length;
                    return (
                      <div key={s.session_id} className="flex items-center gap-2 text-[11px] bg-slate-50 border border-slate-200 rounded px-2 py-1" data-testid={`ret-visit-${s.session_id}`}>
                        <span className="font-semibold text-slate-700 w-24 flex-shrink-0">{fmtDate(s.test_date)}</span>
                        <span className="text-slate-500 flex-1 truncate">{s.audiologist_name || '—'}</span>
                        <span className={`px-1.5 py-0.5 rounded text-[9px] font-semibold ${hasReport ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'}`}>
                          {hasReport ? 'report ready' : 'pending'}
                        </span>
                        <button
                          onClick={() => openLastReport(s.session_id)}
                          data-testid={`ret-visit-open-${s.session_id}`}
                          className="text-[10px] px-1.5 py-0.5 text-blue-600 hover:bg-blue-50 rounded"
                        >Open →</button>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>

            {/* Sticky actions */}
            <div className="px-3 py-2 border-t border-slate-200 bg-slate-50 flex gap-2 justify-end">
              <button
                onClick={checkIn}
                data-testid="ret-btn-checkin"
                className="px-3 py-1.5 text-xs bg-white border border-slate-300 hover:bg-slate-50 text-slate-700 font-semibold rounded"
              >Check In / Print Token</button>
              <button
                onClick={startDiagnostics}
                data-testid="ret-btn-start"
                className="px-3 py-1.5 text-xs bg-blue-600 hover:bg-blue-700 text-white font-semibold rounded shadow-sm"
              >Start Diagnostics →</button>
            </div>
          </div>
        )}
      </div>

      <PatientDrawer
        patientId={historyPatientId}
        onClose={() => setHistoryPatientId(null)}
      />
    </div>
  );
}

const Cell = ({ label, value }) => (
  <div className="bg-slate-50 rounded px-2 py-1.5 border border-slate-200">
    <div className="text-[9px] uppercase tracking-wider text-slate-500 font-semibold">{label}</div>
    <div className="text-[11px] text-slate-800 mt-0.5 truncate">{value}</div>
  </div>
);
