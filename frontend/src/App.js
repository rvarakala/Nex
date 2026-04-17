import React, { useState, useEffect } from "react";
import "@/App.css";
import axios from "axios";
import {
  TopMenu,
  PatientContext,
  WorkflowTabs,
  TestMenu,
  Toolbar,
  AudiogramPanel,
  InfoPanel,
  BottomActions,
  StatusBar,
  SpeechAudiometry,
  ResultsPanel,
  ReportPreviewModal
} from "./components";

const BACKEND_URL = process.env.REACT_APP_BACKEND_URL;
const API = `${BACKEND_URL}/api`;

function App() {
  // Demo patient data
  const [patient] = useState({
    patient_id: "ACS-2025-001234",
    name: "Ramesh Kumar",
    age: 45,
    gender: "Male",
    referring_physician: "Dr. Sharma (ENT)"
  });

  // Session state
  const [session, setSession] = useState(null);
  const [sessionId, setSessionId] = useState(null);

  // Tab navigation
  const [activeTab, setActiveTab] = useState('pta');
  const [completedTabs, setCompletedTabs] = useState([]);

  // PTA state
  const [activeTest, setActiveTest] = useState('ac_right');
  const [activeMode, setActiveMode] = useState('ac');
  const [masked, setMasked] = useState(false);
  const [viewMode, setViewMode] = useState('standard');
  const [reliability, setReliability] = useState('good');

  // Audiogram data
  const [rightEarData, setRightEarData] = useState({
    ear: 'right',
    ac_measurements: [],
    bc_measurements: [],
    pta_3freq: null
  });

  const [leftEarData, setLeftEarData] = useState({
    ear: 'left',
    ac_measurements: [],
    bc_measurements: [],
    pta_3freq: null
  });

  // Speech data
  const [rightEarSpeech, setRightEarSpeech] = useState({
    ear: 'right',
    srt: null,
    srt_masked: false,
    wds_percent: null,
    wds_presentation_level: null,
    wds_masked: false,
    sat: null,
    mcl: null,
    ucl: null
  });

  const [leftEarSpeech, setLeftEarSpeech] = useState({
    ear: 'left',
    srt: null,
    srt_masked: false,
    wds_percent: null,
    wds_presentation_level: null,
    wds_masked: false,
    sat: null,
    mcl: null,
    ucl: null
  });

  // Results state
  const [rightEarResults, setRightEarResults] = useState({});
  const [leftEarResults, setLeftEarResults] = useState({});
  const [clinicalImpression, setClinicalImpression] = useState('');
  const [recommendations, setRecommendations] = useState([]);

  // UI state
  const [notes, setNotes] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [showReportModal, setShowReportModal] = useState(false);
  
  // Collapse state for UI sections
  const [isPatientInfoCollapsed, setIsPatientInfoCollapsed] = useState(false);
  const [isSummaryCollapsed, setIsSummaryCollapsed] = useState(false);

  // Initialize session on mount
  useEffect(() => {
    const initSession = async () => {
      try {
        const response = await axios.post(`${API}/sessions`, {
          patient_id: patient.patient_id,
          audiologist_name: "Dr. Audiologist",
          test_reliability: reliability,
          test_methods: ["headphones"]
        });
        setSession(response.data);
        setSessionId(response.data.session_id);
        console.log("Session created:", response.data.session_id);
      } catch (error) {
        console.error("Failed to create session:", error);
      }
    };

    initSession();
  }, []);

  // Plot point on audiogram
  const handlePlotPoint = (ear, frequency, db) => {
    const currentData = ear === 'right' ? rightEarData : leftEarData;
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

  // Save session to database
  const handleSave = async () => {
    if (!sessionId) {
      console.error("No session ID");
      return;
    }

    setIsSaving(true);
    
    try {
      const updateData = {
        test_reliability: reliability,
        history_notes: notes,
        right_ear_audiogram: rightEarData,
        left_ear_audiogram: leftEarData,
        right_ear_speech: rightEarSpeech,
        left_ear_speech: leftEarSpeech,
        right_ear_degree: rightEarResults.degree,
        right_ear_type: rightEarResults.type,
        right_ear_config: rightEarResults.config,
        left_ear_degree: leftEarResults.degree,
        left_ear_type: leftEarResults.type,
        left_ear_config: leftEarResults.config,
        clinical_impression: clinicalImpression,
        recommendations: recommendations,
        status: 'draft'
      };

      await axios.put(`${API}/sessions/${sessionId}`, updateData);
      console.log("Session saved successfully");
      alert("✅ Session saved successfully!");
    } catch (error) {
      console.error("Failed to save session:", error);
      alert("❌ Failed to save session");
    } finally {
      setIsSaving(false);
    }
  };

  const handlePreview = () => {
    console.log("Preview report");
    setShowReportModal(true);
  };

  const handleFinalize = async () => {
    if (!sessionId) return;

    const confirm = window.confirm("Finalize this session? This will mark it as complete.");
    if (!confirm) return;

    try {
      await axios.put(`${API}/sessions/${sessionId}`, {
        status: 'finalized'
      });
      alert("✅ Session finalized!");
    } catch (error) {
      console.error("Failed to finalize:", error);
    }
  };

  // Update speech data
  const handleUpdateSpeech = (ear, data) => {
    if (ear === 'right') {
      setRightEarSpeech(data);
    } else {
      setLeftEarSpeech(data);
    }
  };

  // Update results
  const handleUpdateResults = (ear, data) => {
    if (ear === 'right') {
      setRightEarResults(data);
    } else {
      setLeftEarResults(data);
    }
  };

  // Mark tabs as completed
  useEffect(() => {
    const completed = [];
    
    // Check PTA completion
    if (rightEarData.ac_measurements.length > 0 || leftEarData.ac_measurements.length > 0) {
      completed.push('pta');
    }
    
    // Check Speech completion
    if (rightEarSpeech.srt !== null || leftEarSpeech.srt !== null) {
      completed.push('speech');
    }
    
    setCompletedTabs(completed);
  }, [rightEarData, leftEarData, rightEarSpeech, leftEarSpeech]);

  // Auto-collapse sections when PTA or Speech tabs are active
  useEffect(() => {
    if (activeTab === 'pta' || activeTab === 'speech') {
      setIsPatientInfoCollapsed(true);
      setIsSummaryCollapsed(true);
    } else if (activeTab === 'results') {
      setIsPatientInfoCollapsed(false);
      setIsSummaryCollapsed(false);
    }
  }, [activeTab]);

  return (
    <div className="h-screen flex flex-col bg-gray-200">
      <TopMenu />
      
      {/* Collapsible Patient Context */}
      <div 
        className="transition-all duration-300 ease-in-out overflow-hidden"
        style={{ 
          maxHeight: isPatientInfoCollapsed ? '0px' : '80px',
          opacity: isPatientInfoCollapsed ? 0 : 1
        }}
      >
        <PatientContext patient={patient} session={session} />
      </div>
      
      <WorkflowTabs
        activeTab={activeTab}
        onTabChange={setActiveTab}
        completedTabs={completedTabs}
      />

      <div className="flex-1 flex overflow-hidden">
        {/* Left Test Menu */}
        {activeTab === 'pta' && (
          <TestMenu
            activeTest={activeTest}
            onTestChange={setActiveTest}
            completedTests={[]}
          />
        )}

        {/* Main Content Area */}
        <div className="flex-1 flex flex-col overflow-hidden">
          {/* Toolbar */}
          {activeTab === 'pta' && (
            <Toolbar
              viewMode={viewMode}
              onViewModeChange={setViewMode}
              reliability={reliability}
              onReliabilityChange={setReliability}
            />
          )}

          {/* Canvas Area */}
          <div className="flex-1 overflow-y-auto bg-gray-100 p-5">
            {activeTab === 'pta' && (
              <div className="grid grid-cols-2 gap-5">
                <AudiogramPanel
                  ear="right"
                  data={rightEarData}
                  onPlotPoint={(freq, db) => handlePlotPoint('right', freq, db)}
                  activeMode={activeMode}
                  masked={masked}
                  onModeChange={setActiveMode}
                  onMaskedToggle={() => setMasked(!masked)}
                />
                <AudiogramPanel
                  ear="left"
                  data={leftEarData}
                  onPlotPoint={(freq, db) => handlePlotPoint('left', freq, db)}
                  activeMode={activeMode}
                  masked={masked}
                  onModeChange={setActiveMode}
                  onMaskedToggle={() => setMasked(!masked)}
                />
              </div>
            )}

            {activeTab === 'speech' && (
              <SpeechAudiometry
                rightEarSpeech={rightEarSpeech}
                leftEarSpeech={leftEarSpeech}
                onUpdateSpeech={handleUpdateSpeech}
              />
            )}

            {activeTab === 'results' && (
              <ResultsPanel
                rightEarResults={rightEarResults}
                leftEarResults={leftEarResults}
                onUpdateResults={handleUpdateResults}
                clinicalImpression={clinicalImpression}
                onClinicalImpressionChange={setClinicalImpression}
                recommendations={recommendations}
                onRecommendationsChange={setRecommendations}
              />
            )}
          </div>

          {/* Bottom Actions */}
          <BottomActions
            onSave={handleSave}
            onPreview={handlePreview}
            onFinalize={handleFinalize}
            isSaving={isSaving}
          />
        </div>

        {/* Right Info Panel - Collapsible */}
        {(activeTab === 'pta' || activeTab === 'speech') && (
          <>
            <div 
              className="transition-all duration-300 ease-in-out overflow-hidden flex-shrink-0"
              style={{ 
                width: isSummaryCollapsed ? '0px' : '320px',
                opacity: isSummaryCollapsed ? 0 : 1,
                minWidth: isSummaryCollapsed ? '0px' : '320px'
              }}
            >
              <InfoPanel
                rightEarData={rightEarData}
                leftEarData={leftEarData}
                notes={notes}
                onNotesChange={setNotes}
              />
            </div>
            
            {/* Toggle Summary Button - shown when collapsed */}
            {isSummaryCollapsed && (
              <button
                onClick={() => setIsSummaryCollapsed(false)}
                className="fixed top-1/2 right-2 transform -translate-y-1/2 bg-blue-500 text-white p-3 rounded-l-lg shadow-lg hover:bg-blue-600 transition-all z-50 hover:pr-4"
                title="Show Summary"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                </svg>
              </button>
            )}
            
            {/* Close Summary Button - shown when expanded */}
            {!isSummaryCollapsed && (
              <button
                onClick={() => setIsSummaryCollapsed(true)}
                className="fixed top-1/2 right-[320px] transform -translate-y-1/2 bg-gray-500 text-white p-2 rounded-l-lg shadow-md hover:bg-gray-600 transition-all z-50"
                title="Hide Summary"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                </svg>
              </button>
            )}
          </>
        )}
      </div>

      <StatusBar />
      
      {/* Report Preview Modal */}
      {showReportModal && (
        <ReportPreviewModal
          sessionId={sessionId}
          patient={patient}
          session={session}
          onClose={() => setShowReportModal(false)}
        />
      )}
    </div>
  );
}

export default App;
