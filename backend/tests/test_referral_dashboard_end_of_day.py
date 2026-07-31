"""Regression: the `end` query param for /api/referrals/dashboard must
include invoices created LATER on the same day.

User workflow (2026-07-31 Vishnu/Dr Prasad walkthrough): Front desk opens
Referral Corner with the default "This month" range → the UI sends
`end=2026-07-31`. Before this fix, that string parsed to
`datetime(2026, 7, 31, 0, 0, 0)` — an invoice raised the same day at
10:04 UTC would sit ABOVE the range and be silently excluded, showing
₹0 payout even though ₹23,700 was owed.

We test in the PAST (2026-06-30) to avoid the "clamp end to now"
behaviour interfering.
"""
from __future__ import annotations
from datetime import datetime, timezone

from routers.referrals import _parse_window


def test_date_only_end_in_past_pads_to_end_of_day():
    """A past-day date-only end must pad to 23:59:59 — otherwise same-day
    invoices raised in the afternoon get excluded."""
    _, end = _parse_window("2026-06-01", "2026-06-30")
    assert end == datetime(2026, 6, 30, 23, 59, 59, 999999, tzinfo=timezone.utc)


def test_explicit_iso_end_in_past_is_not_padded():
    """Client-provided explicit time comes through unchanged."""
    _, end = _parse_window("2026-06-01", "2026-06-15T14:30:00")
    assert end.hour == 14 and end.minute == 30 and end.second == 0


def test_future_end_gets_clamped_to_now():
    """The `end` must never be in the future — clamped to now()."""
    _, end = _parse_window("2020-01-01", "2999-12-31")
    now = datetime.now(timezone.utc)
    # Allow a 5-second tolerance for the test-runtime delta.
    assert (now - end).total_seconds() < 5
