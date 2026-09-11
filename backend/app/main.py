"""SupplyChainIQ API entrypoint."""
from __future__ import annotations

import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.core.config import cors_origin_list, settings
from app.database.session import Base, db_manager
from app.utils.errors import register_error_handlers
from fastapi.staticfiles import StaticFiles

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("supplychainiq")


@asynccontextmanager
async def lifespan(app: FastAPI):
    engine = db_manager.engine()
    Base.metadata.create_all(engine)
    # Lightweight migration: add columns introduced after the first release to
    # tables that already exist (create_all only makes missing tables).
    from sqlalchemy import inspect, text

    insp = inspect(engine)
    if "import_logs" in insp.get_table_names():
        cols = {c["name"] for c in insp.get_columns("import_logs")}
        with engine.begin() as conn:
            if "changes_json" not in cols:
                conn.execute(text("ALTER TABLE import_logs ADD COLUMN changes_json TEXT"))
    status = db_manager.status()
    logger.info("Database active: %s", status["active"])
    yield


app = FastAPI(title=settings.app_name, version="1.0.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=cors_origin_list(),
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

register_error_handlers(app)

from app.api.routes import api_router  # noqa: E402

app.include_router(api_router)


@app.get("/api/health")
def health():
    return {"status": "ok", "database": db_manager.status()}


# Optional: serve the built frontend (production mode) if present.
frontend_dist = None
try:
    from pathlib import Path
    candidate = Path(__file__).resolve().parents[2] / "frontend" / "dist"
    if candidate.exists():
        frontend_dist = candidate
except Exception:  # pragma: no cover
    frontend_dist = None

if frontend_dist is not None:
    app.mount("/", StaticFiles(directory=str(frontend_dist), html=True), name="frontend")
