"""Fulfillment (supplier-side pipeline) and returns endpoints."""
from fastapi import APIRouter, Depends, Query

from app.database.session import get_db
from app.services.fulfillment_service import fulfillment_summary, returns_summary

router = APIRouter(tags=["fulfillment"])


@router.get("/fulfillment/summary")
def fulfillment(period_days: int = Query(default=90, le=365), db=Depends(get_db)):
    return fulfillment_summary(db, period_days=period_days)


@router.get("/returns/summary")
def returns(db=Depends(get_db)):
    return returns_summary(db)
