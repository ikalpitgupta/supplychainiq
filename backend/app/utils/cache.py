"""Process-level TTL cache for expensive read-only analytics.

On serverless (Vercel + remote Postgres), a few aggregate endpoints touch
many tables; a warm function instance serves them from this cache instead
of re-computing. Entries are keyed by route + query params and expire
quickly — demo data changes only via reset/import, so a short TTL is
always honest.
"""
from __future__ import annotations

import hashlib
import json
import time
from typing import Any

_store: dict[str, tuple[float, Any]] = {}
_DEFAULT_TTL = 300  # seconds


def _key(namespace: str, params: dict) -> str:
    raw = json.dumps(params, sort_keys=True, default=str)
    digest = hashlib.sha256(raw.encode()).hexdigest()[:16]
    return f"{namespace}:{digest}"


def cached(namespace: str, params: dict, compute, ttl: int = _DEFAULT_TTL):
    """Return the cached value for (namespace, params) or compute + store it."""
    key = _key(namespace, params)
    hit = _store.get(key)
    now = time.monotonic()
    if hit and now - hit[0] < ttl:
        return hit[1]
    value = compute()
    _store[key] = (now, value)
    return value


def clear(namespace: str | None = None) -> None:
    """Drop everything (data reset/import) or just one namespace."""
    if namespace is None:
        _store.clear()
    else:
        for k in [k for k in _store if k.startswith(f"{namespace}:")]:
            _store.pop(k, None)
