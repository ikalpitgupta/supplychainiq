"""Inventory segmentation: ABC-XYZ, aging buckets, velocity matrix, slow movers.

  ABC — annual consumption value (existing abc.py logic, reused)
  XYZ — demand variability: X predictable (CV < 0.5), Y variable (0.5–1.0), Z erratic (> 1.0)
  Aging — days since the inventory was received (FIFO-ish proxy: last receipt date)
  Velocity — demand rate vs inventory value quadrant classification
"""
from __future__ import annotations

from dataclasses import dataclass


XYZ_CV_THRESHOLDS = (0.5, 1.0)   # coefficient of variation bands


def xyz_class(demand_std: float, avg_daily_demand: float) -> str:
    """X steady, Y variable, Z erratic — from the coefficient of variation."""
    if avg_daily_demand <= 0:
        return "Z"
    cv = demand_std / avg_daily_demand
    if cv < XYZ_CV_THRESHOLDS[0]:
        return "X"
    if cv <= XYZ_CV_THRESHOLDS[1]:
        return "Y"
    return "Z"


XYZ_STRATEGY = {
    "X": "High predictability — automate replenishment, lean safety stock.",
    "Y": "Variable demand — forecast-driven ordering, moderate safety stock.",
    "Z": "Erratic demand — high safety stock or make-to-order; avoid large speculative buys.",
}


def abcxyz_strategy(abc: str, xyz: str) -> str:
    base = {
        "A": "High-value item — tight monitoring and priority replenishment.",
        "B": "Mid-value item — standard review cycle.",
        "C": "Low-value item — bulk ordering, minimal review effort.",
    }[abc]
    return f"{base} {XYZ_STRATEGY[xyz]}"


def aging_bucket(days_since_receipt: int) -> str:
    if days_since_receipt <= 30:
        return "0-30"
    if days_since_receipt <= 60:
        return "31-60"
    if days_since_receipt <= 90:
        return "61-90"
    return "90+"


AGING_ORDER = ["0-30", "31-60", "61-90", "90+"]


def velocity_segment(avg_daily_demand: float, inventory_value: float,
                     demand_median: float, value_median: float) -> str:
    """2x2 on demand velocity vs inventory value (medians split the field).

    Star        high demand, low capital tied up
    Fast Moving high demand, high capital
    Slow Moving low demand, high capital      <- working-capital watchlist
    Dead Stock  low demand, low capital        <- liquidation candidates
    """
    hot = avg_daily_demand >= demand_median
    heavy = inventory_value >= value_median
    if hot and not heavy:
        return "Star"
    if hot and heavy:
        return "Fast Moving"
    if not hot and heavy:
        return "Slow Moving"
    return "Dead Stock"


def slow_mover_reason(avg_daily_demand: float, days_of_inventory: float | None,
                      excess_value: float) -> str | None:
    """Why a product is slow-moving — phrased as analytical suggestions only."""
    if days_of_inventory is None:
        return ("No recent demand while holding stock. Consider promotional pricing, "
                "bundling, or pausing future procurement.")
    if days_of_inventory > 120 and excess_value > 0:
        return (f"Only {avg_daily_demand:.1f} units/day move through {days_of_inventory:.0f} days "
                f"of cover. Consider reducing future procurement and reviewing pricing.")
    if days_of_inventory > 90 and excess_value > 0:
        return (f"{days_of_inventory:.0f} days of inventory versus policy. Consider a "
                f"promotional campaign or bundle offer before reordering.")
    return None
