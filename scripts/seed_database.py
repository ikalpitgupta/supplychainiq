"""Seed the database with deterministic demo data.

Usage:
    python scripts/seed_database.py            # from repo root or backend/
"""
from __future__ import annotations

import sys
from pathlib import Path

BACKEND_DIR = Path(__file__).resolve().parents[1] / "backend"
sys.path.insert(0, str(BACKEND_DIR))

from app.database.seed import seed_demo_data  # noqa: E402
from app.database.session import Base, db_manager  # noqa: E402
import app.models  # noqa: F401,E402  (register models)


def main() -> None:
    Base.metadata.create_all(db_manager.engine())
    counts = seed_demo_data()
    status = db_manager.status()
    print("SupplyChainIQ database seeded")
    print(f"  Database : {status['active']}")
    for k, v in counts.items():
        print(f"  {k:<16}: {v}")


if __name__ == "__main__":
    main()
