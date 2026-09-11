"""Anomaly service: portfolio scans for demand anomalies and supplier delays."""
from __future__ import annotations

from datetime import date, timedelta

import numpy as np
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.analytics.anomaly import demand_anomaly, spike_recommendation
from app.models import InventoryDaily, Product, PurchaseOrder, Sale, Supplier


def _demand_series(db: Session, product_id: int, days: int = 60) -> list[tuple[str, float]]:
    last = db.execute(select(func.max(Sale.sale_date))).scalar()
    end = date.fromisoformat(str(last)) if last else date.today()
    start = (end - timedelta(days=days - 1)).isoformat()
    rows = db.execute(
        select(Sale.sale_date, func.sum(Sale.quantity))
        .where(Sale.product_id == product_id, Sale.sale_date >= start)
        .group_by(Sale.sale_date)
    ).all()
    by_date = dict(rows)
    return [((start_iso := (end - timedelta(days=days - 1) + timedelta(days=i)).isoformat()),
             float(by_date.get(start_iso, 0))) for i in range(days)]


def _latest_stock(db: Session, product_id: int) -> int:
    row = db.execute(
        select(InventoryDaily.closing_stock)
        .where(InventoryDaily.product_id == product_id)
        .order_by(InventoryDaily.date.desc()).limit(1)
    ).first()
    return int(row[0]) if row else 0


def scan_anomalies(db: Session, threshold: float = 2.5, limit: int = 12) -> dict:
    """Scan every product's trailing 60-day demand for anomalies; the newest
    anomaly per product is kept. Returns anomalies + derived spike actions."""
    products = db.query(Product).all()
    out = []
    for p in products:
        series = _demand_series(db, p.id, 60)
        if len(series) < 25:
            continue
        a = demand_anomaly(series, window=14, threshold=threshold)
        if a is None or a.direction != "spike":
            continue
        baseline = a.baseline_mean
        stock = _latest_stock(db, p.id)
        rec = spike_recommendation(baseline, a.value, p.lead_time_days, stock, p.unit_cost)
        out.append({
            **a.to_dict(),
            "key": p.id, "label": p.name, "sku": p.sku, "category_id": p.category_id,
            "spike_action": rec if rec.get("applies") else None,
            "investigate_link": f"/products/{p.id}",
        })
    out.sort(key=lambda x: x["z"], reverse=True)
    return {"anomalies": out[:limit], "scanned": len(products),
            "threshold": threshold, "window_days": 14}


def supplier_delay_anomalies(db: Session) -> list[dict]:
    """Suppliers whose recent on-time rate dropped materially vs lifetime baseline."""
    cutoff = (date.today() - timedelta(days=90)).isoformat()
    rows = db.execute(
        select(PurchaseOrder.supplier_id, PurchaseOrder.expected_date, PurchaseOrder.actual_date)
        .where(PurchaseOrder.order_date >= cutoff)
    ).all()
    by_sup: dict[int, list[int]] = {}
    for sid, exp, act in rows:
        if act:
            by_sup.setdefault(sid, []).append(1 if act <= exp else 0)
    sups = {s.id: s for s in db.query(Supplier).all()}
    out = []
    for sid, flags in by_sup.items():
        s = sups.get(sid)
        if s is None or len(flags) < 4:
            continue
        recent_rate = sum(flags) / len(flags) * 100
        baseline = s.on_time_rate * 100
        drop = baseline - recent_rate
        if drop >= 10 and recent_rate < 80:
            out.append({
                "series": "supplier_delay", "key": sid, "label": s.name,
                "value": round(recent_rate, 1), "baseline_mean": round(baseline, 1),
                "direction": "drop",
                "explanation": (f"On-time delivery fell to {recent_rate:.0f}% over the last 90 days "
                                f"versus a {baseline:.0f}% lifetime baseline."),
                "investigate_link": f"/suppliers/{sid}",
            })
    out.sort(key=lambda x: x["baseline_mean"] - x["value"], reverse=True)
    return out
