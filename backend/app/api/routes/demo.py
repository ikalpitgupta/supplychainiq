"""Interview Demo Mode endpoints."""
from fastapi import APIRouter, Depends, Query

from app.database.session import get_db
from app.services.demo_service import demo_script
from app.utils.cache import cached

router = APIRouter(tags=["demo"])


@router.get("/demo/script")
def demo(days: int = Query(default=21, ge=7, le=90), db=Depends(get_db)):
    return cached("demo_script", {"days": days}, lambda: demo_script(db, days=days))
