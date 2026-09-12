"""Outbound supply-chain endpoints: size availability, fulfillment bottleneck,
delivery SLA, root-cause chain, customer impact, actions."""
from fastapi import APIRouter, Depends, Query

from app.database.session import get_db
from app.services import outbound_service as svc

router = APIRouter(prefix="/outbound", tags=["outbound"])


@router.get("/summary")
def outbound_summary(days: int = Query(default=30, le=120), db=Depends(get_db)):
    return svc.outbound_summary(db, days=days)


@router.get("/size-availability")
def size_availability(category: str | None = None, limit: int = Query(default=12, le=50), db=Depends(get_db)):
    return svc.size_availability(db, category=category, limit=limit)


@router.get("/fulfillment-bottleneck")
def fulfillment_bottleneck(days: int = Query(default=30, le=120), db=Depends(get_db)):
    return svc.fulfillment_bottleneck(db, days=days)


@router.get("/delivery-sla")
def delivery_sla(days: int = Query(default=30, le=120), db=Depends(get_db)):
    return svc.delivery_sla(db, days=days)


@router.get("/root-cause")
def root_cause(days: int = Query(default=30, le=120), db=Depends(get_db)):
    return svc.root_cause_chain(db, days=days)


@router.get("/customer-impact")
def customer_impact(days: int = Query(default=30, le=120), db=Depends(get_db)):
    return svc.customer_impact(db, days=days)


@router.get("/actions")
def actions(days: int = Query(default=30, le=120), db=Depends(get_db)):
    return svc.outbound_actions(db, days=days)


@router.get("/returns")
def returns_intel(days: int = Query(default=90, le=365), db=Depends(get_db)):
    return svc.returns_intel(db, days=days)
