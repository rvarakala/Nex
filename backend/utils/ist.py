"""Shared IST (Asia/Kolkata, UTC+5:30) helpers.
Single source of truth for day-boundary computations across the backend.
Stored datetimes are UTC naive ISO strings; we compare against IST-anchored UTC boundaries.
"""
from datetime import datetime, timezone, timedelta

IST = timezone(timedelta(hours=5, minutes=30))


def ist_now() -> datetime:
    """Current wall-clock time in IST (timezone-aware)."""
    return datetime.now(IST)


def ist_today_ymd() -> str:
    """Today's date in IST as `YYYY-MM-DD`."""
    return ist_now().strftime("%Y-%m-%d")


def ist_day_start_utc(ymd: str | None = None) -> datetime:
    """UTC-naive datetime at 00:00 IST of the given IST date (or today's IST date).
    Usable directly in `{"$gte": ist_day_start_utc().isoformat()}` comparisons against stored ISO strings.
    """
    if ymd:
        y, m, d = [int(x) for x in ymd.split("-")]
        ist_midnight = datetime(y, m, d, 0, 0, 0, tzinfo=IST)
    else:
        n = ist_now()
        ist_midnight = n.replace(hour=0, minute=0, second=0, microsecond=0)
    return ist_midnight.astimezone(timezone.utc).replace(tzinfo=None)


def ist_next_day_start_utc(ymd: str | None = None) -> datetime:
    """UTC-naive datetime at 00:00 IST of the day AFTER the given IST date."""
    if ymd is None:
        ymd = ist_today_ymd()
    y, m, d = [int(x) for x in ymd.split("-")]
    next_day = datetime(y, m, d, tzinfo=IST) + timedelta(days=1)
    return next_day.astimezone(timezone.utc).replace(tzinfo=None)
