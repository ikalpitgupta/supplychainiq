"""Database engine + session management.

Primary target is PostgreSQL (see docker-compose.yml). If Postgres cannot be
reached (e.g. Docker not installed on the demo machine), we transparently fall
back to a local SQLite file so the application always runs. The fallback is
reported via `db_status()` and surfaced on the Settings page — never silently.
"""
from __future__ import annotations

import threading
from pathlib import Path

from sqlalchemy import create_engine, text
from sqlalchemy.orm import DeclarativeBase, sessionmaker

from app.core.config import settings


class Base(DeclarativeBase):
    pass


class DatabaseManager:
    """Owns the active engine; resolves Postgres -> SQLite fallback once."""

    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._engine = None
        self._resolved = False
        self.using_fallback = False
        self.last_error: str | None = None

    def _try_postgres(self) -> bool:
        try:
            engine = create_engine(
                settings.database_url,
                pool_pre_ping=True,
                pool_size=5,
                max_overflow=5,
                connect_args={"connect_timeout": 3},
            )
            with engine.connect() as conn:
                conn.execute(text("SELECT 1"))
            self._engine = engine
            self.using_fallback = False
            self.last_error = None
            return True
        except Exception as exc:  # pragma: no cover - depends on local env
            self.last_error = str(exc).split("\n")[0][:300]
            return False

    def engine(self):
        with self._lock:
            if not self._resolved:
                self._resolved = True
                if not self._try_postgres():
                    url = settings.sqlite_fallback_url
                    if url.startswith("sqlite:///./"):
                        Path(url.replace("sqlite:///./", "")).parent.mkdir(parents=True, exist_ok=True)
                    self._engine = create_engine(
                        url,
                        connect_args={"check_same_thread": False} if url.startswith("sqlite") else {},
                    )
                    self.using_fallback = True
            return self._engine

    def sessionmaker(self) -> sessionmaker:
        return sessionmaker(bind=self.engine(), autoflush=False, expire_on_commit=False)

    def status(self) -> dict:
        self.engine()  # force resolution
        return {
            "primary": "PostgreSQL",
            "active": "SQLite (fallback)" if self.using_fallback else "PostgreSQL",
            "using_fallback": self.using_fallback,
            "last_error": self.last_error,
        }


db_manager = DatabaseManager()


def get_db():
    """FastAPI dependency yielding a database session."""
    db = db_manager.sessionmaker()()
    try:
        yield db
    finally:
        db.close()
