"""Supply Chain Health Score — one explainable 0-100 number.

Components (weights sum to 1.0):
  inventory    0.25  share of SKUs with Healthy status
  stockout     0.25  share of SKUs not at HIGH/CRITICAL stock-out risk
  suppliers    0.20  mean supplier score (already 0-100)
  forecasting  0.15  backtest accuracy: 100 - min(100, MAPE)
  overstock    0.10  share of SKUs not Overstock
  procurement  0.05  on-time PO delivery share over the lookback window

Every component is returned with its raw inputs so the UI can explain exactly
why the score is what it is — no black boxes, no hardcoded numbers.
"""
from __future__ import annotations

from dataclasses import dataclass

WEIGHTS = {
    "inventory": 0.25,
    "stockout": 0.25,
    "suppliers": 0.20,
    "forecasting": 0.15,
    "overstock": 0.10,
    "procurement": 0.05,
}


@dataclass
class HealthScoreResult:
    total: float
    components: dict          # name -> {score, weight, contribution, detail}
    grade: str


def _grade(total: float) -> str:
    if total >= 85:
        return "Excellent"
    if total >= 70:
        return "Good"
    if total >= 55:
        return "Fair"
    if total >= 40:
        return "Needs attention"
    return "At risk"


def health_score(
    status_counts: dict[str, int],
    risk_tier_counts: dict[str, int],
    mean_supplier_score: float | None,
    forecast_mape: float | None,
    on_time_pct: float | None,
) -> HealthScoreResult:
    """Compute the composite score. Any missing input scores neutrally (70/100)
    so a data gap is visible but does not unfairly punish the business."""
    n_total = max(sum(status_counts.values()), 1)

    healthy_share = status_counts.get("Healthy", 0) / n_total
    inventory_pts = round(healthy_share * 100, 1)

    safe = sum(v for k, v in risk_tier_counts.items() if k in ("LOW", "MEDIUM"))
    stockout_pts = round(safe / max(sum(risk_tier_counts.values()), 1) * 100, 1)

    overstock_pts = round(
        (1 - status_counts.get("Overstock", 0) / n_total) * 100, 1)

    NEUTRAL = 70.0
    supplier_pts = round(mean_supplier_score, 1) if mean_supplier_score is not None else NEUTRAL
    forecast_pts = round(max(0.0, 100 - min(100.0, forecast_mape)), 1) if forecast_mape is not None else NEUTRAL
    procure_pts = round(on_time_pct, 1) if on_time_pct is not None else NEUTRAL

    components = {
        "inventory": {
            "score": inventory_pts, "weight": WEIGHTS["inventory"],
            "contribution": round(inventory_pts * WEIGHTS["inventory"], 2),
            "detail": f"{status_counts.get('Healthy', 0)}/{n_total} SKUs Healthy",
        },
        "stockout": {
            "score": stockout_pts, "weight": WEIGHTS["stockout"],
            "contribution": round(stockout_pts * WEIGHTS["stockout"], 2),
            "detail": f"{risk_tier_counts.get('CRITICAL', 0)} critical, {risk_tier_counts.get('HIGH', 0)} high-risk SKUs",
        },
        "suppliers": {
            "score": supplier_pts, "weight": WEIGHTS["suppliers"],
            "contribution": round(supplier_pts * WEIGHTS["suppliers"], 2),
            "detail": "mean supplier score (delivery 30/quality 25/cost 25/reliability 20)"
                      if mean_supplier_score is not None else "no supplier data — neutral 70",
        },
        "forecasting": {
            "score": forecast_pts, "weight": WEIGHTS["forecasting"],
            "contribution": round(forecast_pts * WEIGHTS["forecasting"], 2),
            "detail": (f"backtest MAPE {forecast_mape:.1f}% across product forecasts"
                       if forecast_mape is not None else "no backtested forecasts — neutral 70"),
        },
        "overstock": {
            "score": overstock_pts, "weight": WEIGHTS["overstock"],
            "contribution": round(overstock_pts * WEIGHTS["overstock"], 2),
            "detail": f"{status_counts.get('Overstock', 0)} SKUs overstocked",
        },
        "procurement": {
            "score": procure_pts, "weight": WEIGHTS["procurement"],
            "contribution": round(procure_pts * WEIGHTS["procurement"], 2),
            "detail": (f"{on_time_pct:.0f}% of purchase orders delivered on time"
                       if on_time_pct is not None else "no POs in window — neutral 70"),
        },
    }

    total = round(sum(c["contribution"] for c in components.values()), 1)
    return HealthScoreResult(total=total, components=components, grade=_grade(total))
