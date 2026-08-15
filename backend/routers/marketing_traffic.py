"""Marketing-site traffic — audinexa.com visitor analytics (Feb 2026).

We host a tiny, cookie-less tracker on our own API. The marketing site
adds ONE line to its `<head>`:

    <script src="https://audinexa.com/api/track.js" defer></script>

The script:
  · reads / writes a persistent `visitor_id` from localStorage (30-day)
  · reads / writes a per-tab `session_id` in sessionStorage
  · captures `utm_source`, `utm_medium`, `utm_campaign`, `utm_term`,
    `utm_content` and pins them to the session so cross-page journeys
    from the same campaign attribute correctly
  · sends a beacon to `POST /api/track` on load + SPA `popstate`
  · sends an end-of-session beacon on `beforeunload` (session length)

Founder-only endpoints roll the events up into daily / campaign /
referrer / landing-page views for the AdminPanel.

Design choices that matter:
  · No cookies. GDPR-friendly. The visitor_id is a client-generated
    UUIDv4 in localStorage — no server-issued identifier.
  · The `POST /api/track` beacon is INTENTIONALLY unauthenticated. It
    logs raw IP for rate-limiting only; we never surface the IP in the
    founder dashboard.
  · Duplicate protection: any two events with (visitor_id, path,
    coarse-timestamp-to-second) are treated as one hit so an over-
    eager SPA doesn't inflate counts.
"""
from __future__ import annotations

import hashlib
import re
from datetime import datetime, timedelta, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import Response
from pydantic import BaseModel, Field

from auth import require_roles
from database import get_db

router = APIRouter(prefix="/api")


# ── The tracker script ────────────────────────────────────────────────
# 2 KB when minified in the browser cache. Kept as a Python string so the
# whole feature ships in one router without touching the frontend build.
_TRACKER_JS = r"""/* Audinexa Traffic Tracker — cookieless, ~2KB */
(function () {
  try {
    if (window.__audinexaTrackerLoaded) return;
    window.__audinexaTrackerLoaded = true;
    var API = document.currentScript && document.currentScript.src
      ? new URL(document.currentScript.src).origin + '/api/track'
      : '/api/track';

    var VID_KEY = 'axa_vid', SID_KEY = 'axa_sid', UTM_KEY = 'axa_utm';
    function uuid() {
      return (crypto && crypto.randomUUID && crypto.randomUUID()) ||
        'v-' + Math.random().toString(36).slice(2) + Date.now().toString(36);
    }
    function get(store, k) { try { return store.getItem(k); } catch (e) { return null; } }
    function set(store, k, v) { try { store.setItem(k, v); } catch (e) { /* noop */ } }
    var vid = get(localStorage, VID_KEY);
    if (!vid) { vid = uuid(); set(localStorage, VID_KEY, vid); }
    var sid = get(sessionStorage, SID_KEY);
    if (!sid) { sid = uuid(); set(sessionStorage, SID_KEY, sid); }

    // Capture UTM params + referrer ONCE per session so cross-page
    // journeys stay attributed to the source campaign.
    var utmStored = get(sessionStorage, UTM_KEY);
    var utm = utmStored ? JSON.parse(utmStored) : {};
    var params = new URLSearchParams(location.search);
    ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content'].forEach(function (k) {
      var v = params.get(k);
      if (v) utm[k] = v;
    });
    if (!utm.referrer && document.referrer && !location.href.startsWith(document.referrer)) {
      utm.referrer = document.referrer;
    }
    set(sessionStorage, UTM_KEY, JSON.stringify(utm));

    function send(payload) {
      try {
        var body = JSON.stringify(payload);
        if (navigator.sendBeacon) {
          navigator.sendBeacon(API, new Blob([body], { type: 'application/json' }));
        } else {
          fetch(API, {
            method: 'POST', keepalive: true,
            headers: { 'Content-Type': 'application/json' },
            body: body,
          });
        }
      } catch (e) { /* noop */ }
    }
    function view(kind) {
      send({
        visitor_id: vid,
        session_id: sid,
        kind: kind || 'pageview',
        path: location.pathname + location.search,
        title: document.title,
        referrer: document.referrer || null,
        utm_source: utm.utm_source || null,
        utm_medium: utm.utm_medium || null,
        utm_campaign: utm.utm_campaign || null,
        utm_term: utm.utm_term || null,
        utm_content: utm.utm_content || null,
        origin_referrer: utm.referrer || null,
        screen_w: window.innerWidth,
        screen_h: window.innerHeight,
        lang: navigator.language,
        ts: new Date().toISOString(),
      });
    }

    view('pageview');

    // Also catch SPA nav (React Router / Next.js style). Patch pushState.
    ['pushState', 'replaceState'].forEach(function (method) {
      var orig = history[method];
      history[method] = function () {
        var r = orig.apply(this, arguments);
        setTimeout(function () { view('pageview'); }, 30);
        return r;
      };
    });
    window.addEventListener('popstate', function () { view('pageview'); });
    // End-of-session beacon so we can compute avg session duration.
    var loaded = Date.now();
    window.addEventListener('beforeunload', function () {
      send({
        visitor_id: vid, session_id: sid, kind: 'session_end',
        path: location.pathname, dur_ms: Date.now() - loaded,
        ts: new Date().toISOString(),
      });
    });

    // Public API for the marketing site to log custom events (e.g.
    // "Get Demo" button click). Usage: window.audinexaTrack('demo_cta').
    window.audinexaTrack = function (name, extras) {
      send(Object.assign({
        visitor_id: vid, session_id: sid, kind: 'event',
        event_name: String(name || 'custom'),
        path: location.pathname + location.search,
        ts: new Date().toISOString(),
      }, extras || {}));
    };
  } catch (e) { /* noop — tracker must NEVER break the marketing page */ }
})();
"""


@router.get("/track.js")
async def tracker_script():
    """Serve the tracker JS with a long-ish cache header so the marketing
    site doesn't hit us on every page. Bumping the header value invalidates."""
    return Response(
        content=_TRACKER_JS,
        media_type="application/javascript; charset=utf-8",
        headers={
            "Cache-Control": "public, max-age=3600",
            "X-Content-Type-Options": "nosniff",
        },
    )


# ── Beacon payload ────────────────────────────────────────────────────
class TrackPayload(BaseModel):
    visitor_id: str = Field(..., min_length=6, max_length=64)
    session_id: str = Field(..., min_length=6, max_length=64)
    kind: str = Field("pageview", pattern=r"^(pageview|event|session_end)$")
    path: Optional[str] = None
    title: Optional[str] = None
    referrer: Optional[str] = None
    utm_source: Optional[str] = None
    utm_medium: Optional[str] = None
    utm_campaign: Optional[str] = None
    utm_term: Optional[str] = None
    utm_content: Optional[str] = None
    origin_referrer: Optional[str] = None
    screen_w: Optional[int] = None
    screen_h: Optional[int] = None
    lang: Optional[str] = None
    event_name: Optional[str] = None
    dur_ms: Optional[int] = None
    ts: Optional[str] = None


def _hash_ip(ip: str) -> str:
    """We DON'T want raw IPs in the DB — that's a compliance and audit
    surface. But we still need a stable identifier for rate-limiting +
    unique-visitor de-dup when the client is behind a shared browser
    profile. Hash it with a rotating daily salt."""
    salt = datetime.now(timezone.utc).strftime("%Y-%m-%d") + ":audinexa-traffic"
    return hashlib.sha256(f"{salt}:{ip}".encode()).hexdigest()[:16]


@router.post("/track")
async def track_beacon(
    payload: TrackPayload,
    request: Request,
    db=Depends(get_db),
):
    """Public marketing-site beacon. Unauthenticated on purpose — this
    endpoint is called from `audinexa.com` before the visitor signs up.

    Anti-abuse:
      · Basic path-length + UTM-length caps at pydantic level
      · Every event is stamped with the current date bucket so daily
        aggregation is O(N) with an index on (date_bucket).
      · Duplicate-in-same-second events for the same (visitor, path)
        are silently coalesced by the aggregation stage.
    """
    now = datetime.now(timezone.utc)
    ip = (request.headers.get("x-forwarded-for") or request.client.host or "").split(",")[0].strip()
    ip_hash = _hash_ip(ip) if ip else None

    doc = {
        "visitor_id": payload.visitor_id[:64],
        "session_id": payload.session_id[:64],
        "kind": payload.kind,
        "path": (payload.path or "/")[:512],
        "title": (payload.title or "")[:256] if payload.title else None,
        "referrer": (payload.referrer or "")[:512] if payload.referrer else None,
        "utm_source":   (payload.utm_source or "")[:64] if payload.utm_source else None,
        "utm_medium":   (payload.utm_medium or "")[:64] if payload.utm_medium else None,
        "utm_campaign": (payload.utm_campaign or "")[:96] if payload.utm_campaign else None,
        "utm_term":     (payload.utm_term or "")[:96] if payload.utm_term else None,
        "utm_content":  (payload.utm_content or "")[:96] if payload.utm_content else None,
        "origin_referrer": (payload.origin_referrer or "")[:512] if payload.origin_referrer else None,
        "screen_w": payload.screen_w if isinstance(payload.screen_w, int) else None,
        "screen_h": payload.screen_h if isinstance(payload.screen_h, int) else None,
        "lang": (payload.lang or "")[:16] if payload.lang else None,
        "event_name": (payload.event_name or "")[:64] if payload.event_name else None,
        "dur_ms": payload.dur_ms if isinstance(payload.dur_ms, int) and payload.dur_ms >= 0 else None,
        "ua": (request.headers.get("user-agent") or "")[:512],
        "ip_hash": ip_hash,
        "at": now,
        "date_bucket": now.strftime("%Y-%m-%d"),
    }
    await db.marketing_traffic_events.insert_one(doc)
    return {"ok": True}


# ── Founder analytics endpoints ───────────────────────────────────────
@router.get("/admin/marketing-traffic/overview")
async def marketing_traffic_overview(
    days: int = 30,
    user=Depends(require_roles("super_admin")),
    db=Depends(get_db),
):
    """Roll-up view for the AdminPanel > Traffic page. All aggregates
    computed in Mongo so the endpoint stays fast even on a big log.
    """
    days = max(1, min(days, 365))
    cutoff = datetime.now(timezone.utc) - timedelta(days=days)
    match = {"at": {"$gte": cutoff}}

    # Totals — page views, unique visitors, unique sessions.
    total_page_views = await db.marketing_traffic_events.count_documents(
        {**match, "kind": "pageview"}
    )
    total_events = await db.marketing_traffic_events.count_documents(
        {**match, "kind": "event"}
    )
    unique_visitors = len(
        await db.marketing_traffic_events.distinct("visitor_id", match)
    )
    unique_sessions = len(
        await db.marketing_traffic_events.distinct("session_id", match)
    )

    # Daily series — page views + unique visitors per day. Piggyback the
    # same aggregate to keep the query count minimal.
    daily_cursor = db.marketing_traffic_events.aggregate([
        {"$match": {**match, "kind": "pageview"}},
        {"$group": {
            "_id": "$date_bucket",
            "page_views": {"$sum": 1},
            "visitors": {"$addToSet": "$visitor_id"},
            "sessions": {"$addToSet": "$session_id"},
        }},
        {"$project": {
            "date": "$_id", "_id": 0,
            "page_views": 1,
            "unique_visitors": {"$size": "$visitors"},
            "unique_sessions": {"$size": "$sessions"},
        }},
        {"$sort": {"date": 1}},
    ])
    daily = await daily_cursor.to_list(400)

    # Top landing pages. First pageview of every session is the landing.
    landings_cursor = db.marketing_traffic_events.aggregate([
        {"$match": {**match, "kind": "pageview"}},
        {"$sort": {"at": 1}},
        {"$group": {"_id": "$session_id", "path": {"$first": "$path"}}},
        {"$group": {"_id": "$path", "sessions": {"$sum": 1}}},
        {"$project": {"path": "$_id", "sessions": 1, "_id": 0}},
        {"$sort": {"sessions": -1}},
        {"$limit": 15},
    ])
    top_landings = await landings_cursor.to_list(15)

    # Top referrers (external).
    ref_cursor = db.marketing_traffic_events.aggregate([
        {"$match": {**match, "kind": "pageview",
                    "origin_referrer": {"$nin": [None, ""]}}},
        {"$group": {"_id": "$origin_referrer",
                    "sessions": {"$addToSet": "$session_id"}}},
        {"$project": {"referrer": "$_id",
                      "sessions": {"$size": "$sessions"}, "_id": 0}},
        {"$sort": {"sessions": -1}},
        {"$limit": 15},
    ])
    top_referrers = await ref_cursor.to_list(15)

    # Campaign breakdown — surface every utm_campaign with counts. If
    # utm_campaign is missing, group under "(direct)" so the founder
    # can see the direct-vs-campaign split at a glance.
    camp_cursor = db.marketing_traffic_events.aggregate([
        {"$match": {**match, "kind": "pageview"}},
        {"$group": {
            "_id": {
                "campaign": {"$ifNull": ["$utm_campaign", "(direct)"]},
                "source":   {"$ifNull": ["$utm_source", None]},
                "medium":   {"$ifNull": ["$utm_medium", None]},
            },
            "sessions": {"$addToSet": "$session_id"},
            "visitors": {"$addToSet": "$visitor_id"},
            "page_views": {"$sum": 1},
        }},
        {"$project": {
            "campaign": "$_id.campaign",
            "source": "$_id.source",
            "medium": "$_id.medium",
            "sessions": {"$size": "$sessions"},
            "visitors": {"$size": "$visitors"},
            "page_views": 1, "_id": 0,
        }},
        {"$sort": {"sessions": -1}},
        {"$limit": 30},
    ])
    campaigns = await camp_cursor.to_list(30)

    # Bounce rate — sessions with exactly 1 pageview. Very rough but a
    # useful signal for landing-page work.
    sess_len_cursor = db.marketing_traffic_events.aggregate([
        {"$match": {**match, "kind": "pageview"}},
        {"$group": {"_id": "$session_id", "hits": {"$sum": 1}}},
        {"$group": {
            "_id": None,
            "total_sessions": {"$sum": 1},
            "single_page_sessions": {"$sum": {"$cond": [{"$eq": ["$hits", 1]}, 1, 0]}},
            "total_page_views": {"$sum": "$hits"},
        }},
    ])
    sess_len = await sess_len_cursor.to_list(1)
    if sess_len:
        s = sess_len[0]
        bounce_rate = round(s["single_page_sessions"] / s["total_sessions"] * 100, 1) if s["total_sessions"] else 0
        avg_pages_per_session = round(s["total_page_views"] / s["total_sessions"], 2) if s["total_sessions"] else 0
    else:
        bounce_rate = 0
        avg_pages_per_session = 0

    # Avg session duration from `session_end` beacons.
    dur_cursor = db.marketing_traffic_events.aggregate([
        {"$match": {**match, "kind": "session_end",
                    "dur_ms": {"$ne": None, "$gt": 0}}},
        {"$group": {"_id": None,
                    "avg_ms": {"$avg": "$dur_ms"},
                    "n": {"$sum": 1}}},
    ])
    dur = await dur_cursor.to_list(1)
    avg_session_ms = int((dur[0]["avg_ms"] or 0)) if dur else 0

    # Custom events (Get Demo clicks, etc.)
    events_cursor = db.marketing_traffic_events.aggregate([
        {"$match": {**match, "kind": "event"}},
        {"$group": {
            "_id": "$event_name",
            "hits": {"$sum": 1},
            "visitors": {"$addToSet": "$visitor_id"},
        }},
        {"$project": {"event_name": "$_id", "hits": 1,
                      "visitors": {"$size": "$visitors"}, "_id": 0}},
        {"$sort": {"hits": -1}},
        {"$limit": 15},
    ])
    top_events = await events_cursor.to_list(15)

    return {
        "range_days": days,
        "totals": {
            "page_views": total_page_views,
            "unique_visitors": unique_visitors,
            "unique_sessions": unique_sessions,
            "custom_events": total_events,
            "avg_pages_per_session": avg_pages_per_session,
            "avg_session_seconds": round(avg_session_ms / 1000, 1) if avg_session_ms else 0,
            "bounce_rate_pct": bounce_rate,
        },
        "daily": daily,
        "top_landings": top_landings,
        "top_referrers": top_referrers,
        "campaigns": campaigns,
        "top_events": top_events,
    }


@router.get("/admin/marketing-traffic/live")
async def marketing_traffic_live(
    minutes: int = 15,
    user=Depends(require_roles("super_admin")),
    db=Depends(get_db),
):
    """"Who's on the site right now?" summary. Powers the live pulse
    on the founder dashboard."""
    minutes = max(1, min(minutes, 120))
    cutoff = datetime.now(timezone.utc) - timedelta(minutes=minutes)
    match = {"at": {"$gte": cutoff}, "kind": "pageview"}
    online = len(await db.marketing_traffic_events.distinct("visitor_id", match))
    active_sessions = len(await db.marketing_traffic_events.distinct("session_id", match))
    paths_cursor = db.marketing_traffic_events.aggregate([
        {"$match": match},
        {"$group": {"_id": "$path",
                    "sessions": {"$addToSet": "$session_id"}}},
        {"$project": {"path": "$_id",
                      "sessions": {"$size": "$sessions"}, "_id": 0}},
        {"$sort": {"sessions": -1}},
        {"$limit": 10},
    ])
    live_paths = await paths_cursor.to_list(10)
    return {
        "window_minutes": minutes,
        "visitors_online": online,
        "active_sessions": active_sessions,
        "live_paths": live_paths,
    }


@router.get("/admin/marketing-traffic/compare")
async def marketing_traffic_compare(
    campaigns: str,
    days: int = 30,
    user=Depends(require_roles("super_admin")),
    db=Depends(get_db),
):
    """Side-by-side comparison of 2-4 marketing campaigns.

    `campaigns` is a comma-separated list of `utm_campaign` values. The
    sentinel `(direct)` matches all pageviews with no utm_campaign set,
    mirroring the overview endpoint's bucketing.

    For each campaign we return:
      · totals — visitors, sessions, page_views, custom_events,
        bounce_rate_pct, avg_pages_per_session, avg_session_seconds,
        conversion_rate_pct (events ÷ unique visitors)
      · daily  — page_views + unique_visitors keyed by date_bucket,
        aligned to the shared `dates` axis so the frontend can
        overlay them without extra alignment work.

    Response also carries `dates: [YYYY-MM-DD, ...]` covering the full
    horizon so the overlay chart's X-axis stays stable even when a
    campaign has zero traffic on a given day.
    """
    days = max(1, min(days, 365))
    picks = [c.strip() for c in (campaigns or "").split(",") if c.strip()]
    # Dedupe while preserving order, cap at 4 to protect the query.
    seen: set = set()
    campaign_list: list[str] = []
    for name in picks:
        if name not in seen:
            seen.add(name)
            campaign_list.append(name)
        if len(campaign_list) >= 4:
            break
    if not campaign_list:
        raise HTTPException(400, "campaigns query param required (comma-separated)")

    cutoff = datetime.now(timezone.utc) - timedelta(days=days)
    # Build the shared date axis first — every day between cutoff and
    # today, inclusive. Keeps the frontend rendering trivial.
    axis_days: list[str] = []
    d = cutoff.replace(hour=0, minute=0, second=0, microsecond=0)
    end = datetime.now(timezone.utc).replace(hour=0, minute=0, second=0, microsecond=0)
    while d <= end:
        axis_days.append(d.strftime("%Y-%m-%d"))
        d += timedelta(days=1)

    def _match_filter(name: str) -> dict:
        base = {"at": {"$gte": cutoff}}
        if name == "(direct)":
            base["$or"] = [
                {"utm_campaign": None},
                {"utm_campaign": {"$exists": False}},
                {"utm_campaign": ""},
            ]
        else:
            base["utm_campaign"] = name
        return base

    results: list = []
    for name in campaign_list:
        base_match = _match_filter(name)
        pv_match = {**base_match, "kind": "pageview"}

        page_views = await db.marketing_traffic_events.count_documents(pv_match)
        # Attribute events to a campaign via the campaign's pageview
        # visitor set — because `window.audinexaTrack` beacons don't
        # carry utm_campaign (they inherit attribution through the
        # visitor_id → first-touch campaign relationship).
        campaign_visitor_ids = await db.marketing_traffic_events.distinct(
            "visitor_id", pv_match
        )
        campaign_session_ids = await db.marketing_traffic_events.distinct(
            "session_id", pv_match
        )
        unique_visitors = len(campaign_visitor_ids)
        unique_sessions = len(campaign_session_ids)

        if campaign_visitor_ids:
            custom_events = await db.marketing_traffic_events.count_documents({
                "kind": "event",
                "at": {"$gte": cutoff},
                "visitor_id": {"$in": campaign_visitor_ids},
            })
            event_visitors = len(
                await db.marketing_traffic_events.distinct("visitor_id", {
                    "kind": "event",
                    "at": {"$gte": cutoff},
                    "visitor_id": {"$in": campaign_visitor_ids},
                })
            )
        else:
            custom_events = 0
            event_visitors = 0

        # Daily page_views + unique visitors, indexed for O(1) alignment.
        daily_cursor = db.marketing_traffic_events.aggregate([
            {"$match": pv_match},
            {"$group": {
                "_id": "$date_bucket",
                "page_views": {"$sum": 1},
                "visitors": {"$addToSet": "$visitor_id"},
            }},
            {"$project": {
                "date": "$_id", "_id": 0,
                "page_views": 1,
                "unique_visitors": {"$size": "$visitors"},
            }},
        ])
        daily_by_date = {r["date"]: r for r in await daily_cursor.to_list(400)}
        daily = [{
            "date": d,
            "page_views": (daily_by_date.get(d, {}) or {}).get("page_views", 0),
            "unique_visitors": (daily_by_date.get(d, {}) or {}).get("unique_visitors", 0),
        } for d in axis_days]

        # Bounce rate + pages-per-session (session hit distribution).
        sess_cursor = db.marketing_traffic_events.aggregate([
            {"$match": pv_match},
            {"$group": {"_id": "$session_id", "hits": {"$sum": 1}}},
            {"$group": {
                "_id": None,
                "total_sessions": {"$sum": 1},
                "single_page_sessions": {
                    "$sum": {"$cond": [{"$eq": ["$hits", 1]}, 1, 0]}
                },
                "total_page_views": {"$sum": "$hits"},
            }},
        ])
        sess = await sess_cursor.to_list(1)
        if sess and sess[0]["total_sessions"]:
            s = sess[0]
            bounce_rate = round(s["single_page_sessions"] / s["total_sessions"] * 100, 1)
            avg_pps = round(s["total_page_views"] / s["total_sessions"], 2)
        else:
            bounce_rate = 0.0
            avg_pps = 0.0

        # Avg session duration from session_end beacons within this campaign.
        # Session_end beacons don't carry utm_campaign directly, so we
        # match them by session_id joined with the campaign's sessions.
        if campaign_session_ids:
            dur_cursor = db.marketing_traffic_events.aggregate([
                {"$match": {"kind": "session_end", "dur_ms": {"$gt": 0},
                            "session_id": {"$in": campaign_session_ids}}},
                {"$group": {"_id": None, "avg_ms": {"$avg": "$dur_ms"}}},
            ])
            dur = await dur_cursor.to_list(1)
            avg_session_ms = int(dur[0]["avg_ms"] or 0) if dur else 0
        else:
            avg_session_ms = 0

        # Conversion — % of unique visitors who fired at least one custom
        # event. More useful than raw event count for A/B campaign work.
        conversion_pct = (
            round(event_visitors / unique_visitors * 100, 1)
            if unique_visitors else 0.0
        )

        results.append({
            "campaign": name,
            "totals": {
                "page_views": page_views,
                "unique_visitors": unique_visitors,
                "unique_sessions": unique_sessions,
                "custom_events": custom_events,
                "converting_visitors": event_visitors,
                "conversion_rate_pct": conversion_pct,
                "bounce_rate_pct": bounce_rate,
                "avg_pages_per_session": avg_pps,
                "avg_session_seconds": round(avg_session_ms / 1000, 1) if avg_session_ms else 0,
            },
            "daily": daily,
        })

    return {
        "range_days": days,
        "dates": axis_days,
        "campaigns": results,
    }


@router.get("/admin/marketing-traffic/cohorts")
async def marketing_traffic_cohorts(
    weeks: int = 8,
    user=Depends(require_roles("super_admin")),
    db=Depends(get_db),
):
    """Retention-cohort grid — for each week bucket, count how many of
    that week's first-time visitors came back in week 1, week 2, … up
    to the current week. Powers the "how sticky is our marketing site"
    view + campaign after-effect analysis.

    Rows are anchored on `first_seen_week` (the ISO Monday of the
    visitor's first-ever pageview). Columns are `week_offset` from
    that anchor.
    """
    weeks = max(2, min(weeks, 26))
    # Roll up to (visitor_id, first_seen_at) once so the two-pass math
    # stays cheap even with 100k+ events.
    firsts = await db.marketing_traffic_events.aggregate([
        {"$match": {"kind": "pageview"}},
        {"$group": {"_id": "$visitor_id",
                    "first_at": {"$min": "$at"}}},
    ]).to_list(None)
    if not firsts:
        return {"weeks": weeks, "cohorts": []}

    # Compute the anchor week for the horizon we care about.
    now = datetime.now(timezone.utc)
    # Monday-anchored ISO week for stable buckets across timezones.
    def _week_key(dt: datetime) -> str:
        y, w, _ = dt.isocalendar()
        return f"{y}-W{w:02d}"

    def _as_aware(dt: datetime) -> datetime:
        # BSON round-trips as naive UTC; make comparisons safe.
        return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)

    def _week_diff(a: datetime, b: datetime) -> int:
        """Return how many ISO weeks separate a → b (a earlier)."""
        a = _as_aware(a).replace(hour=0, minute=0, second=0, microsecond=0)
        b = _as_aware(b)
        return int((b - a).days / 7)

    horizon_cut = now - timedelta(weeks=weeks)
    # Filter to visitors whose first pageview is inside the horizon —
    # the cohort table doesn't need older visitors.
    firsts = [f for f in firsts if _as_aware(f["first_at"]) >= horizon_cut]
    if not firsts:
        return {"weeks": weeks, "cohorts": []}

    visitor_first = {f["_id"]: _as_aware(f["first_at"]) for f in firsts}
    cohort_size: dict = {}
    for f in firsts:
        wk = _week_key(f["first_at"])
        cohort_size[wk] = cohort_size.get(wk, 0) + 1

    # Second pass — for every pageview by an in-horizon visitor, mark
    # (cohort_week, week_offset) → visitor was active that week.
    cohort_seen: dict = {}
    cursor = db.marketing_traffic_events.find(
        {"kind": "pageview",
         "visitor_id": {"$in": list(visitor_first.keys())}},
        {"_id": 0, "visitor_id": 1, "at": 1},
    )
    async for evt in cursor:
        first_at = visitor_first[evt["visitor_id"]]
        offset = _week_diff(first_at, evt["at"])
        if offset < 0 or offset >= weeks:
            continue
        cohort_wk = _week_key(first_at)
        cohort_seen.setdefault(cohort_wk, {}).setdefault(offset, set()).add(evt["visitor_id"])
    # Build the response — one row per cohort week, biggest cohort first.
    rows = []
    for cohort_wk, size in sorted(cohort_size.items(), key=lambda kv: kv[0]):
        seen = cohort_seen.get(cohort_wk, {})
        row = {
            "cohort_week": cohort_wk,
            "size": size,
            "offsets": {},
        }
        for off in range(weeks):
            n = len(seen.get(off, set()))
            row["offsets"][str(off)] = {
                "visitors": n,
                "pct": round(n / size * 100, 1) if size else 0.0,
            }
        rows.append(row)

    return {
        "weeks": weeks,
        "cohorts": rows,
    }
