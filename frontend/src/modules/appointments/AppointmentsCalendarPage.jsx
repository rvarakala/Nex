import React, { useState, useEffect, useMemo, useCallback } from 'react';
import axios from 'axios';
import { useNavigate } from 'react-router-dom';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useAuth } from '../../AuthContext';
import StaffRail from './components/StaffRail';
import WeekGrid from './components/WeekGrid';
import IntentChooser from './components/IntentChooser';
import BookCounterpartyModal from './components/BookCounterpartyModal';
import BookAppointmentModal from '../frontdesk/appointments/BookAppointmentModal';
import { startOfWeek, addDays, fmtRange } from './utils';

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;

// =============================================================================
// AppointmentsCalendarPage — top-level /appointments route.
// Phase 2 scope: Week view, staff filter rail, mini-month, booking via
// existing modal. Day / Month / Persons views are stubbed and arrive in
// Phase 4. Counterparty (vendor / sales rep / etc.) booking lands in Phase 3.
// =============================================================================
const VIEWS = ['day', 'week', 'month', 'persons'];

export default function AppointmentsCalendarPage() {
  const { user } = useAuth();
  const navigate = useNavigate();

  const [view, setView] = useState('week');
  const [anchor, setAnchor] = useState(() => new Date());
  const [staff, setStaff] = useState([]);
  const [selectedStaffIds, setSelectedStaffIds] = useState([]);
  const [appointments, setAppointments] = useState([]);
  const [loading, setLoading] = useState(true);

  // Booking modal
  const [modalOpen, setModalOpen] = useState(false);
  const [modalInitial, setModalInitial] = useState(null); // { initialDate, initialTime, existing }

  // Intent chooser + non-patient modal state
  const [chooserOpen, setChooserOpen] = useState(false);
  const [pendingSlot, setPendingSlot] = useState(null); // { date, time }
  const [cpModalState, setCpModalState] = useState(null);
  // ^ { type, initialDate, initialTime, existing? } when open; null when closed

  const weekStart = useMemo(() => startOfWeek(anchor), [anchor]);
  const weekEnd = useMemo(() => addDays(weekStart, 6), [weekStart]);

  // ---- Load staff resources once on mount + when clinic switches -----------
  const loadStaff = useCallback(async () => {
    try {
      const r = await axios.get(`${API}/appointments/staff-resources`);
      const list = r.data?.staff || [];
      setStaff(list);
      // Default: show every staff member toggled ON.
      setSelectedStaffIds(list.map((s) => s.user_id));
    } catch (err) {
      console.error('[AppointmentsCalendar] staff load failed', err);
    }
  }, []);

  useEffect(() => { loadStaff(); }, [loadStaff]);

  // ---- Load appointments for the visible window ----------------------------
  const loadAppointments = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({
        from_date: weekStart.toISOString().slice(0, 10),
        to_date: weekEnd.toISOString().slice(0, 10),
        limit: '500',
      });
      if (selectedStaffIds.length > 0 && selectedStaffIds.length < staff.length) {
        params.set('staff_ids', selectedStaffIds.join(','));
      }
      const r = await axios.get(`${API}/appointments?${params.toString()}`);
      setAppointments(r.data || []);
    } catch (err) {
      console.error('[AppointmentsCalendar] appointments load failed', err);
      setAppointments([]);
    } finally {
      setLoading(false);
    }
  }, [weekStart, weekEnd, selectedStaffIds, staff.length]);

  useEffect(() => {
    if (staff.length > 0) loadAppointments();
  }, [loadAppointments, staff.length]);

  // ---- Filter list (client-side guard so toggles feel instant) -------------
  const visibleAppointments = useMemo(() => {
    if (selectedStaffIds.length === 0) return [];
    if (selectedStaffIds.length === staff.length) return appointments;
    const set = new Set(selectedStaffIds);
    return appointments.filter((a) => set.has(a.staff_id) || set.has(a.audiologist_id));
  }, [appointments, selectedStaffIds, staff.length]);

  // ---- Toolbar interactions ------------------------------------------------
  const goPrev = () => setAnchor(addDays(anchor, view === 'day' ? -1 : -7));
  const goNext = () => setAnchor(addDays(anchor, view === 'day' ? 1 : 7));
  const goToday = () => setAnchor(new Date());

  const toggleStaff = (id) =>
    setSelectedStaffIds((cur) =>
      cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id],
    );
  const selectAll = () => setSelectedStaffIds(staff.map((s) => s.user_id));
  const clearAll = () => setSelectedStaffIds([]);

  // ---- Booking flow --------------------------------------------------------
  const audiologistsForModal = useMemo(
    () => staff.filter((s) => s.role === 'audiologist'),
    [staff],
  );

  // Open the intent chooser. The user picks Patient / Vendor / etc., and we
  // route to the matching modal. If the slot was right-clicked, we skip the
  // chooser entirely and default to Patient (>90% case).
  const openNew = (initialDate = anchor, initialTime, skipChooser = false) => {
    if (skipChooser) {
      setModalInitial({ initialDate, initialTime });
      setModalOpen(true);
      return;
    }
    setPendingSlot({ initialDate, initialTime });
    setChooserOpen(true);
  };

  const handleIntentPick = (type) => {
    const slot = pendingSlot || { initialDate: anchor };
    setChooserOpen(false);
    setPendingSlot(null);
    if (type === 'patient') {
      setModalInitial(slot);
      setModalOpen(true);
    } else {
      setCpModalState({ type, ...slot });
    }
  };

  const handleSlotRightClick = (slotDate) => {
    const hh = String(slotDate.getHours()).padStart(2, '0');
    const mm = String(slotDate.getMinutes()).padStart(2, '0');
    // Right-click is a power-user shortcut → assume Patient and skip the chooser.
    openNew(slotDate, `${hh}:${mm}`, true);
  };

  const handleEventClick = (appt) => {
    const isPatient = (appt.counterparty_type || 'patient') === 'patient';
    if (isPatient) {
      setModalInitial({
        initialDate: new Date(appt.start_at),
        initialTime: undefined,
        existing: appt,
      });
      setModalOpen(true);
    } else {
      setCpModalState({
        type: appt.counterparty_type,
        initialDate: new Date(appt.start_at),
        existing: appt,
      });
    }
  };

  // Drag-to-reschedule — fired by WeekGrid once the user drops an event onto
  // a new slot. We optimistically update the local list and revert on error.
  const handleEventDrop = useCallback(async (appt, newStart) => {
    const newIso = new Date(newStart).toISOString();
    const prev = appointments;
    setAppointments((cur) =>
      cur.map((a) =>
        a.appointment_id === appt.appointment_id
          ? { ...a, start_at: newIso, end_at: new Date(new Date(newStart).getTime() + (appt.duration_minutes || 30) * 60000).toISOString() }
          : a,
      ),
    );
    try {
      await axios.put(`${API}/appointments/${appt.appointment_id}`, {
        start_at: newIso,
        duration_minutes: appt.duration_minutes || 30,
      });
      loadAppointments();
    } catch (err) {
      // Roll back on failure.
      setAppointments(prev);
      const detail = err?.response?.data?.detail;
      const msg = (detail && typeof detail === 'object') ? detail.message : (typeof detail === 'string' ? detail : 'Could not move appointment');
      alert(msg);
    }
  }, [appointments, loadAppointments]);

  const handleSaved = () => {
    setModalOpen(false);
    setModalInitial(null);
    setCpModalState(null);
    loadAppointments();
  };

  // ---- Render --------------------------------------------------------------
  return (
    <div
      className="flex flex-col lg:flex-row h-full min-h-0 bg-white"
      data-testid="appointments-calendar-page"
    >
      <StaffRail
        staff={staff}
        selectedIds={selectedStaffIds}
        onToggle={toggleStaff}
        onSelectAll={selectAll}
        onClearAll={clearAll}
        anchor={anchor}
        onPickDate={(d) => setAnchor(d)}
        onNew={() => openNew()}
      />

      <div className="flex-1 flex flex-col min-w-0 min-h-0">
        {/* Toolbar */}
        <div
          className="flex items-center justify-between border-b border-slate-200 px-4 py-2 bg-white flex-shrink-0"
          data-testid="apt-toolbar"
        >
          {/* View tabs */}
          <div className="flex items-center gap-0.5 bg-slate-100 rounded-lg p-0.5">
            {VIEWS.map((v) => (
              <button
                key={v}
                type="button"
                onClick={() => setView(v)}
                disabled={v !== 'week'}
                title={v !== 'week' ? 'Coming soon' : undefined}
                data-testid={`apt-view-${v}`}
                className={`px-3 py-1 text-[11px] uppercase tracking-wider font-bold rounded transition-colors ${
                  view === v
                    ? 'bg-blue-600 text-white shadow-sm'
                    : v !== 'week'
                    ? 'text-slate-400 cursor-not-allowed'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                {v}
              </button>
            ))}
          </div>

          {/* Range label */}
          <div
            className="text-[13px] font-semibold text-slate-700 tracking-wide"
            data-testid="apt-range-label"
          >
            {fmtRange(weekStart, weekEnd)}
          </div>

          {/* Right controls */}
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={goToday}
              data-testid="apt-today"
              className="text-[11px] uppercase tracking-wider font-bold text-blue-600 hover:bg-blue-50 px-3 py-1 rounded transition-colors"
            >
              Today
            </button>
            <button
              type="button"
              onClick={goPrev}
              data-testid="apt-prev"
              className="p-1.5 text-slate-500 hover:text-slate-900 hover:bg-slate-100 rounded transition-colors"
              aria-label="Previous"
            >
              <ChevronLeft size={16} />
            </button>
            <button
              type="button"
              onClick={goNext}
              data-testid="apt-next"
              className="p-1.5 text-slate-500 hover:text-slate-900 hover:bg-slate-100 rounded transition-colors"
              aria-label="Next"
            >
              <ChevronRight size={16} />
            </button>
          </div>
        </div>

        {/* Hint strip */}
        <div className="text-[10px] text-slate-400 px-4 py-1 bg-slate-50/50 border-b border-slate-100">
          Tip: <span className="font-semibold">Right-click</span> any time slot to book at that minute.
          {loading && <span className="ml-2 text-blue-600 font-semibold">Loading…</span>}
        </div>

        {/* Body */}
        <div className="flex-1 min-h-0">
          {view === 'week' && (
            <WeekGrid
              weekStart={weekStart}
              appointments={visibleAppointments}
              onEventClick={handleEventClick}
              onSlotRightClick={handleSlotRightClick}
              onEventDrop={handleEventDrop}
            />
          )}
          {view !== 'week' && (
            <div className="h-full flex items-center justify-center text-slate-400">
              <div className="text-center">
                <div className="text-3xl mb-2">📅</div>
                <div className="text-sm font-semibold capitalize">{view} view coming soon</div>
                <div className="text-xs mt-1">Phase 4 will land Day, Month and Persons views.</div>
              </div>
            </div>
          )}
        </div>
      </div>

      {modalOpen && (
        <BookAppointmentModal
          audiologists={audiologistsForModal.map((a) => ({
            user_id: a.user_id,
            name: a.name,
            role: a.role,
          }))}
          initialDate={modalInitial?.initialDate}
          initialTime={modalInitial?.initialTime}
          existing={modalInitial?.existing}
          onClose={() => {
            setModalOpen(false);
            setModalInitial(null);
          }}
          onSaved={handleSaved}
        />
      )}

      {chooserOpen && (
        <IntentChooser
          onPick={handleIntentPick}
          onClose={() => { setChooserOpen(false); setPendingSlot(null); }}
        />
      )}

      {cpModalState && (
        <BookCounterpartyModal
          counterpartyType={cpModalState.type}
          staff={staff}
          initialDate={cpModalState.initialDate}
          initialTime={cpModalState.initialTime}
          existing={cpModalState.existing}
          onClose={() => setCpModalState(null)}
          onSaved={handleSaved}
        />
      )}
    </div>
  );
}
