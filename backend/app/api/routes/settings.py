"""Settings endpoints: business parameters, preferences, demo reset."""
from fastapi import APIRouter, Depends

from app.core.security import require_admin
from app.database.session import get_db
from app.schemas import SettingsUpdate
from app.services.settings_service import get_all_settings, update_settings

router = APIRouter(prefix="/settings", tags=["settings"])


@router.get("")
def read_settings(db=Depends(get_db)):
    return {"values": get_all_settings(db)}


@router.put("")
def write_settings(payload: SettingsUpdate, db=Depends(get_db)):
    return {"values": update_settings(db, payload.values)}


@router.post("/reset-demo")
def reset_demo(user: dict = Depends(require_admin), db=Depends(get_db)):
    from app.database.seed import seed_demo_data
    counts = seed_demo_data()
    from app.utils.cache import clear as clear_cache
    clear_cache()  # fresh data in, stale analytics out
    return {"message": "Demo data has been reset", "counts": counts}
