"""AI-powered clinical narrative generation for audiology reports.

Uses Emergent LLM Key + Claude Sonnet 4.5 via emergentintegrations.
Produces structured JSON findings for the Report Builder:
  - puretone_findings
  - immitence_findings
  - speech_findings
  - recommendations (list[str])
  - further_advice
"""
from __future__ import annotations

import json
import os
import re
from typing import Any, Dict, List, Optional
from uuid import uuid4

from emergentintegrations.llm.chat import LlmChat, UserMessage


# ==================== CLINICAL DATA SUMMARISER ====================
# Condenses the raw TestSession dict into a compact, LLM-friendly clinical brief.

_FREQ_ORDER = [250, 500, 1000, 2000, 4000, 8000]


def _fmt_thresholds(measurements: Optional[List[dict]]) -> str:
    """Formats a list of measurement dicts as '250:15 500:20 1k:25 …' (dB)."""
    if not measurements:
        return "(no data)"
    by_f = {m.get("frequency"): m for m in measurements if m.get("frequency") is not None}
    parts = []
    for f in _FREQ_ORDER:
        m = by_f.get(f)
        if not m:
            continue
        db = m.get("threshold_db")
        if db is None:
            continue
        tag = f"{f // 1000}k" if f >= 1000 else str(f)
        marker = "NR" if m.get("no_response") else f"{db}"
        masked = "m" if m.get("masked") else ""
        parts.append(f"{tag}:{marker}{masked}")
    return " ".join(parts) if parts else "(no data)"


def _pta(measurements: Optional[List[dict]]) -> Optional[float]:
    """3-freq PTA (500/1k/2k) from AC measurements, ignoring NR."""
    if not measurements:
        return None
    by_f = {m.get("frequency"): m for m in measurements}
    vals = []
    for f in (500, 1000, 2000):
        m = by_f.get(f)
        if m and m.get("threshold_db") is not None and not m.get("no_response"):
            vals.append(m["threshold_db"])
    if len(vals) < 2:
        return None
    return round(sum(vals) / len(vals), 1)


def _fmt_tymp(ear_dict: Optional[dict]) -> str:
    if not ear_dict:
        return "(no data)"
    t = ear_dict.get("jerger_type") or "—"
    p = ear_dict.get("me_pressure")
    c = ear_dict.get("compliance")
    v = ear_dict.get("volume")
    probe = ear_dict.get("probe_hz", 226)
    bits = [f"Type {t}" if t else ""]
    if p is not None:
        bits.append(f"MEP {p} daPa")
    if c is not None:
        bits.append(f"SC {c} mL")
    if v is not None:
        bits.append(f"ECV {v} mL")
    bits.append(f"probe {probe} Hz")
    return ", ".join(b for b in bits if b)


def _fmt_reflex(reflex_ear: Optional[dict]) -> str:
    """Summarise reflex presence per stimulus ear. Returns e.g. 'ipsi 500-4k present, 6k NR'."""
    if not reflex_ear:
        return ""
    lines = []
    for side in ("ipsi", "contra"):
        freqs = (reflex_ear.get(side) or {}).get("freqs") or {}
        if not freqs:
            continue
        present, absent = [], []
        for f, cell in freqs.items():
            lvl = (cell or {}).get("level")
            if not lvl:
                continue
            if re.search(r"(?i)nr|cnt|absent|no[_\s-]?response", str(lvl)):
                absent.append(f)
            else:
                present.append(f"{f}:{lvl}")
        parts = []
        if present:
            parts.append("present[" + ", ".join(present) + "]")
        if absent:
            parts.append("absent[" + ", ".join(absent) + "]")
        if parts:
            lines.append(f"{side}: " + "; ".join(parts))
    return " | ".join(lines)


def _fmt_case_history(ch: Optional[dict]) -> str:
    if not ch:
        return "(none)"
    bits = []
    if ch.get("chief_complaint"):
        bits.append(f"CC: {ch['chief_complaint']}")
    if ch.get("duration"):
        bits.append(f"duration {ch['duration']}")
    if ch.get("onset"):
        bits.append(f"onset {ch['onset']}")
    if ch.get("affected_ear"):
        bits.append(f"ear {ch['affected_ear']}")
    flags = [k for k in ("tinnitus", "vertigo", "otalgia", "otorrhea") if ch.get(k)]
    if flags:
        bits.append("symptoms: " + ", ".join(flags))
    ne = ch.get("noise_exposure") or {}
    if ne.get("exposed"):
        bits.append("noise exposure +" + (f" ({ne['description']})" if ne.get("description") else ""))
    mh = ch.get("medical_history") or {}
    conds = mh.get("conditions") or []
    if conds:
        bits.append("hx: " + ", ".join(conds))
    return "; ".join(bits) if bits else "(none)"


def _fmt_fields_dict(d: Optional[dict]) -> str:
    """Compacts the schema-free {fields: {k: v}} or nested {section: {k: v}} dicts."""
    if not d:
        return ""
    if isinstance(d, dict) and "fields" in d and isinstance(d["fields"], dict):
        d = d["fields"]
    pairs = []
    for k, v in d.items():
        if isinstance(v, dict):
            inner = ", ".join(f"{kk}={vv}" for kk, vv in v.items() if vv not in (None, "", False))
            if inner:
                pairs.append(f"{k}:{{{inner}}}")
        elif v not in (None, "", False):
            pairs.append(f"{k}={v}")
    return "; ".join(pairs)


def build_clinical_brief(session: dict, patient: Optional[dict]) -> str:
    """Compact human-readable brief of everything the clinician has entered."""
    lines: List[str] = []

    if patient:
        lines.append(
            f"PATIENT: {patient.get('name','?')}, "
            f"{patient.get('age','?')}{patient.get('gender','')[:1] if patient.get('gender') else ''}"
        )

    # Case history
    pre = session.get("pre_test_data") or {}
    lines.append(f"CASE HISTORY: {_fmt_case_history(pre.get('case_history'))}")

    # Otoscopy
    oto = (pre.get("otoscopy") or {})
    oto_bits = []
    for ear in ("right", "left"):
        e = oto.get(ear) or {}
        s = ", ".join(f"{k}:{v}" for k, v in e.items() if k != "image_base64" and v)
        if s:
            oto_bits.append(f"{ear[0].upper()}:{s}")
    if oto_bits:
        lines.append("OTOSCOPY: " + " | ".join(oto_bits))

    # Tuning fork
    tf = pre.get("tuning_fork") or {}
    tf_bits = []
    for k in ("frequency_hz", "rinne_right", "rinne_left", "weber"):
        if tf.get(k):
            tf_bits.append(f"{k}={tf[k]}")
    if tf_bits:
        lines.append("TUNING FORK: " + ", ".join(tf_bits))

    # Pure tone
    r = session.get("right_ear_audiogram") or {}
    lf = session.get("left_ear_audiogram") or {}
    lines.append(f"PTA R: AC[{_fmt_thresholds(r.get('ac_measurements'))}] BC[{_fmt_thresholds(r.get('bc_measurements'))}]")
    lines.append(f"PTA L: AC[{_fmt_thresholds(lf.get('ac_measurements'))}] BC[{_fmt_thresholds(lf.get('bc_measurements'))}]")
    pta_r = _pta(r.get("ac_measurements"))
    pta_l = _pta(lf.get("ac_measurements"))
    if pta_r is not None or pta_l is not None:
        lines.append(f"PTA avg (500/1k/2k): R={pta_r if pta_r is not None else '—'}  L={pta_l if pta_l is not None else '—'}")

    # Impedance
    imp = session.get("impedance_data") or {}
    tymp = imp.get("tympanometry") or {}
    lines.append(f"TYMP R: {_fmt_tymp(tymp.get('right'))}")
    lines.append(f"TYMP L: {_fmt_tymp(tymp.get('left'))}")
    ar = imp.get("acoustic_reflex") or {}
    if ar.get("enabled"):
        lines.append(f"REFLEX R: {_fmt_reflex(ar.get('right'))}")
        lines.append(f"REFLEX L: {_fmt_reflex(ar.get('left'))}")
    rd = imp.get("reflex_decay") or {}
    if rd.get("enabled"):
        lines.append(f"REFLEX DECAY R: {_fmt_reflex(rd.get('right'))}")
        lines.append(f"REFLEX DECAY L: {_fmt_reflex(rd.get('left'))}")

    # Speech
    sp = session.get("speech_data") or {}
    sp_fields = _fmt_fields_dict(sp.get("fields"))
    if sp_fields:
        lines.append(f"SPEECH: {sp_fields}")
    for ch, label in (("wrs_right", "WRS R"), ("wrs_left", "WRS L"),
                      ("wrs_soundfield", "WRS SF"), ("wrs_soundfield_aided", "WRS SFA")):
        pts = sp.get(ch) or []
        if pts:
            s = ", ".join(f"{p.get('db_hl')}dB:{p.get('percent')}%" for p in pts)
            lines.append(f"{label}: {s}")

    # P2 tabs — each has {fields: {section: {k: v}}}
    for key, label in [
        ("special_tests_data", "SPECIAL TESTS"),
        ("oae_data", "OAE"),
        ("soundfield_data", "SOUND FIELD"),
        ("abr_data", "ABR/ASSR"),
        ("pediatric_data", "PEDIATRIC"),
        ("tinnitus_data", "TINNITUS"),
    ]:
        s = _fmt_fields_dict(session.get(key))
        if s:
            lines.append(f"{label}: {s}")

    return "\n".join(lines)


# ==================== LLM PROMPT ====================

SYSTEM_PROMPT = """You are a senior clinical audiologist drafting narrative content for a formal patient
audiological evaluation report. You MUST output strict JSON only — no prose, no markdown, no code
fences — matching the schema described by the user. Follow these clinical conventions:

- Use **standard PTA descriptors**: Normal (≤25), Mild (26-40), Moderate (41-55),
  Moderately-Severe (56-70), Severe (71-90), Profound (>90).
- Classify configuration as Flat, Sloping, Rising, Notched, High-frequency, U-shape.
- Classify type as Conductive, Sensorineural, Mixed, or Normal (use ABG + BC + tymp).
- Use **Jerger tympanogram classification** (A, As, Ad, B, C) and comment on middle-ear status.
- Tone: Puretone/Immitence/Speech findings = concise clinical terminology, audiologist-to-audiologist,
  numbers where helpful. Recommendations + Further Advice = patient-respectful hybrid language
  (clinical accuracy with a plain-language framing).
- If data for a requested field is missing/empty, return an empty string "" for that field
  (or [] for recommendations) rather than making up values.
- Never hallucinate thresholds, types, or findings not present in the provided brief.
- Keep each findings paragraph tight: 1-3 sentences max.
- Recommendations: 3-5 bullet items maximum, each a complete single sentence.
- Further Advice (ENT): only mention if warranted by the data (e.g., asymmetry, conductive
  component, abnormal tymps, sudden onset, otorrhea, acoustic reflex patterns suggesting
  retrocochlear). Otherwise return "".
"""


def _build_user_prompt(brief: str, target: str) -> str:
    schemas = {
        "all": """Return JSON with ALL of these keys:
{
  "puretone_findings": "string — 1-3 sentence clinical summary of PTA findings bilaterally: degree + type + configuration + ABG + asymmetry",
  "immitence_findings": "string — 1-3 sentence summary of tympanograms (Jerger type) + ME pressure + reflexes if tested",
  "speech_findings": "string — 1-3 sentence summary of SRT/SAT consistency with PTA + WRS + aided/noise performance (only if speech data provided, else \\"\\")",
  "recommendations": ["bullet 1", "bullet 2", "... up to 5"],
  "further_advice": "string — ENT referral rationale only if clinically warranted, else \\"\\""
}""",
        "puretone_findings": """Return JSON: { "puretone_findings": "1-3 sentence clinical summary of PTA findings bilaterally (degree, type, configuration, ABG, asymmetry)" }""",
        "immitence_findings": """Return JSON: { "immitence_findings": "1-3 sentence summary of tympanograms (Jerger A/As/Ad/B/C), middle-ear pressure, ECV, and acoustic reflex pattern if tested" }""",
        "speech_findings": """Return JSON: { "speech_findings": "1-3 sentence summary of speech audiometry — SRT/SAT consistency with PTA, word recognition in quiet, aided and in-noise performance. If no speech data, return empty string." }""",
        "recommendations": """Return JSON: { "recommendations": ["3-5 concise patient-directed recommendation sentences"] }""",
        "further_advice": """Return JSON: { "further_advice": "ENT referral rationale when clinically warranted — asymmetric loss, conductive/mixed component, Type B/C tymps, abnormal reflex pattern, sudden onset, otorrhea. Otherwise empty string." }""",
    }
    schema = schemas.get(target, schemas["all"])
    return f"""CLINICAL BRIEF:
---
{brief}
---

TASK: Draft the report narrative for target field(s): {target}.

{schema}

Respond with strict JSON only. No commentary."""


def _extract_json(text: str) -> Dict[str, Any]:
    """Extract the first JSON object from the LLM response (even if wrapped in fences)."""
    if not text:
        return {}
    text = text.strip()
    # Strip markdown fences if present
    text = re.sub(r"^```(?:json)?\s*", "", text)
    text = re.sub(r"\s*```$", "", text)
    # Find first {...} block
    m = re.search(r"\{.*\}", text, re.DOTALL)
    if m:
        text = m.group(0)
    try:
        return json.loads(text)
    except Exception:
        return {}


# ==================== PUBLIC API ====================

VALID_TARGETS = {
    "all",
    "puretone_findings",
    "immitence_findings",
    "speech_findings",
    "recommendations",
    "further_advice",
}


async def generate_narrative(session: dict, patient: Optional[dict], target: str) -> Dict[str, Any]:
    """Call Claude Sonnet 4.5 via Emergent LLM Key and return a structured narrative dict.

    Keys present in the returned dict depend on `target`:
      - "all" → all 5 fields
      - otherwise → just the requested single field

    `recommendations` is always a list[str]; all other fields are strings.
    """
    if target not in VALID_TARGETS:
        raise ValueError(f"Invalid target '{target}'. Must be one of {sorted(VALID_TARGETS)}")

    api_key = os.environ.get("EMERGENT_LLM_KEY")
    if not api_key:
        raise RuntimeError("EMERGENT_LLM_KEY not configured")

    brief = build_clinical_brief(session or {}, patient)
    user_prompt = _build_user_prompt(brief, target)

    chat = LlmChat(
        api_key=api_key,
        session_id=f"audiology-narrative-{uuid4()}",
        system_message=SYSTEM_PROMPT,
    ).with_model("anthropic", "claude-sonnet-4-5-20250929")

    response_text = await chat.send_message(UserMessage(text=user_prompt))
    data = _extract_json(response_text)

    # Normalise types / ensure expected keys
    normalised: Dict[str, Any] = {}
    expected_keys = (
        ["puretone_findings", "immitence_findings", "speech_findings", "recommendations", "further_advice"]
        if target == "all"
        else [target]
    )
    for k in expected_keys:
        v = data.get(k, "")
        if k == "recommendations":
            if isinstance(v, str):
                v = [ln.strip(" -•\t") for ln in v.split("\n") if ln.strip()]
            elif not isinstance(v, list):
                v = []
        else:
            if isinstance(v, list):
                v = " ".join(str(x) for x in v)
            v = str(v).strip()
        normalised[k] = v

    normalised["_brief"] = brief  # useful for debugging / UI tooltip
    return normalised
