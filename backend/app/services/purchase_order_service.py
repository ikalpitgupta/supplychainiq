"""Purchase order service: listing, creation (with recommendation context), status updates."""
from __future__ import annotations

from datetime import date, timedelta

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.models import InventoryDaily, Product, PurchaseOrder, Supplier
from app.services.product_service import product_metrics
from app.services.settings_service import get_value

VALID_STATUSES = ["Draft", "Pending", "Ordered", "In Transit", "Delivered", "Delayed", "Cancelled"]
OPEN_STATUSES = ["Draft", "Pending", "Ordered", "In Transit"]


def _next_po_number(db: Session) -> str:
    n = (db.scalar(select(func.count()).select_from(PurchaseOrder)) or 0) + 1
    return f"PO-{date.today().strftime('%y%m')}-{n:04d}"


def list_purchase_orders(db: Session, status: str | None = None, search: str | None = None,
                         supplier_id: int | None = None, page: int = 1, page_size: int = 25) -> dict:
    q = db.query(PurchaseOrder)
    if status and status != "All":
        q = q.filter(PurchaseOrder.status == status)
    if supplier_id:
        q = q.filter(PurchaseOrder.supplier_id == supplier_id)
    if search:
        like = f"%{search.lower()}%"
        q = q.filter(func.lower(PurchaseOrder.po_number).like(like))
    total = q.count()
    rows = (q.order_by(PurchaseOrder.order_date.desc(), PurchaseOrder.id.desc())
             .offset((max(page, 1) - 1) * page_size).limit(page_size).all())
    prod_names = dict(db.execute(select(Product.id, Product.name)).all())
    sup_names = dict(db.execute(select(Supplier.id, Supplier.name)).all())
    items = [{
        "id": po.id, "po_number": po.po_number, "product_id": po.product_id,
        "product": prod_names.get(po.product_id, "?"), "supplier_id": po.supplier_id,
        "supplier": sup_names.get(po.supplier_id, "?"), "quantity": po.quantity,
        "unit_cost": po.unit_cost, "total_cost": round(po.quantity * po.unit_cost, 2),
        "order_date": po.order_date, "expected_date": po.expected_date,
        "actual_date": po.actual_date, "status": po.status,
        "days_late": (max((date.fromisoformat(po.actual_date) - date.fromisoformat(po.expected_date)).days, 0)
                      if po.actual_date and po.actual_date > po.expected_date else 0),
    } for po in rows]
    counts = dict(db.execute(select(PurchaseOrder.status, func.count())
                             .group_by(PurchaseOrder.status)).all())
    return {"items": items, "total": total, "page": page, "page_size": page_size,
            "status_counts": counts, "valid_statuses": VALID_STATUSES}


def create_purchase_order(db: Session, payload: dict) -> dict:
    """Create a PO. Validates product/supplier, auto-fills unit cost and po_number."""
    product = db.get(Product, int(payload.get("product_id", 0)))
    if product is None:
        raise LookupError("Product not found")
    supplier = db.get(Supplier, int(payload.get("supplier_id", 0)))
    if supplier is None:
        raise LookupError("Supplier not found — select a valid supplier for this order")
    qty = int(payload.get("quantity", 0))
    if qty <= 0:
        raise ValueError("Quantity must be a positive number")
    order_date = payload.get("order_date") or date.today().isoformat()
    try:
        date.fromisoformat(order_date)
    except ValueError:
        raise ValueError("order_date must be an ISO date (YYYY-MM-DD)")
    expected = payload.get("expected_date")
    if not expected:
        expected = (date.fromisoformat(order_date) + timedelta(days=supplier.lead_time_days)).isoformat()
    else:
        try:
            date.fromisoformat(expected)
        except ValueError:
            raise ValueError("expected_date must be an ISO date (YYYY-MM-DD)")

    unit_cost = product.unit_cost
    po = PurchaseOrder(
        po_number=_next_po_number(db), product_id=product.id, supplier_id=supplier.id,
        quantity=qty, unit_cost=unit_cost, order_date=order_date,
        expected_date=expected, actual_date=None,
        status=payload.get("status") or "Pending",
    )
    if po.status not in VALID_STATUSES:
        raise ValueError(f"Invalid status '{po.status}'. Valid: {', '.join(VALID_STATUSES)}")
    db.add(po)
    db.commit()
    return {
        "id": po.id, "po_number": po.po_number, "product_id": po.product_id,
        "product": product.name, "supplier_id": po.supplier_id, "supplier": supplier.name,
        "quantity": po.quantity, "unit_cost": po.unit_cost,
        "total_cost": round(po.quantity * po.unit_cost, 2),
        "order_date": po.order_date, "expected_date": po.expected_date,
        "actual_date": None, "status": po.status,
        "supplier_lead_time_days": supplier.lead_time_days,
        "note": payload.get("note"),
    }


def update_purchase_order_status(db: Session, po_id: int, status: str,
                                 actual_date: str | None = None) -> dict:
    po = db.get(PurchaseOrder, po_id)
    if po is None:
        raise LookupError(f"Purchase order {po_id} not found")
    if status not in VALID_STATUSES:
        raise ValueError(f"Invalid status '{status}'. Valid: {', '.join(VALID_STATUSES)}")
    po.status = status
    if status == "Delivered" and not po.actual_date:
        po.actual_date = actual_date or date.today().isoformat()
    db.commit()
    return {"id": po.id, "po_number": po.po_number, "status": po.status,
            "actual_date": po.actual_date}


def po_form_context(db: Session, product_id: int | None = None) -> dict:
    """Context for the Create PO dialog: products, suppliers, and per-product guidance."""
    products = db.query(Product).order_by(Product.name).all()
    sups = db.query(Supplier).order_by(Supplier.name).all()
    window = int(get_value(db, "demand_window_days", 90))
    service_level = float(get_value(db, "service_level", 0.95))
    low_frac = float(get_value(db, "low_stock_fraction", 0.5))
    overstock_days = int(get_value(db, "overstock_days", 90))
    ordering_cost = float(get_value(db, "ordering_cost", 500))
    holding_rate = float(get_value(db, "holding_cost_rate", 0.20))

    from app.analytics.eoq import recommended_order_qty
    context: dict | None = None
    if product_id:
        p = db.get(Product, product_id)
        if p:
            latest_stock = db.execute(
                select(InventoryDaily.closing_stock)
                .where(InventoryDaily.product_id == product_id)
                .order_by(InventoryDaily.date.desc()).limit(1)
            ).first()
            stock = int(latest_stock[0]) if latest_stock else 0
            m = product_metrics(db, p, stock, window, service_level, low_frac, overstock_days)
            rec_qty = recommended_order_qty(m["avg_daily_demand"], p.unit_cost, p.lead_time_days,
                                            m["safety_stock"], ordering_cost, holding_rate)
            sup = db.get(Supplier, p.supplier_id) if p.supplier_id else None
            context = {
                "product_id": p.id, "product_name": p.name,
                "current_stock": stock, "reorder_point": m["reorder_point"],
                "safety_stock": m["safety_stock"], "avg_daily_demand": m["avg_daily_demand"],
                "status": m["status"], "lead_time_days": p.lead_time_days,
                "recommended_quantity": rec_qty, "unit_cost": p.unit_cost,
                "estimated_cost": round(rec_qty * p.unit_cost, 2),
                "default_supplier_id": p.supplier_id,
                "default_supplier_name": sup.name if sup else None,
            }
    return {
        "products": [{"id": p.id, "name": p.name, "sku": p.sku,
                      "supplier_id": p.supplier_id, "unit_cost": p.unit_cost} for p in products],
        "suppliers": [{"id": s.id, "name": s.name, "lead_time_days": s.lead_time_days,
                       "unit_cost": s.unit_cost} for s in sups],
        "context": context,
    }
