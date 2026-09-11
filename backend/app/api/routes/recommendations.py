"""Recommendations endpoints (decision center)."""
from fastapi import APIRouter, Depends

from app.database.session import get_db
from app.services.recommendation_service import build_recommendations, supplier_recommendations

router = APIRouter(prefix="/recommendations", tags=["recommendations"])


@router.get("")
def recommendations(db=Depends(get_db)):
    data = build_recommendations(db)
    data["supplier_reviews"] = supplier_recommendations(db)
    return data
