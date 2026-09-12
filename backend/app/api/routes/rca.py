"""Root Cause Analysis endpoints: problem detection + hypothesis trees."""
from fastapi import APIRouter, Depends, Query

from app.database.session import get_db
from app.services import rca_service as svc

router = APIRouter(prefix="/rca", tags=["rca"])


@router.get("/analysis")
def analysis(days: int = Query(default=21, le=90, ge=7), db=Depends(get_db)):
    """Detect problems in the recent window and investigate each one."""
    return svc.analyze(db, days=days)


@router.get("/problems")
def problems(days: int = Query(default=21, le=90, ge=7), db=Depends(get_db)):
    """Lightweight problem list without investigation trees."""
    return svc.rca_problems(db, days=days)
