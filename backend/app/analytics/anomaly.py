"""Anomaly detection — deliberately explainable (z-score + rolling baseline).

No black boxes: every anomaly carries the baseline mean, the std deviation, the
z-score, and a plain-language explanation so a manager can audit the call.

  - demand anomalies: rolling-window z-score on daily units sold
  - spike recommendations: extra cover derived from the excess demand rate
"""
from __future__ import annotations

import math
from dataclasses import dataclass


@dataclass
class Anomaly:
    series: str            # "demand" | "supplier_delay" | ...
    key: str               # product/supplier identifier
    label: str             # human name
    date: str | None
    value: float
    baseline_mean: float
    baseline_std: float
    z: float
    direction: str         # "spike" | "drop"
    explanation: str

    def to_dict(self) -> dict:
        return {
            "series": self.series, "key": self.key, "label": self.label,
            "date": self.date, "value": round(self.value, 2),
            "baseline_mean": round(self.baseline_mean, 2),
            "baseline_std": round(self.baseline_std, 2),
            "z": round(self.z, 2), "direction": self.direction,
            "explanation": self.explanation,
        }


def rolling_zscore_anomalies(values: list[float], window: int = 14,
                             threshold: float = 2.5, min_history: int = 21) -> list[int]:
    """Indices of anomalous points via rolling z-score.

    A point is anomalous when |value - mean(prior window)| > threshold * std(prior window).

    A perfectly flat baseline has std = 0, which would make every deviation
    infinitely significant — so the effective std is floored at 5% of the mean.
    (5% of mean daily demand is a conservative noise floor; the floor is also
    what lets a spike off a dead-flat baseline flag correctly.) Windows with a
    zero mean AND zero std carry no usable baseline and are skipped.
    """
    out: list[int] = []
    for i in range(window, len(values)):
        baseline = values[max(0, i - window):i]
        if len(baseline) < max(3, min_history // 3):
            continue
        mean = sum(baseline) / len(baseline)
        var = sum((v - mean) ** 2 for v in baseline) / len(baseline)
        std = math.sqrt(var)
        eff_std = max(std, 0.05 * mean) if mean > 0 else std
        if eff_std <= 0:
            continue
        z = (values[i] - mean) / eff_std
        if abs(z) >= threshold:
            out.append(i)
    return out


def demand_anomaly(series: list[tuple[str, float]], window: int = 14,
                   threshold: float = 2.5) -> Anomaly | None:
    """Most recent demand anomaly in a daily (date, units) series, newest first."""
    if len(series) < window + 7:
        return None
    values = [v for _, v in series]
    hits = rolling_zscore_anomalies(values, window=window, threshold=threshold)
    if not hits:
        return None
    i = hits[-1]
    baseline = values[max(0, i - window):i]
    mean = sum(baseline) / len(baseline)
    var = sum((v - mean) ** 2 for v in baseline) / len(baseline)
    std = math.sqrt(var)
    eff_std = max(std, 0.05 * mean) if mean > 0 else std
    z = (values[i] - mean) / eff_std
    direction = "spike" if z > 0 else "drop"
    pct = abs(values[i] - mean) / mean * 100 if mean > 0 else 0.0
    return Anomaly(
        series="demand", key="", label="",
        date=series[i][0], value=values[i],
        baseline_mean=mean, baseline_std=std, z=z, direction=direction,
        explanation=(f"Sales were {pct:.0f}% {'above' if z > 0 else 'below'} the {window}-day baseline "
                     f"({values[i]:.0f} vs {mean:.1f} units/day) — {abs(z):.1f} standard deviations."),
    )


def spike_recommendation(baseline_daily: float, spike_daily: float, lead_time_days: int,
                         current_stock: int, unit_cost: float) -> dict:
    """Action plan for a demand spike — every number derived, none hardcoded.

    extra_rate    = spike_daily - baseline_daily
    extra_demand  = extra_rate * lead_time  (unmet demand during replenishment)
    cover_needed  = spike_daily * lead_time (demand during lead time at spike rate)
    qty_bump      = extra units needed to hold cover through the spike window
    """
    if baseline_daily <= 0 or spike_daily <= baseline_daily:
        return {"applies": False}
    extra_rate = spike_daily - baseline_daily
    uplift_pct = extra_rate / baseline_daily * 100
    cover_needed = spike_daily * lead_time_days
    qty_bump = max(0, math.ceil(cover_needed - current_stock))
    days_cover = current_stock / spike_daily if spike_daily > 0 else None
    risk = "CRITICAL" if days_cover is not None and days_cover < lead_time_days else "HIGH" \
        if days_cover is not None and days_cover < lead_time_days * 1.5 else "MEDIUM"
    return {
        "applies": True,
        "baseline_daily": round(baseline_daily, 2),
        "spike_daily": round(spike_daily, 2),
        "uplift_pct": round(uplift_pct, 1),
        "extra_demand_during_lead_time": round(extra_rate * lead_time_days, 1),
        "cover_needed_through_lead_time": round(cover_needed, 1),
        "current_stock": current_stock,
        "recommended_qty_increase": qty_bump,
        "estimated_extra_cost": round(qty_bump * unit_cost, 2),
        "days_cover_at_spike": round(days_cover, 1) if days_cover is not None else None,
        "stockout_risk": risk,
        "action": (f"Demand is running {uplift_pct:.0f}% above baseline. Increase the next "
                   f"replenishment by ~{qty_bump} units to cover the {lead_time_days}-day lead time at the spike rate."),
    }
