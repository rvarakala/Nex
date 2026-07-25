import React, { useState, useRef, useEffect, useCallback } from 'react';
import axios from 'axios';
import { useNavigate } from 'react-router-dom';
import { useTestContext } from '../../TestContext';
import { useAuth } from '../../AuthContext';

import SimpleTabs from '../../components/SimpleTabs';
import AudiogramCanvas from '../../components/AudiogramCanvas';
import NoahControlPanel from '../../components/NoahControlPanel';
import PreTestPanel from '../../components/PreTestPanel';
import ReportsPanel from '../../components/ReportsPanel';
import ImpedancePanel from '../../components/ImpedancePanel';
import SpeechPanel from '../../components/SpeechPanel';
import SpecialTestsPanel from '../../components/SpecialTestsPanel';
import OAEPanel from '../../components/OAEPanel';
import SoundFieldPanel from '../../components/SoundFieldPanel';
import ABRPanel from '../../components/ABRPanel';
import PediatricPanel from '../../components/PediatricPanel';
import TinnitusPanel from '../../components/TinnitusPanel';
import { captureAndUploadPdf } from '../../components/reports/captureAndUpload';
import HearingReportHistoryModal from '../../components/HearingReportHistoryModal';
import DiagnosticsQueueBoard from './DiagnosticsQueueBoard';

const BACKEND_URL = process.env.REACT_APP_BACKEND_URL;
const API = `${BACKEND_URL}/api`;

// ==================== DEFAULT STATES ====================
const DEFAULT_PRE_TEST = {
  case_history: {
    chief_complaint: '', duration: '', onset: null, affected_ear: null,
    tinnitus: false, vertigo: false, otalgia: false, otorrhea: false, notes: '',
    hearing_specifics: {}, tinnitus_detail: {}, dizziness_detail: {},
    noise_exposure: { exposed: false, description: '' },
    family_history: { hearing_loss_in_family: null, description: '' },
    medical_history: { prior_head_neck_surgery: false, head_trauma: false, medications: '', conditions: [] },
    hearing_aid_history: { ever_used: false, currently_using: false },
    communication_needs: { difficult_situations: [], top_problem_areas: ['', '', ''], phone_ear: null },
  },
  tuning_fork: { frequency_hz: 512, rinne_right: null, rinne_left: null, weber: null },
  otoscopy: {
    right: { pinna: null, eac: null, tm: null, notes: '', image_base64: null },
    left:  { pinna: null, eac: null, tm: null, notes: '', image_base64: null },
  },
};
const DEFAULT_IMPEDANCE = {
  tympanometry: {
    right: { jerger_type: null, me_pressure: null, compliance: null, volume: null, probe_hz: 226, notes: '' },
    left:  { jerger_type: null, me_pressure: null, compliance: null, volume: null, probe_hz: 226, notes: '' },
  },
  acoustic_reflex: { enabled: false, right: { ipsi: { freqs: {} }, contra: { freqs: {} } }, left: { ipsi: { freqs: {} }, contra: { freqs: {} } } },
  reflex_decay:    { enabled: false, right: { ipsi: { freqs: {} }, contra: { freqs: {} } }, left: { ipsi: { freqs: {} }, contra: { freqs: {} } } },
  et_dysfunction:  { enabled: false, right: { toynbee: {}, valsalva: {}, pressure_app: {} }, left: { toynbee: {}, valsalva: {}, pressure_app: {} } },
  etf_intact:      { enabled: false, right: {}, left: {} },
};
const DEFAULT_SPEECH = { wrs_right: [], wrs_left: [], wrs_soundfield: [], wrs_soundfield_aided: [], fields: {} };
const BLANK_EAR = (ear) => ({ ear, ac_measurements: [], bc_measurements: [], mcl_measurements: [], ucl_measurements: [], ff_measurements: [], ffa_measurements: [] });

// Front-desk test codes → diagnostics tab IDs. Kept in sync with FRONTDESK_TEST_OPTIONS
// used in the BookAppointmentModal.
const RECOMMENDED_TAB_MAP = {
  pta: 'pure_tone',
  impedance: 'impedance',
  speech: 'speech',
  oae: 'oae',
  abr: 'abr',
  soundfield: 'soundfield',
  special: 'special',
  tinnitus: 'tinnitus',
  pediatric: 'pediatric',
};
const TEST_LABEL = {
  pta: 'PTA', impedance: 'Impedance', speech: 'Speech', oae: 'OAE',
  abr: 'ABR', soundfield: 'Sound Field', special: 'Special Tests',
  tinnitus: 'Tinnitus', pediatric: 'Pediatric',
};

export default function TestProceduresModule() {
  const { activeTest, clearActiveTest } = useTestContext();
  const { user } = useAuth();
  const navigate = useNavigate();

  const [activeTab, setActiveTab] = useState('pre_test');
  const [activeTest_ear, setActiveTest_ear] = useState('ac_right');
  const [masked, setMasked] = useState(false);
  const [extendedFrequency, setExtendedFrequency] = useState(false);
  const [reportAudiogramMode, setReportAudiogramMode] = useState('separate');
  const [showGhost, setShowGhost] = useState(true);
  const [prevSession, setPrevSession] = useState(null);

  // Report state + front-desk intake triage
  const [sessionMeta, setSessionMeta] = useState({
    report_status: 'draft',
    visit_type: 'walkin',
    recommended_tests: [],
    referred_by: null,
  });
  const [completingTest] = useState(false);
  const [completedToast] = useState(false);
  // Save + History (split button state)
  const [savingSnapshot, setSavingSnapshot] = useState(false);
  const [savedToast, setSavedToast] = useState('');
  const [historyOpen, setHistoryOpen] = useState(false);
  const [printing, setPrinting] = useState(false);

  const [preTestData, setPreTestData] = useState(DEFAULT_PRE_TEST);
  const [impedanceData, setImpedanceData] = useState(DEFAULT_IMPEDANCE);
  const [speechData, setSpeechData] = useState(DEFAULT_SPEECH);
  const [specialTestsData, setSpecialTestsData] = useState({ fields: {} });
  const [oaeData, setOaeData] = useState({ fields: {} });
  const [soundfieldData, setSoundfieldData] = useState({ fields: {} });
  const [abrData, setAbrData] = useState({ fields: {} });
  const [pediatricData, setPediatricData] = useState({ fields: {} });
  const [tinnitusData, setTinnitusData] = useState({ fields: {} });
  const [rightEarData, setRightEarData] = useState(BLANK_EAR('right'));
  const [leftEarData, setLeftEarData] = useState(BLANK_EAR('left'));

  const loadingRef = useRef(false);

  // Rehydrate from session when activeTest changes
  useEffect(() => {
    if (!activeTest?.sessionId) return;
    loadingRef.current = true;
    (async () => {
      try {
        const r = await axios.get(`${API}/sessions/${activeTest.sessionId}`);
        const s = r.data;
        setPreTestData(s?.pre_test_data || DEFAULT_PRE_TEST);
        setImpedanceData(s?.impedance_data || DEFAULT_IMPEDANCE);
        setSpeechData(s?.speech_data || DEFAULT_SPEECH);
        setSpecialTestsData(s?.special_tests_data || { fields: {} });
        setOaeData(s?.oae_data || { fields: {} });
        setSoundfieldData(s?.soundfield_data || { fields: {} });
        setAbrData(s?.abr_data || { fields: {} });
        setPediatricData(s?.pediatric_data || { fields: {} });
        setTinnitusData(s?.tinnitus_data || { fields: {} });
        setRightEarData(s?.right_ear_audiogram || BLANK_EAR('right'));
        setLeftEarData(s?.left_ear_audiogram || BLANK_EAR('left'));

        // Front-desk intake triage + report lifecycle
        const recommended = Array.isArray(s?.recommended_tests) ? s.recommended_tests : [];
        setSessionMeta({
          report_status: s?.report_status || 'draft',
          visit_type: s?.visit_type || 'walkin',
          recommended_tests: recommended,
          referred_by: s?.referred_by || null,
        });
        // Auto-switch to the first recommended tab (if any) — audiologist can override.
        if (recommended.length > 0) {
          const first = RECOMMENDED_TAB_MAP[recommended[0]];
          if (first) setActiveTab(first);
        }

        // Load prior session for ghost
        const sessList = await axios.get(`${API}/sessions`, { params: { patient_id: activeTest.patient.patient_id, limit: 20 } });
        const arr = sessList.data || [];
        const idx = arr.findIndex((x) => x.session_id === activeTest.sessionId);
        setPrevSession(idx >= 0 ? (arr[idx + 1] || null) : (arr[0]?.session_id === activeTest.sessionId ? null : arr[0]));
      } catch (e) {
        console.error('Rehydrate failed', e);
      } finally {
        setTimeout(() => { loadingRef.current = false; }, 150);
      }
    })();
  }, [activeTest?.sessionId, activeTest?.patient?.patient_id]);

  // Debounced auto-save
  const saveTimer = useRef(null);
  useEffect(() => {
    if (!activeTest?.sessionId || loadingRef.current) return;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(async () => {
      try {
        await axios.put(`${API}/sessions/${activeTest.sessionId}`, {
          pre_test_data: preTestData,
          impedance_data: impedanceData,
          speech_data: speechData,
          special_tests_data: specialTestsData,
          oae_data: oaeData,
          soundfield_data: soundfieldData,
          abr_data: abrData,
          pediatric_data: pediatricData,
          tinnitus_data: tinnitusData,
          right_ear_audiogram: rightEarData,
          left_ear_audiogram: leftEarData,
        });
      } catch (err) { console.error('Auto-save failed', err); }
    }, 800);
    return () => saveTimer.current && clearTimeout(saveTimer.current);
  }, [activeTest?.sessionId, preTestData, impedanceData, speechData, specialTestsData, oaeData, soundfieldData, abrData, pediatricData, tinnitusData, rightEarData, leftEarData]);

  // ==================== PURE TONE HELPERS ====================
  const getActiveMode = () => {
    const t = activeTest_ear.replace('_nr', '').replace('_left', '').replace('_right', '');
    if (t.includes('ac')) return 'ac';
    if (t.includes('bc')) return 'bc';
    if (t.includes('mcl')) return 'mcl';
    if (t.includes('ucl')) return 'ucl';
    if (t.includes('ff') && !t.includes('ffa')) return 'ff';
    if (t.includes('ffa')) return 'ffa';
    return 'ac';
  };
  const isNoResponse = () => activeTest_ear.includes('_nr');

  const handlePlotPoint = (ear, frequency, db, forceNR = false) => {
    const current = ear === 'right' ? rightEarData : leftEarData;
    const mode = getActiveMode();
    const key = `${mode}_measurements`;
    const existing = current[key].findIndex((m) => m.frequency === frequency);
    let updated;
    const pt = { frequency, threshold_db: db, masked, no_response: forceNR || isNoResponse() };
    if (existing >= 0) {
      updated = [...current[key]]; updated[existing] = pt;
    } else updated = [...current[key], pt];
    const data = { ...current, [key]: updated };
    if (ear === 'right') setRightEarData(data); else setLeftEarData(data);
  };
  const handleClearAudiogram = (ear) => {
    if (ear === 'right') setRightEarData(BLANK_EAR('right'));
    else setLeftEarData(BLANK_EAR('left'));
  };
  const handleDeletePoint = (ear, frequency) => {
    const current = ear === 'right' ? rightEarData : leftEarData;
    const mode = getActiveMode();
    const key = `${mode}_measurements`;
    const data = { ...current, [key]: current[key].filter((m) => m.frequency !== frequency) };
    if (ear === 'right') setRightEarData(data); else setLeftEarData(data);
  };

  // ==================== SAVE + PRINT (split) ====================
  //
  // Save = persist a lightweight JSON snapshot of the current session
  //        (audiogram + form data + report-builder state) into the
  //        `hearing_report_versions` collection so the audiologist can
  //        retrieve THIS visit later even after data has been edited.
  //        Also flips the session to `completed` + closes the queue
  //        token (same UX as the old "Save & Print" button).
  //
  // Print = capture the current preview DOM, upload the PDF to GridFS,
  //         then open it in a new tab for the physical printer.
  //
  // Both share a common `flushSession()` that autosaves the latest
  // React state before doing anything else.

  const flushSession = useCallback(async () => {
    if (!activeTest?.sessionId) return;
    if (saveTimer.current) { clearTimeout(saveTimer.current); saveTimer.current = null; }
    await axios.put(`${API}/sessions/${activeTest.sessionId}`, {
      pre_test_data: preTestData, impedance_data: impedanceData, speech_data: speechData,
      special_tests_data: specialTestsData, oae_data: oaeData, soundfield_data: soundfieldData,
      abr_data: abrData, pediatric_data: pediatricData, tinnitus_data: tinnitusData,
      right_ear_audiogram: rightEarData, left_ear_audiogram: leftEarData,
    });
  }, [activeTest?.sessionId, preTestData, impedanceData, speechData, specialTestsData,
      oaeData, soundfieldData, abrData, pediatricData, tinnitusData,
      rightEarData, leftEarData]);

  const handleSaveSnapshot = useCallback(async () => {
    if (!activeTest?.sessionId) return;
    setSavingSnapshot(true);
    try {
      // 1. Autosave the latest form state so the snapshot reflects reality.
      await flushSession();

      // 2. Persist the JSON snapshot (backend reads the session doc it just
      //    saw and copies everything into `hearing_report_versions`).
      const r = await axios.post(`${API}/hearing-reports/save`, {
        session_id: activeTest.sessionId,
      });

      // 3. Match the old "Save & Print" UX for session lifecycle: mark the
      //    session `completed` + close the queue token so the FD dashboard
      //    updates in real time. Fire-and-forget — never blocks the save.
      axios.post(`${API}/sessions/${activeTest.sessionId}/mark-printed`).catch(() => { });
      axios.post(`${API}/diagnostics/queue/complete`, { session_id: activeTest.sessionId }).catch(() => { });
      setSessionMeta((m) => ({ ...m, report_status: 'completed' }));

      setSavedToast(`Report saved — ${r?.data?.label || 'new version'}`);
      setTimeout(() => setSavedToast(''), 3000);
      // Open the history panel so the audiologist sees ALL versions
      // (including the one just saved). Slight delay so the toast is visible.
      setTimeout(() => setHistoryOpen(true), 400);
    } catch (err) {
      console.error('Save snapshot failed', err);
      alert(err?.response?.data?.detail || 'Could not save the report. Please try again.');
    } finally {
      setSavingSnapshot(false);
    }
  }, [activeTest?.sessionId, flushSession]);

  const handlePrint = useCallback(async () => {
    if (!activeTest?.sessionId) return;
    setPrinting(true);
    try {
      // 1. Autosave first so the printed PDF reflects the latest edits.
      await flushSession();

      // 2. Switch to the Reports tab and give the DOM a beat to render.
      setActiveTab('reports');
      await new Promise((r) => requestAnimationFrame(() => setTimeout(r, 500)));

      // 3. Capture the exact preview DOM → upload PDF to GridFS.
      const el = document.getElementById('report-preview');
      if (el) {
        try {
          await captureAndUploadPdf(el, activeTest.sessionId);
        } catch (uploadErr) {
          console.warn('PDF capture/upload failed, falling back to server template:', uploadErr);
          await axios.post(`${API}/sessions/${activeTest.sessionId}/mark-printed`).catch(() => { });
        }
      } else {
        await axios.post(`${API}/sessions/${activeTest.sessionId}/generate-report`);
      }

      // 4. Fetch the now-stored PDF and open it in a new tab for printing.
      try {
        const r = await axios.get(`${API}/reports/${activeTest.sessionId}/pdf`, { responseType: 'blob' });
        const url = URL.createObjectURL(r.data);
        const w = window.open(url, '_blank');
        if (!w) {
          const a = document.createElement('a');
          a.href = url; a.download = `report-${activeTest.sessionId}.pdf`;
          document.body.appendChild(a); a.click(); a.remove();
        }
        setTimeout(() => URL.revokeObjectURL(url), 60_000);
      } catch (pdfErr) {
        console.error('PDF fetch failed', pdfErr);
        alert('Print PDF could not be opened. Try again in a moment.');
      }
    } catch (err) {
      console.error('Print failed', err);
      alert(err?.response?.data?.detail || 'Could not print the report. Please try again.');
    } finally {
      setPrinting(false);
    }
  }, [activeTest?.sessionId, flushSession]);

  // ==================== EMPTY STATE: no active test ====================
  // Shows today's diagnostics queue instead of a blank placeholder so the
  // audiologist can pick the next patient with ONE click.
  if (!activeTest?.patient || !activeTest?.sessionId) {
    return <DiagnosticsQueueBoard />;
  }

  // ==================== RENDER ====================
  return (
    <div className="h-full flex flex-col bg-white" data-testid="test-procedures-module">
      {/* Context strip */}
      <div className="bg-amber-50 border-b border-amber-200 px-3 py-1.5 flex items-center justify-between flex-shrink-0" data-testid="test-context-strip">
        <div className="flex items-center gap-2 text-xs">
          <button onClick={() => { clearActiveTest(); navigate('/patients'); }} className="text-amber-800 hover:text-amber-900 font-semibold" data-testid="test-back-btn">
            ← Back to Front Desk
          </button>
          <div className="w-px h-4 bg-amber-300" />
          <span className="font-bold text-slate-800">{activeTest.patient.name}</span>
          <span className="text-slate-500">·</span>
          <span className="font-mono text-slate-600">{activeTest.patient.mrd || activeTest.patient.patient_id}</span>
          <span className="text-slate-500">·</span>
          <span className="text-slate-600">{activeTest.patient.age}{(activeTest.patient.gender || '')[0]}</span>
          {activeTest.patient.mobile && <><span className="text-slate-500">·</span><span className="text-slate-600">{activeTest.patient.mobile}</span></>}
        </div>
        {activeTest.token && (
          <div className="text-[10px] text-amber-800">Token #{activeTest.token.token_no}</div>
        )}
        <div className="flex items-center gap-2">
          <button
            onClick={() => navigate(`/ha/fittings?patient_id=${encodeURIComponent(activeTest.patient.patient_id)}&auto=1`)}
            data-testid="test-start-fitting"
            className="px-2 py-0.5 text-[10px] font-bold bg-indigo-600 hover:bg-indigo-700 text-white rounded shadow-sm"
            title="Start a hearing-aid fitting for this patient"
          >
            Start Fitting →
          </button>

          {/* ─── Save / Print / History (split from the old single button) ─── */}
          <button
            onClick={handleSaveSnapshot}
            disabled={savingSnapshot || printing}
            data-testid="test-save-report-btn"
            title="Save a JSON snapshot of this visit's report. You can view + reprint any saved version from History."
            className="px-2.5 py-0.5 text-[10px] font-bold bg-emerald-600 hover:bg-emerald-700 disabled:bg-slate-300 text-white rounded shadow-sm inline-flex items-center gap-1"
          >
            {savingSnapshot ? 'Saving…' : (
              <>
                <span>💾</span> SAVE
              </>
            )}
          </button>
          <button
            onClick={handlePrint}
            disabled={savingSnapshot || printing}
            data-testid="test-print-report-btn"
            title="Print the current report as a PDF (does not create a new saved version)"
            className="px-2.5 py-0.5 text-[10px] font-bold bg-slate-800 hover:bg-slate-900 disabled:bg-slate-300 text-white rounded shadow-sm inline-flex items-center gap-1"
          >
            {printing ? 'Printing…' : (
              <>
                <span>🖨</span> Print
              </>
            )}
          </button>
          <button
            onClick={() => setHistoryOpen(true)}
            data-testid="test-history-report-btn"
            title="View reports saved for this patient (all visits)"
            className="px-2 py-0.5 text-[10px] font-bold bg-white hover:bg-slate-100 border border-slate-300 text-slate-700 rounded shadow-sm inline-flex items-center gap-1"
          >
            <span>📁</span> History
          </button>
        </div>
      </div>

      {/* Front-desk recommendation banner — shown when reception pre-marked tests */}
      {(sessionMeta.recommended_tests.length > 0 || sessionMeta.visit_type === 'consultation') && (
        <div
          data-testid="recommended-tests-banner"
          className={`border-b px-3 py-1.5 flex items-center gap-3 flex-shrink-0 text-xs ${
            sessionMeta.visit_type === 'consultation'
              ? 'bg-violet-50 border-violet-200 text-violet-900'
              : 'bg-sky-50 border-sky-200 text-sky-900'
          }`}
        >
          {sessionMeta.visit_type === 'consultation' ? (
            <>
              <span className="font-bold uppercase tracking-wide text-[10px] px-1.5 py-0.5 bg-violet-200 rounded">
                Consultation
              </span>
              <span>Front desk marked this as a consultation — decide tests after speaking with the patient.</span>
            </>
          ) : (
            <>
              <span className="font-bold uppercase tracking-wide text-[10px] px-1.5 py-0.5 bg-sky-200 rounded">
                {sessionMeta.visit_type === 'referral' ? 'Referral' : 'Walk-in'}
              </span>
              <span className="font-semibold">Recommended tests:</span>
              <div className="flex items-center gap-1 flex-wrap">
                {sessionMeta.recommended_tests.map((t) => {
                  const label = TEST_LABEL[t] || t;
                  const tab = RECOMMENDED_TAB_MAP[t];
                  return (
                    <button
                      key={t}
                      onClick={() => tab && setActiveTab(tab)}
                      data-testid={`recommended-chip-${t}`}
                      className={`px-2 py-0.5 text-[10px] font-bold rounded border transition-colors ${
                        tab && activeTab === tab
                          ? 'bg-sky-600 text-white border-sky-700'
                          : 'bg-white text-sky-700 border-sky-300 hover:bg-sky-100'
                      }`}
                    >
                      {label}
                    </button>
                  );
                })}
              </div>
              {sessionMeta.referred_by && (
                <span className="ml-auto italic text-slate-600">
                  Ref: <b>{sessionMeta.referred_by}</b>
                </span>
              )}
            </>
          )}
        </div>
      )}

      {completedToast && (
        <div data-testid="complete-toast"
             className="absolute top-4 right-4 z-50 bg-emerald-600 text-white text-xs font-semibold px-3 py-2 rounded-lg shadow-lg">
          ✓ Report generated — opened in new tab. Session moved to Reports.
        </div>
      )}

      {savedToast && (
        <div data-testid="save-toast"
             className="absolute top-4 right-4 z-50 bg-emerald-600 text-white text-xs font-semibold px-3 py-2 rounded-lg shadow-lg">
          💾 {savedToast}
        </div>
      )}

      <HearingReportHistoryModal
        open={historyOpen}
        patientId={activeTest.patient?.patient_id}
        patientName={activeTest.patient?.name}
        sessionId={activeTest.sessionId}
        onClose={() => setHistoryOpen(false)}
      />

      <SimpleTabs activeTab={activeTab} onTabChange={setActiveTab} />

      {activeTab === 'pre_test' && <PreTestPanel data={preTestData} onChange={setPreTestData} />}

      {activeTab === 'pure_tone' && (
        <div className="flex-1 flex flex-col min-h-0">
          <div className="flex items-center gap-4 px-3 py-1 bg-gray-50 border-b border-gray-300 flex-shrink-0">
            <label className="flex items-center gap-2 cursor-pointer">
              <input type="checkbox" checked={extendedFrequency} onChange={(e) => setExtendedFrequency(e.target.checked)} className="w-3.5 h-3.5"/>
              <span className="text-xs font-medium text-gray-700">Extended Audiogram (High Frequencies)</span>
            </label>
            {prevSession && (
              <label className="flex items-center gap-2 cursor-pointer" data-testid="ghost-toggle-label">
                <input type="checkbox" checked={showGhost} onChange={(e) => setShowGhost(e.target.checked)} data-testid="ghost-toggle" className="w-3.5 h-3.5"/>
                <span className="text-xs font-medium text-gray-700">Show Previous Visit</span>
                <span className="text-[10px] text-gray-500 italic">({new Date(prevSession.test_date).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: '2-digit' })})</span>
              </label>
            )}
          </div>
          <div className="flex-1 flex min-h-0">
            <div className="flex-1 flex flex-col p-1 bg-white min-w-0">
              <h2 className="text-xs font-bold text-gray-700 mb-0.5 text-center">Right</h2>
              <div className="flex-1 min-h-0">
                <AudiogramCanvas ear="right" data={rightEarData}
                  onPlotPoint={(f, d, nr) => handlePlotPoint('right', f, d, nr)}
                  activeMode={getActiveMode()} masked={masked} extendedFrequency={extendedFrequency}
                  onClearAudiogram={handleClearAudiogram} onDeletePoint={handleDeletePoint}
                  ghostData={showGhost ? prevSession?.right_ear_audiogram : null}
                  ghostLabel={showGhost && prevSession ? new Date(prevSession.test_date).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: '2-digit' }) : null}
                />
              </div>
            </div>
            <NoahControlPanel activeTest={activeTest_ear} onTestChange={setActiveTest_ear} masked={masked} onMaskedToggle={() => setMasked(!masked)}
              rightEarData={rightEarData} leftEarData={leftEarData}
              reportAudiogramMode={reportAudiogramMode} onReportAudiogramModeChange={setReportAudiogramMode}
            />
            <div className="flex-1 flex flex-col p-1 bg-white min-w-0">
              <h2 className="text-xs font-bold text-gray-700 mb-0.5 text-center">Left</h2>
              <div className="flex-1 min-h-0">
                <AudiogramCanvas ear="left" data={leftEarData}
                  onPlotPoint={(f, d, nr) => handlePlotPoint('left', f, d, nr)}
                  activeMode={getActiveMode()} masked={masked} extendedFrequency={extendedFrequency}
                  onClearAudiogram={handleClearAudiogram} onDeletePoint={handleDeletePoint}
                  ghostData={showGhost ? prevSession?.left_ear_audiogram : null}
                  ghostLabel={showGhost && prevSession ? new Date(prevSession.test_date).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: '2-digit' }) : null}
                />
              </div>
            </div>
          </div>
        </div>
      )}

      {activeTab === 'speech' && <SpeechPanel data={speechData} onChange={setSpeechData} />}
      {activeTab === 'impedance' && <ImpedancePanel data={impedanceData} onChange={setImpedanceData} />}
      {activeTab === 'special' && <SpecialTestsPanel data={specialTestsData} onChange={setSpecialTestsData} />}
      {activeTab === 'oae' && <OAEPanel data={oaeData} onChange={setOaeData} />}
      {activeTab === 'soundfield' && <SoundFieldPanel data={soundfieldData} onChange={setSoundfieldData} />}
      {activeTab === 'abr' && <ABRPanel data={abrData} onChange={setAbrData} />}
      {activeTab === 'pediatric' && <PediatricPanel data={pediatricData} onChange={setPediatricData} />}
      {activeTab === 'tinnitus' && <TinnitusPanel data={tinnitusData} onChange={setTinnitusData} />}

      {activeTab === 'reports' && (
        <ReportsPanel
          patient={activeTest.patient}
          rightEarData={rightEarData}
          leftEarData={leftEarData}
          preTestData={preTestData}
          sessionId={activeTest.sessionId}
          audiologistName={user?.name || 'Audiologist'}
          audiologistUserId={user?.user_id}
          clinicalImpression=""
          recommendations={[]}
          audiogramMode={reportAudiogramMode}
          impedanceData={impedanceData}
          speechData={speechData}
          specialTestsData={specialTestsData}
          oaeData={oaeData}
          soundfieldData={soundfieldData}
          abrData={abrData}
          pediatricData={pediatricData}
          tinnitusData={tinnitusData}
          onPersist={async (partial) => {
            if (!activeTest.sessionId) return;
            try { await axios.put(`${API}/sessions/${activeTest.sessionId}`, partial); }
            catch (err) { console.error('Report save failed', err); }
          }}
        />
      )}
    </div>
  );
}
