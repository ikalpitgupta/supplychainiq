"""Business impact math — the ₹ translation of inventory risk.

Every figure here is an ESTIMATE derived from deterministic inputs (demand
projections, unit economics, holding-cost assumptions). The UI must keep the
"estimate" labeling; nothing is hardcoded.

  shortfall_units   = avg_daily_demand * max(0, lead_time_days - days_to_zero)
  revenue_at_risk   = Σ shortfall_units * selling_price           (at-risk SKUs)
  excess_units      = max(0, stock - overstock_days * avg_daily_demand)
                      (zero-demand SKUs: the entire stock is excess)
  excess_value      = Σ excess_units * unit_cost
  potential_savings = Σ excess_value * holding_cost_rate           (annualized
                      holding cost avoided by trimming to policy cover)
"""
from __future__ import annotations

from dataclasses import dataclass, field


@dataclass
class ProductImpact:
    product_id: int
    name: str = ""
    category: str = ""
    # Stock-out side
    risk_tier: str = "LOW"                  # LOW | MEDIUM | HIGH | CRITICAL
    days_to_zero: float | None = None
    shortfall_units: float = 0.0            # unmet demand before replenishment
    revenue_at_risk: float = 0.0
    # Overstock side
    excess_units: float = 0.0
    excess_value: float = 0.0
    # Provenance shown in tooltips
    inputs: dict = field(default_factory=dict)


def shortfall_units(avg_daily_demand: float, lead_time_days: int,
                    days_to_zero: float | None) -> float:
    """Units of demand that go unmet before a replenishment order can arrive."""
    if days_to_zero is None or avg_daily_demand <= 0:
        return 0.0
    uncovered = lead_time_days - days_to_zero
    return max(0.0, avg_daily_demand * uncovered)


def revenue_at_risk(rows: list[dict]) -> float:
    """Sum of shortfall_units * selling_price over rows carrying risk inputs.

    Expected row keys: avg_daily_demand, lead_time_days, days_to_zero, selling_price.
    """
    total = 0.0
    for r in rows:
        add = float(r.get("avg_daily_demand") or 0)
        lt = int(r.get("lead_time_days") or 0)
        dtz = r.get("days_to_zero")
        price = float(r.get("selling_price") or 0)
        if dtz is not None and add > 0 and dtz < lt:
            total += add * (lt - dtz) * price
    return round(total, 2)


def excess_units(current_stock: int, avg_daily_demand: float, overstock_days: int) -> float:
    """Stock above the policy horizon; zero-demand stock counts entirely as excess."""
    if avg_daily_demand <= 0:
        return float(max(current_stock, 0))
    return max(0.0, current_stock - overstock_days * avg_daily_demand)


def excess_inventory_value(rows: list[dict]) -> float:
    """Σ excess_units * unit_cost over rows with current_stock inputs.

    Expected row keys: current_stock, avg_daily_demand, overstock_days, unit_cost.
    """
    total = 0.0
    for r in rows:
        stock = int(r.get("current_stock") or 0)
        add = float(r.get("avg_daily_demand") or 0)
        days = int(r.get("overstock_days") or 0)
        cost = float(r.get("unit_cost") or 0)
        total += excess_units(stock, add, days) * cost
    return round(total, 2)


def potential_savings(excess_value: float, holding_cost_rate: float) -> float:
    """Annual holding cost avoided by trimming excess to policy cover."""
    return round(max(excess_value, 0.0) * max(holding_cost_rate, 0.0), 2)


def business_impact(rows: list[dict], holding_cost_rate: float) -> dict:
    """One-call impact summary. Rows must carry the keys listed above, plus an
    optional 'category'/'name'/'product_id' for per-category hotspots."""
    rar = revenue_at_risk(rows)
    eiv = excess_inventory_value(rows)
    by_cat_risk: dict[str, float] = {}
    by_cat_excess: dict[str, float] = {}
    for r in rows:
        cat = r.get("category") or "Uncategorized"
        add = float(r.get("avg_daily_demand") or 0)
        lt = int(r.get("lead_time_days") or 0)
        dtz = r.get("days_to_zero")
        if dtz is not None and add > 0 and dtz < lt:
            by_cat_risk[cat] = by_cat_risk.get(cat, 0.0) + add * (lt - dtz) * float(r.get("selling_price") or 0)
        stock = int(r.get("current_stock") or 0)
        days = int(r.get("overstock_days") or 0)
        ex = excess_units(stock, add, days) * float(r.get("unit_cost") or 0)
        if ex > 0:
            by_cat_excess[cat] = by_cat_excess.get(cat, 0.0) + ex
    top_risk_cat = max(by_cat_risk, key=by_cat_risk.get) if by_cat_risk else None
    top_excess_cat = max(by_cat_excess, key=by_cat_excess.get) if by_cat_excess else None
    return {
        "revenue_at_risk": rar,
        "excess_inventory_value": eiv,
        "potential_savings": potential_savings(eiv, holding_cost_rate),
        "top_risk_category": top_risk_cat,
        "top_excess_category": top_excess_cat,
        "holding_cost_rate": holding_cost_rate,
        "basis": {
            "revenue_at_risk": "Σ unmet units before replenishment × selling price (estimate)",
            "excess_inventory_value": "Σ stock above policy cover × unit cost (estimate)",
            "potential_savings": f"excess value × {holding_cost_rate:.0%} annual holding rate (demo assumption)",
        },
    }
