/**
 * AudiogramReportPage — full-page host for the HearingReportPreviewModal.
 *
 * Route: /test/audiogram/:sessionId (mounted OUTSIDE the /test/* module
 * shell so the Hearing Tests queue never renders behind it).
 *
 * Two entry surfaces need this URL:
 *   1. Patient Profile → Reports → "Open →" link
 *   2. Direct sharing / bookmarks
 *
 * Since the audiogram modal is already fullscreen + self-contained, this
 * page just mounts it. `onClose` uses the browser history so users
 * always land back where they came from (patient profile, reports
 * archive, hearing-tests queue — whichever).
 */
import React, { useEffect, useMemo, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import axios from 'axios';
import { useAuth } from '../AuthContext';
import HearingReportPreviewModal from '../components/HearingReportPreviewModal';

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;

export default function AudiogramReportPage() {
  const { sessionId } = useParams();
  const navigate = useNavigate();
  const { clinic } = useAuth();
  const [patient, setPatient] = useState(null);

  // Load the patient for the shareContext (WhatsApp chip needs mobile).
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const s = await axios.get(`${API}/sessions/${sessionId}`);
        const pid = s.data?.patient_id;
        if (!pid || !alive) return;
        const p = await axios.get(`${API}/patients/${pid}`);
        if (alive) setPatient(p.data);
      } catch {
        // Modal renders without shareContext — audiologist can still
        // preview & print. WhatsApp chip auto-hides when mobile is missing.
      }
    })();
    return () => { alive = false; };
  }, [sessionId]);

  const shareContext = useMemo(() => ({
    sessionId,
    patientMobile: patient?.mobile,
    patientName: patient?.name,
    clinicName: clinic?.name,
  }), [sessionId, patient, clinic]);

  const handleClose = () => {
    // Prefer browser back so users land on their referrer (patient
    // profile, reports archive, queue). Falls back to a safe list page
    // if this tab was opened directly (no prior history).
    if (window.history.length > 1) navigate(-1);
    else navigate('/reports');
  };

  if (!sessionId) return null;

  return (
    <HearingReportPreviewModal
      sessionId={sessionId}
      title="Hearing Assessment Report"
      shareContext={shareContext}
      onClose={handleClose}
    />
  );
}
