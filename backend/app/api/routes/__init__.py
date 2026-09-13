"""API router registration."""
from fastapi import APIRouter

from app.api.routes import (analytics, auth, dashboard, data_quality, demo, fulfillment, import_export,
                            inbound, intelligence, outbound, pm, product_intelligence, products,
                            purchase_orders, rca, recommendations, settings, suppliers)

api_router = APIRouter(prefix="/api")
api_router.include_router(auth.router)
api_router.include_router(dashboard.router)
api_router.include_router(products.router)
api_router.include_router(suppliers.router)
api_router.include_router(purchase_orders.router)
api_router.include_router(fulfillment.router)
api_router.include_router(outbound.router)
api_router.include_router(inbound.router)
api_router.include_router(rca.router)
api_router.include_router(pm.router)
api_router.include_router(product_intelligence.router)
api_router.include_router(demo.router)
api_router.include_router(recommendations.router)
api_router.include_router(analytics.router)
api_router.include_router(data_quality.router)
api_router.include_router(intelligence.router)
api_router.include_router(settings.router)
api_router.include_router(import_export.router)
