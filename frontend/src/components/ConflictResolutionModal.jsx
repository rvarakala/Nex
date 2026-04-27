/**
 * ConflictResolutionModal — 3-way diff merge UI for optimistic-locking conflicts.
 *
 * Trigger: any axios call returning HTTP 409 with payload:
 *   { detail: { code: "VERSION_MISMATCH", current: {...}, current_version: int, expected_version: int } }
 *
 * Renders 3 columns per conflicting field:
 *
 *   ┌──────────────────┬──────────────────┬──────────────────┐
 *   │ BASE (v expected)│ YOUR EDIT        │ SERVER (v current)│
 *   ├──────────────────┼──────────────────┼──────────────────┤
 *   │ Mild SNHL        │ Moderate SNHL ✏ │ Mild SNHL         │
 *   │ 9876543210       │ 9876543210       │ 9876543212 ✏      │
 *   └──────────────────┴──────────────────┴──────────────────┘
 *
 * Auto-resolves fields where only one side changed (no user prompt). Forces
 * the user to pick on true 3-way conflicts. On Resolve, calls onResolve(merged,
 * newVersion) with a clean payload pinned to current_version.
 */
import React, { useEffect, useMemo, useState } from 'react';

const fmt = (v) => {
  if (v === null || v === undefined || v === '') return <span className="italic text-slate-400">empty</span>;
  if (typeof v === 'boolean') return v ? '✓ Yes' : '✗ No';
  if (typeof v === 'number') return String(v);
  if (typeof v === 'object') return <code className="text-[10px]">{JSON.stringify(v)}</code>;
  return String(v);
};

const eq = (a, b) => {
  if (a === b) return true;
  if (a == null && b == null) return true;
  if (a == null || b == null) return false;
  return JSON.stringify(a) === JSON.stringify(b);
};

/**
 * Build per-field merge state.
 *
 * For each `field` in `fields`:
 *  - If localEdit[f] === base[f] → user didn't touch it, take server value (no conflict)
 *  - If server[f] === base[f]    → server didn't touch it, take user value (no conflict)
 *  - Else → 3-way CONFLICT. Default to "mine" but flag for user attention.
 */
function buildResolution(fields, base, local, server) {
  const out = {};
  fields.forEach((f) => {
    const fk = f.key;
    const baseV = base?.[fk];
    const localV = local?.[fk];
    const serverV = server?.[fk];

    let pick = 'server';
    let conflict = false;
    if (eq(localV, baseV)) {
      pick = 'server';
    } else if (eq(serverV, baseV)) {
      pick = 'mine';
    } else {
      pick = 'mine';
      conflict = true;
    }
    out[fk] = { pick, conflict, baseV, localV, serverV };
  });
  return out;
}

export default function ConflictResolutionModal({
  open, onClose,
  base, local, server,
  fields,                    // [{ key, label, render? }]
  currentVersion,
  expectedVersion,
  onResolve,                 // async (mergedFields, newExpectedVersion) → void
  recordLabel = 'this record',
}) {
  const [resolution, setResolution] = useState({});
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  // Recompute the per-field merge plan whenever the conflict payload changes.
  // (useState's initialiser only runs once at mount, which is wrong for a
  // modal that gets re-used with fresh data each time.)
  useEffect(() => {
    if (!open) return;
    setResolution(buildResolution(fields, base, local, server));
    setErr('');
  // We intentionally serialise the deep payload via JSON to keep the dep
  // array stable: same data → same string → no re-init.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, JSON.stringify(base), JSON.stringify(local), JSON.stringify(server)]);

  const conflictCount = useMemo(
    () => Object.values(resolution).filter((r) => r.conflict).length,
    [resolution],
  );

  // Only show fields where at least one side differs from base. Stable / unchanged
  // fields are auto-resolved silently and don't need to clutter the diff table.
  const visibleFields = useMemo(
    () => fields.filter((f) => {
      const r = resolution[f.key];
      if (!r) return false;
      const userEdited = !eq(r.localV, r.baseV);
      const serverChanged = !eq(r.serverV, r.baseV);
      return userEdited || serverChanged;
    }),
    [fields, resolution],
  );

  if (!open) return null;

  const setPick = (fk, pick) => {
    setResolution((prev) => ({ ...prev, [fk]: { ...prev[fk], pick } }));
  };

  const submit = async () => {
    setBusy(true); setErr('');
    try {
      const merged = {};
      Object.entries(resolution).forEach(([fk, r]) => {
        merged[fk] = r.pick === 'mine' ? r.localV : r.serverV;
      });
      await onResolve(merged, currentVersion);
      onClose();
    } catch (e) {
      const detail = e?.response?.data?.detail;
      setErr(typeof detail === 'string' ? detail : 'Failed to save merged record. Try again.');
    } finally { setBusy(false); }
  };

  return (
    <div className="fixed inset-0 z-[80] bg-black/60 flex items-center justify-center p-4"
         data-testid="conflict-modal">
      <div className="bg-white rounded-lg shadow-2xl max-w-5xl w-full max-h-[90vh] overflow-hidden flex flex-col">
        {/* Header */}
        <div className="bg-amber-50 border-b-2 border-amber-300 px-5 py-3 flex items-start justify-between">
          <div>
            <div className="text-amber-900 font-bold text-base flex items-center gap-2">
              <span className="text-xl">⚠</span> Conflict — someone else updated {recordLabel}
            </div>
            <div className="text-[12px] text-amber-800 mt-1">
              You loaded version <b>{expectedVersion}</b>; the latest server version is <b>{currentVersion}</b>.
              {' '}Auto-merged <b>{Object.keys(resolution).length - conflictCount}</b> fields safely.
              {conflictCount > 0 && (
                <> <span className="text-rose-700 font-bold">{conflictCount} field{conflictCount === 1 ? '' : 's'} need your decision.</span></>
              )}
            </div>
          </div>
          <button onClick={onClose} className="text-slate-500 hover:text-slate-800 text-2xl leading-none"
                  data-testid="conflict-close">×</button>
        </div>

        {err && <div className="m-3 bg-rose-100 text-rose-800 text-xs p-2 rounded font-semibold">⚠ {err}</div>}

        {/* Diff table */}
        <div className="overflow-y-auto p-4 flex-1">
          <table className="w-full text-xs border-collapse" data-testid="conflict-diff">
            <thead>
              <tr className="bg-slate-100 text-slate-700 text-[10px] uppercase tracking-wider">
                <th className="text-left p-2 border border-slate-300 w-[18%]">Field</th>
                <th className="text-left p-2 border border-slate-300 w-[27%]">Base (v{expectedVersion})</th>
                <th className="text-left p-2 border border-blue-300 w-[27%] bg-blue-50">Your edit</th>
                <th className="text-left p-2 border border-emerald-300 w-[27%] bg-emerald-50">Server (v{currentVersion})</th>
              </tr>
            </thead>
            <tbody>
              {visibleFields.map((f) => {
                const r = resolution[f.key];
                if (!r) return null;
                const isConflict = r.conflict;
                const userEdited = !eq(r.localV, r.baseV);
                const serverChanged = !eq(r.serverV, r.baseV);
                return (
                  <tr key={f.key} data-testid={`conflict-row-${f.key}`}
                      className={isConflict ? 'bg-rose-50/50' : ''}>
                    <td className="p-2 border border-slate-200 font-semibold align-top">
                      {f.label}
                      {isConflict && <div className="text-[9px] text-rose-700 font-bold mt-0.5">CONFLICT</div>}
                    </td>
                    <td className="p-2 border border-slate-200 align-top text-slate-500">
                      {f.render ? f.render(r.baseV) : fmt(r.baseV)}
                    </td>
                    <td className={`p-2 border align-top ${
                      isConflict ? 'border-blue-300' : 'border-slate-200'
                    } ${
                      r.pick === 'mine' && isConflict ? 'bg-blue-100' : (userEdited ? 'bg-blue-50/60' : '')
                    }`}>
                      <div>{f.render ? f.render(r.localV) : fmt(r.localV)}</div>
                      {isConflict && (
                        <label className="mt-1 inline-flex items-center gap-1 text-[10px] cursor-pointer">
                          <input type="radio"
                                 checked={r.pick === 'mine'}
                                 onChange={() => setPick(f.key, 'mine')}
                                 data-testid={`conflict-pick-mine-${f.key}`} />
                          <span className="font-bold text-blue-800">Use mine</span>
                        </label>
                      )}
                    </td>
                    <td className={`p-2 border align-top ${
                      isConflict ? 'border-emerald-300' : 'border-slate-200'
                    } ${
                      r.pick === 'server' && isConflict ? 'bg-emerald-100' : (serverChanged ? 'bg-emerald-50/60' : '')
                    }`}>
                      <div>{f.render ? f.render(r.serverV) : fmt(r.serverV)}</div>
                      {isConflict && (
                        <label className="mt-1 inline-flex items-center gap-1 text-[10px] cursor-pointer">
                          <input type="radio"
                                 checked={r.pick === 'server'}
                                 onChange={() => setPick(f.key, 'server')}
                                 data-testid={`conflict-pick-server-${f.key}`} />
                          <span className="font-bold text-emerald-800">Use theirs</span>
                        </label>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>

          {visibleFields.length === 0 && (
            <div className="text-center py-10 text-slate-500 text-sm italic">
              No conflicting fields detected — your write was just stale on version. Click <b>Resolve & Save</b> to retry with the fresh version.
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="border-t border-slate-200 p-3 flex items-center justify-between bg-slate-50">
          <div className="text-[11px] text-slate-600">
            Picked: {' '}
            <b className="text-blue-700">{Object.values(resolution).filter((r) => r.pick === 'mine').length} mine</b>
            {' · '}
            <b className="text-emerald-700">{Object.values(resolution).filter((r) => r.pick === 'server').length} theirs</b>
          </div>
          <div className="flex gap-2">
            <button onClick={onClose}
                    data-testid="conflict-cancel"
                    className="px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-200 rounded">
              Cancel
            </button>
            <button onClick={submit} disabled={busy}
                    data-testid="conflict-resolve"
                    className="px-4 py-1.5 text-xs font-bold bg-indigo-600 hover:bg-indigo-700 disabled:bg-slate-300 text-white rounded shadow">
              {busy ? 'Saving merged…' : `Resolve & Save (v${currentVersion + 1})`}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
