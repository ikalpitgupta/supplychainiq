"""Supplier scorecard: transparent weighted scoring of normalized metrics.

Weights: 30% delivery (on-time rate), 25% quality (1 - defect rate),
         25% cost (unit-cost index, lower is better), 20% reliability.
Each component is min-max normalized across the supplier set to 0-100.
"""
from __future__ import annotations

from dataclasses import dataclass

WEIGHTS = {"delivery": 0.30, "quality": 0.25, "cost": 0.25, "reliability": 0.20}


@dataclass
class SupplierScoreRow:
    supplier_id: int
    name: str
    on_time_rate: float
    defect_rate: float
    unit_cost: float          # cost index (1.0 = market)
    reliability_score: float  # supplier-declared reliability proxy
    orders: int
    delivery_pts: float
    quality_pts: float
    cost_pts: float
    reliability_pts: float
    total: float


def _minmax(values: list[float], lower_is_better: bool = False) -> list[float]:
    if not values:
        return []
    lo, hi = min(values), max(values)
    if hi - lo < 1e-9:
        return [80.0] * len(values)  # all equal -> neutral-good score
    norm = [(v - lo) / (hi - lo) for v in values]
    return [round(100 * (1 - n if lower_is_better else n), 1) for n in norm]


def score_suppliers(rows: list[dict]) -> list[SupplierScoreRow]:
    """rows: [{id, name, on_time_rate, defect_rate, unit_cost, reliability_score, orders}]."""
    if not rows:
        return []
    delivery = _minmax([r["on_time_rate"] for r in rows])
    quality = _minmax([1 - r["defect_rate"] for r in rows])
    cost = _minmax([r["unit_cost"] for r in rows], lower_is_better=True)
    reliability = _minmax([r["reliability_score"] for r in rows])
    out: list[SupplierScoreRow] = []
    for i, r in enumerate(rows):
        d, q, c, rel = delivery[i], quality[i], cost[i], reliability[i]
        total = round(
            WEIGHTS["delivery"] * d + WEIGHTS["quality"] * q
            + WEIGHTS["cost"] * c + WEIGHTS["reliability"] * rel, 1)
        out.append(SupplierScoreRow(
            supplier_id=r["id"], name=r["name"], on_time_rate=r["on_time_rate"],
            defect_rate=r["defect_rate"], unit_cost=r["unit_cost"],
            reliability_score=r["reliability_score"], orders=r.get("orders", 0),
            delivery_pts=d, quality_pts=q, cost_pts=c, reliability_pts=rel, total=total,
        ))
    out.sort(key=lambda x: x.total, reverse=True)
    return out


def supplier_risk_level(row: SupplierScoreRow) -> str:
    if row.total >= 65:
        return "Low"
    if row.total >= 45:
        return "Medium"
    return "High"
