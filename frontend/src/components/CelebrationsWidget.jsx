/**
 * Today's Celebrations widget — surfaces patients whose birthday or
 * wedding anniversary is today (with a 7-day look-ahead expandable list).
 *
 * Delivery model (PR 1): clicking "Send" opens a wa.me deep link in a new
 * tab pre-filled with a personalised template message + records the send
 * to the greeting_log so we never spam the same patient twice in a day.
 * PR 2 will route the same call through MSG91 once Connect is enabled.
 */
import React, { useEffect, useState, useCallback } from 'react';
import { Link } from 'react-router-dom';
import axios from 'axios';
import { Cake, Heart, Send, ChevronRight, Sparkles } from 'lucide-react';

const API = process.env.REACT_APP_BACKEND_URL + '/api';

const initials = (n) => (n || '?').trim().split(/\s+/).slice(0, 2).map((s) => s[0] || '').join('').toUpperCase();

export default function CelebrationsWidget() {
  const [today, setToday]       = useState([]);
  const [upcoming, setUpcoming] = useState([]);
  const [loading, setLoading]   = useState(true);
  const [showUpcoming, setShowUpcoming] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await axios.get(`${API}/greetings/today?days=7`);
      setToday(r.data?.today || []);
      setUpcoming(r.data?.upcoming || []);
    } finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const send = async (item) => {
    try {
      const r = await axios.post(`${API}/greetings/${item.patient_id}/send`, { kind: item.kind });
      if (r.data?.wa_link) window.open(r.data.wa_link, '_blank', 'noopener');
      // Mark as sent in local state so the green badge appears immediately.
      setToday((arr) => arr.map((x) => (x.patient_id === item.patient_id && x.kind === item.kind)
        ? { ...x, already_sent_today: true } : x));
    } catch (e) {
      // eslint-disable-next-line no-alert
      alert('Could not send greeting: ' + (e?.response?.data?.detail || e.message));
    }
  };

  if (loading) {
    return (
      <div className="bg-white border border-slate-200 rounded-xl p-4">
        <div className="text-[11px] text-slate-400 italic">Loading celebrations…</div>
      </div>
    );
  }

  if (today.length === 0 && upcoming.length === 0) {
    return null;
  }

  return (
    <div className="bg-gradient-to-br from-indigo-50 via-white to-amber-50 border border-indigo-200/60 rounded-xl overflow-hidden" data-testid="celebrations-widget">
      <header className="px-4 pt-4 pb-2 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="w-8 h-8 rounded-lg bg-gradient-to-br from-amber-400 to-rose-500 text-white flex items-center justify-center shadow-sm">
            <Sparkles size={15} />
          </span>
          <div>
            <div className="text-[13px] font-bold text-slate-900">Today's Celebrations</div>
            <div className="text-[10.5px] text-slate-500">{today.length} today · {upcoming.length} this week</div>
          </div>
        </div>
        {upcoming.length > 0 && (
          <button
            onClick={() => setShowUpcoming((v) => !v)}
            data-testid="celebrations-toggle-upcoming"
            className="text-[11px] text-indigo-700 font-semibold hover:text-indigo-900 inline-flex items-center gap-0.5">
            {showUpcoming ? 'Hide upcoming' : 'Show upcoming'} <ChevronRight size={11} className={`transition ${showUpcoming ? 'rotate-90' : ''}`} />
          </button>
        )}
      </header>

      {today.length === 0 ? (
        <div className="px-4 pb-4 text-[12px] text-slate-500 italic">No birthdays or anniversaries today — but {upcoming.length} coming up this week.</div>
      ) : (
        <ul className="px-2 pb-2">
          {today.map((g, i) => (
            <CelebrationRow key={`${g.patient_id}-${g.kind}-${i}`} item={g} onSend={() => send(g)} />
          ))}
        </ul>
      )}

      {showUpcoming && upcoming.length > 0 && (
        <div className="border-t border-indigo-100 bg-white/70 px-2 py-2">
          <div className="text-[10px] font-bold uppercase tracking-wider text-slate-500 px-2 pb-1">Upcoming · next 7 days</div>
          <ul>
            {upcoming.map((g, i) => (
              <CelebrationRow key={`u-${g.patient_id}-${g.kind}-${i}`} item={g} compact />
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function CelebrationRow({ item, onSend, compact }) {
  const isBday = item.kind === 'birthday';
  const Icon = isBday ? Cake : Heart;
  const label = item.days_until === 0
    ? (isBday
        ? `Birthday today${item.age_years ? ` · turning ${item.age_years}` : ''}`
        : `Anniversary today${item.years_together ? ` · ${item.years_together} years` : ''}`)
    : `${isBday ? 'Birthday' : 'Anniversary'} in ${item.days_until} day${item.days_until === 1 ? '' : 's'}`;

  return (
    <li className={`flex items-center gap-2.5 px-2 ${compact ? 'py-1.5' : 'py-2'} rounded-lg hover:bg-white/80 transition`}>
      <span className="w-7 h-7 rounded-full bg-indigo-100 text-indigo-700 flex items-center justify-center font-bold text-[10px] flex-shrink-0">
        {initials(item.name)}
      </span>
      <div className="flex-1 min-w-0">
        <Link to={`/patients/${item.patient_id}`} className="text-[12.5px] font-semibold text-slate-900 hover:text-indigo-700 truncate block" data-testid={`celebration-name-${item.patient_id}-${item.kind}`}>
          {item.name}
        </Link>
        <div className={`flex items-center gap-1 text-[10.5px] ${isBday ? 'text-amber-700' : 'text-rose-700'}`}>
          <Icon size={10} /> {label}
        </div>
      </div>
      {compact ? null : item.already_sent_today ? (
        <span className="text-[10px] font-bold text-emerald-700 px-2 py-0.5 bg-emerald-50 rounded-full border border-emerald-200">✓ Sent</span>
      ) : (
        <button
          onClick={onSend}
          disabled={!item.mobile}
          data-testid={`celebration-send-${item.patient_id}-${item.kind}`}
          title={item.mobile ? 'Open WhatsApp with greeting' : 'No mobile on file'}
          className="inline-flex items-center gap-1 text-[11px] px-2.5 py-1 bg-indigo-600 hover:bg-indigo-700 disabled:bg-slate-300 disabled:cursor-not-allowed text-white font-semibold rounded-md">
          <Send size={10} /> Send
        </button>
      )}
    </li>
  );
}
