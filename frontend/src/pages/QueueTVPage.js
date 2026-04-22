import React, { useState, useEffect, useCallback } from 'react';
import axios from 'axios';
import { useParams } from 'react-router-dom';

const BACKEND_URL = process.env.REACT_APP_BACKEND_URL;
const API = `${BACKEND_URL}/api`;

// Public waiting-room TV display. No auth. Polls every 5s.
// URL: /queue/:clinicId
export default function QueueTVPage() {
  const { clinicId } = useParams();
  const [data, setData] = useState(null);
  const [err, setErr] = useState(null);
  const [clock, setClock] = useState(new Date());

  const load = useCallback(async () => {
    try {
      const r = await axios.get(`${API}/queue/public/${clinicId}`);
      setData(r.data); setErr(null);
    } catch (e) {
      setErr(e?.response?.data?.detail || 'Clinic not found');
    }
  }, [clinicId]);

  useEffect(() => {
    load();
    const iv = setInterval(load, 5000);
    return () => clearInterval(iv);
  }, [load]);

  useEffect(() => {
    const iv = setInterval(() => setClock(new Date()), 1000);
    return () => clearInterval(iv);
  }, []);

  if (err) {
    return (
      <div className="min-h-screen bg-slate-900 flex items-center justify-center text-white" data-testid="queue-tv-error">
        <div className="text-center">
          <div className="text-4xl font-bold mb-2">⚠ Unavailable</div>
          <div className="text-lg text-slate-400">{err}</div>
        </div>
      </div>
    );
  }

  const now = data?.now_serving || [];
  const next = data?.next_up || [];

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-blue-950 to-slate-900 text-white p-6 md:p-10" data-testid="queue-tv-page">
      {/* Header */}
      <header className="flex items-center justify-between border-b border-blue-800 pb-4 mb-6">
        <div>
          <div className="text-4xl md:text-5xl font-bold tracking-tight">{data?.clinic?.name || 'Clinic Queue'}</div>
          {data?.clinic?.city && <div className="text-blue-300 text-lg md:text-xl mt-1">{data.clinic.city}</div>}
        </div>
        <div className="text-right">
          <div className="text-5xl md:text-6xl font-bold tabular-nums text-blue-200" data-testid="queue-tv-clock">
            {clock.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: false })}
          </div>
          <div className="text-blue-400 text-sm md:text-base uppercase tracking-widest mt-1">
            {clock.toLocaleDateString('en-IN', { weekday: 'long', day: '2-digit', month: 'long' })}
          </div>
        </div>
      </header>

      {/* Now serving */}
      <section className="mb-8" data-testid="queue-tv-now-serving">
        <div className="text-sm md:text-base text-emerald-400 uppercase tracking-[0.3em] font-bold mb-3">Now Serving</div>
        {now.length === 0 ? (
          <div className="bg-slate-800/50 border border-dashed border-slate-700 rounded-lg p-10 text-center text-2xl md:text-3xl text-slate-500 italic">
            —  waiting to start  —
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {now.map((t) => (
              <div key={t.token_no} data-testid={`tv-now-${t.token_no}`}
                className="bg-gradient-to-br from-emerald-600 to-emerald-800 rounded-xl p-6 shadow-2xl border border-emerald-400 animate-pulse-slow">
                <div className="flex items-start justify-between">
                  <div>
                    <div className="text-emerald-200 text-xs md:text-sm uppercase tracking-[0.3em] font-bold">Token</div>
                    <div className="text-7xl md:text-9xl font-black tabular-nums leading-none mt-1">#{t.token_no}</div>
                  </div>
                  <div className="text-right">
                    <div className="text-emerald-100 text-lg md:text-2xl font-bold">{t.patient_name}</div>
                    {t.service && <div className="text-emerald-300 text-sm md:text-base uppercase tracking-wider mt-0.5">{t.service}</div>}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Next up */}
      <section data-testid="queue-tv-next-up">
        <div className="flex items-end justify-between mb-3">
          <div className="text-sm md:text-base text-amber-400 uppercase tracking-[0.3em] font-bold">Next in Queue</div>
          <div className="text-amber-300 text-sm md:text-base">
            {data?.total_waiting || 0} waiting
          </div>
        </div>
        {next.length === 0 ? (
          <div className="bg-slate-800/50 border border-dashed border-slate-700 rounded-lg p-6 text-center text-xl text-slate-500 italic">
            Queue is empty.
          </div>
        ) : (
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3">
            {next.map((t, i) => (
              <div key={t.token_no} data-testid={`tv-next-${t.token_no}`}
                className={`rounded-lg p-4 border shadow-lg ${
                  i === 0
                    ? 'bg-amber-500/20 border-amber-500 animate-pulse'
                    : 'bg-slate-800/70 border-slate-700'
                }`}>
                <div className="text-4xl md:text-5xl font-black tabular-nums text-white">#{t.token_no}</div>
                <div className="text-base md:text-lg font-semibold text-blue-200 truncate mt-1">{t.patient_name}</div>
                {t.service && <div className="text-xs md:text-sm text-slate-400 uppercase tracking-wider mt-0.5 truncate">{t.service}</div>}
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Footer */}
      <footer className="mt-10 text-center text-xs md:text-sm text-slate-600 uppercase tracking-[0.2em]">
        Please wait until your token is called · अपनी बारी का इंतज़ार करें
      </footer>

      <style>{`
        @keyframes pulse-slow {
          0%, 100% { box-shadow: 0 0 0 0 rgba(16, 185, 129, 0.5); }
          50% { box-shadow: 0 0 30px 10px rgba(16, 185, 129, 0.25); }
        }
        .animate-pulse-slow { animation: pulse-slow 2s ease-in-out infinite; }
      `}</style>
    </div>
  );
}
