"""Professional audiological-report PDF generator.

The public API is unchanged (`create_audiogram_report`, `generate_report_pdf`);
internally the document build is split into single-purpose helpers so each
section is independently testable and the overall cyclomatic complexity drops
from 23 → ~5 in the orchestrator.

Public entry points
-------------------
* ``create_audiogram_report(session_data, patient_data, audiogram_images=None)``
    → returns a ``BytesIO`` containing the rendered PDF.
* ``generate_report_pdf(session_id, session_data, patient_data)``
    → thin logging wrapper kept for backwards compatibility with existing
    callers in ``server.py``.
"""
from __future__ import annotations

from datetime import datetime
from io import BytesIO
from typing import Any, Dict, List, Optional

from reportlab.lib import colors
from reportlab.lib.enums import TA_CENTER
from reportlab.lib.pagesizes import letter
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import inch
from reportlab.platypus import (
    Image, Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle,
)

# Type aliases — keeps helper signatures readable
StyleDict = Dict[str, ParagraphStyle]
Elements = List[Any]  # ReportLab accepts any Flowable here

BRAND_BLUE = colors.HexColor("#1a5490")
BRAND_LIGHT_BLUE = colors.HexColor("#2c5aa0")
MUTED_GREY = colors.HexColor("#444444")
PANEL_GREY = colors.HexColor("#f0f0f0")


# ---------------------------------------------------------------------------
# Safe accessors
# ---------------------------------------------------------------------------
def _safe_dict(d: Any, key: str) -> Dict[str, Any]:
    """Return ``d[key]`` if it is a dict, else ``{}``.

    Guards against the 'explicit-None' trap where ``dict.get(k, {})`` still
    returns ``None`` when the key exists but holds ``None``.
    """
    if not isinstance(d, dict):
        return {}
    v = d.get(key)
    return v if isinstance(v, dict) else {}


def _safe_list(d: Any, key: str) -> list:
    if not isinstance(d, dict):
        return []
    v = d.get(key)
    return v if isinstance(v, list) else []


# ---------------------------------------------------------------------------
# Styles
# ---------------------------------------------------------------------------
def _build_styles() -> StyleDict:
    """Return the fixed set of paragraph styles used across the report."""
    base = getSampleStyleSheet()
    return {
        "title": ParagraphStyle(
            "CustomTitle", parent=base["Heading1"],
            fontSize=18, textColor=BRAND_BLUE,
            spaceAfter=12, alignment=TA_CENTER, fontName="Helvetica-Bold",
        ),
        "heading": ParagraphStyle(
            "CustomHeading", parent=base["Heading2"],
            fontSize=14, textColor=BRAND_LIGHT_BLUE,
            spaceAfter=10, spaceBefore=15, fontName="Helvetica-Bold",
        ),
        "subheading": ParagraphStyle(
            "CustomSubheading", parent=base["Heading3"],
            fontSize=11, textColor=MUTED_GREY,
            spaceAfter=8, fontName="Helvetica-Bold",
        ),
        "body": ParagraphStyle(
            "CustomBody", parent=base["Normal"],
            fontSize=10, textColor=colors.black,
            spaceAfter=6, leading=14,
        ),
        "clinic_name": ParagraphStyle(
            "ClinicName", parent=base["Heading1"],
            fontSize=20, textColor=BRAND_BLUE,
            alignment=TA_CENTER, fontName="Helvetica-Bold",
        ),
        "clinic_info": ParagraphStyle(
            "ClinicInfo", parent=base["Normal"],
            fontSize=9, textColor=colors.HexColor("#666666"),
            alignment=TA_CENTER, spaceAfter=15,
        ),
        "footer": ParagraphStyle(
            "Footer", parent=base["Normal"],
            fontSize=8, textColor=colors.grey, alignment=TA_CENTER,
        ),
    }


# Shared table style helpers --------------------------------------------------
def _header_row_table_style() -> TableStyle:
    """Blue-header, bordered style used by PTA & speech tables."""
    return TableStyle([
        ("BACKGROUND", (0, 0), (-1, 0), BRAND_BLUE),
        ("TEXTCOLOR", (0, 0), (-1, 0), colors.whitesmoke),
        ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
        ("FONTSIZE", (0, 0), (-1, -1), 10),
        ("GRID", (0, 0), (-1, -1), 0.5, colors.grey),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("ALIGN", (1, 0), (-1, -1), "CENTER"),
        ("LEFTPADDING", (0, 0), (-1, -1), 8),
        ("TOPPADDING", (0, 0), (-1, -1), 6),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
    ])


def _info_table_style(grey_columns: tuple[int, ...] = (0,)) -> TableStyle:
    """Two-tone info-panel style (grey label columns + bordered cells)."""
    style = TableStyle([
        ("TEXTCOLOR", (0, 0), (-1, -1), colors.black),
        ("FONTSIZE", (0, 0), (-1, -1), 9),
        ("GRID", (0, 0), (-1, -1), 0.5, colors.grey),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("LEFTPADDING", (0, 0), (-1, -1), 8),
        ("RIGHTPADDING", (0, 0), (-1, -1), 8),
        ("TOPPADDING", (0, 0), (-1, -1), 6),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
    ])
    for col in grey_columns:
        style.add("BACKGROUND", (col, 0), (col, -1), PANEL_GREY)
        style.add("FONTNAME", (col, 0), (col, -1), "Helvetica-Bold")
    return style


# ---------------------------------------------------------------------------
# Section builders — each one mutates `elements` and returns None
# ---------------------------------------------------------------------------
def _build_header(elements: Elements, styles: StyleDict) -> None:
    """Letterhead: clinic name, contact line, brand rule, report title."""
    elements.append(Paragraph("<b>ACS AUDIOLOGY CLINIC</b>", styles["clinic_name"]))
    elements.append(Paragraph(
        "123 Hearing Street, Audiology City, AC 12345<br/>"
        "Phone: (555) 123-4567 | Email: info@acsaudiology.com<br/>"
        "RCI Registration: ACS-12345 | GSTIN: 27XXXXX1234X1ZX",
        styles["clinic_info"],
    ))
    elements.append(Spacer(1, 0.1 * inch))
    elements.append(Table(
        [[""]],
        colWidths=[7 * inch],
        style=TableStyle([("LINEABOVE", (0, 0), (-1, -1), 2, BRAND_BLUE)]),
    ))
    elements.append(Spacer(1, 0.2 * inch))
    elements.append(Paragraph("<b>AUDIOLOGICAL ASSESSMENT REPORT</b>", styles["title"]))
    elements.append(Spacer(1, 0.15 * inch))


def _format_test_date(raw: Optional[str]) -> str:
    """Safely format an ISO test date string into a human-readable form."""
    if not raw:
        return "N/A"
    try:
        return datetime.fromisoformat(raw).strftime("%d-%b-%Y %I:%M %p")
    except (ValueError, TypeError):
        return "N/A"


def _build_patient_info(
    elements: Elements,
    styles: StyleDict,
    patient_data: Dict[str, Any],
    session_data: Dict[str, Any],
) -> None:
    elements.append(Paragraph("PATIENT INFORMATION", styles["heading"]))
    rows = [
        ["Patient Name:", patient_data.get("name", "N/A"),
         "MRD Number:", patient_data.get("patient_id", "N/A")],
        ["Age:", f"{patient_data.get('age', 'N/A')} Years",
         "Gender:", patient_data.get("gender", "N/A")],
        ["Date of Birth:", patient_data.get("dob", "N/A"),
         "Phone:", patient_data.get("phone", "N/A")],
        ["Test Date:", _format_test_date(session_data.get("test_date")),
         "Referring Physician:", patient_data.get("referring_physician", "N/A")],
    ]
    table = Table(rows, colWidths=[1.5 * inch, 2 * inch, 1.5 * inch, 2 * inch])
    table.setStyle(_info_table_style(grey_columns=(0, 2)))
    elements.append(table)
    elements.append(Spacer(1, 0.2 * inch))


def _build_test_context(
    elements: Elements,
    styles: StyleDict,
    session_data: Dict[str, Any],
) -> None:
    elements.append(Paragraph("TEST CONTEXT", styles["heading"]))
    methods = session_data.get("test_methods") or ["Headphones"]
    rows = [
        ["Test Reliability:", (session_data.get("test_reliability") or "Good").capitalize()],
        ["Test Methods:", ", ".join(str(m) for m in methods)],
        ["Audiologist:", session_data.get("audiologist_name") or "Not specified"],
    ]
    table = Table(rows, colWidths=[2 * inch, 5 * inch])
    table.setStyle(_info_table_style(grey_columns=(0,)))
    elements.append(table)
    elements.append(Spacer(1, 0.2 * inch))


def _build_pure_tone_audiometry(
    elements: Elements,
    styles: StyleDict,
    session_data: Dict[str, Any],
    audiogram_images: Optional[Dict[str, str]],
) -> None:
    elements.append(Paragraph("PURE TONE AUDIOMETRY", styles["heading"]))

    if audiogram_images:
        elements.append(Paragraph("Audiograms", styles["subheading"]))
        # Production TODO: decode base64 images. Placeholder retained for now.
        elements.append(Paragraph(
            "<i>Audiogram charts would be embedded here from the canvas images</i>",
            styles["body"],
        ))
        elements.append(Spacer(1, 0.1 * inch))

    right = _safe_dict(session_data, "right_ear_audiogram")
    left = _safe_dict(session_data, "left_ear_audiogram")

    def _fmt_pta(ear: Dict[str, Any]) -> str:
        v = ear.get("pta_3freq")
        return f"{v} dB" if v is not None else "--"

    rows = [
        ["Measurement", "Right Ear", "Left Ear"],
        ["3-Frequency PTA", _fmt_pta(right), _fmt_pta(left)],
        ["AC Thresholds",
         f"{len(_safe_list(right, 'ac_measurements'))} frequencies tested",
         f"{len(_safe_list(left, 'ac_measurements'))} frequencies tested"],
        ["BC Thresholds",
         f"{len(_safe_list(right, 'bc_measurements'))} frequencies tested",
         f"{len(_safe_list(left, 'bc_measurements'))} frequencies tested"],
    ]
    table = Table(rows, colWidths=[2.5 * inch, 2.25 * inch, 2.25 * inch])
    table.setStyle(_header_row_table_style())
    elements.append(table)
    elements.append(Spacer(1, 0.2 * inch))


def _build_speech_audiometry(
    elements: Elements,
    styles: StyleDict,
    session_data: Dict[str, Any],
) -> None:
    elements.append(Paragraph("SPEECH AUDIOMETRY", styles["heading"]))
    right = _safe_dict(session_data, "right_ear_speech")
    left = _safe_dict(session_data, "left_ear_speech")

    def _db(ear: Dict[str, Any], key: str) -> str:
        v = ear.get(key)
        return f"{v} dB" if v is not None and v != "" else "--"

    def _pct(ear: Dict[str, Any], key: str) -> str:
        v = ear.get(key)
        return f"{v}%" if v is not None and v != "" else "--"

    rows = [
        ["Test", "Right Ear", "Left Ear"],
        ["SRT (Speech Reception Threshold)", _db(right, "srt"), _db(left, "srt")],
        ["WDS (Word Discrimination Score)", _pct(right, "wds_percent"), _pct(left, "wds_percent")],
        ["MCL (Most Comfortable Level)", _db(right, "mcl"), _db(left, "mcl")],
        ["UCL (Uncomfortable Level)", _db(right, "ucl"), _db(left, "ucl")],
    ]
    table = Table(rows, colWidths=[3 * inch, 2 * inch, 2 * inch])
    table.setStyle(_header_row_table_style())
    elements.append(table)
    elements.append(Spacer(1, 0.2 * inch))


def _ear_results_text(session_data: Dict[str, Any], ear: str) -> str:
    """Render the degree / type / configuration block for a given ear ('left' or 'right')."""
    def _val(key: str) -> str:
        v = session_data.get(f"{ear}_ear_{key}") or "Not classified"
        return v.replace("_", " ").title()
    return (
        f"<b>Degree:</b> {_val('degree')}<br/>"
        f"<b>Type:</b> {_val('type')}<br/>"
        f"<b>Configuration:</b> {_val('config')}"
    )


def _build_results_and_impression(
    elements: Elements,
    styles: StyleDict,
    session_data: Dict[str, Any],
) -> None:
    elements.append(Paragraph("RESULTS & INTERPRETATION", styles["heading"]))

    elements.append(Paragraph("Right Ear", styles["subheading"]))
    elements.append(Paragraph(_ear_results_text(session_data, "right"), styles["body"]))
    elements.append(Spacer(1, 0.1 * inch))

    elements.append(Paragraph("Left Ear", styles["subheading"]))
    elements.append(Paragraph(_ear_results_text(session_data, "left"), styles["body"]))
    elements.append(Spacer(1, 0.15 * inch))

    impression = session_data.get("clinical_impression")
    if impression:
        elements.append(Paragraph("Clinical Impression", styles["subheading"]))
        elements.append(Paragraph(impression, styles["body"]))
        elements.append(Spacer(1, 0.15 * inch))


def _build_recommendations(
    elements: Elements,
    styles: StyleDict,
    session_data: Dict[str, Any],
) -> None:
    recs = session_data.get("recommendations") or []
    if not recs:
        return
    elements.append(Paragraph("RECOMMENDATIONS", styles["heading"]))
    body = "<br/>".join(f"\u2022 {r}" for r in recs)
    elements.append(Paragraph(body, styles["body"]))
    elements.append(Spacer(1, 0.2 * inch))


def _build_signature_and_footer(
    elements: Elements,
    styles: StyleDict,
    session_data: Dict[str, Any],
    signature_png: Optional[bytes] = None,
    seal_png: Optional[bytes] = None,
) -> None:
    elements.append(Spacer(1, 0.3 * inch))

    # Build the image flowable cells lazily — ReportLab's `Image` from a
    # BytesIO is fine, but we don't want to instantiate one if the user has
    # no signature/seal on file (the placeholder underline reads cleaner).
    def _img(blob: bytes, max_h_in: float, max_w_in: float):
        try:
            return Image(BytesIO(blob), width=max_w_in * inch, height=max_h_in * inch, kind="proportional")
        except Exception:
            # Bad blob — fall back to the underline rather than crashing
            # report generation. The user can still read the typed name.
            return ""

    sig_cell = _img(signature_png, 0.55, 2.6) if signature_png else "_____________________"
    seal_cell = _img(seal_png, 0.95, 1.2) if seal_png else ""

    # Two-column layout. Left column: signature image (or underline) stacked
    # over the audiologist name + license. Right column: an optional seal
    # image floats above the date so we keep the same visual rhythm as the
    # plain (pre-seal) report when no seal is configured.
    signature_rows = [
        [sig_cell, seal_cell],
        [session_data.get("audiologist_name", "Audiologist Name"),
         f"Date: {datetime.now().strftime('%d-%b-%Y')}"],
        ["Audiologist",
         "Signed & sealed" if (signature_png and seal_png) else ""],
        [session_data.get("audiologist_license", "License: RCI-XXXXX"), ""],
    ]
    table = Table(signature_rows, colWidths=[4.0 * inch, 3.0 * inch])
    table.setStyle(TableStyle([
        ("FONTSIZE", (0, 0), (-1, -1), 9),
        ("ALIGN", (0, 0), (0, -1), "LEFT"),
        ("ALIGN", (1, 0), (1, -1), "RIGHT"),
        ("VALIGN", (0, 0), (-1, 0), "BOTTOM"),
        ("VALIGN", (0, 1), (-1, -1), "TOP"),
        ("TOPPADDING", (0, 0), (-1, -1), 3),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 3),
        # Subtle baseline under the signature cell so the eye still tracks the
        # signing area even when no image is embedded.
        ("LINEBELOW", (0, 0), (0, 0), 0.5, MUTED_GREY) if not signature_png else
            ("LINEBELOW", (0, 0), (0, 0), 0, colors.transparent),
    ]))
    elements.append(table)

    elements.append(Spacer(1, 0.2 * inch))
    elements.append(Paragraph(
        "<i>This is a computer-generated report. For any queries, please contact the clinic.</i>",
        styles["footer"],
    ))


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------
def create_audiogram_report(
    session_data: Dict[str, Any],
    patient_data: Dict[str, Any],
    audiogram_images: Optional[Dict[str, str]] = None,
    signature_png: Optional[bytes] = None,
    seal_png: Optional[bytes] = None,
) -> BytesIO:
    """Generate a professional audiological report PDF.

    Args:
        session_data: Test-session payload (audiograms, speech, results, recommendations).
        patient_data: Patient demographics (name, age, MRD, etc).
        audiogram_images: Optional dict ``{'right': <base64>, 'left': <base64>}``.
        signature_png: Optional raw PNG/JPEG bytes of the signing audiologist's
            signature. Embedded above the typed name when present.
        seal_png: Optional raw PNG/JPEG bytes of the user's official seal.
            Embedded on the right of the signature row when present AND the
            user has opted in to "audiogram" in their seal placement prefs.

    Returns:
        A ``BytesIO`` buffer positioned at 0, ready to stream back as a response.
    """
    buffer = BytesIO()
    doc = SimpleDocTemplate(
        buffer,
        pagesize=letter,
        rightMargin=0.75 * inch,
        leftMargin=0.75 * inch,
        topMargin=1 * inch,
        bottomMargin=0.75 * inch,
    )
    styles = _build_styles()
    elements: Elements = []

    _build_header(elements, styles)
    _build_patient_info(elements, styles, patient_data, session_data)
    _build_test_context(elements, styles, session_data)
    _build_pure_tone_audiometry(elements, styles, session_data, audiogram_images)
    _build_speech_audiometry(elements, styles, session_data)
    _build_results_and_impression(elements, styles, session_data)
    _build_recommendations(elements, styles, session_data)
    _build_signature_and_footer(elements, styles, session_data,
                                 signature_png=signature_png,
                                 seal_png=seal_png)

    doc.build(elements)
    buffer.seek(0)
    return buffer


def generate_report_pdf(
    session_id: str,
    session_data: Dict[str, Any],
    patient_data: Dict[str, Any],
    signature_png: Optional[bytes] = None,
    seal_png: Optional[bytes] = None,
) -> BytesIO:
    """Thin wrapper kept for backwards compatibility. Returns the PDF buffer."""
    try:
        return create_audiogram_report(
            session_data, patient_data,
            signature_png=signature_png, seal_png=seal_png,
        )
    except Exception as e:
        # Keep the legacy print-then-raise behaviour so callers see the trace.
        print(f"Error generating PDF (session {session_id}): {e}")
        raise
