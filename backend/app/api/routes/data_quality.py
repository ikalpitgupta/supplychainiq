"""Data Quality Center endpoint."""
from fastapi import APIRouter, Depends

from app.database.session import get_db
from app.services.data_quality_service import data_quality_report

router = APIRouter(prefix="/data-quality", tags=["data-quality"])


@router.get("")
def get_data_quality(db=Depends(get_db)):
    return data_quality_report(db)
