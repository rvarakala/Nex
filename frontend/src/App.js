import React, { useState, useEffect, useRef } from "react";
import "@/App.css";
import axios from "axios";
import SimpleTabs from "./components/SimpleTabs";
import AudiogramCanvas from "./components/AudiogramCanvas";
import NoahControlPanel from "./components/NoahControlPanel";
import PTACalculator from "./components/PTACalculator";
import TabPlaceholder from "./components/TabPlaceholder";
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

const BACKEND_URL = process.env.REACT_APP_BACKEND_URL;
const API = `${BACKEND_URL}/api`;

function App() {
  // Demo patient data
  const patient = {
    patient_id: "ACS-2025-001234",
    name: "Ramesh Kumar",
    age: 45,
    gender: "Male",
  };

  // Tab navigation
  const [activeTab, setActiveTab] = useState('pre_test');
  
  // Pure Tone state
  const [activeTest, setActiveTest] = useState('ac_right');
  const [masked, setMasked] = useState(false);
  const [extendedFrequency, setExtendedFrequency] = useState(false);
  const [reportAudiogramMode, setReportAudiogramMode] = useState('separate'); // 'combined' | 'separate'
  
  // Pre-Test (Case History + Tuning Fork + Otoscopy)
  const defaultPreTest = {
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
  const [preTestData, setPreTestData] = useState(defaultPreTest);

  // Impedance / Tympanometry
  const defaultImpedance = {
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
  const [impedanceData, setImpedanceData] = useState(defaultImpedance);

  // Speech Audiometry
  const defaultSpeech = {
    wrs_right: [],
    wrs_left: [],
    wrs_soundfield: [],
    wrs_soundfield_aided: [],
    fields: {},
  };
  const [speechData, setSpeechData] = useState(defaultSpeech);

  // P2 clinical tabs — schema-free
  const [specialTestsData, setSpecialTestsData] = useState({ fields: {} });
  const [oaeData, setOaeData]                   = useState({ fields: {} });
  const [soundfieldData, setSoundfieldData]     = useState({ fields: {} });
  const [abrData, setAbrData]                   = useState({ fields: {} });
  const [pediatricData, setPediatricData]       = useState({ fields: {} });
  const [tinnitusData, setTinnitusData]         = useState({ fields: {} });
  
  // Audiogram data
  const [rightEarData, setRightEarData] = useState({
    ear: 'right',
    ac_measurements: [],
    bc_measurements: [],
    mcl_measurements: [],
    ucl_measurements: [],
    ff_measurements: [],
    ffa_measurements: [],
  });

  const [leftEarData, setLeftEarData] = useState({
    ear: 'left',
    ac_measurements: [],
    bc_measurements: [],
    mcl_measurements: [],
    ucl_measurements: [],
    ff_measurements: [],
    ffa_measurements: [],
  });

  // Session state (for backend persistence)
  const [sessionId, setSessionId] = useState(null);

  // Initialize session on mount
  useEffect(() => {
    const initSession = async () => {
      try {
        const response = await axios.post(`${API}/sessions`, {
          patient_id: patient.patient_id,
          audiologist_name: "Dr. Audiologist",
          test_reliability: "good",
          test_methods: ["headphones"]
        });
        setSessionId(response.data.session_id);
        console.log("Session created:", response.data.session_id);
      } catch (error) {
        console.error("Failed to create session:", error);
      }
    };

    initSession();
  }, []);

  // Debounced auto-save of pre-test data to backend
  const preTestSaveTimer = useRef(null);
  useEffect(() => {
    if (!sessionId) return;
    if (preTestSaveTimer.current) clearTimeout(preTestSaveTimer.current);
    preTestSaveTimer.current = setTimeout(async () => {
      try {
        await axios.put(`${API}/sessions/${sessionId}`, {
          pre_test_data: preTestData,
        });
        console.log('Pre-test data saved');
      } catch (err) {
        console.error('Pre-test save failed', err);
      }
    }, 800);
    return () => {
      if (preTestSaveTimer.current) clearTimeout(preTestSaveTimer.current);
    };
  }, [preTestData, sessionId]);

  // Debounced auto-save of P2 clinical tab data (schema-free dicts)
  const p2SaveTimer = useRef(null);
  useEffect(() => {
    if (!sessionId) return;
    if (p2SaveTimer.current) clearTimeout(p2SaveTimer.current);
    p2SaveTimer.current = setTimeout(async () => {
      try {
        await axios.put(`${API}/sessions/${sessionId}`, {
          special_tests_data: specialTestsData,
          oae_data: oaeData,
          soundfield_data: soundfieldData,
          abr_data: abrData,
          pediatric_data: pediatricData,
          tinnitus_data: tinnitusData,
        });
      } catch (err) {
        console.error('P2 save failed', err);
      }
    }, 800);
    return () => {
      if (p2SaveTimer.current) clearTimeout(p2SaveTimer.current);
    };
  }, [specialTestsData, oaeData, soundfieldData, abrData, pediatricData, tinnitusData, sessionId]);

  // Debounced auto-save of speech audiometry data to backend
  const speechSaveTimer = useRef(null);
  useEffect(() => {
    if (!sessionId) return;
    if (speechSaveTimer.current) clearTimeout(speechSaveTimer.current);
    speechSaveTimer.current = setTimeout(async () => {
      try {
        await axios.put(`${API}/sessions/${sessionId}`, {
          speech_data: speechData,
        });
      } catch (err) {
        console.error('Speech save failed', err);
      }
    }, 800);
    return () => {
      if (speechSaveTimer.current) clearTimeout(speechSaveTimer.current);
    };
  }, [speechData, sessionId]);

  // Determine active mode and ear from activeTest
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

  const getActiveEar = () => {
    if (activeTest.includes('left')) return 'left';
    if (activeTest.includes('right')) return 'right';
    return 'right';
  };
  
  const isNoResponse = () => {
    return activeTest.includes('_nr');
  };

  // Plot point on audiogram
  const handlePlotPoint = (ear, frequency, db, forceNoResponse = false) => {
    const currentData = ear === 'right' ? rightEarData : leftEarData;
    const activeMode = getActiveMode();
    
    // Map mode to measurement array name
    const measurementArrayMap = {
      'ac': 'ac_measurements',
      'bc': 'bc_measurements',
      'mcl': 'mcl_measurements',
      'ucl': 'ucl_measurements',
      'ff': 'ff_measurements',
      'ffa': 'ffa_measurements'
    };
    
    const measurementArray = measurementArrayMap[activeMode] || 'ac_measurements';
    
    // Find if measurement exists
    const existingIndex = currentData[measurementArray].findIndex(m => m.frequency === frequency);
    
    let updatedMeasurements;
    if (existingIndex >= 0) {
      // Update existing
      updatedMeasurements = [...currentData[measurementArray]];
      updatedMeasurements[existingIndex] = {
        frequency,
        threshold_db: db,
        masked,
        no_response: forceNoResponse || isNoResponse()
      };
    } else {
      // Add new
      updatedMeasurements = [
        ...currentData[measurementArray],
        { frequency, threshold_db: db, masked, no_response: forceNoResponse || isNoResponse() }
      ];
    }

    const updatedData = {
      ...currentData,
      [measurementArray]: updatedMeasurements
    };

    // Update state
    if (ear === 'right') {
      setRightEarData(updatedData);
    } else {
      setLeftEarData(updatedData);
    }

    console.log(`Plotted ${ear} ${activeMode.toUpperCase()} @ ${frequency}Hz: ${db}dB${masked ? ' (masked)' : ''}${forceNoResponse || isNoResponse() ? ' (NR)' : ''}`);
  };
  
  // Clear entire audiogram for one ear
  const handleClearAudiogram = (ear) => {
    if (ear === 'right') {
      setRightEarData({
        ear: 'right',
        ac_measurements: [],
        bc_measurements: [],
        mcl_measurements: [],
        ucl_measurements: [],
        ff_measurements: [],
        ffa_measurements: [],
      });
    } else {
      setLeftEarData({
        ear: 'left',
        ac_measurements: [],
        bc_measurements: [],
        mcl_measurements: [],
        ucl_measurements: [],
        ff_measurements: [],
        ffa_measurements: [],
      });
    }
    console.log(`Cleared ${ear} audiogram`);
  };
  
  // Delete point at specific frequency
  const handleDeletePoint = (ear, frequency) => {
    const currentData = ear === 'right' ? rightEarData : leftEarData;
    const activeMode = getActiveMode();
    
    const measurementArrayMap = {
      'ac': 'ac_measurements',
      'bc': 'bc_measurements',
      'mcl': 'mcl_measurements',
      'ucl': 'ucl_measurements',
      'ff': 'ff_measurements',
      'ffa': 'ffa_measurements'
    };
    
    const measurementArray = measurementArrayMap[activeMode] || 'ac_measurements';
    
    const updatedMeasurements = currentData[measurementArray].filter(m => m.frequency !== frequency);
    
    const updatedData = {
      ...currentData,
      [measurementArray]: updatedMeasurements
    };
    
    if (ear === 'right') {
      setRightEarData(updatedData);
    } else {
      setLeftEarData(updatedData);
    }
    
    console.log(`Deleted ${ear} ${activeMode.toUpperCase()} point @ ${frequency}Hz`);
  };

  // Auto-save to backend
  const handleSave = async () => {
    if (!sessionId) {
      console.error("No session ID");
      return;
    }

    try {
      const updateData = {
        test_reliability: "good",
        right_ear_audiogram: rightEarData,
        left_ear_audiogram: leftEarData,
        status: 'draft'
      };

      await axios.put(`${API}/sessions/${sessionId}`, updateData);
      console.log("Session saved successfully");
    } catch (error) {
      console.error("Failed to save session:", error);
    }
  };

  return (
    <div className="h-screen w-screen flex flex-col bg-gray-100 overflow-hidden">
      {/* Test Procedures - Outer Window */}
      <div className="flex-1 flex flex-col min-h-0 border-4 border-gray-300 m-1 bg-white rounded-lg shadow-lg">
        {/* Test Procedures Header */}
        <div className="bg-gradient-to-r from-gray-200 to-gray-100 px-4 py-1.5 border-b-2 border-gray-300 flex items-center justify-between flex-shrink-0">
          <h1 className="text-sm font-bold text-gray-700">Test Procedures</h1>
          <div className="text-xs text-gray-600">
            Patient: {patient.name} | MRD: {patient.patient_id} | Age: {patient.age}Y
          </div>
        </div>

        {/* Inner Window - Tabs */}
        <div className="flex-1 flex flex-col min-h-0">
          {/* Tab Navigation */}
          <SimpleTabs activeTab={activeTab} onTabChange={setActiveTab} />

          {/* Pre-Test (Case History + Tuning Fork + Otoscopy) */}
          {activeTab === 'pre_test' && (
            <PreTestPanel data={preTestData} onChange={setPreTestData} />
          )}

          {/* Pure Tone Audiometry */}
          {activeTab === 'pure_tone' && (
            <div className="flex-1 flex flex-col min-h-0">
              {/* Extended Frequency Checkbox */}
              <div className="flex items-center gap-2 px-3 py-1 bg-gray-50 border-b border-gray-300 flex-shrink-0">
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
              </div>

              {/* Main Audiogram Area */}
              <div className="flex-1 flex min-h-0 relative">
                {/* Right Ear Audiogram */}
                <div className="flex-1 flex flex-col p-1 bg-white min-w-0">
                  <h2 className="text-xs font-bold text-gray-700 mb-0.5 text-center flex-shrink-0">
                    Right
                  </h2>
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
                    />
                  </div>
                </div>

                {/* Center Control Panel (NOAH-style) */}
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

                {/* Left Ear Audiogram */}
                <div className="flex-1 flex flex-col p-1 bg-white min-w-0">
                  <h2 className="text-xs font-bold text-gray-700 mb-0.5 text-center flex-shrink-0">
                    Left
                  </h2>
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
                    />
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Speech Audiometry (Full functional panel) */}
          {activeTab === 'speech' && (
            <SpeechPanel data={speechData} onChange={setSpeechData} />
          )}

          {/* Impedance / Tympanometry (Full functional panel) */}
          {activeTab === 'impedance' && (
            <ImpedancePanel data={impedanceData} onChange={setImpedanceData} />
          )}

          {/* Special Tests */}
          {activeTab === 'special' && (
            <SpecialTestsPanel data={specialTestsData} onChange={setSpecialTestsData} />
          )}

          {/* OAE */}
          {activeTab === 'oae' && (
            <OAEPanel data={oaeData} onChange={setOaeData} />
          )}

          {/* Sound Field / Aided */}
          {activeTab === 'soundfield' && (
            <SoundFieldPanel data={soundfieldData} onChange={setSoundfieldData} />
          )}

          {/* ABR / ASSR */}
          {activeTab === 'abr' && (
            <ABRPanel data={abrData} onChange={setAbrData} />
          )}

          {/* Pediatric */}
          {activeTab === 'pediatric' && (
            <PediatricPanel data={pediatricData} onChange={setPediatricData} />
          )}

          {/* Tinnitus */}
          {activeTab === 'tinnitus' && (
            <TinnitusPanel data={tinnitusData} onChange={setTinnitusData} />
          )}

          {/* Reports (live print preview with configurable sections) */}
          {activeTab === 'reports' && (
            <ReportsPanel
              patient={patient}
              rightEarData={rightEarData}
              leftEarData={leftEarData}
              preTestData={preTestData}
              sessionId={sessionId}
              audiologistName="Dr. Audiologist"
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
        </div>
      </div>
    </div>
  );
}

export default App;
