"""Phase 6 — FollowUp cadence rules + WhatsApp template catalogue.

Given a source doc (fitting / trial / sale / subscription) + its anchor date,
produces a list of (kind, due_date, title, message_template) tuples.

Kept in a dedicated module so the scheduler, the manual-generate endpoint,
and tests all apply the same rules.
"""
from __future__ import annotations

from datetime import date, timedelta
from typing import List, Tuple


# Fitting cadence (user's plan verbatim: 1 week, 1 month, 3 months, annual)
FITTING_CADENCE: List[Tuple[str, int, str]] = [
    ("adaptation_1w",  7,    "1-week adaptation check"),
    ("review_1mo",     30,   "1-month review"),
    ("review_3mo",     90,   "3-month review"),
    ("review_annual",  365,  "Annual check-up"),
    ("nps",            30,   "NPS & referral ask"),      # piggybacks on 30-day checkpoint
]

# Trial cadence (user's plan: day 3 follow-up, day 7 check-in, overdue)
TRIAL_CADENCE: List[Tuple[str, int, str]] = [
    ("trial_day3",     3,    "Day 3 trial check-in"),
    ("trial_day7",     7,    "Day 7 trial decision"),
]


def templ_fitting(kind: str, name: str, clinic_name: str, clinic_phone: str) -> str:
    """Pre-composed WhatsApp message per fitting follow-up kind."""
    if kind == "adaptation_1w":
        return (
            f"Hi {name}, hope your new hearing aid is settling in well! "
            f"It's been a week — any questions about fit, comfort, or sound? "
            f"Please reply or drop by {clinic_name} for a quick tune-up. — Team {clinic_name}"
        )
    if kind == "review_1mo":
        return (
            f"Hello {name}, it's been a month since your fitting. "
            f"Would love to see you for a 30-day review — fine-tune your aid to your daily routine. "
            f"Call {clinic_phone} to book."
        )
    if kind == "review_3mo":
        return (
            f"Hi {name}, ready for your 3-month review? A small adjustment visit keeps you hearing your best. "
            f"{clinic_name} · {clinic_phone}"
        )
    if kind == "review_annual":
        return (
            f"Hi {name}, your annual hearing-aid review is due. We'll check fit, performance, and clean the unit. "
            f"Book a slot: {clinic_phone}"
        )
    if kind == "nps":
        return (
            f"Hi {name}, quick question — on a scale of 0-10, how likely are you to recommend {clinic_name} to a friend? "
            f"Your reply helps us serve better. Thank you!"
        )
    return f"Hi {name}, {clinic_name} team checking in."


def templ_trial(kind: str, name: str, clinic_name: str, clinic_phone: str, return_date: str = "") -> str:
    if kind == "trial_day3":
        return (
            f"Hi {name}, how is day 3 of your hearing-aid trial going? "
            f"Any comfort or sound concerns we should address? Reply here or call {clinic_phone}. — {clinic_name}"
        )
    if kind == "trial_day7":
        return (
            f"Hi {name}, you're a week into the trial. Time to decide? "
            f"We can help you finalise or plan the next step. {clinic_name} · {clinic_phone}"
        )
    if kind == "trial_overdue":
        return (
            f"Hi {name}, your hearing-aid trial was due back on {return_date}. "
            f"Please reach out so we can schedule the return or discuss next steps. {clinic_phone}"
        )
    return f"Hi {name}, {clinic_name} team checking in."


def templ_consumable(item: str, name: str, clinic_name: str, clinic_phone: str) -> str:
    return (
        f"Hi {name}, it's time to refresh your {item}. "
        f"Drop by {clinic_name} or reply here and we'll keep a pack ready for you. {clinic_phone}"
    )


def templ_upgrade(name: str, years: int, clinic_name: str, clinic_phone: str) -> str:
    return (
        f"Hi {name}, your hearing aid has served you for {years} year(s). "
        f"Newer models have sharper clarity and longer battery — would love to show you. "
        f"{clinic_name} · {clinic_phone}"
    )


def fitting_due_dates(first_fit_at_ymd: date) -> List[Tuple[str, str, str]]:
    """Returns [(kind, due_date_ymd, title)] for every cadence entry for a fitting."""
    return [
        (kind, (first_fit_at_ymd + timedelta(days=offset)).isoformat(), title)
        for (kind, offset, title) in FITTING_CADENCE
    ]


def trial_due_dates(start_date_ymd: date) -> List[Tuple[str, str, str]]:
    return [
        (kind, (start_date_ymd + timedelta(days=offset)).isoformat(), title)
        for (kind, offset, title) in TRIAL_CADENCE
    ]
