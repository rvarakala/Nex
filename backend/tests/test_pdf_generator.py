"""Regression tests for pdf_generator.

Ensures the refactored section-builders still produce valid PDFs for the
three shapes we see in the wild:
  * Happy path — fully populated session + patient.
  * Empty dicts — defensive fallback values everywhere.
  * Explicit-None fields — guards against 'NoneType has no attribute' bugs
    that previously bit ``.get(k, {})`` calls on keys that stored ``None``.
"""
from __future__ import annotations

from io import BytesIO
from typing import Any, Dict

import pytest

from pdf_generator import (
    _ear_results_text, _safe_dict, _safe_list,
    create_audiogram_report, generate_report_pdf,
)


PDF_MAGIC = b"%PDF-"


@pytest.fixture
def happy_session() -> Dict[str, Any]:
    return {
        "test_date": "2026-02-10T10:30:00",
        "test_reliability": "excellent",
        "test_methods": ["Headphones", "Bone"],
        "audiologist_name": "Dr. Regression",
        "audiologist_license": "RCI-ABCD12345",
        "right_ear_audiogram": {"pta_3freq": 35, "ac_measurements": [1, 2, 3, 4, 5, 6, 7], "bc_measurements": [1, 2, 3]},
        "left_ear_audiogram": {"pta_3freq": 40, "ac_measurements": [1, 2, 3, 4, 5], "bc_measurements": [1, 2]},
        "right_ear_speech": {"srt": 30, "wds_percent": 88, "mcl": 55, "ucl": 100},
        "left_ear_speech": {"srt": 35, "wds_percent": 92, "mcl": 60, "ucl": 100},
        "right_ear_degree": "mild", "right_ear_type": "conductive", "right_ear_config": "flat",
        "left_ear_degree": "moderate_severe", "left_ear_type": "sensorineural", "left_ear_config": "high_frequency",
        "clinical_impression": "Mild conductive loss right, moderate SNHL left.",
        "recommendations": ["Schedule hearing aid trial", "Return in 6 months for review"],
    }


@pytest.fixture
def happy_patient() -> Dict[str, Any]:
    return {
        "name": "Test Patient", "patient_id": "MRD-001", "age": 42,
        "gender": "Female", "dob": "1984-01-15", "phone": "+91-9876543210",
        "referring_physician": "Dr. Referral",
    }


class TestSafeAccessors:
    def test_safe_dict_returns_value_when_dict(self):
        assert _safe_dict({"a": {"x": 1}}, "a") == {"x": 1}

    def test_safe_dict_handles_none_value(self):
        assert _safe_dict({"a": None}, "a") == {}

    def test_safe_dict_handles_non_dict_value(self):
        assert _safe_dict({"a": "str"}, "a") == {}

    def test_safe_dict_handles_non_dict_arg(self):
        assert _safe_dict("not a dict", "a") == {}

    def test_safe_list_returns_list(self):
        assert _safe_list({"xs": [1, 2, 3]}, "xs") == [1, 2, 3]

    def test_safe_list_handles_none(self):
        assert _safe_list({"xs": None}, "xs") == []


class TestEarResultsText:
    def test_formats_snake_case_values(self):
        s = _ear_results_text({"right_ear_degree": "moderate_severe",
                               "right_ear_type": "mixed",
                               "right_ear_config": "high_frequency"}, "right")
        assert "Moderate Severe" in s
        assert "Mixed" in s
        assert "High Frequency" in s

    def test_defaults_when_not_classified(self):
        s = _ear_results_text({}, "left")
        assert s.count("Not Classified") == 3


class TestCreateAudiogramReport:
    def test_happy_path_returns_valid_pdf(self, happy_session, happy_patient):
        buf = create_audiogram_report(happy_session, happy_patient)
        assert isinstance(buf, BytesIO)
        assert buf.tell() == 0, "buffer must be rewound for the caller"
        pdf_bytes = buf.getvalue()
        assert pdf_bytes.startswith(PDF_MAGIC)
        assert len(pdf_bytes) > 2000  # realistic size floor

    def test_empty_inputs_do_not_crash(self):
        buf = create_audiogram_report({}, {})
        assert buf.getvalue().startswith(PDF_MAGIC)

    def test_none_values_do_not_crash(self):
        """Guards the 'explicit-None' bug class (the reason _safe_dict exists)."""
        session = {
            "right_ear_audiogram": {"pta_3freq": None, "ac_measurements": None},
            "left_ear_audiogram": None,        # entire key is None
            "right_ear_speech": {"srt": "", "wds_percent": None},
            "recommendations": None,
            "test_methods": None,
        }
        buf = create_audiogram_report(session, {"name": None, "age": None})
        assert buf.getvalue().startswith(PDF_MAGIC)

    def test_audiogram_images_branch(self, happy_session, happy_patient):
        """The ``audiogram_images`` branch should render an extra subheading."""
        buf = create_audiogram_report(
            happy_session, happy_patient,
            audiogram_images={"right": "data:image/png;base64,AAAA", "left": "data:image/png;base64,AAAA"},
        )
        assert buf.getvalue().startswith(PDF_MAGIC)

    def test_bad_test_date_falls_back_to_na(self, happy_patient):
        """Malformed ISO date should not raise."""
        buf = create_audiogram_report({"test_date": "not-a-date"}, happy_patient)
        assert buf.getvalue().startswith(PDF_MAGIC)


class TestGenerateReportPdfWrapper:
    def test_wrapper_delegates(self, happy_session, happy_patient):
        buf = generate_report_pdf("SES-123", happy_session, happy_patient)
        assert isinstance(buf, BytesIO)
        assert buf.getvalue().startswith(PDF_MAGIC)
