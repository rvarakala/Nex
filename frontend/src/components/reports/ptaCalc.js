import { autoClassifyJerger } from '../ImpedancePanel';

// Pure-tone threshold average (PTA) across the supplied frequencies.
// Excludes null thresholds and no-response points.
export const ptaAvg = (data, which, freqs = [500, 1000, 2000]) => {
  if (!data) return null;
  const arr = (data[which] || []).filter(
    (m) =>
      freqs.includes(m.frequency) &&
      m.threshold_db !== null &&
      m.threshold_db !== undefined &&
      !m.no_response
  );
  if (arr.length < freqs.length) return null;
  return Math.round(arr.reduce((a, m) => a + m.threshold_db, 0) / arr.length);
};

// Resolve the effective Jerger type — user-entered value takes precedence,
// otherwise fall back to automatic classification.
export const effectiveJerger = (ear) =>
  ear?.jerger_type ||
  autoClassifyJerger({
    me_pressure: ear?.me_pressure,
    compliance: ear?.compliance,
    volume: ear?.volume,
  });
