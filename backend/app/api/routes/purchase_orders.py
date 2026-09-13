"""Purchase order endpoints."""
from fastapi import APIRouter, Depends, Query

from app.database.session import get_db
from app.schemas import POCreateRequest, POStatusUpdate
from app.services.purchase_order_service import (create_purchase_order, list_purchase_orders,
                                                 po_form_context, update_purchase_order_status)
from app.utils.cache import clear as clear_cache

router = APIRouter(prefix="/purchase-orders", tags=["purchase-orders"])


@router.get("")
def list_pos(status: str | None = None, search: str | None = None,
             supplier_id: int | None = None, page: int = 1,
             page_size: int = Query(default=25, le=200), db=Depends(get_db)):
    return list_purchase_orders(db, status=status, search=search, supplier_id=supplier_id,
                                page=page, page_size=page_size)


@router.get("/form-context")
def form_context(product_id: int | None = None, db=Depends(get_db)):
    return po_form_context(db, product_id)


@router.post("")
def create_po(payload: POCreateRequest, db=Depends(get_db)):
    result = create_purchase_order(db, payload.model_dump())
    clear_cache()  # a new PO moves fulfillment + supplier metrics
    return result


@router.put("/{po_id}")
def update_po(po_id: int, payload: POStatusUpdate, db=Depends(get_db)):
    result = update_purchase_order_status(db, po_id, payload.status, payload.actual_date)
    clear_cache()  # status changes move fulfillment + supplier metrics
    return result
