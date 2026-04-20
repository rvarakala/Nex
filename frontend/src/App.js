import React, { useState, useEffect } from "react";
import "@/App.css";
import axios from "axios";
import SimpleTabs from "./components/SimpleTabs";
import AudiogramCanvas from "./components/AudiogramCanvas";
import NoahControlPanel from "./components/NoahControlPanel";
import PTACalculator from "./components/PTACalculator";

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
  const [activeTab, setActiveTab] = useState('pure_tone');
  
  // Pure Tone state
  const [activeTest, setActiveTest] = useState('ac_right');
  const [masked, setMasked] = useState(false);
  const [extendedFrequency, setExtendedFrequency] = useState(false);
  
  // Audiogram data
  const [rightEarData, setRightEarData] = useState({
    ear: 'right',
    ac_measurements: [],
    bc_measurements: [],
  });

  const [leftEarData, setLeftEarData] = useState({
    ear: 'left',
    ac_measurements: [],
    bc_measurements: [],
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

  // Determine active mode and ear from activeTest
  const getActiveMode = () => {
    if (activeTest.includes('ac')) return 'ac';
    if (activeTest.includes('bc')) return 'bc';
    return 'ac';
  };

  const getActiveEar = () => {
    if (activeTest.includes('right')) return 'right';
    if (activeTest.includes('left')) return 'left';
    return 'right';
  };

  // Plot point on audiogram
  const handlePlotPoint = (ear, frequency, db) => {
    const currentData = ear === 'right' ? rightEarData : leftEarData;
    const activeMode = getActiveMode();
    const measurementArray = activeMode === 'ac' ? 'ac_measurements' : 'bc_measurements';
    
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
        no_response: false
      };
    } else {
      // Add new
      updatedMeasurements = [
        ...currentData[measurementArray],
        { frequency, threshold_db: db, masked, no_response: false }
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

    console.log(`Plotted ${ear} ${activeMode.toUpperCase()} @ ${frequency}Hz: ${db}dB${masked ? ' (masked)' : ''}`);
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
      <div className="flex-1 flex flex-col min-h-0 border-4 border-gray-300 m-2 bg-white rounded-lg shadow-lg">
        {/* Test Procedures Header */}
        <div className="bg-gradient-to-r from-gray-200 to-gray-100 px-4 py-2 border-b-2 border-gray-300 flex items-center justify-between">
          <h1 className="text-sm font-bold text-gray-700">Test Procedures</h1>
          <div className="text-xs text-gray-600">
            Patient: {patient.name} | MRD: {patient.patient_id} | Age: {patient.age}Y
          </div>
        </div>

        {/* Inner Window - Tabs */}
        <div className="flex-1 flex flex-col min-h-0">
          {/* Tab Navigation */}
          <SimpleTabs activeTab={activeTab} onTabChange={setActiveTab} />

          {/* Pure Tone Audiometry */}
          {activeTab === 'pure_tone' && (
            <div className="flex-1 flex flex-col min-h-0">
              {/* Extended Frequency Checkbox */}
              <div className="flex items-center gap-2 px-3 py-1.5 bg-gray-50 border-b border-gray-300">
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
                <div className="flex-1 flex flex-col px-1 py-1 bg-white min-w-0">
                  <h2 className="text-xs font-bold text-gray-700 mb-0.5 text-center flex-shrink-0">
                    Right
                  </h2>
                  <div className="flex-1 min-h-0">
                    <AudiogramCanvas
                      ear="right"
                      data={rightEarData}
                      onPlotPoint={(freq, db) => handlePlotPoint('right', freq, db)}
                      activeMode={getActiveMode()}
                      masked={masked}
                      extendedFrequency={extendedFrequency}
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
                  />
                </div>

                {/* Left Ear Audiogram */}
                <div className="flex-1 flex flex-col px-1 py-1 bg-white min-w-0">
                  <h2 className="text-xs font-bold text-gray-700 mb-0.5 text-center flex-shrink-0">
                    Left
                  </h2>
                  <div className="flex-1 min-h-0">
                    <AudiogramCanvas
                      ear="left"
                      data={leftEarData}
                      onPlotPoint={(freq, db) => handlePlotPoint('left', freq, db)}
                      activeMode={getActiveMode()}
                      masked={masked}
                      extendedFrequency={extendedFrequency}
                    />
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Speech Tab (Placeholder) */}
          {activeTab === 'speech' && (
            <div className="flex-1 flex items-center justify-center bg-gray-50">
              <div className="text-center">
                <h2 className="text-2xl font-bold text-gray-700 mb-2">Speech Audiometry</h2>
                <p className="text-gray-500">Coming next...</p>
              </div>
            </div>
          )}

          {/* Impedance Tab (Placeholder) */}
          {activeTab === 'impedance' && (
            <div className="flex-1 flex items-center justify-center bg-gray-50">
              <div className="text-center">
                <h2 className="text-2xl font-bold text-gray-700 mb-2">Impedance / Tympanometry</h2>
                <p className="text-gray-500">Coming next...</p>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default App;
