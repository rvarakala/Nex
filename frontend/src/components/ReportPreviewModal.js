import React, { useState } from 'react';
import axios from 'axios';

const BACKEND_URL = process.env.REACT_APP_BACKEND_URL;
const API = `${BACKEND_URL}/api`;

const ReportPreviewModal = ({ sessionId, patient, session, onClose }) => {
  const [isGenerating, setIsGenerating] = useState(false);

  const handleDownloadPDF = async () => {
    if (!sessionId) {
      alert('No session ID available');
      return;
    }

    setIsGenerating(true);
    try {
      const response = await axios.get(`${API}/reports/${sessionId}/pdf`, {
        responseType: 'blob',
      });

      // Create blob link to download
      const url = window.URL.createObjectURL(new Blob([response.data]));
      const link = document.createElement('a');
      link.href = url;
      link.setAttribute('download', `audiogram_report_${sessionId}.pdf`);
      document.body.appendChild(link);
      link.click();
      link.parentNode.removeChild(link);
      window.URL.revokeObjectURL(url);

      alert('✅ Report downloaded successfully!');
    } catch (error) {
      console.error('Failed to download PDF:', error);
      alert('❌ Failed to generate PDF report');
    } finally {
      setIsGenerating(false);
    }
  };

  const handleEmailReport = () => {
    alert('📧 Email functionality will be implemented in Phase 2');
  };

  const handlePrintReport = async () => {
    if (!sessionId) return;

    try {
      const response = await axios.get(`${API}/reports/${sessionId}/pdf`, {
        responseType: 'blob',
      });

      const url = window.URL.createObjectURL(new Blob([response.data]));
      const printWindow = window.open(url);
      if (printWindow) {
        printWindow.onload = () => {
          printWindow.print();
        };
      }
    } catch (error) {
      console.error('Failed to print PDF:', error);
      alert('❌ Failed to open print dialog');
    }
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg shadow-2xl w-11/12 max-w-4xl max-h-[90vh] overflow-hidden flex flex-col">
        {/* Header */}
        <div className="bg-blue-600 text-white px-6 py-4 flex justify-between items-center">
          <h2 className="text-xl font-bold">📄 Report Preview</h2>
          <button
            onClick={onClose}
            className="text-white hover:text-gray-200 text-2xl font-bold"
          >
            ×
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6">
          {/* Report Summary */}
          <div className="bg-blue-50 border border-blue-200 rounded p-4 mb-6">
            <h3 className="font-semibold text-blue-900 mb-2">Report Summary</h3>
            <div className="text-sm text-blue-800 space-y-1">
              <p><strong>Patient:</strong> {patient?.name || 'N/A'}</p>
              <p><strong>MRD:</strong> {patient?.patient_id || 'N/A'}</p>
              <p><strong>Test Date:</strong> {session?.test_date ? new Date(session.test_date).toLocaleString() : 'N/A'}</p>
              <p><strong>Session ID:</strong> {sessionId}</p>
            </div>
          </div>

          {/* Report Sections Preview */}
          <div className="space-y-4">
            <div className="border border-gray-300 rounded p-4">
              <h4 className="font-semibold text-gray-900 mb-2">📊 Pure Tone Audiometry</h4>
              <div className="text-sm text-gray-700">
                <p>✓ Right ear: {session?.right_ear_audiogram?.ac_measurements?.length || 0} AC measurements, {session?.right_ear_audiogram?.bc_measurements?.length || 0} BC measurements</p>
                <p>✓ Left ear: {session?.left_ear_audiogram?.ac_measurements?.length || 0} AC measurements, {session?.left_ear_audiogram?.bc_measurements?.length || 0} BC measurements</p>
                {session?.right_ear_audiogram?.pta_3freq && (
                  <p>✓ Right PTA: {session.right_ear_audiogram.pta_3freq} dB</p>
                )}
                {session?.left_ear_audiogram?.pta_3freq && (
                  <p>✓ Left PTA: {session.left_ear_audiogram.pta_3freq} dB</p>
                )}
              </div>
            </div>

            <div className="border border-gray-300 rounded p-4">
              <h4 className="font-semibold text-gray-900 mb-2">🗣️ Speech Audiometry</h4>
              <div className="text-sm text-gray-700">
                {session?.right_ear_speech?.srt ? (
                  <p>✓ Right SRT: {session.right_ear_speech.srt} dB</p>
                ) : (
                  <p>○ Right ear speech tests: Not completed</p>
                )}
                {session?.left_ear_speech?.srt ? (
                  <p>✓ Left SRT: {session.left_ear_speech.srt} dB</p>
                ) : (
                  <p>○ Left ear speech tests: Not completed</p>
                )}
              </div>
            </div>

            <div className="border border-gray-300 rounded p-4">
              <h4 className="font-semibold text-gray-900 mb-2">✓ Results & Interpretation</h4>
              <div className="text-sm text-gray-700 space-y-1">
                {session?.right_ear_degree && (
                  <p>✓ Right ear: {session.right_ear_degree.replace('_', ' ')} {session.right_ear_type || ''}</p>
                )}
                {session?.left_ear_degree && (
                  <p>✓ Left ear: {session.left_ear_degree.replace('_', ' ')} {session.left_ear_type || ''}</p>
                )}
                {session?.clinical_impression && (
                  <p>✓ Clinical impression included</p>
                )}
                {session?.recommendations && session.recommendations.length > 0 && (
                  <p>✓ {session.recommendations.length} recommendations</p>
                )}
              </div>
            </div>
          </div>

          {/* Info Box */}
          <div className="bg-gray-50 border border-gray-200 rounded p-4 mt-6">
            <div className="flex items-start gap-3">
              <div className="text-blue-500 text-xl">ℹ️</div>
              <div className="text-sm text-gray-700">
                <p className="font-semibold mb-1">Professional Report Features:</p>
                <ul className="list-disc list-inside space-y-1">
                  <li>Clinic letterhead with contact information</li>
                  <li>Complete patient demographics</li>
                  <li>Test results tables (PTA, Speech)</li>
                  <li>Results interpretation and classification</li>
                  <li>Clinical impressions and recommendations</li>
                  <li>Audiologist signature section</li>
                </ul>
              </div>
            </div>
          </div>
        </div>

        {/* Footer Actions */}
        <div className="border-t border-gray-300 px-6 py-4 bg-gray-50 flex justify-between items-center">
          <div className="text-sm text-gray-600">
            Report will be generated in PDF format
          </div>
          <div className="flex gap-3">
            <button
              onClick={handleEmailReport}
              className="px-4 py-2 border border-blue-500 text-blue-500 rounded hover:bg-blue-50 transition-colors text-sm font-medium"
            >
              📧 Email Report
            </button>
            <button
              onClick={handlePrintReport}
              className="px-4 py-2 border border-gray-300 bg-white rounded hover:bg-gray-100 transition-colors text-sm font-medium"
            >
              🖨️ Print
            </button>
            <button
              onClick={handleDownloadPDF}
              disabled={isGenerating}
              className="px-4 py-2 bg-green-600 text-white rounded hover:bg-green-700 transition-colors text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isGenerating ? '⏳ Generating...' : '📥 Download PDF'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default ReportPreviewModal;
