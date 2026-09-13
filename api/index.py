"""Vercel serverless entrypoint for the SupplyChainIQ API.

Reuses the existing FastAPI app (same routes, same lifespan — tables +
advisory-locked auto-seed on an empty database). Vercel serves the
frontend statically from frontend/dist; relative /api paths make
same-origin routing work identically in dev, Docker, and Vercel.

Serverless hardening: the SQLite fallback is disabled — DATABASE_URL must
point at a real Postgres (Neon free tier), otherwise data would be lost
when Vercel recycles the ephemeral instance.
"""
from __future__ import annotations

import sys
from pathlib import Path

# Vercel Python functions run from the repo root: make `app` importable.
BACKEND_DIR = Path(__file__).resolve().parent.parent / "backend"
sys.path.insert(0, str(BACKEND_DIR))

from app.database.session import db_manager  # noqa: E402

# No silent SQLite on serverless: fail loudly if DATABASE_URL is unreachable.
db_manager.allow_fallback = False

from app.main import app  # noqa: E402,F401  (re-exported for Vercel)
