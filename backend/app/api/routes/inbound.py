"""Inbound Intelligence endpoints: procurement linkage, catalog quality,
pricing, and promotions — four lenses, one module."""
from fastapi import APIRouter, Depends, Query

from app.database.session import get_db
from app.services import inbound_service as svc

router = APIRouter(prefix="/inbound", tags=["inbound"])


@router.get("/summary")
def inbound_summary(days: int = Query(default=90, le=365), db=Depends(get_db)):
    return svc.inbound_summary(db, days=days)


@router.get("/procurement")
def procurement(days: int = Query(default=120, le=365), db=Depends(get_db)):
    return svc.procurement_linkage(db, days=days)


@router.get("/catalog-quality")
def catalog_quality(db=Depends(get_db)):
    return svc.catalog_quality(db)


@router.get("/pricing")
def pricing(days: int = Query(default=90, le=365), db=Depends(get_db)):
    return svc.pricing_intel(db, days=days)


@router.get("/promotions")
def promotions(days: int = Query(default=90, le=365), db=Depends(get_db)):
    return svc.promotions_intel(db, days=days)
