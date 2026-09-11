"""Scenario service: bridges the simulation engine to live product metrics."""
from __future__ import annotations

from sqlalchemy.orm import Session

from app.analytics.scenario import cost_vs_service_curve, simulate_scenario
from app.services.product_service import _latest_stock, _demand_series, product_metrics
from app.services.settings_service import get_value
import numpy as np


def _product_inputs(db: Session, product) -> dict:
    window = int(get_value(db, "demand_window_days", 90))
    series = _demand_series(db, product.id, window)
    vals = [v for _, v in series]
    arr = np.asarray(vals) if vals else np.zeros(1)
    return {
        "avg_daily_demand": float(arr.mean()),
        "demand_std": float(arr.std(ddof=1)) if len(arr) > 1 else 0.0,
        "lead_time_days": product.lead_time_days,
        "current_stock": _latest_stock(db, product.id),
        "selling_price": product.selling_price,
        "unit_cost": product.unit_cost,
    }


def simulate_for_product(db: Session, product_id: int,
                         demand_change_pct: float = 0.0,
                         lead_time_delta_days: int = 0,
                         safety_stock_override: float | None = None,
                         stock_override: int | None = None,
                         service_level: float | None = None) -> dict | None:
    p = db.get(__import__("app.models", fromlist=["Product"]).Product, product_id)
    if p is None:
        return None
    sl = float(service_level if service_level is not None
               else get_value(db, "service_level", 0.95))
    inputs = _product_inputs(db, p)
    baseline = simulate_scenario(**inputs, service_level=sl, overstock_days=int(get_value(db, "overstock_days", 90)))
    scenario = simulate_scenario(
        **inputs, service_level=sl,
        demand_change_pct=demand_change_pct,
        lead_time_delta_days=lead_time_delta_days,
        safety_stock_override=safety_stock_override,
        stock_override=stock_override,
        overstock_days=int(get_value(db, "overstock_days", 90)),
    )
    return {
        "product": {"id": p.id, "name": p.name, "sku": p.sku},
        "baseline": baseline,
        "scenario": scenario,
        "deltas": {
            "risk_tier": f"{baseline['outputs']['risk_tier']} → {scenario['outputs']['risk_tier']}",
            "revenue_at_risk": round(scenario["outputs"]["revenue_at_risk"] - baseline["outputs"]["revenue_at_risk"], 2),
            "recommended_qty": scenario["outputs"]["recommended_qty"] - baseline["outputs"]["recommended_qty"],
        },
    }


def service_cost_curve(db: Session, product_id: int) -> dict | None:
    p = db.get(__import__("app.models", fromlist=["Product"]).Product, product_id)
    if p is None:
        return None
    inputs = _product_inputs(db, p)
    curve = cost_vs_service_curve(
        avg_daily_demand=inputs["avg_daily_demand"],
        demand_std=inputs["demand_std"],
        lead_time_days=inputs["lead_time_days"],
        unit_cost=p.unit_cost,
        holding_cost_rate=float(get_value(db, "holding_cost_rate", 0.20)),
    )
    best = min(curve, key=lambda r: r["total_cost"])
    return {
        "product": {"id": p.id, "name": p.name, "sku": p.sku},
        "curve": curve,
        "economic_service_level": best["service_level"],
        "note": ("Holding cost rises and expected stock-out cost falls as the service "
                 "level increases; the curve minimum is the cost-optimal balance "
                 "(stock-out cost proxied at a 1.4x margin — a demo assumption)."),
    }
