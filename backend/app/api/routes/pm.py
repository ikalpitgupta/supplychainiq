"""PM decision layer endpoints: structured product initiatives with RICE,
experiment designs, and evidence-grounded decisions."""
from fastapi import APIRouter, Depends

from app.database.session import get_db
from app.services import pm_service as svc

router = APIRouter(prefix="/pm", tags=["pm"])


@router.get("/decisions")
def decisions(db=Depends(get_db)):
    """Full decision layer: initiatives with opportunity, RICE, experiment,
    decision, and business impact."""
    return svc.decision_layer(db)


@router.get("/decisions/summary")
def decisions_summary(db=Depends(get_db)):
    return svc.decision_layer_summary(db)
