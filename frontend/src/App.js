import React, { useState, useEffect, useRef, useCallback } from "react";
import "@/App.css";
import axios from "axios";
import SimpleTabs from "./components/SimpleTabs";
import AudiogramCanvas from "./components/AudiogramCanvas";
import NoahControlPanel from "./components/NoahControlPanel";
import PreTestPanel from "./components/PreTestPanel";
import ReportsPanel from "./components/ReportsPanel";
import ImpedancePanel from "./components/ImpedancePanel";
import SpeechPanel from "./components/SpeechPanel";
import SpecialTestsPanel from "./components/SpecialTestsPanel";
import OAEPanel from "./components/OAEPanel";
import SoundFieldPanel from "./components/SoundFieldPanel";
import ABRPanel from "./components/ABRPanel";
import PediatricPanel from "./components/PediatricPanel";
import TinnitusPanel from "./components/TinnitusPanel";

import { PatientSwitcher } from "./components/patient/PatientSwitcher";
import { PatientModal } from "./components/patient/PatientModal";
import { PatientJournal } from "./components/patient/PatientJournal";

const BACKEND_URL = process.env.REACT_APP_BACKEND_URL;
const API = `${BACKEND_URL}/api`;
const AUDIOLOGIST_NAME = "Dr. Audiologist";
const LAST_PATIENT_KEY = "acs.lastPatientId";
const LAST_SESSION_KEY = "acs.lastSessionId";

// ==================== DEFAULTS (fresh blank session) ====================
const DEFAULT_PRE_TEST = {
  case_history: {
    chief_complaint: '', duration: '', onset: null, affected_ear: null,
    tinnitus: false, vertigo: false, otalgia: false, otorrhea: false,
    notes: '',
    hearing_specifics: {
      suspect_hearing_loss: null, better_ear: null, progression: null,
      prior_test: false, prior_test_details: '',
      seen_physician: false, physician_details: '',
      earache_drainage_3mo: false,
      aural_fullness: false, aural_fullness_ear: null, aural_fullness_frequency: '',
    },
    tinnitus_detail: { ear: null, frequency: null, bothersome: null, sound_description: '' },
    dizziness_detail: {
      dizzy_today: false, associated_symptoms: [], frequency: '',
      falls_12mo: false, falls_count: null, falls_injured: false, falls_injury_details: '',
    },
    noise_exposure: { exposed: false, description: '' },
    family_history: { hearing_loss_in_family: null, description: '' },
    medical_history: {
      prior_head_neck_surgery: false, prior_head_neck_surgery_details: '',
      head_trauma: false, head_trauma_details: '',
      medications: '', conditions: [],
    },
    hearing_aid_history: {
      ever_used: false, currently_using: false, ear: null,
      years_of_use: '', regular_wear: null, benefit: null, problems: '',
    },
    communication_needs: {
      difficult_situations: [], top_problem_areas: ['', '', ''], phone_ear: null,
    },
  },
  tuning_fork: {
    frequency_hz: 512,
    rinne_right: null, rinne_left: null, rinne_notes: '',
    weber: null, weber_notes: '',
    abc_right: null, abc_left: null, abc_notes: '',
    bing_right: null, bing_left: null, bing_notes: '',
  },
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
  acoustic_reflex: {
    enabled: false,
    right: { ipsi: { freqs: {} }, contra: { freqs: {} } },
    left:  { ipsi: { freqs: {} }, contra: { freqs: {} } },
  },
  reflex_decay: {
    enabled: false,
    right: { ipsi: { freqs: {} }, contra: { freqs: {} } },
    left:  { ipsi: { freqs: {} }, contra: { freqs: {} } },
  },
  et_dysfunction: {
    enabled: false,
    right: { toynbee: {}, valsalva: {}, pressure_app: {} },
    left:  { toynbee: {}, valsalva: {}, pressure_app: {} },
  },
  etf_intact: {
    enabled: false,
    right: { volume: null, pressure_1: null, pressure_2: null, pressure_3: null, notes: '' },
    left:  { volume: null, pressure_1: null, pressure_2: null, pressure_3: null, notes: '' },
  },
};

const DEFAULT_SPEECH = {
  wrs_right: [], wrs_left: [], wrs_soundfield: [], wrs_soundfield_aided: [],
  fields: {},
};

const BLANK_EAR = (ear) => ({
  ear,
  ac_measurements: [], bc_measurements: [],
  mcl_measurements: [], ucl_measurements: [],
  ff_measurements: [], ffa_measurements: [],
});

function App() {
  // ==================== PATIENT + SESSION STATE ====================
  const [patient, setPatient] = useState(null);
  const [sessions, setSessions] = useState([]);
  const [sessionId, setSessionId] = useState(null);
  const [bootstrapped, setBootstrapped] = useState(false);

  // Modals
  const [showPatientModal, setShowPatientModal] = useState(false);
  const [patientModalMode, setPatientModalMode] = useState('create');
  const [showJournal, setShowJournal] = useState(false);

  // ==================== CLINICAL STATE ====================
  const [activeTab, setActiveTab] = useState('pre_test');
  const [activeTest, setActiveTest] = useState('ac_right');
  const [masked, setMasked] = useState(false);
  const [extendedFrequency, setExtendedFrequency] = useState(false);
  const [reportAudiogramMode, setReportAudiogramMode] = useState('separate');

  // Ghost overlay (previous-visit audiogram)
  const [showGhost, setShowGhost] = useState(true);
  const [prevSession, setPrevSession] = useState(null);

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

  // Suspend auto-save while we're rehydrating a loaded session (otherwise defaults overwrite real data)
  const loadingRef = useRef(false);

  // ==================== HELPERS ====================
  const resetClinicalState = useCallback(() => {
    loadingRef.current = true;
    setPreTestData(DEFAULT_PRE_TEST);
    setImpedanceData(DEFAULT_IMPEDANCE);
    setSpeechData(DEFAULT_SPEECH);
    setSpecialTestsData({ fields: {} });
    setOaeData({ fields: {} });
    setSoundfieldData({ fields: {} });
    setAbrData({ fields: {} });
    setPediatricData({ fields: {} });
    setTinnitusData({ fields: {} });
    setRightEarData(BLANK_EAR('right'));
    setLeftEarData(BLANK_EAR('left'));
    setTimeout(() => { loadingRef.current = false; }, 50);
  }, []);

  const rehydrateFromSession = useCallback((s) => {
    loadingRef.current = true;
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
    // Clear loading after React finishes a paint cycle
    setTimeout(() => { loadingRef.current = false; }, 150);
  }, []);

  const loadSessionsForPatient = useCallback(async (pid) => {
    try {
      const r = await axios.get(`${API}/sessions`, { params: { patient_id: pid, limit: 200 } });
      return r.data || [];
    } catch (e) {
      console.error('Failed to load sessions', e);
      return [];
    }
  }, []);

  const pickPatient = useCallback(async (p) => {
    if (!p) return;
    setPatient(p);
    localStorage.setItem(LAST_PATIENT_KEY, p.patient_id);
    const sess = await loadSessionsForPatient(p.patient_id);
    setSessions(sess);
    if (sess.length > 0) {
      const latest = sess[0]; // API sorts by test_date DESC
      setSessionId(latest.session_id);
      localStorage.setItem(LAST_SESSION_KEY, latest.session_id);
      rehydrateFromSession(latest);
      setPrevSession(sess[1] || null);
    } else {
      setPrevSession(null);
      // No sessions yet — auto-create one
      try {
        const r = await axios.post(`${API}/sessions`, {
          patient_id: p.patient_id,
          audiologist_name: AUDIOLOGIST_NAME,
          test_reliability: "good",
          test_methods: ["headphones"],
        });
        const newSess = r.data;
        setSessions([newSess]);
        setSessionId(newSess.session_id);
        localStorage.setItem(LAST_SESSION_KEY, newSess.session_id);
        resetClinicalState();
        // Journal: auto-log session creation (await so first journal-open sees it)
        try {
          await axios.post(`${API}/patient-notes`, {
            patient_id: p.patient_id,
            text: 'New test session started.',
            audiologist: AUDIOLOGIST_NAME,
            auto: true,
          });
        } catch (err) { console.error('Auto-note failed', err); }
      } catch (e) {
        console.error('Failed to create first session', e);
      }
    }
  }, [loadSessionsForPatient, rehydrateFromSession, resetClinicalState]);

  const pickSession = useCallback(async (sid) => {
    if (!sid || sid === sessionId) return;
    try {
      const r = await axios.get(`${API}/sessions/${sid}`);
      setSessionId(sid);
      localStorage.setItem(LAST_SESSION_KEY, sid);
      rehydrateFromSession(r.data);
      // Find previous session — the one immediately after the selected one in DESC list
      const idx = sessions.findIndex((s) => s.session_id === sid);
      setPrevSession(idx >= 0 ? (sessions[idx + 1] || null) : null);
    } catch (e) {
      console.error('Failed to load session', e);
    }
  }, [sessionId, rehydrateFromSession, sessions]);

  const createNewSession = useCallback(async () => {
    if (!patient) return;
    try {
      const r = await axios.post(`${API}/sessions`, {
        patient_id: patient.patient_id,
        audiologist_name: AUDIOLOGIST_NAME,
        test_reliability: "good",
        test_methods: ["headphones"],
      });
      const newSess = r.data;
      // The session that was selected becomes the "previous" for ghost overlay
      setPrevSession((prev) => {
        const currentSession = sessions.find((s) => s.session_id === sessionId);
        return currentSession || prev;
      });
      setSessions((list) => [newSess, ...list]);
      setSessionId(newSess.session_id);
      localStorage.setItem(LAST_SESSION_KEY, newSess.session_id);
      resetClinicalState();
      try {
        await axios.post(`${API}/patient-notes`, {
          patient_id: patient.patient_id,
          text: 'New test session started.',
          audiologist: AUDIOLOGIST_NAME,
          auto: true,
        });
      } catch (err) { console.error('Auto-note failed', err); }
    } catch (e) {
      console.error('Create session failed', e);
    }
  }, [patient, resetClinicalState, sessions, sessionId]);

  // ==================== PATIENT MODAL HANDLERS ====================
  const handleSavePatient = async (payload) => {
    if (patientModalMode === 'edit' && patient) {
      const r = await axios.put(`${API}/patients/${patient.patient_id}`, payload);
      setPatient(r.data);
    } else {
      const r = await axios.post(`${API}/patients`, payload);
      await pickPatient(r.data);
    }
  };

  // ==================== BOOTSTRAP ====================
  useEffect(() => {
    const boot = async () => {
      const lastPid = localStorage.getItem(LAST_PATIENT_KEY);
      if (lastPid) {
        try {
          const r = await axios.get(`${API}/patients/${lastPid}`);
          await pickPatient(r.data);
        } catch {
          localStorage.removeItem(LAST_PATIENT_KEY);
          localStorage.removeItem(LAST_SESSION_KEY);
        }
      }
      setBootstrapped(true);
    };
    boot();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ==================== DEBOUNCED AUTO-SAVE ====================
  const saveTimer = useRef(null);
  useEffect(() => {
    if (!sessionId || loadingRef.current || !bootstrapped) return;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(async () => {
      try {
        await axios.put(`${API}/sessions/${sessionId}`, {
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
      } catch (err) {
        console.error('Auto-save failed', err);
      }
    }, 800);
    return () => saveTimer.current && clearTimeout(saveTimer.current);
  }, [
    sessionId, bootstrapped,
    preTestData, impedanceData, speechData,
    specialTestsData, oaeData, soundfieldData, abrData, pediatricData, tinnitusData,
    rightEarData, leftEarData,
  ]);

  // ==================== PURE TONE HELPERS ====================
  const getActiveMode = () => {
    const testName = activeTest.replace('_nr', '').replace('_left', '').replace('_right', '');
    if (testName.includes('ac')) return 'ac';
    if (testName.includes('bc')) return 'bc';
    if (testName.includes('mcl')) return 'mcl';
    if (testName.includes('ucl')) return 'ucl';
    if (testName.includes('ff') && !testName.includes('ffa')) return 'ff';
    if (testName.includes('ffa')) return 'ffa';
    return 'ac';
  };

  const isNoResponse = () => activeTest.includes('_nr');

  const handlePlotPoint = (ear, frequency, db, forceNoResponse = false) => {
    const currentData = ear === 'right' ? rightEarData : leftEarData;
    const activeMode = getActiveMode();
    const measurementArrayMap = {
      'ac': 'ac_measurements', 'bc': 'bc_measurements',
      'mcl': 'mcl_measurements', 'ucl': 'ucl_measurements',
      'ff': 'ff_measurements', 'ffa': 'ffa_measurements',
    };
    const measurementArray = measurementArrayMap[activeMode] || 'ac_measurements';
    const existingIndex = currentData[measurementArray].findIndex(m => m.frequency === frequency);
    let updated;
    if (existingIndex >= 0) {
      updated = [...currentData[measurementArray]];
      updated[existingIndex] = { frequency, threshold_db: db, masked, no_response: forceNoResponse || isNoResponse() };
    } else {
      updated = [...currentData[measurementArray], { frequency, threshold_db: db, masked, no_response: forceNoResponse || isNoResponse() }];
    }
    const data = { ...currentData, [measurementArray]: updated };
    if (ear === 'right') setRightEarData(data); else setLeftEarData(data);
  };

  const handleClearAudiogram = (ear) => {
    if (ear === 'right') setRightEarData(BLANK_EAR('right'));
    else setLeftEarData(BLANK_EAR('left'));
  };

  const handleDeletePoint = (ear, frequency) => {
    const currentData = ear === 'right' ? rightEarData : leftEarData;
    const activeMode = getActiveMode();
    const measurementArrayMap = {
      'ac': 'ac_measurements', 'bc': 'bc_measurements',
      'mcl': 'mcl_measurements', 'ucl': 'ucl_measurements',
      'ff': 'ff_measurements', 'ffa': 'ffa_measurements',
    };
    const measurementArray = measurementArrayMap[activeMode] || 'ac_measurements';
    const updated = currentData[measurementArray].filter(m => m.frequency !== frequency);
    const data = { ...currentData, [measurementArray]: updated };
    if (ear === 'right') setRightEarData(data); else setLeftEarData(data);
  };

  // ==================== RENDER ====================
  return (
    <div className="h-screen w-screen flex flex-col bg-gray-100 overflow-hidden">
      <div className="flex-1 flex flex-col min-h-0 border-4 border-gray-300 m-1 bg-white rounded-lg shadow-lg">
        {/* Header with Patient Switcher */}
        <div className="bg-gradient-to-r from-gray-200 to-gray-100 px-3 py-1.5 border-b-2 border-gray-300 flex items-center justify-between flex-shrink-0 gap-3">
          <h1 className="text-sm font-bold text-gray-700 whitespace-nowrap">Test Procedures</h1>
          <PatientSwitcher
            patient={patient}
            sessionId={sessionId}
            sessions={sessions}
            onPickPatient={pickPatient}
            onPickSession={pickSession}
            onNewPatient={() => { setPatientModalMode('create'); setShowPatientModal(true); }}
            onEditPatient={() => { setPatientModalMode('edit'); setShowPatientModal(true); }}
            onNewSession={createNewSession}
            onOpenJournal={() => setShowJournal(true)}
          />
        </div>

        <div className="flex-1 flex flex-col min-h-0">
          <SimpleTabs activeTab={activeTab} onTabChange={setActiveTab} />

          {!patient ? (
            <div className="flex-1 flex items-center justify-center bg-gray-50">
              <div className="text-center max-w-md p-6">
                <h2 className="text-lg font-bold text-gray-700 mb-2">No patient selected</h2>
                <p className="text-sm text-gray-500 mb-4">
                  Search for an existing patient or create a new one to begin the clinical workflow.
                </p>
                <button
                  onClick={() => { setPatientModalMode('create'); setShowPatientModal(true); }}
                  data-testid="empty-state-new-patient"
                  className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white font-semibold text-sm rounded shadow"
                >+ New Patient</button>
              </div>
            </div>
          ) : (
            <>
              {activeTab === 'pre_test' && (
                <PreTestPanel data={preTestData} onChange={setPreTestData} />
              )}

              {activeTab === 'pure_tone' && (
                <div className="flex-1 flex flex-col min-h-0">
                  <div className="flex items-center gap-4 px-3 py-1 bg-gray-50 border-b border-gray-300 flex-shrink-0">
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={extendedFrequency}
                        onChange={(e) => setExtendedFrequency(e.target.checked)}
                        className="w-3.5 h-3.5 cursor-pointer"
                      />
                      <span className="text-xs font-medium text-gray-700">
                        Extended Audiogram (High Frequencies: 10K, 12.5K, 16K)
                      </span>
                    </label>
                    {prevSession && (
                      <label className="flex items-center gap-2 cursor-pointer" data-testid="ghost-toggle-label">
                        <input
                          type="checkbox"
                          checked={showGhost}
                          onChange={(e) => setShowGhost(e.target.checked)}
                          data-testid="ghost-toggle"
                          className="w-3.5 h-3.5 cursor-pointer"
                        />
                        <span className="text-xs font-medium text-gray-700">
                          Show Previous Visit
                        </span>
                        <span className="text-[10px] text-gray-500 italic">
                          ({new Date(prevSession.test_date).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: '2-digit' })})
                        </span>
                      </label>
                    )}
                  </div>

                  <div className="flex-1 flex min-h-0 relative">
                    <div className="flex-1 flex flex-col p-1 bg-white min-w-0">
                      <h2 className="text-xs font-bold text-gray-700 mb-0.5 text-center flex-shrink-0">Right</h2>
                      <div className="flex-1 min-h-0">
                        <AudiogramCanvas
                          ear="right"
                          data={rightEarData}
                          onPlotPoint={(freq, db, forceNR) => handlePlotPoint('right', freq, db, forceNR)}
                          activeMode={getActiveMode()}
                          masked={masked}
                          extendedFrequency={extendedFrequency}
                          onClearAudiogram={handleClearAudiogram}
                          onDeletePoint={handleDeletePoint}
                          ghostData={showGhost ? prevSession?.right_ear_audiogram : null}
                          ghostLabel={showGhost && prevSession ? new Date(prevSession.test_date).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: '2-digit' }) : null}
                        />
                      </div>
                    </div>
                    <div className="flex-shrink-0">
                      <NoahControlPanel
                        activeTest={activeTest}
                        onTestChange={setActiveTest}
                        masked={masked}
                        onMaskedToggle={() => setMasked(!masked)}
                        rightEarData={rightEarData}
                        leftEarData={leftEarData}
                        reportAudiogramMode={reportAudiogramMode}
                        onReportAudiogramModeChange={setReportAudiogramMode}
                      />
                    </div>
                    <div className="flex-1 flex flex-col p-1 bg-white min-w-0">
                      <h2 className="text-xs font-bold text-gray-700 mb-0.5 text-center flex-shrink-0">Left</h2>
                      <div className="flex-1 min-h-0">
                        <AudiogramCanvas
                          ear="left"
                          data={leftEarData}
                          onPlotPoint={(freq, db, forceNR) => handlePlotPoint('left', freq, db, forceNR)}
                          activeMode={getActiveMode()}
                          masked={masked}
                          extendedFrequency={extendedFrequency}
                          onClearAudiogram={handleClearAudiogram}
                          onDeletePoint={handleDeletePoint}
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
                  patient={patient}
                  rightEarData={rightEarData}
                  leftEarData={leftEarData}
                  preTestData={preTestData}
                  sessionId={sessionId}
                  audiologistName={AUDIOLOGIST_NAME}
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
                    if (!sessionId) return;
                    try {
                      await axios.put(`${API}/sessions/${sessionId}`, partial);
                    } catch (err) {
                      console.error('Report save failed', err);
                    }
                  }}
                />
              )}
            </>
          )}
        </div>
      </div>

      {showPatientModal && (
        <PatientModal
          mode={patientModalMode}
          initial={patientModalMode === 'edit' ? patient : null}
          onClose={() => setShowPatientModal(false)}
          onSave={handleSavePatient}
        />
      )}

      {showJournal && patient && (
        <PatientJournal
          patient={patient}
          audiologist={AUDIOLOGIST_NAME}
          open={showJournal}
          onClose={() => setShowJournal(false)}
        />
      )}
    </div>
  );
}

export default App;
