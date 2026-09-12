"""Product & inventory service: listing with real filters, product detail pack,
inventory projection (stock vs demand vs reorder point), purchase history."""
from __future__ import annotations

import json
from datetime import date, timedelta

import numpy as np
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.analytics.eoq import recommended_order_qty
from app.analytics.forecasting import forecast_series
from app.analytics.inventory import (classify_status, days_of_inventory, days_until_reorder,
                                     reorder_point, safety_stock, stockout_risk)
from app.models import Category, InventoryDaily, Product, PurchaseOrder, Sale, Supplier
from app.services.settings_service import get_value


def _demand_series(db: Session, product_id: int, days: int) -> list[tuple[str, float]]:
    """Daily demand ending at the newest sale date in the DB (never wall-clock today,
    which breaks when the clock crosses a day boundary after seeding)."""
    last = db.execute(select(func.max(Sale.sale_date))).scalar()
    end = date.fromisoformat(str(last)) if last else date.today()
    start = (end - timedelta(days=days - 1)).isoformat()
    rows = db.execute(
        select(Sale.sale_date, func.sum(Sale.quantity))
        .where(Sale.product_id == product_id, Sale.sale_date >= start)
        .group_by(Sale.sale_date).order_by(Sale.sale_date)
    ).all()
    by_date = dict(rows)
    out = []
    for i in range(days):
        iso = (end - timedelta(days=days - 1) + timedelta(days=i)).isoformat()
        out.append((iso, float(by_date.get(iso, 0))))
    return out


def _latest_stock(db: Session, product_id: int) -> int:
    row = db.execute(
        select(InventoryDaily.closing_stock)
        .where(InventoryDaily.product_id == product_id)
        .order_by(InventoryDaily.date.desc()).limit(1)
    ).first()
    return int(row[0]) if row else 0


def _stock_series(db: Session, product_id: int, days: int) -> list[tuple[str, int]]:
    start = (date.today() - timedelta(days=days)).isoformat()
    rows = db.execute(
        select(InventoryDaily.date, InventoryDaily.closing_stock)
        .where(InventoryDaily.product_id == product_id, InventoryDaily.date >= start)
        .order_by(InventoryDaily.date)
    ).all()
    return [(d, int(s)) for d, s in rows]


def product_metrics(db: Session, p: Product, stock: int, window: int,
                    service_level: float, low_frac: float, overstock_days: int) -> dict:
    series = _demand_series(db, p.id, window)
    vals = [v for _, v in series]
    arr = np.asarray(vals) if vals else np.zeros(1)
    add = float(arr.mean())
    dstd = float(arr.std(ddof=1)) if len(arr) > 1 else 0.0
    ss = safety_stock(dstd, p.lead_time_days, service_level)
    rop = reorder_point(add, dstd, p.lead_time_days, service_level)
    doi = days_of_inventory(stock, add)
    status = classify_status(stock, add, rop, doi, overstock_days, low_frac)
    risk = stockout_risk(stock, add, dstd, p.lead_time_days, ss)
    return {
        "current_stock": stock,
        "avg_daily_demand": round(add, 2),
        "demand_std": round(dstd, 2),
        "safety_stock": round(ss, 1),
        "reorder_point": round(rop, 1),
        "days_of_inventory": round(doi, 1) if doi is not None else None,
        "days_until_reorder": (round(days_until_reorder(stock, add, rop), 1)
                               if days_until_reorder(stock, add, rop) is not None else None),
        "status": status,
        "risk_level": risk["risk"],
        "projected_stock_at_lead_time": round(risk["projected_stock_at_lead_time"], 1),
        "days_to_zero": round(risk["days_to_zero"], 1) if risk["days_to_zero"] is not None else None,
        "inventory_value": round(stock * p.unit_cost, 2),
    }


def list_products(db: Session, search: str | None = None, category: str | None = None,
                  status: str | None = None, supplier_id: int | None = None,
                  sort: str = "name", direction: str = "asc",
                  page: int = 1, page_size: int = 20) -> dict:
    window = int(get_value(db, "demand_window_days", 90))
    service_level = float(get_value(db, "service_level", 0.95))
    low_frac = float(get_value(db, "low_stock_fraction", 0.5))
    overstock_days = int(get_value(db, "overstock_days", 90))

    q = db.query(Product)
    if search:
        like = f"%{search.lower()}%"
        q = q.filter((func.lower(Product.name).like(like)) | (func.lower(Product.sku).like(like)))
    if supplier_id:
        q = q.filter(Product.supplier_id == supplier_id)
    products = q.all()
    cats = dict(db.execute(select(Category.id, Category.name)).all())
    sups = dict(db.execute(select(Supplier.id, Supplier.name)).all())
    if category:
        keep = {cid for cid, name in cats.items() if name.lower() == category.lower()}
        products = [p for p in products if p.category_id in keep]

    stock_map = {}
    if products:
        latest = (
            select(InventoryDaily.product_id, func.max(InventoryDaily.date).label("m"))
            .where(InventoryDaily.product_id.in_([p.id for p in products]))
            .group_by(InventoryDaily.product_id).subquery()
        )
        rows = db.execute(
            select(InventoryDaily.product_id, InventoryDaily.closing_stock)
            .join(latest, (latest.c.product_id == InventoryDaily.product_id)
                  & (latest.c.m == InventoryDaily.date))
        ).all()
        stock_map = dict(rows)

    items = []
    for p in products:
        if status and status not in ("All", ""):
            m = product_metrics(db, p, stock_map.get(p.id, 0), window, service_level, low_frac, overstock_days)
            if m["status"] != status:
                continue
        else:
            m = product_metrics(db, p, stock_map.get(p.id, 0), window, service_level, low_frac, overstock_days)
        items.append({
            "id": p.id, "sku": p.sku, "name": p.name,
            "category": cats.get(p.category_id, "?"),
            "supplier": sups.get(p.supplier_id) if p.supplier_id else None,
            "supplier_id": p.supplier_id,
            "unit_cost": p.unit_cost, "selling_price": p.selling_price,
            "lead_time_days": p.lead_time_days,
            **m,
        })

    reverse = direction.lower() == "desc"
    key_map = {
        "name": lambda r: r["name"].lower(),
        "stock": lambda r: r["current_stock"],
        "doi": lambda r: (r["days_of_inventory"] if r["days_of_inventory"] is not None else -1),
        "value": lambda r: r["inventory_value"],
        "demand": lambda r: r["avg_daily_demand"],
        "rop": lambda r: r["reorder_point"],
    }
    items.sort(key=key_map.get(sort, key_map["name"]), reverse=reverse)

    total = len(items)
    page = max(page, 1)
    page_size = max(min(page_size, 200), 1)
    page_items = items[(page - 1) * page_size: page * page_size]
    return {"items": page_items, "total": total, "page": page, "page_size": page_size,
            "categories": sorted(set(cats.values())), "suppliers": sorted(set(sups.values()))}


def product_detail(db: Session, product_id: int, horizon_days: int = 30) -> dict:
    p = db.get(Product, product_id)
    if p is None:
        raise LookupError(f"Product {product_id} not found")
    window = int(get_value(db, "demand_window_days", 90))
    service_level = float(get_value(db, "service_level", 0.95))
    low_frac = float(get_value(db, "low_stock_fraction", 0.5))
    overstock_days = int(get_value(db, "overstock_days", 90))

    stock = _latest_stock(db, product_id)
    metrics = product_metrics(db, p, stock, window, service_level, low_frac, overstock_days)

    # Charts: 120d history
    hist_days = 120
    stock_hist = [{"date": d, "stock": s} for d, s in _stock_series(db, product_id, hist_days)]
    demand_hist = [{"date": d, "quantity": v} for d, v in _demand_series(db, product_id, hist_days)]

    # Forecast with CI
    fdates = [d for d, _ in _demand_series(db, product_id, 120)]
    fvals = [v for _, v in _demand_series(db, product_id, 120)]
    fc = forecast_series(fdates, fvals, horizon=horizon_days)
    forecast_chart = ([{"date": d, "quantity": v} for d, v in _demand_series(db, product_id, 60)]
                      + [{"date": fp.date, "quantity": None, "forecast": fp.yhat,
                          "lower": fp.lower, "upper": fp.upper} for fp in fc.forecast])

    # Projection: stock vs demand vs safety/ROP over next `horizon_days` days
    projection = []
    proj_stock = float(stock)
    daily = metrics["avg_daily_demand"]
    for i in range(horizon_days + 1):
        iso = (date.today() + timedelta(days=i)).isoformat()
        if i > 0:
            proj_stock = max(proj_stock - daily, 0)
        projection.append({"date": iso, "stock": round(proj_stock, 1),
                           "reorder_point": metrics["reorder_point"],
                           "safety_stock": metrics["safety_stock"], "demand": None})
    # overlay cumulative expected demand
    cum = 0.0
    for i, row in enumerate(projection):
        if i > 0:
            cum += daily
            row["demand"] = max(stock - cum, 0)

    # Purchase history
    po_rows = (db.query(PurchaseOrder)
               .filter(PurchaseOrder.product_id == product_id)
               .order_by(PurchaseOrder.order_date.desc()).limit(25).all())
    po_list = [{
        "id": po.id, "po_number": po.po_number, "quantity": po.quantity,
        "unit_cost": po.unit_cost, "total_cost": round(po.quantity * po.unit_cost, 2),
        "order_date": po.order_date, "expected_date": po.expected_date,
        "actual_date": po.actual_date, "status": po.status,
        "supplier": db.get(Supplier, po.supplier_id).name if po.supplier_id else None,
    } for po in po_rows]

    # Decision packet: risk tier, why-packet, impact, supplier options —
    # computed by the same engine that powers the recommendation center.
    from app.services.recommendation_service import product_decision
    decision = product_decision(db, p, stock, metrics, overstock_days=overstock_days,
                                ordering_cost=float(get_value(db, "ordering_cost", 500)),
                                holding_rate=float(get_value(db, "holding_cost_rate", 0.20)))

    # Timeline markers for the stock-out simulation: the day projected stock
    # crosses the reorder point, the safety level, and zero — all derived.
    daily = metrics["avg_daily_demand"]

    def _cross_day(level: float) -> int | None:
        if daily <= 0 or stock <= level:
            return 0  # already at/below this level today
        return max(1, round((stock - level) / daily))

    timeline = {
        "reorder_point_day": _cross_day(metrics["reorder_point"]),
        "safety_stock_day": _cross_day(metrics["safety_stock"]),
        "stockout_day": _cross_day(0),
        "lead_time_days": p.lead_time_days,
    }

    cat = db.get(Category, p.category_id)
    sup = db.get(Supplier, p.supplier_id) if p.supplier_id else None

    # Outbound view: variant × warehouse stock, size risk, fulfillment and
    # return performance for THIS product (the complete product-health view).
    from app.services.outbound_service import outbound_product_view
    outbound = outbound_product_view(db, product_id)

    return {
        "id": p.id, "sku": p.sku, "name": p.name,
        "category": cat.name if cat else "?",
        "supplier": {"id": sup.id, "name": sup.name} if sup else None,
        "unit_cost": p.unit_cost, "selling_price": p.selling_price,
        "lead_time_days": p.lead_time_days, "active": p.active,
        "metrics": metrics,
        "stock_history": stock_hist,
        "demand_history": demand_hist,
        "forecast_chart": forecast_chart,
        "forecast_method": fc.method,
        "forecast_metrics": fc.metrics,
        "projection": projection,
        "risk_tier": decision["risk_tier"],
        "decision": decision,
        "timeline": timeline,
        "outbound": outbound,
        "purchase_orders": po_list,
        "formulas": {
            "safety_stock": "Z × σ(demand) × √(lead time)",
            "reorder_point": "avg_daily_demand × lead_time + safety_stock",
            "days_of_inventory": "current_stock / avg_daily_demand",
        },
    }


def product_audit(db: Session, product_id: int, limit: int = 20) -> dict:
    """Field-level change history for one product, sourced from the import log.

    Each entry records which import touched the product, who ran it, when, and
    the old → new value of every field that import overwrote.
    """
    p = db.get(Product, product_id)
    if p is None:
        raise LookupError(f"Product {product_id} not found")
    from app.models import ImportLog

    logs = (db.query(ImportLog)
            .filter(ImportLog.entity == "products", ImportLog.changes_json.isnot(None))
            .order_by(ImportLog.id.desc()).limit(200).all())
    events: list[dict] = []
    for log in logs:
        try:
            changes = json.loads(log.changes_json or "[]")
        except (TypeError, ValueError):
            continue
        for change in changes:
            if str(change.get("key", "")).lower() != p.sku.lower():
                continue
            events.append({
                "import_id": log.id,
                "filename": log.filename,
                "ran_at": log.ran_at.isoformat() if log.ran_at else None,
                "uploaded_by": log.uploaded_by,
                "uploaded_by_name": log.uploaded_by_name,
                "fields": change.get("fields", []),
            })
            if len(events) >= limit:
                break
        if len(events) >= limit:
            break
    return {"product_id": p.id, "sku": p.sku, "events": events}


def product_options(db: Session) -> list[dict]:
    rows = db.execute(select(Product.id, Product.sku, Product.name, Product.category_id)).all()
    cats = dict(db.execute(select(Category.id, Category.name)).all())
    return [{"id": r[0], "sku": r[1], "name": r[2], "category": cats.get(r[3], "?")} for r in rows]
