"""Economic Order Quantity.

EOQ = sqrt((2 * AnnualDemand * OrderingCost) / HoldingCostPerUnit)
Holding cost per unit = unit_cost * holding_cost_rate (rate = demo assumption from Settings).
"""
from __future__ import annotations

import math


def eoq(annual_demand: float, ordering_cost: float, holding_cost_per_unit: float) -> int:
    """Round to a sensible integer; guards divide-by-zero and negative inputs."""
    if annual_demand <= 0 or ordering_cost <= 0 or holding_cost_per_unit <= 0:
        return 0
    return max(1, int(round(math.sqrt((2 * annual_demand * ordering_cost) / holding_cost_per_unit))))


def recommended_order_qty(avg_daily_demand: float, unit_cost: float, lead_time_days: int,
                          safety: float, ordering_cost: float, holding_cost_rate: float,
                          annual_factor: float = 1.0) -> int:
    """Blended recommendation: EOQ for cycle quantity, floored by lead-time + review cover.

    Never returns less than demand over (lead_time + review) so the order covers the cycle.
    """
    annual_demand = avg_daily_demand * 365 * annual_factor
    h = max(unit_cost, 0.01) * holding_cost_rate
    q_eoq = eoq(annual_demand, ordering_cost, h)
    cover_qty = avg_daily_demand * (lead_time_days + 14) + safety  # lead time + 2-week review
    return int(max(q_eoq, math.ceil(cover_qty))) if avg_daily_demand > 0 else int(max(q_eoq, math.ceil(safety)))
