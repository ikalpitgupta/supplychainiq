"""Analytics endpoint: inventory/procurement/sales/efficiency + ABC + insights."""
from fastapi import APIRouter, Depends, Query

from app.database.session import get_db
from app.services.analytics_service import analytics_overview

router = APIRouter(prefix="/analytics", tags=["analytics"])


@router.get("")
def analytics(period_days: int = Query(default=365, le=730), db=Depends(get_db)):
    return analytics_overview(db, period_days=period_days)
