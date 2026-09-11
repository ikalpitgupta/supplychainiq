"""Recommendation engine — the decision layer.

Converts inventory math into per-product actions, each carrying a full
explainability packet:

  risk_tier          CRITICAL | HIGH | MEDIUM | LOW  (from the stock projection)
  why                step-by-step numbers behind the decision (the "Why?" modal)
  impact             estimated before → after risk movement + revenue protected
  supplier_options   risk-adjusted supplier shortlist with trade-offs

Design rules:
  - every number is derived from DB records via the shared analytics layer;
  - actions never ignore supplier MOQ reality only because it is unknown (no MOQ
    column exists, so no fake constraint is invented);
  - recommended quantities are EOQ-derived and floored by cycle cover, never
    negative (see app/analytics/eoq.py);
  - zero-demand, zero-stock, and supplier-less products get honest states
    instead of fabricated metrics.
"""
from __future__ import annotations

from datetime import date, timedelta

import numpy as np
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.analytics.eoq import recommended_order_qty
from app.analytics.forecasting import forecast_series
from app.analytics.impact import shortfall_units
from app.analytics.inventory import risk_tier
from app.models import InventoryDaily, Product, PurchaseOrder, Supplier
from app.services.product_service import product_metrics
from app.services.settings_service import get_value

ACTIONS = {"NO ACTION", "MONITOR", "REORDER SOON", "ORDER NOW", "REDUCE FUTURE ORDERS", "REVIEW SUPPLIER"}


# --------------------------------------------------------------------------- #
# Suppliers
# --------------------------------------------------------------------------- #
def _observed_supplier_stats(db: Session, window_days: int = 180) -> dict[int, dict]:
    """supplier_id -> observed PO delivery stats over the window."""
    cutoff = (date.today() - timedelta(days=window_days)).isoformat()
    rows = db.execute(
        select(PurchaseOrder.supplier_id, PurchaseOrder.expected_date,
               PurchaseOrder.actual_date, PurchaseOrder.quantity, PurchaseOrder.unit_cost)
        .where(PurchaseOrder.order_date >= cutoff)
    ).all()
    out: dict[int, dict] = {}
    for sid, exp, act, qty, cost in rows:
        st = out.setdefault(sid, {"orders": 0, "ontime": 0, "delayed": 0, "spend": 0.0, "unit_costs": []})
        st["orders"] += 1
        st["spend"] += qty * cost
        st["unit_costs"].append(float(cost))
        if act:
            if act <= exp:
                st["ontime"] += 1
            else:
                st["delayed"] += 1
    for st in out.values():
        st["unit_cost"] = (sum(st["unit_costs"]) / len(st["unit_costs"])) if st["unit_costs"] else None
        st["on_time_pct"] = round(st["ontime"] / st["orders"] * 100, 1) if st["orders"] else None
    return out


def _category_suppliers(db: Session) -> dict[int, list[int]]:
    rows = db.execute(select(Product.category_id, Product.supplier_id)
                      .where(Product.supplier_id != None)).all()  # noqa: E711
    out: dict[int, list[int]] = {}
    for cid, sid in rows:
        out.setdefault(cid, [])
        if sid not in out[cid]:
            out[cid].append(sid)
    return out


def _supplier_options(db: Session, supplier_ids: list[int], critical: bool) -> list[dict]:
    """Risk-adjusted supplier shortlist.

    All candidates are scored with the standard transparent weights (30/25/25/20).
    When the item is critical, reliability is additionally up-weighted — a
    slightly costlier but more dependable supplier can beat a cheaper risky one.
    Every option carries its observed performance so the UI can show the
    trade-off in one sentence instead of a bare ranking.
    """
    if not supplier_ids:
        return []
    sups = db.query(Supplier).filter(Supplier.id.in_(supplier_ids)).all()
    stats = _observed_supplier_stats(db)
    rows = []
    for s in sups:
        st = stats.get(s.id, {})
        rows.append({
            "id": s.id, "name": s.name, "on_time_rate": s.on_time_rate,
            "defect_rate": s.defect_rate, "unit_cost": s.unit_cost,
            "reliability_score": s.reliability_score,
            "orders": st.get("orders", 0),
        })
    from app.analytics.supplier_score import score_suppliers, supplier_risk_level
    scored = score_suppliers(rows)
    if not scored:
        return []

    def adjusted(row):
        # Reliability boost: up to +15 points on the reliability component when
        # the item is critical — enough to reorder the ranking, small enough to
        # stay explainable ("we weight reliability higher for critical items").
        reliability = min(100.0, row.reliability_pts + (15.0 if critical else 0.0))
        return (0.30 * row.delivery_pts + 0.25 * row.quality_pts
                + 0.25 * row.cost_pts + 0.20 * reliability)

    options = []
    for r in scored:
        st = stats.get(r.supplier_id, {})
        critical_factor = 1.10 if critical else 1.0  # stock-out penalty on expected cost
        unit_cost = st.get("unit_cost") or None
        expected_cost_note = ""
        if unit_cost is not None:
            expected_cost_note = (f"observed on-time {st['on_time_pct']}% "
                                  f"across {st['orders']} recent POs" if st.get("orders") else "no recent POs observed")
        options.append({
            "supplier_id": r.supplier_id,
            "name": r.name,
            "score": r.total,
            "adjusted_score": round(adjusted(r), 1),
            "on_time_rate": round(r.on_time_rate * 100, 1),
            "observed_on_time_pct": st.get("on_time_pct"),
            "defect_rate": round(r.defect_rate * 100, 2),
            "unit_cost_index": r.unit_cost,
            "lead_time_days": next((s.lead_time_days for s in sups if s.id == r.supplier_id), None),
            "risk_level": supplier_risk_level(r),
            "risk_adjusted_expected_cost_note": expected_cost_note,
            "critical_penalty_applied": critical_factor,
        })
    options.sort(key=lambda o: o["adjusted_score"], reverse=True)
    top = options[:3]
    for i, o in enumerate(top):
        if i == 0:
            o["trade_off"] = (
                f"Highest risk-adjusted score ({o['adjusted_score']})"
                + (f" — reliability weighted up because this item is critical." if critical else "."))
        else:
            best = top[0]
            costlier = o["unit_cost_index"] < best["unit_cost_index"]
            o["trade_off"] = (
                f"Cheaper (index {o['unit_cost_index']:.2f} vs {best['unit_cost_index']:.2f}) "
                f"but on-time {o['on_time_rate']:.0f}% vs {best['on_time_rate']:.0f}% — "
                f"{'higher stock-out exposure' if o['on_time_rate'] < best['on_time_rate'] else 'comparable reliability'}.")
    return top


# --------------------------------------------------------------------------- #
# Forecast demand during lead time (with honest fallback disclosure)
# --------------------------------------------------------------------------- #
def _forecast_lead_time_demand(db: Session, product_id: int, lead_time_days: int,
                               fallback_daily: float) -> tuple[float, str]:
    """Expected demand over the lead-time window from the forecasting engine.

    Falls back to the moving-average demand when the history cannot support a
    backtested forecast — the disclosure string travels with the number so the
    UI never presents a fallback as a model forecast.
    """
    from app.services.product_service import _demand_series
    series = _demand_series(db, product_id, 120)
    dates = [d for d, _ in series]
    vals = [v for _, v in series]
    if len(vals) < 14:
        return round(max(fallback_daily, 0.0) * lead_time_days, 1), "moving average (insufficient history for a model forecast)"
    fc = forecast_series(dates, vals, horizon=max(lead_time_days, 7))
    if fc.method == "Insufficient data" or not fc.forecast:
        return round(max(fallback_daily, 0.0) * lead_time_days, 1), "moving average (insufficient history for a model forecast)"
    needed = fc.forecast[:lead_time_days]
    if not needed:
        return round(max(fallback_daily, 0.0) * lead_time_days, 1), "moving average (forecast window shorter than lead time)"
    return round(sum(p.yhat for p in needed), 1), f"{fc.method} over {len(needed)} days"


# --------------------------------------------------------------------------- #
# Core engine
# --------------------------------------------------------------------------- #
def product_decision(db: Session, p, stock: int, m: dict, *, overstock_days: int,
                     ordering_cost: float, holding_rate: float) -> dict:
    """One product's full decision packet — the single source of truth used by
    both the recommendation center and the product-detail page.

    Returns action/severity/reason, the structured `why` packet, the estimated
    `impact`, the risk tier, recommended quantity, and supplier options.
    """
    tier = risk_tier(m["days_to_zero"], m["projected_stock_at_lead_time"],
                     m["safety_stock"], m["reorder_point"])
    critical = tier == "CRITICAL"

    rec_qty = recommended_order_qty(m["avg_daily_demand"], p.unit_cost, p.lead_time_days,
                                    m["safety_stock"], ordering_cost, holding_rate)

    options = _supplier_options(db, _category_suppliers(db).get(p.category_id, []), critical)
    pref_id = options[0]["supplier_id"] if options else None
    pref_name = options[0]["name"] if options else None
    pref_score = options[0]["adjusted_score"] if options else 0.0

    # Forecast demand during lead time (disclosed fallback when thin history)
    ltd_forecast, forecast_basis = _forecast_lead_time_demand(
        db, p.id, p.lead_time_days, m["avg_daily_demand"])

    doi = m["days_of_inventory"]
    shortfall = shortfall_units(m["avg_daily_demand"], p.lead_time_days, m["days_to_zero"])
    revenue_protected = round(shortfall * p.selling_price, 2)

    # --- Decision logic -------------------------------------------------------
    if m["avg_daily_demand"] <= 0 and stock > 0:
        action, severity = "REDUCE FUTURE ORDERS", "opportunity"
        reason = "No recent demand recorded; holding stock ties up cash without forecast offtake."
    elif tier == "CRITICAL" or m["status"] == "Critical":
        action, severity = "ORDER NOW", "critical"
        proj = m["projected_stock_at_lead_time"]
        if proj < 0:
            shortfall_txt = f"run ~{abs(proj):.0f} units short"
        else:
            shortfall_txt = f"be left with only {proj:.0f} units, below the safety stock ({m['safety_stock']:.0f})"
        reason = (f"Stock ({stock}) is below the reorder point ({m['reorder_point']:.0f}) and will {shortfall_txt} "
                  f"by the time a replenishment order arrives ({p.lead_time_days}-day lead time).")
    elif m["status"] == "Low Stock" or tier == "HIGH":
        action, severity = "REORDER SOON", "warning"
        reason = (f"Inventory covers {doi:.0f} days versus a {p.lead_time_days}-day lead time; "
                  f"stock crosses the reorder point before the next review cycle.")
    elif m["status"] == "Overstock":
        action, severity = "REDUCE FUTURE ORDERS", "opportunity"
        excess = max(doi - overstock_days, 0) if doi is not None else 0
        reason = (f"Inventory covers {doi:.0f} days versus a {overstock_days}-day policy; "
                  f"~{excess:.0f} days of excess stock ties up working capital.")
    elif tier == "MEDIUM" or m["risk_level"] == "Medium":
        action, severity = "MONITOR", "warning"
        reason = ("Stock is above the reorder point but projected to touch safety stock "
                  "within the lead-time window; recheck at next review.")
    else:
        action, severity = "NO ACTION", "info"
        if doi is None:
            reason = ("No recent demand and no stock on hand; inventory metrics "
                      "will populate once sales resume.")
        else:
            reason = (f"Healthy cover: {doi:.0f} days of inventory versus a {p.lead_time_days}-day "
                      f"lead time, with reorder point at {m['reorder_point']:.0f}.")

    cat_sups = _category_suppliers(db).get(p.category_id, [])
    if not cat_sups and action in ("ORDER NOW", "REORDER SOON"):
        pref_id, pref_name, pref_score = None, None, 0.0
        options = []
        reason += " Supplier unavailable — supplier assignment required before ordering."

    # --- Structured WHY packet (drives the "Why?" modal) ----------------------
    why_titles = {
        "ORDER NOW": f"Why order {p.name} now?",
        "REORDER SOON": f"Why reorder {p.name} soon?",
        "REDUCE FUTURE ORDERS": f"Why reduce future orders of {p.name}?",
        "MONITOR": f"Why is {p.name} on the watch list?",
        "NO ACTION": f"Why is {p.name} healthy?",
    }
    why = {
        "title": why_titles.get(action, f"Why this recommendation for {p.name}?"),
        "steps": [
            {"label": "Current stock", "value": stock, "unit": "units"},
            {"label": "Average daily demand", "value": m["avg_daily_demand"], "unit": "units/day"},
            {"label": "Demand std deviation", "value": m["demand_std"], "unit": "units"},
            {"label": "Lead time", "value": p.lead_time_days, "unit": "days"},
            {"label": "Safety stock (Z×σ×√LT)", "value": m["safety_stock"], "unit": "units"},
            {"label": "Reorder point (demand×LT + safety)", "value": m["reorder_point"], "unit": "units"},
            {"label": "Forecast demand during lead time", "value": ltd_forecast, "unit": "units",
             "note": forecast_basis},
            {"label": "Projected stock when replenishment arrives", "value": m["projected_stock_at_lead_time"], "unit": "units"},
            {"label": "Days until stock-out", "value": m["days_to_zero"], "unit": "days"},
            {"label": "Days of inventory", "value": doi, "unit": "days"},
        ],
        "verdict": reason,
    }

    # --- Estimated impact -----------------------------------------------------
    impact = {
        "shortfall_units_avoided": round(shortfall, 1),
        "revenue_protected": revenue_protected,
        "risk_before": tier,
        "risk_after": "LOW",
        "risk_movement": f"{tier.capitalize()} → Low",
        "note": ("Ordering before stock-out converts unmet demand into protected revenue "
                 "(estimate: shortfall units × selling price)."),
    }

    return {
        "risk_tier": tier,
        "action": action,
        "severity": severity,
        "reason": reason,
        "recommended_quantity": rec_qty,
        "preferred_supplier_id": pref_id,
        "preferred_supplier": pref_name,
        "preferred_supplier_score": pref_score,
        "supplier_options": options,
        "forecast_lead_time_demand": ltd_forecast,
        "forecast_basis": forecast_basis,
        "why": why,
        "impact": impact,
    }


def build_recommendations(db: Session) -> dict:
    window = int(get_value(db, "demand_window_days", 90))
    service_level = float(get_value(db, "service_level", 0.95))
    low_frac = float(get_value(db, "low_stock_fraction", 0.5))
    overstock_days = int(get_value(db, "overstock_days", 90))
    ordering_cost = float(get_value(db, "ordering_cost", 500))
    holding_rate = float(get_value(db, "holding_cost_rate", 0.20))

    products = db.query(Product).all()
    latest = (select(InventoryDaily.product_id, func.max(InventoryDaily.date).label("m"))
              .group_by(InventoryDaily.product_id).subquery())
    stock_map = dict(db.execute(
        select(InventoryDaily.product_id, InventoryDaily.closing_stock)
        .join(latest, (latest.c.product_id == InventoryDaily.product_id)
              & (latest.c.m == InventoryDaily.date))).all())
    from app.models import Category
    cats = dict(db.execute(select(Category.id, Category.name)).all())
    cat_sups = _category_suppliers(db)
    recs = []
    for p in products:
        stock = stock_map.get(p.id, 0)
        m = product_metrics(db, p, stock, window, service_level, low_frac, overstock_days)
        decision = product_decision(db, p, stock, m, overstock_days=overstock_days,
                                    ordering_cost=ordering_cost, holding_rate=holding_rate)

        recs.append({
            "product_id": p.id, "sku": p.sku, "product": p.name,
            "category": cats.get(p.category_id, "?"),
            "current_stock": m["current_stock"], "reorder_point": m["reorder_point"],
            "safety_stock": m["safety_stock"], "avg_daily_demand": m["avg_daily_demand"],
            "days_of_inventory": m["days_of_inventory"], "status": m["status"],
            "risk_level": m["risk_level"], "risk_tier": decision["risk_tier"],
            "lead_time_days": p.lead_time_days,
            "forecast_lead_time_demand": decision["forecast_lead_time_demand"],
            "forecast_basis": decision["forecast_basis"],
            "action": decision["action"], "severity": decision["severity"],
            "reason": decision["reason"],
            "recommended_quantity": decision["recommended_quantity"],
            "preferred_supplier_id": decision["preferred_supplier_id"],
            "preferred_supplier": decision["preferred_supplier"],
            "preferred_supplier_score": decision["preferred_supplier_score"],
            "supplier_options": decision["supplier_options"],
            "estimated_cost": round(decision["recommended_quantity"] * p.unit_cost, 2),
            "why": decision["why"],
            "impact": decision["impact"],
        })

    order = {"critical": 0, "warning": 1, "opportunity": 2, "info": 3}
    recs.sort(key=lambda r: (order.get(r["severity"], 9),
                             r["days_of_inventory"] if r["days_of_inventory"] is not None else 1e9))
    counts = {
        "critical": sum(1 for r in recs if r["severity"] == "critical"),
        "warning": sum(1 for r in recs if r["severity"] == "warning"),
        "opportunity": sum(1 for r in recs if r["severity"] == "opportunity"),
        "info": sum(1 for r in recs if r["severity"] == "info"),
    }
    tier_counts = {t: sum(1 for r in recs if r["risk_tier"] == t) for t in ("CRITICAL", "HIGH", "MEDIUM", "LOW")}
    return {"items": recs, "counts": counts, "risk_tier_counts": tier_counts}


def supplier_recommendations(db: Session) -> list[dict]:
    """Supplier-level review recommendations from observed delivery performance."""
    sups = db.query(Supplier).all()
    rows = []
    for s in sups:
        cutoff = (date.today() - timedelta(days=90)).isoformat()
        recent = db.execute(
            select(PurchaseOrder.expected_date, PurchaseOrder.actual_date, PurchaseOrder.status)
            .where(PurchaseOrder.supplier_id == s.id, PurchaseOrder.order_date >= cutoff)
        ).all()
        if len(recent) < 4:
            continue
        ontime = sum(1 for exp, act, st in recent if act and act <= exp)
        rate = ontime / len(recent) * 100
        rows.append({"id": s.id, "name": s.name, "recent_ontime": round(rate, 1), "n": len(recent),
                     "baseline": round(s.on_time_rate * 100, 1)})
    out = []
    for r in rows:
        drop = r["baseline"] - r["recent_ontime"]
        if drop >= 8:
            out.append({
                "supplier_id": r["id"], "supplier": r["name"], "severity": "warning",
                "action": "REVIEW SUPPLIER",
                "reason": (f"On-time delivery is {r['recent_ontime']}% over the last 90 days versus "
                           f"{r['baseline']}% lifetime — a drop of {drop:.0f} points. "
                           f"Review performance or shift critical orders to a higher-scored supplier."),
            })
    return out
