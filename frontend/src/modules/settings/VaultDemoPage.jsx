/**
 * VaultDemoPage — proves the BYOK round-trip end-to-end.
 *
 * 1. Add a record (label + secret note). The note is encrypted in the
 *    browser BEFORE leaving — the server stores only the ciphertext.
 * 2. Refresh / re-login: the list re-fetches ciphertext from the server
 *    and decrypts it locally in the browser.
 * 3. Lock the vault: the same list now shows "🔒 locked" — the browser no
 *    longer holds the key, the server has never had it, so the data is
 *    unreadable until the user unlocks again.
 *
 * If this works, the entire "Your Data. Your Key. Your Control." promise
 * is real on a small surface area, and we can confidently expand to the
 * patient + audiogram + invoice tables in Phase 2.
 */
import React, { useCallback, useEffect, useState } from 'react';
import axios from 'axios';
import { Shield, ShieldOff, Trash2, Lock, Plus, RefreshCw, ServerCrash } from 'lucide-react';
import { useVault } from '../../crypto/VaultContext';
import VaultGate from '../../crypto/VaultGate';

const BACKEND = process.env.REACT_APP_BACKEND_URL;
const API = `${BACKEND}/api/vault`;

export default function VaultDemoPage() {
  return (
    <VaultGate required>
      <DemoBody />
    </VaultGate>
  );
}

function DemoBody() {
  const v = useVault();
  const [items, setItems] = useState([]);
  const [decoded, setDecoded] = useState({});
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState('');
  const [label, setLabel] = useState('');
  const [secret, setSecret] = useState('');
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true); setErr('');
    try {
      const r = await axios.get(`${API}/test-records`);
      setItems(r.data || []);
      const next = {};
      for (const row of r.data || []) {
        next[row.record_id] = await v.decrypt({
          encrypted_payload: row.encrypted_payload, iv: row.iv,
        });
      }
      setDecoded(next);
    } catch (e) {
      setErr(e?.message || 'Load failed');
    } finally {
      setLoading(false);
    }
  }, [v]);

  useEffect(() => { refresh(); }, [refresh]);

  const onAdd = async (e) => {
    e.preventDefault();
    if (!label || !secret) return;
    setBusy(true); setErr('');
    try {
      const env = await v.encrypt({ note: secret, ts: Date.now() });
      await axios.post(`${API}/test-records`, {
        label, encrypted_payload: env.encrypted_payload, iv: env.iv,
      });
      setLabel(''); setSecret('');
      await refresh();
    } catch (e) {
      setErr(e?.message || 'Save failed');
    } finally {
      setBusy(false);
    }
  };

  const onDelete = async (id) => {
    await axios.delete(`${API}/test-records/${id}`);
    await refresh();
  };

  return (
    <div className="max-w-4xl mx-auto px-4 sm:px-6 py-8" data-testid="vault-demo-page">
      <header className="flex items-start justify-between gap-4">
        <div>
          <div className="inline-flex items-center gap-2 px-2.5 py-1 rounded-full text-[11px] font-bold uppercase tracking-wider bg-emerald-100 text-emerald-700">
            <Shield size={12} /> Vault unlocked
          </div>
          <h1 className="mt-3 font-[Manrope,Inter,sans-serif] font-extrabold text-2xl sm:text-3xl text-slate-900 tracking-tight">
            Clinic Vault — Demo
          </h1>
          <p className="mt-2 text-[14px] text-slate-600 leading-relaxed max-w-2xl">
            Records below are encrypted in this browser before leaving. The server only stores ciphertext. <strong className="text-slate-800">Lock the vault to prove it</strong> — you&apos;ll see the records become unreadable until you unlock again.
          </p>
        </div>
        <div className="flex flex-col sm:flex-row gap-2 shrink-0">
          <button
            onClick={refresh}
            data-testid="vault-demo-refresh"
            className="inline-flex items-center gap-2 px-3.5 py-2 rounded-lg border border-slate-200 text-slate-700 hover:bg-slate-50 text-sm"
          >
            <RefreshCw size={14} /> Refresh
          </button>
          <button
            onClick={v.lock}
            data-testid="vault-demo-lock"
            className="inline-flex items-center gap-2 px-3.5 py-2 rounded-lg bg-slate-900 hover:bg-slate-800 text-white text-sm font-semibold shadow-sm"
          >
            <Lock size={14} /> Lock vault
          </button>
        </div>
      </header>

      <form onSubmit={onAdd} className="mt-8 grid sm:grid-cols-[1fr_2fr_auto] gap-3 p-4 rounded-xl bg-slate-50 border border-slate-200">
        <input
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          placeholder="Label (e.g. Patient note)"
          data-testid="vault-demo-label"
          className="px-3 py-2.5 rounded-lg border border-slate-200 text-sm focus:ring-2 focus:ring-blue-100 focus:border-[#0B5FFF] outline-none"
          maxLength={80}
        />
        <input
          value={secret}
          onChange={(e) => setSecret(e.target.value)}
          placeholder="Secret content (encrypted before save)"
          data-testid="vault-demo-secret"
          className="px-3 py-2.5 rounded-lg border border-slate-200 text-sm focus:ring-2 focus:ring-blue-100 focus:border-[#0B5FFF] outline-none"
        />
        <button
          type="submit"
          disabled={!label || !secret || busy}
          data-testid="vault-demo-add"
          className="inline-flex items-center justify-center gap-2 bg-[#0B5FFF] hover:bg-[#094acf] disabled:bg-slate-300 text-white px-5 py-2.5 rounded-lg font-semibold text-sm shadow-sm transition"
        >
          <Plus size={14} /> {busy ? 'Encrypting…' : 'Add'}
        </button>
      </form>

      {err && (
        <div className="mt-4 flex items-center gap-2 rounded-lg bg-rose-50 border border-rose-200 text-rose-700 px-3 py-2 text-sm">
          <ServerCrash size={14} /> {err}
        </div>
      )}

      <ul className="mt-6 divide-y divide-slate-100 rounded-2xl border border-slate-100 bg-white shadow-sm">
        {loading && <li className="px-5 py-8 text-center text-slate-400 text-sm">Loading…</li>}
        {!loading && items.length === 0 && (
          <li className="px-5 py-10 text-center text-slate-400 text-sm">
            No records yet. Add one to see the encrypt → store → decrypt round-trip.
          </li>
        )}
        {items.map((row) => {
          const plain = decoded[row.record_id];
          const errored = plain && plain._decrypt_error;
          return (
            <li key={row.record_id} className="px-5 py-4 flex items-start gap-4" data-testid={`vault-demo-row-${row.record_id}`}>
              <span className={`mt-0.5 w-9 h-9 rounded-lg flex items-center justify-center ${errored ? 'bg-rose-100 text-rose-600' : 'bg-emerald-100 text-emerald-700'}`}>
                {errored ? <ShieldOff size={16} /> : <Shield size={16} />}
              </span>
              <div className="flex-1 min-w-0">
                <div className="font-semibold text-slate-900 text-[14px]">{row.label}</div>
                {!errored ? (
                  <div className="mt-0.5 text-[13.5px] text-slate-700 break-words">{plain?.note ?? '…'}</div>
                ) : (
                  <div className="mt-0.5 text-[13px] text-rose-600">Cannot decrypt — wrong vault?</div>
                )}
                <div className="mt-1.5 text-[11px] text-slate-400 font-mono truncate" title={row.encrypted_payload}>
                  ciphertext: {row.encrypted_payload.slice(0, 60)}…
                </div>
              </div>
              <button
                onClick={() => onDelete(row.record_id)}
                className="text-slate-400 hover:text-rose-600 transition shrink-0"
                aria-label="Delete"
                data-testid={`vault-demo-delete-${row.record_id}`}
              >
                <Trash2 size={16} />
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
