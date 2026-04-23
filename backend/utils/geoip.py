"""Lightweight IP → City / Country resolver with Mongo caching.

Uses ip-api.com (free, 45 req/min, no auth required) and caches every
lookup forever in the `geoip_cache` collection. Subsequent lookups for
the same IP are instant.

Private / local IPs resolve to "Local" without an external call.
"""
from __future__ import annotations

import asyncio
import ipaddress
import logging
from datetime import datetime, timezone
from typing import Optional

import httpx

logger = logging.getLogger(__name__)

# In-memory LRU — avoids even Mongo hit on hot IPs
_memory_cache: dict[str, dict] = {}
_MEMORY_CACHE_MAX = 500

# Per-IP lock to dedup concurrent lookups of the same IP
_locks: dict[str, asyncio.Lock] = {}


def _is_private_or_empty(ip: Optional[str]) -> bool:
    if not ip:
        return True
    try:
        addr = ipaddress.ip_address(ip)
        return addr.is_private or addr.is_loopback or addr.is_link_local or addr.is_reserved
    except ValueError:
        return True


async def resolve_ip(db, ip: Optional[str]) -> dict:
    """Return {ip, city, region, country, country_code, lat, lon, source}.

    Never raises — returns a "Local" / "Unknown" stub on any error.
    """
    if _is_private_or_empty(ip):
        return {"ip": ip, "city": "Local", "country": "", "country_code": "", "source": "private"}

    # 1. Memory cache
    if ip in _memory_cache:
        return _memory_cache[ip]

    # 2. Mongo cache
    try:
        cached = await db.geoip_cache.find_one({"ip": ip}, {"_id": 0})
        if cached:
            _memory_cache[ip] = cached
            return cached
    except Exception:
        pass

    # 3. External lookup (dedup concurrent calls for same IP)
    if ip not in _locks:
        _locks[ip] = asyncio.Lock()
    async with _locks[ip]:
        # Re-check cache after acquiring lock
        if ip in _memory_cache:
            return _memory_cache[ip]
        try:
            async with httpx.AsyncClient(timeout=2.5) as client:
                r = await client.get(f"http://ip-api.com/json/{ip}?fields=status,country,countryCode,regionName,city,lat,lon,query")
                if r.status_code == 200:
                    data = r.json()
                    if data.get("status") == "success":
                        doc = {
                            "ip": ip,
                            "city": data.get("city", ""),
                            "region": data.get("regionName", ""),
                            "country": data.get("country", ""),
                            "country_code": data.get("countryCode", ""),
                            "lat": data.get("lat"),
                            "lon": data.get("lon"),
                            "source": "ip-api",
                            "looked_up_at": datetime.now(timezone.utc),
                        }
                        try:
                            await db.geoip_cache.update_one(
                                {"ip": ip}, {"$set": doc}, upsert=True
                            )
                        except Exception:
                            pass
                        _memory_cache[ip] = doc
                        # Trim memory cache
                        if len(_memory_cache) > _MEMORY_CACHE_MAX:
                            # Drop oldest (insertion order)
                            for k in list(_memory_cache.keys())[:100]:
                                _memory_cache.pop(k, None)
                        return doc
        except Exception as e:
            logger.debug(f"geoip resolve failed for {ip}: {e}")

    # 4. Fallback stub — DO NOT cache (so we can retry later)
    return {"ip": ip, "city": "", "country": "", "country_code": "", "source": "unknown"}


async def resolve_ips_batch(db, ips: list[str]) -> dict[str, dict]:
    """Resolve many IPs in parallel. Returns {ip: resolved_doc}."""
    unique = list({ip for ip in ips if ip})
    if not unique:
        return {}
    results = await asyncio.gather(*[resolve_ip(db, ip) for ip in unique], return_exceptions=True)
    out: dict[str, dict] = {}
    for ip, res in zip(unique, results):
        if isinstance(res, Exception):
            out[ip] = {"ip": ip, "city": "", "country": "", "source": "error"}
        else:
            out[ip] = res
    return out
