import React, { useState, useEffect, useCallback, useMemo } from 'react';
import axios from 'axios';
import ErrorToast, { describeError } from '../../../components/ErrorToast';
import { ReferringDoctorPicker } from '../../../components/patient/ReferringDoctorPicker';

const BACKEND_URL = process.env.REACT_APP_BACKEND_URL;
const API = `${BACKEND_URL}/api`;

const ROOMS = ['Room 1', 'Room 2', 'Sound Booth'];
const DURATIONS = [15, 30, 45, 60, 75, 90, 105, 120];

// Snap an arbitrary total (in minutes) to the closest allowed duration
// bucket. Prevents auto-sum outputs like 80 min (ha_fitting + ha_earmould)
// from silently defaulting the <select> back to the first option because
// the computed value isn't present in DURATIONS. Ties go UP so reception
// always gets ≥ the estimated time.
const snapDurationToAllowed = (mins) => {
  if (!mins || mins <= DURATIONS[0]) return DURATIONS[0];
  if (mins >= DURATIONS[DURATIONS.length - 1]) return DURATIONS[DURATIONS.length - 1];
  let best = DURATIONS[0];
  let bestDiff = Infinity;
  for (const d of DURATIONS) {
    const diff = Math.abs(d - mins);
    // < instead of <= so equal-distance snaps prefer the LARGER bucket.
    if (diff < bestDiff) { best = d; bestDiff = diff; }
  }
  return best;
};

// Front-desk "what tests to perform" chip picker. Kept in sync with the
// RECOMMENDED_TAB_MAP in TestProceduresModule — the audiologist sees the
// matching tab pre-highlighted.
//
// `defaultMin` is the fallback per-test minutes when the catalog row doesn't
// expose `duration_minutes`. Used to auto-sum the appointment block so front
// desk doesn't have to guess "PTA + IMP + OAE = how long?".
//
// `catalogCodes` and `catalogNameHints` map a chip to the canonical service
// catalogue (seeded from `DEFAULT_SERVICES` in backend/billing.py). Codes
// match first (precise), then name substrings — covers clinics that have
// renamed e.g. "Immittance" → "Impedance" or vice versa.
//
// `defaultPrice` is the fallback used to draft an invoice line when the
// clinic's catalogue is missing this test entirely (so reception still sees
// every selected test on the invoice — they can edit the price inline).
const FRONTDESK_TEST_OPTIONS = [
  { key: 'pta',        label: 'PTA',           defaultMin: 30, defaultPrice: 800,
    catalogCodes: ['PTA'],     catalogNameHints: ['pure tone', 'pta'] },
  { key: 'impedance',  label: 'Impedance',     defaultMin: 15, defaultPrice: 600,
    catalogCodes: ['IMM'],     catalogNameHints: ['immittance', 'impedance', 'tymp', 'reflex'] },
  { key: 'speech',     label: 'Speech',        defaultMin: 20, defaultPrice: 800,
    catalogCodes: ['SPEECH'],  catalogNameHints: ['speech'] },
  { key: 'oae',        label: 'OAE',           defaultMin: 15, defaultPrice: 1000,
    catalogCodes: ['OAE'],     catalogNameHints: ['oae', 'otoacoustic'] },
  { key: 'abr',        label: 'ABR',           defaultMin: 45, defaultPrice: 2500,
    catalogCodes: ['ABR'],     catalogNameHints: ['abr', 'bera'] },
  { key: 'soundfield', label: 'Sound Field',   defaultMin: 20, defaultPrice: 800,
    catalogCodes: ['SF', 'SOUNDFIELD'], catalogNameHints: ['sound field', 'soundfield', 'free field'] },
  { key: 'special',    label: 'Special Tests', defaultMin: 30, defaultPrice: 1500,
    catalogCodes: ['SPECIAL'], catalogNameHints: ['special'] },
  { key: 'tinnitus',   label: 'Tinnitus',      defaultMin: 30, defaultPrice: 1000,
    catalogCodes: ['TINN'],    catalogNameHints: ['tinnitus'] },
  { key: 'pediatric',  label: 'Pediatric',     defaultMin: 30, defaultPrice: 1500,
    catalogCodes: ['PEDS'],    catalogNameHints: ['pediatric', 'paediatric', 'voa', 'play audiometry'] },
];
const TEST_BY_KEY = Object.fromEntries(FRONTDESK_TEST_OPTIONS.map((t) => [t.key, t]));

// Phase B #3 — Hearing-Aid wing service chips. Routes the appointment to
// the HA module (category=`fitting` by default) and drafts invoice lines
// from the HA catalogue (HAF / HA-BTE / HA-RIC / EARMOULD / BATTERY).
//
// The `category` field lets us override the wing's default when a specific
// chip is more of a `demo` or `other` — e.g. HA Trial is a demo, HA Sale
// is `other` (product purchase, not a fitting session).
const HA_SERVICE_OPTIONS = [
  { key: 'ha_trial',       label: 'HA Trial / Demo',   defaultMin: 45, defaultPrice: 0,     category: 'demo',
    catalogCodes: [],             catalogNameHints: ['trial', 'demo'] },
  { key: 'ha_fitting',     label: 'HA Fitting',        defaultMin: 60, defaultPrice: 1500,  category: 'fitting',
    catalogCodes: ['HAF'],        catalogNameHints: ['hearing aid fitting', 'fitting'] },
  { key: 'ha_programming', label: 'Programming',       defaultMin: 45, defaultPrice: 1000,  category: 'fitting',
    catalogCodes: ['HAP'],        catalogNameHints: ['programming', 'fine tune', 'fine-tune'] },
  { key: 'ha_followup',    label: 'HA Follow-up',      defaultMin: 30, defaultPrice: 500,   category: 'fitting',
    catalogCodes: ['HAFU'],       catalogNameHints: ['follow-up', 'followup', 'review'] },
  { key: 'ha_repair',      label: 'Repair / Service',  defaultMin: 30, defaultPrice: 0,     category: 'other',
    catalogCodes: ['HAR'],        catalogNameHints: ['repair', 'service'] },
  { key: 'ha_earmould',    label: 'Ear Mould',         defaultMin: 20, defaultPrice: 1200,  category: 'fitting',
    catalogCodes: ['EARMOULD'],   catalogNameHints: ['ear mould', 'earmould', 'mould'] },
  { key: 'ha_battery',     label: 'Battery / Accy.',   defaultMin: 10, defaultPrice: 300,   category: 'other',
    catalogCodes: ['BATTERY'],    catalogNameHints: ['battery', 'accessor'] },
  { key: 'ha_sale_bte',    label: 'HA Sale — BTE',     defaultMin: 60, defaultPrice: 35000, category: 'other',
    catalogCodes: ['HA-BTE'],     catalogNameHints: ['bte'] },
  { key: 'ha_sale_ric',    label: 'HA Sale — RIC',     defaultMin: 60, defaultPrice: 55000, category: 'other',
    catalogCodes: ['HA-RIC'],     catalogNameHints: ['ric'] },
];
const HA_BY_KEY = Object.fromEntries(HA_SERVICE_OPTIONS.map((t) => [t.key, t]));

export default function BookAppointmentModal({ audiologists, initialDate, initialTime, existing, onClose, onSaved }) {
  const isEdit = !!existing?.appointment_id;
  const today = useMemo(() => (initialDate ? initialDate.toISOString().slice(0, 10) : new Date().toISOString().slice(0, 10)), [initialDate]);

  // Patient search
  const [patientQuery, setPatientQuery] = useState(existing?.patient_name || '');
  const [patientResults, setPatientResults] = useState([]);
  const [selectedPatient, setSelectedPatient] = useState(existing && existing.patient_id ? { patient_id: existing.patient_id, name: existing.patient_name } : null);
  const [patientDropdown, setPatientDropdown] = useState(false);

  // Form
  const [audiologistId, setAudiologistId] = useState(existing?.audiologist_id || (audiologists[0]?.user_id || ''));
  // Re-sync audiologist dropdown once the async /users fetch returns.
  // Without this, opening the modal before the fetch completes caches
  // `audiologists = []` and the dropdown stays empty forever.
  useEffect(() => {
    if (!audiologistId && audiologists.length > 0) {
      setAudiologistId(existing?.audiologist_id || audiologists[0].user_id);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [audiologists]);
  const [room, setRoom] = useState(existing?.room || '');
  const [priority, setPriority] = useState(existing?.priority || 'normal');
  // `duration` auto-syncs to the sum of selected chip defaults (or catalog
  // `duration_minutes` when present), but front desk can still override via
  // the dropdown. Once they touch the dropdown we stop auto-resyncing.
  const [duration, setDuration] = useState(existing?.duration_minutes || 30);
  const [durationManuallySet, setDurationManuallySet] = useState(!!existing);
  const [date, setDate] = useState(existing?.start_at ? existing.start_at.slice(0, 10) : today);
  const [time, setTime] = useState(existing?.start_at ? existing.start_at.slice(11, 16) : (initialTime || '10:00'));
  const [notes, setNotes] = useState(existing?.notes || '');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const [slots, setSlots] = useState([]);
  const [nextAvailable, setNextAvailable] = useState(null);
  const [override, setOverride] = useState(false);
  const [showAllSlots, setShowAllSlots] = useState(false);

  // Front-desk intake triage (the user's "recommended tests" feature)
  const [visitType, setVisitType] = useState(existing?.visit_type || 'walkin');
  const [recommendedTests, setRecommendedTests] = useState(
    Array.isArray(existing?.recommended_tests) ? existing.recommended_tests : [],
  );
  // Phase B #3 — Wing routing. `diagnostic` shows the classic PTA/IMP/etc.
  // chips; `hearing_aid` swaps them for HA Fitting / Trial / Sale / Ear
  // Mould etc. and routes the appointment to the HA module (category=
  // `fitting` or `other` per chip). Legacy rows default to diagnostic.
  const [wing, setWing] = useState(existing?.wing || 'diagnostic');
  const [hearingAidServices, setHearingAidServices] = useState(
    Array.isArray(existing?.hearing_aid_services) ? existing.hearing_aid_services : [],
  );
  const toggleHaService = (k) => setHearingAidServices((prev) =>
    prev.includes(k) ? prev.filter((x) => x !== k) : [...prev, k]);
  const [referredBy, setReferredBy] = useState(existing?.referred_by || '');
  // Doctor picker — feeds the same `referredBy` free-text field so the
  // downstream appointment payload doesn't change shape. Also passes
  // `referring_doctor_id` when a doctor is picked so the referral
  // rollup + payout tracking works out of the box.
  const [referringDoctorId, setReferringDoctorId] = useState(existing?.referring_doctor_id || null);
  const toggleRecTest = (k) => setRecommendedTests((prev) =>
    prev.includes(k) ? prev.filter((x) => x !== k) : [...prev, k]);

  // ---- Catalog services (for the inline invoice auto-draft) ----
  const [catalog, setCatalog] = useState([]);
  useEffect(() => {
    (async () => {
      try {
        const r = await axios.get(`${API}/billing/services`);
        setCatalog(r.data || []);
      } catch { /* noop */ }
    })();
  }, []);

  // Map front-desk test chips → canonical catalog service rows.
  // Lookup priority:
  //   1. exact `code` match against the chip's `catalogCodes` (strongest)
  //   2. exact `name` match (case-insensitive) against the chip label
  //   3. fuzzy name `includes` against the chip's `catalogNameHints`
  // Returns `null` only if ALL strategies miss — handled by the invoice
  // auto-sync below (which then drafts a line with the chip's `defaultPrice`).
  //
  // Phase B #3 — accepts an optional `chipRegistry` so the same lookup
  // works for HA_SERVICE_OPTIONS. Defaults to TEST_BY_KEY for back-compat.
  const matchService = useCallback((chipKey, chipRegistry = TEST_BY_KEY) => {
    if (!catalog.length) return null;
    const meta = chipRegistry[chipKey];
    if (!meta) return null;
    const lc = (s) => (s || '').toLowerCase().trim();
    const codes = (meta.catalogCodes || []).map((c) => c.toUpperCase());
    if (codes.length) {
      const byCode = catalog.find((s) => codes.includes((s.code || '').toUpperCase()));
      if (byCode) return byCode;
    }
    const exactName = catalog.find((s) => lc(s.name) === lc(meta.label));
    if (exactName) return exactName;
    const hints = (meta.catalogNameHints || []).map(lc);
    if (hints.length) {
      const fuzzy = catalog.find((s) => hints.some((h) => lc(s.name).includes(h)));
      if (fuzzy) return fuzzy;
    }
    return null;
  }, [catalog]);

  // ---- Inline invoice draft (auto-filled from ticked tests, FD-editable) ----
  const [raiseInvoice, setRaiseInvoice] = useState(existing?.visit_type !== 'consultation');
  const [invoiceLines, setInvoiceLines] = useState([]);

  // Per-chip price for the chip label. Prefers the clinic's catalogue, but
  // falls back to the chip's `defaultPrice` so reception always sees a price
  // (even on tenants whose catalogue is incomplete — like fresh signups).
  const chipPrice = useCallback((chipKey, chipRegistry = TEST_BY_KEY) => {
    const svc = matchService(chipKey, chipRegistry);
    if (svc && svc.price != null) return Number(svc.price);
    const meta = chipRegistry[chipKey];
    return meta && meta.defaultPrice ? Number(meta.defaultPrice) : null;
  }, [matchService]);

  // Auto-derive a single `service` string for the appointment row from the
  // selected chips. The backend still expects one `service` field for
  // calendar tooltips / staff dashboards, but the user mental model is now
  // "I'll do PTA + Impedance + OAE today" — so we collapse the chip list
  // into a friendly summary like "PTA + Impedance + OAE". For edits of
  // legacy appointments with no chips, preserve the original `service`.
  //
  // Phase B #3 — HA wing derives from HA chips instead of test chips.
  const derivedService = useMemo(() => {
    if (visitType === 'consultation') return 'Consultation';
    if (wing === 'hearing_aid') {
      if (hearingAidServices.length === 0) return existing?.service || 'Hearing Aid';
      const labels = hearingAidServices.map((k) => (HA_BY_KEY[k] || {}).label || k);
      if (labels.length <= 3) return labels.join(' + ');
      return `${labels.slice(0, 2).join(' + ')} +${labels.length - 2} more`;
    }
    if (visitType === 'referral' && recommendedTests.length === 0) {
      return existing?.service || 'Referral';
    }
    if (recommendedTests.length === 0) return existing?.service || '';
    const labels = recommendedTests.map((k) => (TEST_BY_KEY[k] || {}).label || k);
    if (labels.length <= 3) return labels.join(' + ');
    return `${labels.slice(0, 2).join(' + ')} +${labels.length - 2} more`;
  }, [visitType, wing, recommendedTests, hearingAidServices, existing]);

  // Derived appointment category. Diagnostic wing keeps the legacy
  // `consultation` default; HA wing takes the first chip's `category`
  // (falls back to `fitting`). Front desk doesn't need to think about
  // this — it just powers calendar colour + downstream module routing.
  const derivedCategory = useMemo(() => {
    if (visitType === 'consultation') return 'consultation';
    if (wing === 'hearing_aid') {
      if (hearingAidServices.length === 0) return 'fitting';
      const first = HA_BY_KEY[hearingAidServices[0]];
      return first?.category || 'fitting';
    }
    return existing?.category || 'diagnostic';
  }, [visitType, wing, hearingAidServices, existing]);

  // Auto-sum duration from selected chips (catalog `duration_minutes` first,
  // else the static defaultMin). Front desk can still override the dropdown.
  useEffect(() => {
    if (durationManuallySet) return;
    if (visitType === 'consultation') { setDuration(30); return; }
    if (wing === 'hearing_aid') {
      if (hearingAidServices.length === 0) return;
      const total = hearingAidServices.reduce((sum, k) => {
        const svc = matchService(k, HA_BY_KEY);
        const fromCatalog = Number(svc?.duration_minutes || 0);
        const fallback = (HA_BY_KEY[k] || {}).defaultMin || 30;
        return sum + (fromCatalog > 0 ? fromCatalog : fallback);
      }, 0);
      // Snap to the nearest ALLOWED duration so the <select> displays it.
      setDuration(snapDurationToAllowed(total));
      return;
    }
    if (recommendedTests.length === 0) return;
    const total = recommendedTests.reduce((sum, k) => {
      const svc = matchService(k);
      const fromCatalog = Number(svc?.duration_minutes || 0);
      const fallback = (TEST_BY_KEY[k] || {}).defaultMin || 15;
      return sum + (fromCatalog > 0 ? fromCatalog : fallback);
    }, 0);
    setDuration(snapDurationToAllowed(total));
  }, [recommendedTests, hearingAidServices, wing, visitType, matchService, durationManuallySet]);

  // Auto-sync invoice lines to ticked tests / HA services (consultation → no invoice).
  // We ALWAYS draft a line per chip — even when the catalog is missing
  // the entry — so reception sees every test/service on the invoice. Missing
  // catalog entries fall back to the chip's hard-coded `defaultPrice`
  // and are flagged with `_unmapped: true` so the table can hint that
  // the price is editable.
  useEffect(() => {
    if (isEdit) return;
    if (visitType === 'consultation') { setInvoiceLines([]); return; }
    const activeChips = wing === 'hearing_aid' ? hearingAidServices : recommendedTests;
    const registry = wing === 'hearing_aid' ? HA_BY_KEY : TEST_BY_KEY;
    setInvoiceLines((prev) => {
      // Preserve user edits on already-present lines; add missing; drop unticked.
      // Also drops lines from the OTHER wing when the wing toggle flips.
      const kept = prev.filter((l) => activeChips.includes(l._chip));
      const existingChips = new Set(kept.map((l) => l._chip));
      const additions = activeChips
        .filter((k) => !existingChips.has(k))
        .map((k) => {
          const meta = registry[k] || {};
          const svc = matchService(k, registry);
          if (svc) {
            return {
              _key: Math.random().toString(36).slice(2),
              _chip: k,
              _unmapped: false,
              service_id: svc.service_id,
              name: svc.name,
              unit_price: svc.price,
              quantity: 1,
              discount_type: 'flat',
              discount_value: 0,
            };
          }
          // Catalog miss → still add the line so reception sees the test
          // on the invoice. Price defaults to the chip's typical rate;
          // FD edits inline. service_id stays null and the backend
          // honours the description + unit_price as an ad-hoc line.
          return {
            _key: Math.random().toString(36).slice(2),
            _chip: k,
            _unmapped: true,
            service_id: null,
            name: meta.label || k,
            unit_price: meta.defaultPrice || 0,
            quantity: 1,
            discount_type: 'flat',
            discount_value: 0,
          };
        });
      return [...kept, ...additions];
    });
  }, [recommendedTests, hearingAidServices, wing, visitType, catalog, matchService, isEdit]);

  const updateInvoiceLine = (key, patch) =>
    setInvoiceLines((prev) => prev.map((l) => l._key === key ? { ...l, ...patch } : l));
  const removeInvoiceLine = (key) =>
    setInvoiceLines((prev) => prev.filter((l) => l._key !== key));

  // Live preview total (simple: qty × price − discount). Matches the backend
  // closely enough for FD to "see what they're charging".
  const invoiceTotal = invoiceLines.reduce((sum, l) => {
    const gross = Number(l.quantity || 1) * Number(l.unit_price || 0);
    const discVal = Number(l.discount_value || 0);
    const disc = l.discount_type === 'percent'
      ? Math.min(gross, gross * Math.max(0, Math.min(100, discVal)) / 100)
      : Math.max(0, Math.min(gross, discVal));
    return sum + Math.max(0, gross - disc);
  }, 0);

  // Track whether the last patient-search request has completed with zero
  // hits. Used to show a "No patient found" message so the user isn't left
  // wondering why the Book button is disabled after typing a name.
  const [patientSearchRun, setPatientSearchRun] = useState(false);

  // Inline quick-register sub-form state — lets the user create a new
  // patient without leaving the Book Appointment modal. Kept minimal
  // (only the required PatientCreate fields + mobile for dedup) so the
  // FD can reach the audiologist slot in ≤ 2 clicks.
  const [quickRegOpen, setQuickRegOpen] = useState(false);
  const [qrName, setQrName] = useState('');
  const [qrMobile, setQrMobile] = useState('');
  const [qrAge, setQrAge] = useState('');
  const [qrGender, setQrGender] = useState('Male');
  const [qrBusy, setQrBusy] = useState(false);
  const [qrErr, setQrErr] = useState('');

  const openQuickReg = () => {
    setQrName(patientQuery.trim() || '');
    setQrMobile('');
    setQrAge('');
    setQrGender('Male');
    setQrErr('');
    setQuickRegOpen(true);
  };
  const submitQuickReg = async () => {
    setQrErr('');
    if (!qrName.trim()) { setQrErr('Name is required'); return; }
    const ageNum = parseInt(qrAge, 10);
    if (!ageNum || ageNum < 0 || ageNum > 120) { setQrErr('Enter a valid age'); return; }
    setQrBusy(true);
    try {
      const r = await axios.post(`${API}/patients`, {
        name: qrName.trim(), age: ageNum, gender: qrGender,
        mobile: qrMobile.trim() || null,
      });
      // Auto-select the freshly-created patient and close the sub-form.
      setSelectedPatient(r.data);
      setPatientQuery(r.data.name);
      setPatientResults([]);
      setPatientDropdown(false);
      setQuickRegOpen(false);
    } catch (e) {
      const d = e?.response?.data?.detail;
      if (d && typeof d === 'object' && d.existing_patient) {
        // Backend found a duplicate by mobile — auto-use that record.
        setSelectedPatient(d.existing_patient);
        setPatientQuery(d.existing_patient.name);
        setQuickRegOpen(false);
        setQrErr('');
      } else {
        setQrErr(describeError(e, 'Quick registration failed'));
      }
    } finally {
      setQrBusy(false);
    }
  };

  // Patient search debounce
  useEffect(() => {
    if (selectedPatient && patientQuery === selectedPatient.name) return;
    if (!patientQuery || patientQuery.trim().length < 2) { setPatientResults([]); setPatientSearchRun(false); return; }
    const t = setTimeout(async () => {
      try {
        const r = await axios.get(`${API}/patients`, { params: { search: patientQuery, limit: 8 } });
        setPatientResults(r.data || []);
      } catch { setPatientResults([]); }
      finally { setPatientSearchRun(true); }
    }, 250);
    return () => clearTimeout(t);
  }, [patientQuery, selectedPatient]);

  // Slot suggestions — uses /availability/slots which returns the FULL day
  // with availability+reason metadata so we can grey out lunch / off-shift /
  // already-booked slots with tooltips instead of silently hiding them.
  const fetchSlots = useCallback(async () => {
    if (!audiologistId || !date) return;
    try {
      const r = await axios.get(`${API}/availability/slots`, {
        params: {
          staff_id: audiologistId,
          date,
          duration_minutes: duration,
          override: override ? 'true' : 'false',
        },
      });
      setSlots(r.data?.slots || []);
      setNextAvailable(r.data?.next_available || null);
    } catch {
      // fallback to legacy free-only endpoint if availability isn't available
      try {
        const r2 = await axios.get(`${API}/appointments/slots`, {
          params: { audiologist_id: audiologistId, date, duration_minutes: duration },
        });
        setSlots((r2.data?.slots || []).map((s) => ({ ...s, available: true })));
        setNextAvailable(null);
      } catch { setSlots([]); setNextAvailable(null); }
    }
  }, [audiologistId, date, duration, override]);
  useEffect(() => { fetchSlots(); }, [fetchSlots]);

  const valid =
    selectedPatient && audiologistId && date && time &&
    // For new appointments, require ≥1 chip (or consultation). For edits we
    // accept the legacy single-`service` value the row was created with so
    // older appointments don't get blocked from being edited.
    (isEdit || visitType === 'consultation'
      || (wing === 'hearing_aid' ? hearingAidServices.length > 0 : recommendedTests.length > 0));

  // Collect human-readable reasons the form isn't submittable yet.
  // Surfaced both under the Patient field and next to the Book button so
  // the user never has to guess why the CTA is greyed out.
  const missing = [];
  if (!selectedPatient) missing.push('patient');
  if (!audiologistId) missing.push('audiologist');
  if (!date) missing.push('date');
  if (!time) missing.push('time');
  if (!isEdit && visitType !== 'consultation') {
    if (wing === 'hearing_aid' && hearingAidServices.length === 0) {
      missing.push('at least one HA service');
    } else if (wing === 'diagnostic' && recommendedTests.length === 0) {
      missing.push('at least one test');
    }
  }

  // Patient-field helper states (not a *blocking* error — just UX nudges).
  const patientQueryTrimmed = patientQuery.trim();
  const showPickHint = !selectedPatient && patientQueryTrimmed.length >= 2 && patientResults.length > 0;
  const showNoMatchHint = !selectedPatient && patientQueryTrimmed.length >= 2 && patientSearchRun && patientResults.length === 0;

  const submit = async () => {
    if (!valid) return;
    setBusy(true); setErr(null);
    try {
      const startIso = `${date}T${time}:00`;
      // Wing-aware payload — HA wing sends HA services + zeroes out
      // diagnostic test chips (and vice versa) so the appointment row
      // never carries stale chips from the OTHER wing.
      const isHaWing = wing === 'hearing_aid';
      const recTests = visitType === 'consultation' || isHaWing ? [] : recommendedTests;
      const haServices = visitType === 'consultation' || !isHaWing ? [] : hearingAidServices;
      if (isEdit) {
        await axios.put(`${API}/appointments/${existing.appointment_id}`, {
          audiologist_id: audiologistId, service: derivedService, room: room || null, priority,
          start_at: startIso, duration_minutes: duration, notes,
          visit_type: visitType,
          wing,
          category: derivedCategory,
          recommended_tests: recTests,
          hearing_aid_services: haServices,
          referred_by: visitType === 'referral' ? (referredBy || null) : null,
          referring_doctor_id: visitType === 'referral' ? (referringDoctorId || null) : null,
        });
      } else {
        // Atomic create — appointment + (optionally) a pre-filled draft invoice.
        // The invoice lines are auto-drafted from the ticked tests (see `invoiceLines`
        // below) but FD can edit them inline before clicking Save & Send.
        const payload = {
          patient_id: selectedPatient.patient_id, audiologist_id: audiologistId,
          service: derivedService, room: room || null, priority,
          start_at: startIso, duration_minutes: duration, notes,
          visit_type: visitType,
          wing,
          category: derivedCategory,
          recommended_tests: recTests,
          hearing_aid_services: haServices,
          referred_by: visitType === 'referral' ? (referredBy || null) : null,
          referring_doctor_id: visitType === 'referral' ? (referringDoctorId || null) : null,
          raise_invoice: raiseInvoice && invoiceLines.length > 0,
          invoice_lines: invoiceLines.map((l) => ({
            service_id: l.service_id,
            // Send `description` so ad-hoc lines (catalog miss) still print
            // a meaningful row on the invoice. Backend prefers service.name
            // over description when service_id resolves, so this is safe.
            description: l.name || undefined,
            quantity: Number(l.quantity) || 1,
            unit_price: l.unit_price !== '' && l.unit_price != null ? Number(l.unit_price) : null,
            discount_type: l.discount_type || 'flat',
            discount_value: Number(l.discount_value) || 0,
          })),
        };
        await axios.post(`${API}/appointments/with-invoice`, payload);
        if (existing?._waitlist_entry_id) {
          try { await axios.put(`${API}/waitlist/${existing._waitlist_entry_id}/status`, { status: 'scheduled' }); } catch { /* noop */ }
        }
      }
      onSaved?.();
    } catch (e) {
      const d = e?.response?.data?.detail;
      if (d && typeof d === 'object' && d.conflict_with) {
        setErr(`Conflict with ${d.conflict_with.patient_name} at ${new Date(d.conflict_with.start_at).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}`);
      } else {
        setErr(describeError(e, 'Failed to save appointment'));
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4"
         onClick={(e) => { if (e.target === e.currentTarget) onClose?.(); }}
         data-testid="book-apt-modal">
      <div className="bg-white rounded-lg shadow-2xl w-[560px] max-w-full max-h-[90vh] flex flex-col">
        <div className="px-4 py-2.5 border-b border-slate-200 bg-gradient-to-r from-slate-50 to-white flex items-center justify-between">
          <h3 className="text-sm font-bold text-slate-800">{isEdit ? 'Edit Appointment' : 'Book Appointment'}</h3>
          <button onClick={onClose} className="w-6 h-6 text-slate-500 hover:text-red-600 text-lg">×</button>
        </div>

        <div className="flex-1 overflow-auto p-3 space-y-2">
          {/* Patient */}
          <div className="relative">
            <label className="block text-[10px] font-semibold text-slate-600 uppercase tracking-wide mb-0.5">Patient *</label>
            <input
              type="text"
              value={patientQuery}
              onChange={(e) => { setPatientQuery(e.target.value); setPatientDropdown(true); setSelectedPatient(null); }}
              onFocus={() => setPatientDropdown(true)}
              disabled={isEdit}
              placeholder="Search name / mobile / MRD…"
              autoFocus={!isEdit}
              data-testid="bk-patient-search"
              className="w-full px-2 py-1.5 text-xs border border-slate-300 rounded focus:outline-none focus:border-blue-500 disabled:bg-slate-50 disabled:text-slate-500"
            />
            {patientDropdown && !isEdit && patientResults.length > 0 && (
              <div className="absolute z-10 mt-0.5 w-full max-h-40 overflow-auto bg-white border border-slate-300 rounded shadow-lg">
                {patientResults.map((p) => (
                  <button key={p.patient_id} type="button" onClick={() => {
                    setSelectedPatient(p);
                    setPatientQuery(p.name);
                    setPatientDropdown(false);
                    // Auto-populate referring doctor from the patient's
                    // registration record (issue #1, 2026-07-30). If the
                    // patient was created with `referring_doctor_id`, we
                    // switch the visit type to "referral" and pre-select
                    // the doctor so the audiologist doesn't have to type
                    // the same name twice.
                    if (p.referring_doctor_id) {
                      setVisitType('referral');
                      setReferringDoctorId(p.referring_doctor_id);
                    }
                  }}
                    data-testid={`bk-patient-${p.patient_id}`}
                    className="w-full text-left px-2 py-1 text-xs hover:bg-blue-50 border-b border-slate-100 last:border-0">
                    <div className="font-medium">{p.name}</div>
                    <div className="text-[9px] text-slate-500">{p.mrd || p.patient_id} · {p.age}{(p.gender||'')[0]}{p.mobile ? ` · ${p.mobile}` : ''}</div>
                    {p.referring_physician && (
                      <div className="text-[9px] text-blue-600 italic">Ref: {p.referring_physician}</div>
                    )}
                  </button>
                ))}
              </div>
            )}
            {/* Inline helpers: guide the user when patient isn't yet chosen. */}
            {!isEdit && showPickHint && (
              <div className="mt-1 flex items-center justify-between gap-2 text-[10px] text-amber-700 bg-amber-50 border border-amber-200 rounded px-1.5 py-0.5" data-testid="bk-pick-hint">
                <span>Pick a patient from the list above to continue.</span>
                <button type="button" onClick={openQuickReg} data-testid="bk-quick-register-btn"
                  className="text-[10px] font-semibold text-indigo-700 hover:text-indigo-900 underline">
                  + Register new
                </button>
              </div>
            )}
            {!isEdit && showNoMatchHint && (
              <div className="mt-1 text-[10px] text-rose-700 bg-rose-50 border border-rose-200 rounded px-1.5 py-1" data-testid="bk-no-match-hint">
                <div>No patient found for "{patientQueryTrimmed}".</div>
                <button type="button" onClick={openQuickReg} data-testid="bk-quick-register-btn-no-match"
                  className="mt-0.5 text-[10px] font-semibold text-rose-800 hover:text-rose-950 underline">
                  + Register "{patientQueryTrimmed}" as a new patient
                </button>
              </div>
            )}
            {selectedPatient && (
              <div className="mt-1 text-[10px] text-emerald-700" data-testid="bk-patient-selected">
                ✓ {selectedPatient.name} selected
              </div>
            )}

            {/* Inline Quick-Register form — doesn't navigate away. */}
            {!isEdit && quickRegOpen && (
              <div className="mt-2 border border-indigo-200 bg-indigo-50/50 rounded p-2 space-y-1.5" data-testid="bk-quick-register-form">
                <div className="flex items-center justify-between">
                  <div className="text-[10px] font-bold uppercase tracking-wider text-indigo-800">Register new patient</div>
                  <button type="button" onClick={() => setQuickRegOpen(false)} className="text-[14px] text-indigo-700 hover:text-indigo-900 leading-none" data-testid="bk-quick-register-close">×</button>
                </div>
                <div className="grid grid-cols-2 gap-1.5">
                  <input type="text" value={qrName} onChange={(e) => setQrName(e.target.value)} placeholder="Name *" data-testid="bk-qr-name"
                    className="col-span-2 px-2 py-1 text-xs border border-slate-300 rounded" />
                  <input type="tel" value={qrMobile} onChange={(e) => setQrMobile(e.target.value.replace(/[^\d]/g, '').slice(0, 10))} placeholder="Mobile (10 digits)" data-testid="bk-qr-mobile"
                    className="px-2 py-1 text-xs border border-slate-300 rounded" />
                  <input type="number" value={qrAge} onChange={(e) => setQrAge(e.target.value)} placeholder="Age *" data-testid="bk-qr-age"
                    className="px-2 py-1 text-xs border border-slate-300 rounded" min="0" max="120" />
                  <select value={qrGender} onChange={(e) => setQrGender(e.target.value)} data-testid="bk-qr-gender"
                    className="col-span-2 px-2 py-1 text-xs border border-slate-300 rounded bg-white">
                    <option value="Male">Male</option>
                    <option value="Female">Female</option>
                    <option value="Other">Other</option>
                  </select>
                </div>
                {qrErr && <ErrorToast err={qrErr} testid="bk-qr-error" className="text-[10px] !p-1.5" />}
                <div className="flex items-center justify-end gap-1.5 pt-0.5">
                  <button type="button" onClick={() => setQuickRegOpen(false)}
                    className="px-2 py-0.5 text-[11px] text-slate-600 hover:bg-slate-100 rounded">Cancel</button>
                  <button type="button" onClick={submitQuickReg} disabled={qrBusy}
                    data-testid="bk-qr-save"
                    className="px-2 py-0.5 text-[11px] font-semibold text-white bg-indigo-600 hover:bg-indigo-700 disabled:bg-slate-300 rounded">
                    {qrBusy ? 'Registering…' : 'Register & use'}
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* Schedule */}
          <div className="grid grid-cols-3 gap-2">
            <div>
              <label className="block text-[10px] font-semibold text-slate-600 uppercase tracking-wide mb-0.5">Audiologist *</label>
              <select value={audiologistId} onChange={(e) => setAudiologistId(e.target.value)} data-testid="bk-audiologist"
                className="w-full px-2 py-1.5 text-xs border border-slate-300 rounded bg-white">
                {audiologists.map((a) => <option key={a.user_id} value={a.user_id}>{a.name}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-[10px] font-semibold text-slate-600 uppercase tracking-wide mb-0.5">Date *</label>
              <input type="date" value={date} onChange={(e) => setDate(e.target.value)} data-testid="bk-date"
                className="w-full px-2 py-1.5 text-xs border border-slate-300 rounded bg-white" />
            </div>
            <div>
              <label className="block text-[10px] font-semibold text-slate-600 uppercase tracking-wide mb-0.5">Time *</label>
              <input type="time" value={time} onChange={(e) => setTime(e.target.value)} data-testid="bk-time"
                className="w-full px-2 py-1.5 text-xs border border-slate-300 rounded bg-white" />
            </div>
          </div>

          {/* Suggested slots — full day grid with availability metadata.
              Available slots are highlighted; unavailable ones (lunch, off-shift,
              already booked) are greyed out with a tooltip explaining why. */}
          {slots.length > 0 && (
            <div className="bg-slate-50 border border-slate-200 rounded p-2">
              <div className="flex items-center justify-between mb-1.5 gap-2 flex-wrap">
                <div className="text-[10px] font-semibold text-slate-700 uppercase tracking-wider">Slots on {date}</div>
                <div className="flex items-center gap-2">
                  {nextAvailable && (
                    <button type="button"
                      onClick={() => setTime(nextAvailable.start_at.slice(11, 16))}
                      className="text-[10px] px-2 py-0.5 bg-emerald-100 hover:bg-emerald-200 border border-emerald-300 rounded text-emerald-800 font-semibold"
                      data-testid="bk-slot-next-available">
                      Next available · {nextAvailable.start_at.slice(11, 16)}
                    </button>
                  )}
                  <button type="button"
                    onClick={() => setShowAllSlots((s) => !s)}
                    className="text-[10px] px-2 py-0.5 border border-slate-300 hover:bg-slate-100 rounded text-slate-700"
                    data-testid="bk-slots-toggle-all">
                    {showAllSlots ? 'Show available only' : `Show all ${slots.length}`}
                  </button>
                </div>
              </div>
              <div className="flex flex-wrap gap-0.5">
                {(showAllSlots ? slots : slots.filter((s) => s.available)).map((s) => {
                  const t = s.start_at.slice(11, 16);
                  const blocked = !s.available;
                  return (
                    <button key={s.start_at} type="button"
                      onClick={() => { if (!blocked || override) setTime(t); }}
                      disabled={blocked && !override}
                      title={s.reason || s.label || 'Available'}
                      className={`text-[10px] px-1.5 py-0.5 border rounded font-mono tabular-nums transition ${
                        time === t
                          ? 'bg-indigo-600 border-indigo-700 text-white font-semibold'
                          : blocked
                            ? 'bg-slate-100 border-slate-200 text-slate-400 line-through cursor-not-allowed'
                            : 'bg-white border-emerald-300 hover:bg-emerald-50 text-emerald-800'
                      }`}
                      data-testid={`bk-slot-${t}`}>
                      {t}
                    </button>
                  );
                })}
              </div>
              <label className="flex items-center gap-1.5 mt-2 text-[10px] text-slate-600 cursor-pointer select-none">
                <input type="checkbox" checked={override} onChange={(e) => setOverride(e.target.checked)}
                  data-testid="bk-slot-override"
                  className="rounded border-slate-300 text-indigo-600 focus:ring-indigo-500" />
                <span>Override hours / lunch / off-shift (book anyway)</span>
              </label>
            </div>
          )}

          <div className="grid grid-cols-3 gap-2">
            <div>
              <label className="block text-[10px] font-semibold text-slate-600 uppercase tracking-wide mb-0.5">
                Duration
                {!durationManuallySet && (recommendedTests.length > 0 || hearingAidServices.length > 0) && (
                  <span className="ml-1 text-[9px] font-normal text-emerald-700 normal-case">· auto</span>
                )}
              </label>
              <select
                value={duration}
                onChange={(e) => { setDuration(parseInt(e.target.value, 10)); setDurationManuallySet(true); }}
                data-testid="bk-duration"
                className="w-full px-2 py-1.5 text-xs border border-slate-300 rounded bg-white">
                {DURATIONS.map((d) => <option key={d} value={d}>{`${d} min`}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-[10px] font-semibold text-slate-600 uppercase tracking-wide mb-0.5">Room</label>
              <select value={room} onChange={(e) => setRoom(e.target.value)}
                className="w-full px-2 py-1.5 text-xs border border-slate-300 rounded bg-white">
                <option value="">—</option>
                {ROOMS.map((r) => <option key={r} value={r}>{r}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-[10px] font-semibold text-slate-600 uppercase tracking-wide mb-0.5">Priority</label>
              <select value={priority} onChange={(e) => setPriority(e.target.value)}
                className="w-full px-2 py-1.5 text-xs border border-slate-300 rounded bg-white">
                <option value="normal">Normal</option><option value="urgent">Urgent</option><option value="vip">VIP</option>
              </select>
            </div>
          </div>

          <div>
            <label className="block text-[10px] font-semibold text-slate-600 uppercase tracking-wide mb-0.5">Notes</label>
            <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} data-testid="bk-notes"
              className="w-full px-2 py-1.5 text-xs border border-slate-300 rounded resize-y" />
          </div>

          {/* ==================== FRONT-DESK INTAKE TRIAGE ==================== */}
          <div className="pt-1.5 border-t border-dashed border-slate-200" data-testid="bk-intake-block">
            <div className="flex items-center gap-2 mb-1.5">
              <span className="text-[10px] font-bold text-slate-700 uppercase tracking-wider">Intake · what to perform</span>
              <div className="flex-1 h-px bg-slate-200" />
            </div>

            {/* Phase B #3 — Wing toggle: Diagnostic vs Hearing Aid.
                Drives which chip set is shown + which module the
                appointment is routed to. Hidden on consultation
                (audiologist decides). Legacy edits default to
                diagnostic so existing appts keep working. */}
            {visitType !== 'consultation' && (
              <div className="flex gap-1 mb-2" role="radiogroup" aria-label="wing-selector">
                {[
                  { key: 'diagnostic',  label: 'Diagnostic',   tip: 'Audiology tests (PTA, Impedance, OAE, etc.)' },
                  { key: 'hearing_aid', label: 'Hearing Aid',  tip: 'HA fitting / trial / repair / sale — routes to Hearing Aid module' },
                ].map((w) => (
                  <button key={w.key} type="button" onClick={() => {
                    setWing(w.key);
                    // Flipping wings clears chips from the other side so we
                    // don't send stale selections to the backend.
                    if (w.key === 'diagnostic') setHearingAidServices([]);
                    else setRecommendedTests([]);
                    // Reset duration override so it re-syncs to new chips.
                    setDurationManuallySet(false);
                  }} title={w.tip}
                    data-testid={`bk-wing-${w.key}`}
                    className={`flex-1 px-2 py-1 text-[11px] font-semibold rounded border transition-colors ${
                      wing === w.key
                        ? 'bg-teal-600 text-white border-teal-700 shadow-sm'
                        : 'bg-white text-slate-700 border-slate-300 hover:border-teal-300 hover:bg-teal-50'
                    }`}>
                    {w.label}
                  </button>
                ))}
              </div>
            )}
            {wing === 'hearing_aid' && visitType !== 'consultation' && (
              <div className="mb-2 px-2 py-1 text-[10px] text-teal-800 bg-teal-50 border border-teal-200 rounded" data-testid="bk-wing-ha-hint">
                This booking will be routed to the <b>Hearing Aid</b> module.
              </div>
            )}

            {/* Visit type — 3 cases requested by the user */}
            <div className="flex gap-1 mb-2" role="radiogroup" aria-label="visit-type">
              {[
                { key: 'walkin', label: 'Walk-in', tip: 'Direct walk-in — pick the specific test(s) to run.' },
                { key: 'referral', label: 'Referral', tip: 'ENT / doctor referral with specific tests recommended.' },
                { key: 'consultation', label: 'Consultation', tip: 'Enquiry — audiologist decides tests after consult.' },
              ].map((v) => (
                <button key={v.key} type="button" onClick={() => setVisitType(v.key)} title={v.tip}
                  data-testid={`bk-visit-${v.key}`}
                  className={`flex-1 px-2 py-1 text-[11px] font-semibold rounded border transition-colors ${
                    visitType === v.key
                      ? 'bg-indigo-600 text-white border-indigo-700 shadow-sm'
                      : 'bg-white text-slate-700 border-slate-300 hover:border-indigo-300 hover:bg-indigo-50'
                  }`}>
                  {v.label}
                </button>
              ))}
            </div>

            {/* Referred-by line — only for referral. Uses ReferringDoctorPicker
                so any newly typed doctor name gets auto-added to the master
                list under Settings → Referral Doctors. */}
            {visitType === 'referral' && (
              <div className="mb-2" data-testid="bk-referred-by">
                <ReferringDoctorPicker
                  value={referringDoctorId}
                  onChange={(id, doc) => {
                    setReferringDoctorId(id);
                    setReferredBy(doc ? `${doc.name}${doc.clinic ? ` (${doc.clinic})` : ''}` : '');
                  }}
                  testid="bk-referred-by-picker"
                />
              </div>
            )}

            {/* Test / HA chip-picker — hidden for consultation (audiologist decides).
                DIAGNOSTIC wing → PTA / IMP / OAE etc. HEARING AID wing → HA Fitting
                / Trial / Sale / Ear Mould etc. Each chip shows the catalog price
                inline (looked up via `chipPrice`). Toggling drives BOTH the
                audiologist's pre-checked test tabs and the inline invoice draft. */}
            {visitType !== 'consultation' ? (
              wing === 'hearing_aid' ? (
                <div>
                  <div className="text-[10px] text-slate-500 mb-1">
                    Pick the HA services for this visit — auto-fills the invoice and routes to the Hearing Aid module.
                  </div>
                  <div className="flex flex-wrap gap-1" data-testid="bk-ha-services">
                    {HA_SERVICE_OPTIONS.map((t) => {
                      const on = hearingAidServices.includes(t.key);
                      const price = chipPrice(t.key, HA_BY_KEY);
                      return (
                        <button key={t.key} type="button" onClick={() => toggleHaService(t.key)}
                          data-testid={`bk-ha-${t.key}`}
                          title={price != null ? `${t.label} · ₹${price.toLocaleString('en-IN')}` : t.label}
                          className={`px-2 py-0.5 text-[10px] font-semibold rounded-full border transition-colors ${
                            on
                              ? 'bg-teal-600 text-white border-teal-700'
                              : 'bg-white text-slate-600 border-slate-300 hover:border-teal-400 hover:bg-teal-50'
                          }`}>
                          {on ? '✓ ' : ''}{t.label}
                          {price != null && price > 0 && (
                            <span className={`ml-1 tabular-nums ${on ? 'text-teal-100' : 'text-slate-400'}`}>
                              · ₹{price.toLocaleString('en-IN')}
                            </span>
                          )}
                        </button>
                      );
                    })}
                  </div>
                </div>
              ) : (
                <div>
                  <div className="text-[10px] text-slate-500 mb-1">
                    Pick the tests for this visit — auto-fills the invoice and pre-checks the audiologist's tabs.
                  </div>
                  <div className="flex flex-wrap gap-1" data-testid="bk-recommended-tests">
                    {FRONTDESK_TEST_OPTIONS.map((t) => {
                      const on = recommendedTests.includes(t.key);
                      const price = chipPrice(t.key);
                      return (
                        <button key={t.key} type="button" onClick={() => toggleRecTest(t.key)}
                          data-testid={`bk-rec-${t.key}`}
                          title={price != null ? `${t.label} · ₹${price.toLocaleString('en-IN')}` : t.label}
                          className={`px-2 py-0.5 text-[10px] font-semibold rounded-full border transition-colors ${
                            on
                              ? 'bg-sky-600 text-white border-sky-700'
                              : 'bg-white text-slate-600 border-slate-300 hover:border-sky-400 hover:bg-sky-50'
                          }`}>
                          {on ? '✓ ' : ''}{t.label}
                          {price != null && (
                            <span className={`ml-1 tabular-nums ${on ? 'text-sky-100' : 'text-slate-400'}`}>
                              · ₹{price.toLocaleString('en-IN')}
                            </span>
                          )}
                        </button>
                      );
                    })}
                  </div>
                </div>
              )
            ) : (
              <div className="px-2 py-1.5 text-[11px] text-violet-700 bg-violet-50 border border-violet-200 rounded italic" data-testid="bk-consultation-note">
                The audiologist will decide which tests to run after speaking with the patient.
              </div>
            )}
          </div>

          {/* ==================== INLINE INVOICE DRAFT ==================== */}
          {!isEdit && visitType !== 'consultation' && (
            <div className="pt-1.5 border-t border-dashed border-slate-200" data-testid="bk-invoice-block">
              <div className="flex items-center gap-2 mb-1.5">
                <span className="text-[10px] font-bold text-slate-700 uppercase tracking-wider">Invoice — raised on save</span>
                <div className="flex-1 h-px bg-slate-200" />
                <label className="flex items-center gap-1 text-[10px] text-slate-600 cursor-pointer" title="Uncheck to book the appointment without raising an invoice (rare — follow-up visits, warranty)">
                  <input
                    type="checkbox"
                    checked={raiseInvoice}
                    onChange={(e) => setRaiseInvoice(e.target.checked)}
                    data-testid="bk-raise-invoice-toggle"
                    className="w-3 h-3"
                  />
                  Raise invoice
                </label>
              </div>

              {raiseInvoice && invoiceLines.length === 0 && (
                <div className="px-2 py-1.5 text-[11px] text-slate-500 italic bg-slate-50 border border-slate-200 rounded" data-testid="bk-invoice-empty">
                  Tick tests above to populate the invoice draft.
                </div>
              )}

              {raiseInvoice && invoiceLines.length > 0 && (
                <div className="border border-slate-200 rounded overflow-hidden" data-testid="bk-invoice-lines">
                  <table className="w-full text-[11px]">
                    <thead className="bg-slate-50 text-[9px] uppercase text-slate-500 tracking-wider">
                      <tr>
                        <th className="text-left px-2 py-1">Service</th>
                        <th className="text-right px-1 py-1 w-10">Qty</th>
                        <th className="text-right px-1 py-1 w-16">Price</th>
                        <th className="text-right px-1 py-1 w-24">Discount</th>
                        <th className="text-right px-2 py-1 w-20">Amount</th>
                        <th className="w-5" />
                      </tr>
                    </thead>
                    <tbody>
                      {invoiceLines.map((l) => {
                        const gross = Number(l.quantity || 1) * Number(l.unit_price || 0);
                        const dv = Number(l.discount_value || 0);
                        const disc = l.discount_type === 'percent'
                          ? Math.min(gross, gross * Math.max(0, Math.min(100, dv)) / 100)
                          : Math.max(0, Math.min(gross, dv));
                        const amount = Math.max(0, gross - disc);
                        return (
                          <tr key={l._key} className="border-t border-slate-100" data-testid={`bk-inv-line-${l._chip}`}>
                            <td className="px-2 py-1 truncate max-w-[140px]" title={l._unmapped ? `${l.name} — not in service catalog; ad-hoc line, edit price as needed` : l.name}>
                              {l.name}
                              {l._unmapped && (
                                <span className="ml-1 text-[8px] font-bold text-amber-700 bg-amber-100 border border-amber-200 rounded px-1 align-middle" title="This test isn't in your service catalog yet — line price is a default, edit it as needed.">
                                  AD-HOC
                                </span>
                              )}
                            </td>
                            <td className="px-1 py-1">
                              <input
                                type="number" min="1" step="1" value={l.quantity}
                                onChange={(e) => updateInvoiceLine(l._key, { quantity: e.target.value })}
                                className="w-full text-right text-[11px] border border-slate-200 rounded px-1 py-0.5 tabular-nums"
                              />
                            </td>
                            <td className="px-1 py-1">
                              <input
                                type="number" min="0" step="0.01" value={l.unit_price}
                                onChange={(e) => updateInvoiceLine(l._key, { unit_price: e.target.value })}
                                className="w-full text-right text-[11px] border border-slate-200 rounded px-1 py-0.5 tabular-nums"
                              />
                            </td>
                            <td className="px-1 py-1">
                              <div className="flex items-center gap-0.5">
                                <input
                                  type="number" min="0" value={l.discount_value}
                                  max={l.discount_type === 'percent' ? 100 : undefined}
                                  onChange={(e) => updateInvoiceLine(l._key, { discount_value: e.target.value })}
                                  className="w-full text-right text-[11px] border border-slate-200 rounded px-1 py-0.5 tabular-nums"
                                />
                                <button
                                  type="button"
                                  onClick={() => updateInvoiceLine(l._key, {
                                    discount_type: l.discount_type === 'percent' ? 'flat' : 'percent',
                                  })}
                                  className={`text-[9px] font-bold px-1 py-0.5 rounded border leading-none ${
                                    l.discount_type === 'percent'
                                      ? 'bg-emerald-600 text-white border-emerald-600'
                                      : 'bg-slate-100 text-slate-700 border-slate-300'
                                  }`}
                                >{l.discount_type === 'percent' ? '%' : '₹'}</button>
                              </div>
                            </td>
                            <td className="px-2 py-1 text-right font-semibold tabular-nums">₹{amount.toFixed(0)}</td>
                            <td className="px-1 py-1 text-center">
                              <button type="button" onClick={() => removeInvoiceLine(l._key)} className="text-slate-400 hover:text-rose-600 text-xs" title="Remove">×</button>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                    <tfoot className="bg-emerald-50 border-t border-emerald-200">
                      <tr>
                        <td colSpan="4" className="px-2 py-1 text-right text-[10px] uppercase font-bold text-emerald-900 tracking-wider">Draft total</td>
                        <td className="px-2 py-1 text-right font-bold text-emerald-900 tabular-nums" data-testid="bk-invoice-total">₹{invoiceTotal.toFixed(0)}</td>
                        <td />
                      </tr>
                    </tfoot>
                  </table>
                </div>
              )}
            </div>
          )}

          {err && <ErrorToast err={err} testid="bk-error" />}
        </div>

        <div className="px-3 py-2 border-t border-slate-200 bg-slate-50 flex items-center justify-between gap-2">
          <div className="flex-1 min-w-0">
            {!valid && !busy && (
              <div className="text-[10px] text-amber-700" data-testid="bk-missing-hint">
                Still needed: <span className="font-semibold">{missing.join(', ')}</span>
              </div>
            )}
          </div>
          <div className="flex items-center gap-2">
            <button onClick={onClose} className="px-3 py-1 text-xs text-slate-600 hover:bg-slate-100 rounded">Cancel</button>
            <button
              onClick={submit}
              disabled={!valid || busy}
              data-testid="bk-save"
              title={!valid ? `Still needed: ${missing.join(', ')}` : ''}
              className="px-3 py-1 text-xs bg-blue-600 hover:bg-blue-700 disabled:bg-slate-300 disabled:cursor-not-allowed text-white font-semibold rounded"
            >
              {busy ? 'Saving…' : (isEdit ? 'Save changes' : 'Book appointment')}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
