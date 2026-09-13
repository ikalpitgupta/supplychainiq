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
    from app.database.migrations import run_light_migrations
    run_light_migrations(engine)
    status = db_manager.status()
    logger.info("Database active: %s", status["active"])

    # First boot on a fresh database: seed deterministic demo data so the app
    # is fully usable immediately (idempotent — skips if products already exist).
    from sqlalchemy import select
    from app.models.product import Product
    with engine.connect() as conn:
        has_products = conn.execute(select(Product.id).limit(1)).first() is not None
    if not has_products:
        logger.info("Empty database detected — seeding demo data...")
        from app.database.seed import seed_demo_data
        counts = seed_demo_data()
        logger.info("Seeded: %s", counts)

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
    from fastapi.responses import FileResponse

    @app.get("/{full_path:path}", include_in_schema=False)
    def spa_fallback(full_path: str):
        """SPA fallback: serve real files when they exist, index.html otherwise,
        so deep links like /demo or /inventory work on a fresh browser load."""
        dist_root = frontend_dist.resolve()
        candidate = (dist_root / full_path).resolve() if full_path else dist_root / "index.html"
        if str(candidate).startswith(str(dist_root)) and candidate.is_file():
            return FileResponse(candidate)
        return FileResponse(dist_root / "index.html")

    app.mount("/", StaticFiles(directory=str(frontend_dist), html=True), name="frontend")
