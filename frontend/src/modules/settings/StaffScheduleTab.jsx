/**
 * Staff Schedule tab — per-audiologist weekly availability.
 *
 * • Pick a staff member from the left list.
 * • Toggle "Inherit clinic hours" for the simple case (works whenever the clinic is open).
 * • Or set a custom weekly schedule with split shifts (e.g. Mon-Fri 9–1 morning + 5–8 evening).
 */
import React, { useEffect, useState, useCallback } from 'react';
import axios from 'axios';
import { Save, Users } from 'lucide-react';
import { useAuth } from '../../AuthContext';
import WeeklyHoursEditor from '../../components/WeeklyHoursEditor';

const API = process.env.REACT_APP_BACKEND_URL + '/api';

const DEFAULT_TEMPLATE = {
  mon: { open: true, windows: [{ start: '09:00', end: '13:30', label: 'Morning' }, { start: '14:30', end: '19:00', label: 'Evening' }] },
  tue: { open: true, windows: [{ start: '09:00', end: '13:30', label: 'Morning' }, { start: '14:30', end: '19:00', label: 'Evening' }] },
  wed: { open: true, windows: [{ start: '09:00', end: '13:30', label: 'Morning' }, { start: '14:30', end: '19:00', label: 'Evening' }] },
  thu: { open: true, windows: [{ start: '09:00', end: '13:30', label: 'Morning' }, { start: '14:30', end: '19:00', label: 'Evening' }] },
  fri: { open: true, windows: [{ start: '09:00', end: '13:30', label: 'Morning' }, { start: '14:30', end: '19:00', label: 'Evening' }] },
  sat: { open: true, windows: [{ start: '09:00', end: '13:30', label: 'Morning' }, { start: '14:30', end: '17:30', label: 'Evening' }] },
  sun: { open: false, windows: [] },
};

export default function StaffScheduleTab() {
  const { user } = useAuth();
  const canEditAll = ['clinic_owner', 'super_admin', 'founder'].includes(user?.role);

  const [staff, setStaff] = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const [hours, setHours] = useState(null);
  const [inherit, setInherit] = useState(true);
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState(null);

  // Load staff list once
  useEffect(() => {
    (async () => {
      try {
        const r = await axios.get(`${API}/users`);
        const list = Array.isArray(r.data) ? r.data : (r.data?.users || []);
        const audiologists = list.filter((u) =>
          ['audiologist', 'clinic_owner', 'super_admin'].includes(u.role)
          && u.active !== false,
        );
        setStaff(audiologists);
        // Default selection: self if I'm an audiologist, else first in list.
        const initialId = audiologists.find((u) => u.user_id === user?.user_id)
          ? user.user_id
          : audiologists[0]?.user_id;
        setSelectedId(initialId || null);
      } catch { setStaff([]); }
    })();
  }, [user]);

  // Load schedule whenever the selection changes
  const loadSchedule = useCallback(async (uid) => {
    if (!uid) return;
    setLoading(true);
    try {
      const r = await axios.get(`${API}/staff-schedule/${uid}`);
      setHours(r.data?.weekly_hours || DEFAULT_TEMPLATE);
      setInherit(!!r.data?.inherit_clinic);
    } catch {
      setHours(DEFAULT_TEMPLATE);
      setInherit(true);
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => { loadSchedule(selectedId); }, [selectedId, loadSchedule]);

  const canEditSelected = canEditAll || selectedId === user?.user_id;

  const save = async () => {
    setSaving(true);
    setMsg(null);
    try {
      await axios.put(`${API}/staff-schedule/${selectedId}`, {
        weekly_hours: hours, inherit_clinic: inherit,
      });
      setMsg({ kind: 'success', text: 'Schedule saved.' });
      setTimeout(() => setMsg(null), 2500);
    } catch (e) {
      setMsg({ kind: 'error', text: e?.response?.data?.detail || 'Save failed' });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="p-4 sm:p-6 max-w-6xl space-y-4" data-testid="staff-schedule-tab">
      <header className="flex items-end justify-between flex-wrap gap-3">
        <div>
          <h2 className="text-lg font-bold text-slate-900 flex items-center gap-2">
            <Users size={18} className="text-indigo-600" /> Staff Schedule
          </h2>
          <p className="text-[12px] text-slate-500 mt-1">
            Configure when each audiologist is available. Pick a staff member,
            then either inherit the clinic hours or set custom split shifts.
          </p>
        </div>
        {selectedId && canEditSelected && (
          <button
            onClick={save}
            disabled={saving}
            className="inline-flex items-center gap-1.5 text-[12px] px-3 py-2 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white rounded-lg font-semibold shadow-sm shadow-indigo-600/20"
            data-testid="staff-schedule-save"
          >
            <Save size={13} /> {saving ? 'Saving…' : 'Save'}
          </button>
        )}
      </header>

      {msg && (
        <div
          className={`text-[12px] px-3 py-2 rounded border ${
            msg.kind === 'success'
              ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
              : 'bg-rose-50 border-rose-200 text-rose-800'
          }`}
          data-testid={`staff-schedule-msg-${msg.kind}`}
        >
          {msg.text}
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-[240px,1fr] gap-4">
        <aside className="bg-white border border-slate-200 rounded-lg p-2 max-h-[640px] overflow-auto">
          {staff.length === 0 && (
            <div className="text-[11px] text-slate-400 italic p-3">No audiologists found.</div>
          )}
          {staff.map((s) => (
            <button
              key={s.user_id}
              onClick={() => setSelectedId(s.user_id)}
              data-testid={`staff-pick-${s.user_id}`}
              className={`w-full text-left px-3 py-2 rounded text-[12px] font-semibold transition flex items-center justify-between ${
                selectedId === s.user_id
                  ? 'bg-indigo-50 text-indigo-700 border border-indigo-200'
                  : 'text-slate-700 hover:bg-slate-50'
              }`}
            >
              <span className="truncate">{s.name || s.email}</span>
              <span className="text-[10px] uppercase tracking-wider text-slate-400">{s.role}</span>
            </button>
          ))}
        </aside>

        <section className="space-y-3">
          {!selectedId && (
            <div className="text-[12px] text-slate-500 italic">Pick a staff member to manage their schedule.</div>
          )}
          {selectedId && (
            <>
              <label className={`flex items-start gap-3 px-3 py-2.5 rounded-lg border ${
                inherit ? 'bg-indigo-50 border-indigo-200' : 'bg-white border-slate-200'
              }`}>
                <input
                  type="checkbox"
                  checked={inherit}
                  onChange={(e) => setInherit(e.target.checked)}
                  disabled={!canEditSelected}
                  className="mt-0.5 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                  data-testid="staff-schedule-inherit"
                />
                <div>
                  <div className="text-[12.5px] font-semibold text-slate-800">Inherit clinic hours</div>
                  <div className="text-[11px] text-slate-500 mt-0.5">
                    Available whenever the clinic is open (incl. lunch break). Uncheck to set
                    custom shifts (mornings only, split shift, days off, etc.).
                  </div>
                </div>
              </label>

              {!loading && (
                <div className={inherit ? 'opacity-50 pointer-events-none select-none' : ''}>
                  <WeeklyHoursEditor
                    value={hours}
                    onChange={canEditSelected && !inherit ? setHours : () => {}}
                    testidPrefix="staff-hours"
                  />
                </div>
              )}

              {!canEditSelected && (
                <div className="text-[11px] px-3 py-2 rounded bg-amber-50 border border-amber-200 text-amber-800">
                  Read-only view. Only the clinic owner / super-admin (or the staff member themselves) can edit this schedule.
                </div>
              )}
            </>
          )}
        </section>
      </div>
    </div>
  );
}
