import { LABELS } from './constants';

// Builds a compact, prose-style Case History narrative from pre-test form data.
export const buildCaseHistoryNarrative = (patient, ch = {}) => {
  const parts = [];
  const hs = ch.hearing_specifics || {};
  const td = ch.tinnitus_detail || {};
  const dd = ch.dizziness_detail || {};
  const ne = ch.noise_exposure || {};
  const fh = ch.family_history || {};
  const mh = ch.medical_history || {};
  const ha = ch.hearing_aid_history || {};

  const demog = `${patient.age}-y/o ${patient.gender?.toLowerCase() || ''}`.trim();
  const complaint = ch.chief_complaint ? `c/o ${ch.chief_complaint.toLowerCase()}` : 'presenting for evaluation';
  const duration = ch.duration ? ` × ${ch.duration}` : '';
  const onset = ch.onset ? `, ${LABELS.onset[ch.onset].toLowerCase()} onset` : '';
  const ear = ch.affected_ear ? `, ${LABELS.ear[ch.affected_ear].toLowerCase()} side` : '';
  parts.push(`${demog}, ${complaint}${duration}${onset}${ear}.`);

  // Symptoms
  const syms = [];
  if (ch.tinnitus) syms.push('tinnitus');
  if (ch.vertigo) syms.push('vertigo');
  if (ch.otalgia) syms.push('otalgia');
  if (ch.otorrhea) syms.push('otorrhea');
  if (hs.aural_fullness) syms.push('aural fullness');
  if (syms.length) parts.push(`Associated symptoms: ${syms.join(', ')}.`);

  // Hearing specifics
  const hsBits = [];
  if (hs.progression) hsBits.push(`${LABELS.progression[hs.progression]} hearing loss`);
  if (hs.better_ear && hs.better_ear !== 'same') hsBits.push(`better hearing in ${hs.better_ear} ear`);
  if (hs.prior_test) hsBits.push(`previous audiometry${hs.prior_test_details ? ` (${hs.prior_test_details})` : ''}`);
  if (hs.earache_drainage_3mo) hsBits.push('recent earache/drainage');
  if (hsBits.length) parts.push(`${hsBits.join('; ')}.`);

  // Tinnitus detail
  if (ch.tinnitus && (td.ear || td.frequency || td.bothersome)) {
    const tinBits = [];
    if (td.ear) tinBits.push(`${td.ear} ear`);
    if (td.frequency) tinBits.push(td.frequency);
    if (td.bothersome) tinBits.push(`bothersome: ${td.bothersome}`);
    if (td.sound_description) tinBits.push(`"${td.sound_description}"`);
    parts.push(`Tinnitus: ${tinBits.join(', ')}.`);
  }

  // Dizziness
  if (dd.falls_12mo || dd.dizzy_today || (dd.associated_symptoms || []).length) {
    const dzBits = [];
    if (dd.dizzy_today) dzBits.push('dizzy today');
    if ((dd.associated_symptoms || []).length) dzBits.push(`associated: ${dd.associated_symptoms.join(', ')}`);
    if (dd.falls_12mo) dzBits.push(`${dd.falls_count ?? 'recurrent'} fall(s) in last 12 mo${dd.falls_injured ? ' with injury' : ''}`);
    parts.push(`Balance: ${dzBits.join('; ')}.`);
  }

  // Noise
  if (ne.exposed) parts.push(`Noise exposure: ${ne.description || 'yes'}.`);

  // Family
  if (fh.hearing_loss_in_family === 'yes') parts.push(`Family history of hearing loss${fh.description ? ` (${fh.description})` : ''}.`);

  // Medical
  const medBits = [];
  if (mh.prior_head_neck_surgery) medBits.push(`prior head/neck surgery${mh.prior_head_neck_surgery_details ? ` (${mh.prior_head_neck_surgery_details})` : ''}`);
  if (mh.head_trauma) medBits.push(`head trauma${mh.head_trauma_details ? ` (${mh.head_trauma_details})` : ''}`);
  if ((mh.conditions || []).length) medBits.push(`comorbidities: ${mh.conditions.map((c) => LABELS.cond[c] || c).join(', ')}`);
  if (mh.medications) medBits.push(`medications: ${mh.medications}`);
  if (medBits.length) parts.push(`Medical hx: ${medBits.join('; ')}.`);

  // Hearing aid
  if (ha.ever_used || ha.currently_using) {
    parts.push(`Hearing aid: ${ha.currently_using ? 'currently using' : 'past use'}${ha.ear ? ` (${ha.ear})` : ''}${ha.years_of_use ? `, ${ha.years_of_use}` : ''}.`);
  }

  if (ch.notes) parts.push(ch.notes);

  return parts.join(' ');
};
