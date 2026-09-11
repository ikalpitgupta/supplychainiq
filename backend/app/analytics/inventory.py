"""Inventory business logic: demand stats, safety stock, reorder point, days of inventory.

All formulas are documented in README and surfaced in the UI ("Why this matters").

  average_daily_demand = mean(units sold per day over demand_window_days)
  safety_stock         = Z * sigma_daily_demand * sqrt(lead_time_days)
  reorder_point        = average_daily_demand * lead_time_days + safety_stock
  days_of_inventory    = current_stock / average_daily_demand   (None if no demand)
"""
from __future__ import annotations

import math
from dataclasses import dataclass

import numpy as np

SERVICE_LEVEL_Z: dict[float, float] = {
    0.90: 1.28, 0.95: 1.65, 0.975: 1.96, 0.98: 2.05, 0.99: 2.33, 0.995: 2.58,
}


def z_for_service_level(service_level: float) -> float:
    """Z-score for a target service level (nearest configured; interpolated fallback)."""
    if service_level in SERVICE_LEVEL_Z:
        return SERVICE_LEVEL_Z[service_level]
    keys = sorted(SERVICE_LEVEL_Z)
    for lo, hi in zip(keys, keys[1:]):
        if lo < service_level < hi:
            t = (service_level - lo) / (hi - lo)
            return SERVICE_LEVEL_Z[lo] * (1 - t) + SERVICE_LEVEL_Z[hi] * t
    return 1.65


@dataclass
class DemandStats:
    avg_daily_demand: float
    demand_std: float
    total_sold: int
    window_days: int
    zero_demand: bool


def demand_stats(daily_quantities: list[int], window_days: int = 90) -> DemandStats:
    """Compute demand statistics over the most recent `window_days` days."""
    q = list(daily_quantities)[-window_days:] if daily_quantities else []
    if not q:
        return DemandStats(0.0, 0.0, 0, window_days, True)
    arr = np.asarray(q, dtype=float)
    total = int(arr.sum())
    return DemandStats(
        avg_daily_demand=float(arr.mean()),
        demand_std=float(arr.std(ddof=1)) if len(arr) > 1 else 0.0,
        total_sold=total,
        window_days=len(q),
        zero_demand=total == 0,
    )


def safety_stock(demand_std: float, lead_time_days: int, service_level: float = 0.95) -> float:
    """Z * sigma * sqrt(LT) — protects against demand variability during replenishment."""
    z = z_for_service_level(service_level)
    return z * demand_std * math.sqrt(max(lead_time_days, 1))


def reorder_point(avg_daily_demand: float, demand_std: float, lead_time_days: int,
                  service_level: float = 0.95) -> float:
    """Expected demand during lead time plus safety stock."""
    return avg_daily_demand * max(lead_time_days, 0) + safety_stock(demand_std, lead_time_days, service_level)


def days_of_inventory(current_stock: int, avg_daily_demand: float) -> float | None:
    """Days until stock reaches zero at current demand; None when there is no recent demand."""
    if avg_daily_demand <= 0:
        return None
    return current_stock / avg_daily_demand


def days_until_reorder(current_stock: int, avg_daily_demand: float, rop: float) -> float | None:
    """Days until projected stock crosses the reorder point (negative = already below)."""
    if avg_daily_demand <= 0:
        return None
    return (current_stock - rop) / avg_daily_demand


def classify_status(current_stock: int, avg_daily_demand: float, rop: float,
                    doi: float | None, overstock_days: int = 90,
                    low_stock_fraction: float = 0.5) -> str:
    """Healthy | Low Stock | Critical | Overstock — thresholds are configurable."""
    if avg_daily_demand <= 0:
        return "Overstock" if current_stock > 0 else "Healthy"
    if current_stock <= 0:
        return "Critical"
    if doi is not None and doi > overstock_days:
        return "Overstock"
    if current_stock < rop * low_stock_fraction:
        return "Critical"
    if current_stock < rop:
        return "Low Stock"
    return "Healthy"


def stockout_risk(current_stock: int, avg_daily_demand: float, demand_std: float,
                  lead_time_days: int, safety: float) -> dict:
    """Project stock at lead-time date and classify risk.

    High risk: projected stock at arrival < safety stock (or stock-out before arrival).
    """
    if avg_daily_demand <= 0:
        return {"risk": "None", "projected_stock_at_lead_time": float(current_stock),
                "days_to_zero": None, "days_to_below_safety": None}
    days_to_zero = current_stock / avg_daily_demand
    days_to_safety = (current_stock - safety) / avg_daily_demand
    projected = current_stock - avg_daily_demand * lead_time_days
    if projected <= 0 or days_to_zero < lead_time_days:
        risk = "High"
    elif days_to_safety < lead_time_days or projected < safety:
        risk = "Medium"
    else:
        risk = "Low"
    return {"risk": risk, "projected_stock_at_lead_time": projected,
            "days_to_zero": days_to_zero, "days_to_below_safety": days_to_safety}


RISK_TIERS = ("LOW", "MEDIUM", "HIGH", "CRITICAL")


def risk_tier(days_to_zero: float | None, projected_at_lead_time: float,
              safety: float, rop: float) -> str:
    """Four-tier stock-out risk, derived from the same projection as stockout_risk.

    With demand declining monotonically, stock at the lead-time date is the
    window minimum, so one projection settles the tier:

      CRITICAL  stock hits zero at/before the replenishment arrives
      HIGH      arrives above zero but below the safety buffer
      MEDIUM    arrives above safety but below the reorder point (order due)
      LOW       arrives at/above the reorder point

    No demand (days_to_zero is None) is LOW — nothing is being consumed.
    """
    if days_to_zero is None:
        return "LOW"
    if days_to_zero <= 0 or projected_at_lead_time <= 0:
        return "CRITICAL"
    if projected_at_lead_time < safety:
        # arrives above zero, but dips into the safety buffer before then
        return "HIGH"
    if projected_at_lead_time < rop:
        return "MEDIUM"
    return "LOW"
