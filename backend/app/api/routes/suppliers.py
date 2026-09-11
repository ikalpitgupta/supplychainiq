"""Supplier endpoints."""
from fastapi import APIRouter, Depends, Query

from app.database.session import get_db
from app.services.supplier_service import list_suppliers, supplier_detail

router = APIRouter(prefix="/suppliers", tags=["suppliers"])


@router.get("")
def suppliers(search: str | None = None, risk: str | None = None, sort: str = "score",
              db=Depends(get_db)):
    return list_suppliers(db, search=search, risk=risk, sort=sort)


@router.get("/{supplier_id}")
def supplier(supplier_id: int, db=Depends(get_db)):
    return supplier_detail(db, supplier_id)
