"""Regression: pair quote with one 'both' side line should succeed.

User complaint (2026-07-31): Clinic owner opened New Quotation, ticked
Binaural, picked Phonak I30 (side=both, qty=1, ₹1,60,000), Save →
"Pair quote must have exactly one LEFT + one RIGHT serialised line
(got L=0, R=0)". Root cause: backend didn't expand side='both' into
L + R. Fix: `_explode_both_sides` normalises pair quotes so the
frontend can stay simple (one row per SKU).
"""
from __future__ import annotations
from types import SimpleNamespace

from routers.ha_quotations import _explode_both_sides, _validate_pair


def _mk(product_id="P1", side="single", qty=1, unit_price=160000):
    # QuoteLine is a Pydantic model — import at call time to avoid cycles.
    from routers.ha_quotations import QuoteLine
    return QuoteLine(
        product_id=product_id, side=side, qty=qty,
        unit_price=unit_price, discount_pct=30, gst_rate=0,
    )


def test_pair_quote_with_side_both_expands_to_left_and_right():
    lines = [_mk(side="both")]
    exploded = _explode_both_sides(True, lines)
    assert len(exploded) == 2
    sides = sorted(x.side for x in exploded)
    assert sides == ["left", "right"]
    for x in exploded:
        assert x.qty == 1
        assert x.unit_price == 160000
    # And the validator now passes on the exploded shape:
    _validate_pair(True, exploded)  # no HTTPException


def test_pair_quote_with_side_single_also_expands():
    exploded = _explode_both_sides(True, [_mk(side="single")])
    assert len(exploded) == 2
    assert sorted(x.side for x in exploded) == ["left", "right"]
    _validate_pair(True, exploded)


def test_pair_quote_with_explicit_left_and_right_passes_through():
    lines = [_mk(side="left"), _mk(side="right")]
    exploded = _explode_both_sides(True, lines)
    # No expansion — already correctly split.
    assert exploded == lines
    _validate_pair(True, exploded)


def test_non_pair_quote_leaves_both_as_is():
    lines = [_mk(side="both")]
    exploded = _explode_both_sides(False, lines)
    # Not a pair — no expansion, no validation.
    assert exploded == lines


def test_pair_quote_validation_message_no_longer_says_serialised():
    """Error message must NOT contain the misleading word "serialised"
    (users were reading it as "you need to enter a serial number")."""
    import pytest
    from fastapi import HTTPException

    with pytest.raises(HTTPException) as excinfo:
        _validate_pair(True, [])  # missing both sides

    detail = excinfo.value.detail
    assert "serialised" not in detail.lower()
    assert "hearing-aid" in detail.lower()
