"""API router registration."""
from fastapi import APIRouter

from app.api.routes import (analytics, auth, dashboard, data_quality, import_export,
                            intelligence, products, purchase_orders, recommendations,
                            settings, suppliers)

api_router = APIRouter(prefix="/api")
api_router.include_router(auth.router)
api_router.include_router(dashboard.router)
api_router.include_router(products.router)
api_router.include_router(suppliers.router)
api_router.include_router(purchase_orders.router)
api_router.include_router(recommendations.router)
api_router.include_router(analytics.router)
api_router.include_router(data_quality.router)
api_router.include_router(intelligence.router)
api_router.include_router(settings.router)
api_router.include_router(import_export.router)
