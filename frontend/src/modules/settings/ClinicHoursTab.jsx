/**
 * Clinic Hours tab — set the clinic's working hours per weekday.
 *
 * Most clinics in India have a 9–1.30 + 2.30–7 split with Sunday closed; the
 * default template ships with that. Owner / super_admin can change it; other
 * roles see a read-only view.
 */
import React, { useEffect, useState } from 'react';
import axios from 'axios';
import { Save, RotateCcw, Clock } from 'lucide-react';
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

export default function ClinicHoursTab() {
  const { user } = useAuth();
  const canEdit = ['clinic_owner', 'super_admin', 'founder'].includes(user?.role);

  const [hours, setHours] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState(null);

  const load = async () => {
    try {
      setLoading(true);
      const r = await axios.get(`${API}/clinic-schedule`);
      setHours(r.data?.weekly_hours || DEFAULT_TEMPLATE);
    } catch {
      setHours(DEFAULT_TEMPLATE);
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => { load(); }, []);

  const save = async () => {
    setSaving(true);
    setMsg(null);
    try {
      await axios.put(`${API}/clinic-schedule`, { weekly_hours: hours });
      setMsg({ kind: 'success', text: 'Working hours saved.' });
      setTimeout(() => setMsg(null), 2500);
    } catch (e) {
      setMsg({ kind: 'error', text: e?.response?.data?.detail || 'Save failed' });
    } finally {
      setSaving(false);
    }
  };

  const resetDefaults = () => setHours(DEFAULT_TEMPLATE);

  if (loading) return <div className="p-6 text-sm text-slate-500">Loading…</div>;

  return (
    <div className="p-4 sm:p-6 max-w-4xl space-y-4" data-testid="clinic-hours-tab">
      <header className="flex items-end justify-between flex-wrap gap-3">
        <div>
          <h2 className="text-lg font-bold text-slate-900 flex items-center gap-2">
            <Clock size={18} className="text-indigo-600" /> Clinic Working Hours
          </h2>
          <p className="text-[12px] text-slate-500 mt-1">
            Set when your clinic is open and reachable. Booked slots will only be
            offered inside these windows. Lunch breaks are easy — add a second
            shift window for the afternoon.
          </p>
        </div>
        {canEdit && (
          <div className="flex items-center gap-2">
            <button
              onClick={resetDefaults}
              className="inline-flex items-center gap-1.5 text-[12px] px-3 py-2 bg-white border border-slate-200 hover:border-slate-300 text-slate-700 rounded-lg font-semibold"
              data-testid="clinic-hours-reset"
            >
              <RotateCcw size={13} /> Reset to default
            </button>
            <button
              onClick={save}
              disabled={saving}
              className="inline-flex items-center gap-1.5 text-[12px] px-3 py-2 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white rounded-lg font-semibold shadow-sm shadow-indigo-600/20"
              data-testid="clinic-hours-save"
            >
              <Save size={13} /> {saving ? 'Saving…' : 'Save'}
            </button>
          </div>
        )}
      </header>

      {msg && (
        <div
          className={`text-[12px] px-3 py-2 rounded border ${
            msg.kind === 'success'
              ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
              : 'bg-rose-50 border-rose-200 text-rose-800'
          }`}
          data-testid={`clinic-hours-msg-${msg.kind}`}
        >
          {msg.text}
        </div>
      )}

      {!canEdit && (
        <div className="text-[12px] px-3 py-2 rounded bg-amber-50 border border-amber-200 text-amber-800">
          You can view but not change clinic hours. Ask the clinic owner / super-admin to make edits.
        </div>
      )}

      <WeeklyHoursEditor value={hours} onChange={canEdit ? setHours : () => {}} testidPrefix="clinic-hours" />
    </div>
  );
}
