"""Fulfillment (supplier-side pipeline) + Returns summary services.

Fulfillment: everything derives from real purchase-order rows — on-time rate,
lead times, delays, spend, monthly rhythm, late orders, and the inbound
pipeline. This is the honest DELIVERY stage for a dataset with no outbound
courier integration.

Returns: the dataset has no returns ledger. Rather than fake one, the service
states the gap and exposes return-*exposure* bands per line using published
category return-rate experience for fashion e-commerce, clearly labeled as
indicative, not measured.
"""
from __future__ import annotations

from collections import defaultdict
from datetime import date, timedelta

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.models import Category, Product, PurchaseOrder, Sale, Supplier


def _serialize_po(po: PurchaseOrder, prod_names: dict[int, str], supp_names: dict[int, str]) -> dict:
    """Same row shape as list_purchase_orders, so the frontend reuses POListItem."""
    days_late = 0
    if po.actual_date and po.actual_date > po.expected_date:
        days_late = (date.fromisoformat(po.actual_date) - date.fromisoformat(po.expected_date)).days
    return {
        "id": po.id, "po_number": po.po_number, "product_id": po.product_id,
        "product": prod_names.get(po.product_id, "?"), "supplier_id": po.supplier_id,
        "supplier": supp_names.get(po.supplier_id, "?"), "quantity": po.quantity,
        "unit_cost": po.unit_cost, "total_cost": round(po.quantity * po.unit_cost, 2),
        "order_date": po.order_date, "expected_date": po.expected_date,
        "actual_date": po.actual_date, "status": po.status, "days_late": days_late,
    }


def fulfillment_summary(db: Session, period_days: int = 90) -> dict:
    """Supplier-side fulfillment performance from real purchase orders."""
    end = date.today() - timedelta(days=1)
    start = (end - timedelta(days=period_days)).isoformat()

    pos = db.execute(
        select(PurchaseOrder)
        .where(PurchaseOrder.order_date >= start)
        .order_by(PurchaseOrder.order_date.desc())
    ).scalars().all()

    status_counts: dict[str, int] = defaultdict(int)
    delivered = late_pos = 0
    lead_days: list[int] = []
    late_days: list[int] = []
    spend_total = 0.0
    monthly: dict[str, dict] = {}

    for po in pos:
        status_counts[po.status] += 1
        spend_total += po.quantity * po.unit_cost
        mk = po.order_date[:7]
        m = monthly.setdefault(mk, {"month": mk, "orders": 0, "on_time": 0, "late": 0, "spend": 0.0})
        m["orders"] += 1
        m["spend"] += po.quantity * po.unit_cost
        if po.status == "Delivered" and po.actual_date:
            lead = (date.fromisoformat(po.actual_date) - date.fromisoformat(po.order_date)).days
            lead_days.append(lead)
            if po.actual_date <= po.expected_date:
                delivered += 1
                m["on_time"] += 1
            else:
                late_pos += 1
                late_days.append((date.fromisoformat(po.actual_date) - date.fromisoformat(po.expected_date)).days)
                m["late"] += 1

    # 30-day vs prior-30-day spend momentum.
    d30 = (end - timedelta(days=30)).isoformat()
    d60 = (end - timedelta(days=60)).isoformat()
    spend_30d = sum(po.quantity * po.unit_cost for po in pos if po.order_date >= d30)
    spend_30d_prev = sum(po.quantity * po.unit_cost for po in pos if d60 <= po.order_date < d30)

    closed = delivered + late_pos
    on_time_rate = delivered / closed if closed else 0.0

    prod_names = dict(db.execute(select(Product.id, Product.name)).all())
    supp_names = dict(db.execute(select(Supplier.id, Supplier.name)).all())
    po_list = [_serialize_po(po, prod_names, supp_names) for po in pos]

    # Purchase price variance: mean signed gap of PO unit cost vs master cost (%).
    master = dict(db.execute(select(Product.id, Product.unit_cost)).all())
    gaps = [(po.unit_cost - master[po.product_id]) / master[po.product_id] * 100
            for po in pos if po.product_id in master and master[po.product_id] > 0]

    return {
        "period_days": period_days,
        "status_counts": dict(status_counts),
        "total_pos": len(pos),
        "on_time_rate": round(on_time_rate, 4),
        "delay_rate": round(1 - on_time_rate, 4),
        "avg_lead_time_days": round(sum(lead_days) / len(lead_days), 2) if lead_days else None,
        "avg_delay_days": round(sum(late_days) / len(late_days), 2) if late_days else None,
        "spend_total": round(spend_total, 2),
        "spend_30d": round(spend_30d, 2),
        "spend_30d_prev": round(spend_30d_prev, 2),
        "price_variance_pct": round(sum(gaps) / len(gaps), 2) if gaps else None,
        "monthly": sorted(monthly.values(), key=lambda m: m["month"]),
        "late_orders": [p for p in po_list if p["status"] == "Delivered" and p["days_late"] > 0],
        "inbound": [p for p in po_list if p["status"] in ("In Transit", "Delayed", "Pending", "Draft")],
    }


# ---------------------------------------------------------------------------
# Returns — honest placeholder
# ---------------------------------------------------------------------------

# Published category return-rate experience for Indian fashion e-commerce
# (used ONLY as clearly-labeled indicative bands, never presented as measured
# data). Higher bands reflect categories where fit/expectation gaps dominate.
RETURN_EXPERIENCE_BANDS: dict[str, tuple[float, str]] = {
    "Fashion": (0.25, "High exposure — fit and styling returns dominate apparel"),
    "Footwear": (0.30, "High exposure — sizing returns dominate footwear"),
    "Sportswear": (0.18, "Elevated — fit and fabric-feel returns"),
    "Accessories": (0.12, "Elevated — expectation gaps on look and finish"),
    "Bags & Luggage": (0.10, "Elevated — expectation gaps on size and finish"),
    "Home & Living": (0.08, "Moderate — colour/finish expectation gaps"),
    "Beauty": (0.06, "Moderate — hygiene rules limit try-and-return behaviour"),
    "Personal Care": (0.06, "Moderate — hygiene rules limit try-and-return behaviour"),
}


def returns_summary(db: Session) -> dict:
    """State the data gap honestly; expose return-exposure bands from real sales."""
    top = db.execute(
        select(
            Product.id, Product.name, Category.name.label("category"),
            func.sum(Sale.quantity).label("units"),
            func.sum(Sale.revenue).label("revenue"),
        )
        .join(Sale, Sale.product_id == Product.id)
        .join(Category, Category.id == Product.category_id)
        .where(Sale.sale_date >= (date.today() - timedelta(days=365)).isoformat())
        .group_by(Product.id, Product.name, Category.name)
        .order_by(func.sum(Sale.revenue).desc())
        .limit(8)
    ).all()

    lines = []
    for pid, name, cat, units, revenue in top:
        band_spec = RETURN_EXPERIENCE_BANDS.get(cat)
        if band_spec:
            rate, note = band_spec
            band = f"High ({rate:.0%})" if rate >= 0.25 else (
                f"Elevated ({rate:.0%})" if rate >= 0.10 else f"Moderate ({rate:.0%})")
        else:
            band, note = "Moderate", "No category benchmark — treat as baseline"
        lines.append({
            "product_id": pid,
            "product": name,
            "category": cat,
            "sold_365d": int(units or 0),
            "revenue_365d": float(revenue or 0),
            "return_band": band,
            "exposure_note": note,
        })

    return {
        "available": False,
        "message": "No returns ledger exists in this dataset yet.",
        "reason": ("Return records (RMA, reason, resale state) are not part of the seeded data model, "
                   "so no return rate can be computed without inventing numbers. This page makes the gap "
                   "explicit and shows where a returns feed would plug in."),
        "scope": ("inbound supplier delivery and the purchase-order pipeline are fully modeled; outbound "
                  "customer delivery and returns are not"),
        "indicative_rate_pct": 0.25,
        "selling_price_exposed": True,
        "top_lines": lines,
    }
