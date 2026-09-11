"""Dashboard endpoint: KPIs, health mix, demand trend, alerts, executive summary."""
from fastapi import APIRouter, Depends, Query

from app.database.session import get_db
from app.services.dashboard_service import compute_dashboard

router = APIRouter(prefix="/dashboard", tags=["dashboard"])


@router.get("")
def dashboard(category: str | None = None,
              period: int = Query(default=90, alias="period"),
              db=Depends(get_db)):
    return compute_dashboard(db, category=category, period=period)
