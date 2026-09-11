"""ABC inventory classification by annual consumption value (demand * unit cost).

A: cumulative <= 80% of total value, B: <= 95%, C: remainder.
"""
from __future__ import annotations

from dataclasses import dataclass


@dataclass
class AbcRow:
    product_id: int
    sku: str
    name: str
    category: str
    annual_demand: int
    unit_cost: float
    consumption_value: float
    value_share: float          # fraction of total
    cumulative_share: float
    class_: str                 # A | B | C


def abc_classify(products: list[dict]) -> list[AbcRow]:
    """products: [{id, sku, name, category, annual_demand, unit_cost}] sorted internally."""
    rows = []
    for p in products:
        cv = max(p["annual_demand"], 0) * max(p["unit_cost"], 0)
        rows.append({**p, "cv": cv})
    rows.sort(key=lambda r: r["cv"], reverse=True)
    total = sum(r["cv"] for r in rows) or 1.0
    out: list[AbcRow] = []
    cum = 0.0
    for r in rows:
        share = r["cv"] / total
        # The item that crosses a threshold still belongs to the class it completes:
        # e.g. a single SKU holding 90% of value is A, not B.
        cum_before = cum
        cum += share
        cls = "A" if cum_before < 0.80 else ("B" if cum_before < 0.95 else "C")
        out.append(AbcRow(
            product_id=r["id"], sku=r["sku"], name=r["name"], category=r["category"],
            annual_demand=int(r["annual_demand"]), unit_cost=float(r["unit_cost"]),
            consumption_value=round(r["cv"], 2), value_share=share, cumulative_share=cum, class_=cls,
        ))
    return out


def abc_summary(rows: list[AbcRow]) -> list[dict]:
    """Per-class rollup: SKU count share vs value share (for the Pareto story)."""
    out = []
    for cls in ("A", "B", "C"):
        sub = [r for r in rows if r.class_ == cls]
        if not sub:
            continue
        out.append({
            "class": cls,
            "sku_count": len(sub),
            "sku_share": len(sub) / len(rows),
            "value_share": sum(r.value_share for r in sub) / (sum(r.value_share for r in rows) or 1),
            "value": round(sum(r.consumption_value for r in sub), 2),
        })
    return out
