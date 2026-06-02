"""CSV export endpoints for Patients + Invoices "Export this view" buttons."""
import requests

from _helpers import API, ADMIN_EMAIL, ADMIN_PASSWORD, login, H


def _bearer():
    return login(ADMIN_EMAIL, ADMIN_PASSWORD)


def test_patients_export_csv_returns_streaming_csv():
    tok = _bearer()
    r = requests.get(f"{API}/patients/export.csv", headers=H(tok))
    assert r.status_code == 200, r.text
    ctype = r.headers.get("content-type", "")
    assert ctype.startswith("text/csv"), f"unexpected content-type {ctype}"
    assert "attachment" in (r.headers.get("content-disposition") or "")
    body = r.content
    # UTF-8 BOM first → Excel-friendly
    assert body.startswith(b"\xef\xbb\xbf"), "missing UTF-8 BOM"
    # Header row contains the canonical column names
    header_line = body[3:].split(b"\n", 1)[0].decode()
    for col in ("MRD", "Patient ID", "Name", "Mobile"):
        assert col in header_line, f"missing column {col}"


def test_patients_export_csv_respects_search_filter():
    tok = _bearer()
    r_all = requests.get(f"{API}/patients/export.csv", headers=H(tok))
    # extremely unlikely match — should yield 0 data rows
    r_none = requests.get(
        f"{API}/patients/export.csv?search=ZZZZZZZ-NO-SUCH-PATIENT-EVER",
        headers=H(tok),
    )
    assert r_all.status_code == 200 and r_none.status_code == 200
    lines_all = r_all.content.splitlines()
    lines_none = r_none.content.splitlines()
    # 1 header row in both. The "no match" file should have header only.
    assert len(lines_none) == 1, f"expected header-only, got {len(lines_none)} lines"
    assert len(lines_all) >= 1  # at least the header


def test_invoices_export_csv_streams_with_correct_headers():
    tok = _bearer()
    r = requests.get(f"{API}/billing/invoices/export.csv", headers=H(tok))
    assert r.status_code == 200, r.text
    assert r.headers.get("content-type", "").startswith("text/csv")
    cd = r.headers.get("content-disposition") or ""
    assert "audinexa-invoices-" in cd and ".csv" in cd
    body = r.content
    assert body.startswith(b"\xef\xbb\xbf")
    header_line = body[3:].split(b"\n", 1)[0].decode()
    for col in ("Invoice No", "Patient Name", "Grand Total", "Status"):
        assert col in header_line


def test_invoices_export_csv_filters():
    tok = _bearer()
    # status=paid filter must apply on the export.
    r = requests.get(f"{API}/billing/invoices/export.csv?status=paid", headers=H(tok))
    assert r.status_code == 200
    lines = r.content.splitlines()
    # Header + zero-or-more rows; if any rows exist, every row's Status
    # column should be "paid" (column index 2, 0-based).
    for line in lines[1:]:
        cells = line.decode().split(",")
        if len(cells) > 2:
            assert cells[2].strip('"') == "paid", line
