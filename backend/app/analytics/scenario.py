"""What-if scenario simulation — the SAME inventory math as the live engine,
re-run under user-adjusted assumptions. Nothing is faked: change an input and
every output (risk tier, revenue at risk, recommended quantity) is recomputed
from the shared analytics layer.
"""
from __future__ import annotations

import math

from app.analytics.inventory import risk_tier, safety_stock, reorder_point, days_of_inventory


def simulate_scenario(
    *,
    avg_daily_demand: float,
    demand_std: float,
    lead_time_days: int,
    current_stock: int,
    selling_price: float,
    unit_cost: float,
    service_level: float = 0.95,
    demand_change_pct: float = 0.0,       # -50..+100
    lead_time_delta_days: int = 0,        # e.g. +5 = supplier slips
    safety_stock_override: float | None = None,
    stock_override: int | None = None,
    overstock_days: int = 90,
) -> dict:
    """Recompute the decision packet under adjusted assumptions."""
    add = max(0.0, avg_daily_demand * (1 + demand_change_pct / 100))
    dstd = max(0.0, demand_std * math.sqrt(max(add, 1e-9) / max(avg_daily_demand, 1e-9))) if avg_daily_demand > 0 else 0.0
    lead = max(0, lead_time_days + lead_time_delta_days)
    stock = current_stock if stock_override is None else max(0, stock_override)

    ss = safety_stock_override if safety_stock_override is not None else safety_stock(dstd, lead, service_level)
    rop = reorder_point(add, dstd, lead, service_level)
    doi = days_of_inventory(stock, add)
    days_to_zero = (stock / add) if add > 0 else None
    projected = stock - add * lead
    tier = risk_tier(days_to_zero, projected, ss, rop)

    shortfall = max(0.0, add * max(0, lead - (days_to_zero or 0)))
    revenue_at_risk = round(shortfall * selling_price, 2)
    # Recommended quantity: EOQ-style cover (lead time + 2-week review) floored
    cover_qty = add * (lead + 14) + ss
    recommended_qty = int(max(0, math.ceil(cover_qty))) if add > 0 else 0
    excess_units = max(0.0, stock - overstock_days * add) if add > 0 else float(stock)

    return {
        "inputs": {
            "avg_daily_demand": round(avg_daily_demand, 2),
            "demand_change_pct": demand_change_pct,
            "lead_time_days": lead_time_days,
            "lead_time_delta_days": lead_time_delta_days,
            "current_stock": current_stock,
            "stock_override": stock,
            "service_level": service_level,
            "safety_stock_override": safety_stock_override,
        },
        "outputs": {
            "avg_daily_demand": round(add, 2),
            "safety_stock": round(ss, 1),
            "reorder_point": round(rop, 1),
            "days_of_inventory": round(doi, 1) if doi is not None else None,
            "days_to_zero": round(days_to_zero, 1) if days_to_zero is not None else None,
            "projected_stock_at_lead_time": round(projected, 1),
            "risk_tier": tier,
            "shortfall_units": round(shortfall, 1),
            "revenue_at_risk": revenue_at_risk,
            "recommended_qty": recommended_qty,
            "recommended_qty_cost": round(recommended_qty * unit_cost, 2),
            "excess_units": round(excess_units, 1),
            "excess_value": round(excess_units * unit_cost, 2),
        },
    }


def cost_vs_service_curve(
    avg_daily_demand: float, demand_std: float, lead_time_days: int,
    unit_cost: float, holding_cost_rate: float, stockout_cost_per_unit: float | None = None,
    levels: list[float] | None = None,
) -> list[dict]:
    """Total cost vs service level. Holding cost grows with Z; expected stock-out
    cost falls. The minimum of the curve is the economic service level."""
    levels = levels or [0.90, 0.925, 0.95, 0.975, 0.99, 0.995]
    Z = {0.90: 1.28, 0.925: 1.44, 0.95: 1.65, 0.975: 1.96, 0.99: 2.33, 0.995: 2.58}
    h = unit_cost * holding_cost_rate                       # annual holding per unit
    cycle_days = 30
    out = []
    for sl in levels:
        z = Z.get(sl, 1.65)
        ss = z * demand_std * math.sqrt(max(lead_time_days, 1))
        avg_inv = avg_daily_demand * cycle_days / 2 + ss
        holding_cost = avg_inv * h
        # expected units short per cycle ~ sigma_dLT * L(z); L(z) approximated
        # by the standard normal loss integral (tabulated at our Z grid).
        Lz = {1.28: 0.048, 1.44: 0.036, 1.65: 0.021, 1.96: 0.008, 2.33: 0.003, 2.58: 0.001}
        sigma_dLT = demand_std * math.sqrt(max(lead_time_days, 1))
        units_short = sigma_dLT * Lz.get(z, 0.02)
        stockout_cost = units_short * (stockout_cost_per_unit or (selling_price_fallback(unit_cost)))
        out.append({
            "service_level": sl,
            "z": z,
            "safety_stock": round(ss, 1),
            "holding_cost": round(holding_cost, 2),
            "expected_stockout_cost": round(stockout_cost, 2),
            "total_cost": round(holding_cost + stockout_cost, 2),
        })
    return out


def selling_price_fallback(unit_cost: float, margin: float = 1.4) -> float:
    """Margin proxy used only when no product-specific stock-out cost exists."""
    return unit_cost * margin
