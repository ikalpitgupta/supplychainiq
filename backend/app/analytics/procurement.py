"""Procurement intelligence: spend concentration, single-source risk, and
price-trend analysis — all from purchase-order history.
"""
from __future__ import annotations

from datetime import date, timedelta


def supplier_concentration(spend_by_supplier: dict[int, float], total_spend: float) -> dict:
    """Portfolio-level supplier dependency, classified by top-supplier share.

    Top share is the primary signal (what a manager reads: 'we depend on one
    supplier for X% of spend'): >=50% high, >=35% moderate, else low. HHI is
    reported alongside as a supporting metric — note that with few suppliers
    HHI has a high floor (N suppliers => minimum 10000/N), so it alone can't
    separate a balanced 3-supplier portfolio from a lopsided one.
    """
    if total_spend <= 0 or not spend_by_supplier:
        return {"hhi": None, "level": "unknown", "top_share_pct": None, "shares": []}
    shares = sorted(
        [{"supplier_id": sid, "share_pct": round(v / total_spend * 100, 1)}
         for sid, v in spend_by_supplier.items()],
        key=lambda x: x["share_pct"], reverse=True)
    hhi = round(sum(s["share_pct"] ** 2 for s in shares))
    top = shares[0]["share_pct"]
    level = "high" if top >= 50 else "moderate" if top >= 35 else "low"
    return {"hhi": hhi, "level": level, "top_share_pct": top, "shares": shares[:8]}


def product_concentration(spend_by_supplier_for_product: dict[int, float]) -> dict | None:
    """Single-product supplier dependency. Flags when one supplier holds >70%."""
    total = sum(spend_by_supplier_for_product.values())
    if total <= 0 or not spend_by_supplier_for_product:
        return None
    top_sid, top_spend = max(spend_by_supplier_for_product.items(), key=lambda kv: kv[1])
    share = top_spend / total
    if share < 0.70 or len(spend_by_supplier_for_product) < 2:
        return None
    return {
        "top_supplier_id": top_sid,
        "share_pct": round(share * 100, 1),
        "n_suppliers": len(spend_by_supplier_for_product),
        "suggestion": (f"~{share * 100:.0f}% of this product's purchase volume comes from one "
                       f"supplier. Analytical suggestion: qualify a second source and shift "
                       f"15-20% of volume once quality is validated."),
    }


def price_trend(po_rows: list[dict], split_days: int = 90) -> dict | None:
    """Unit-cost drift for one product: recent-window average vs prior-window.

    po_rows: [{order_date, unit_cost, quantity}]. Returns None when either
    window is empty — never invents a trend from thin data.
    """
    if len(po_rows) < 4:
        return None
    cutoff = (date.today() - timedelta(days=split_days)).isoformat()
    recent = [r["unit_cost"] for r in po_rows if r["order_date"] >= cutoff]
    prior = [r["unit_cost"] for r in po_rows if r["order_date"] < cutoff]
    if not recent or not prior:
        return None
    recent_avg = sum(recent) / len(recent)
    prior_avg = sum(prior) / len(prior)
    if prior_avg <= 0:
        return None
    change_pct = (recent_avg - prior_avg) / prior_avg * 100
    if abs(change_pct) < 3:      # noise floor
        return None
    return {
        "recent_avg_cost": round(recent_avg, 2),
        "prior_avg_cost": round(prior_avg, 2),
        "change_pct": round(change_pct, 1),
        "direction": "increase" if change_pct > 0 else "decrease",
    }
