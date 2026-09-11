"""Dashboard + cross-domain aggregation service.

All KPIs, alerts, and the executive summary are computed from the database at
request time. Filters (category) are applied to the base product set so KPIs
and charts genuinely reflect the active filter.
"""
from __future__ import annotations

from datetime import date, timedelta

import numpy as np
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.models import Category, InventoryDaily, Product, PurchaseOrder, Sale, Supplier
from app.services.settings_service import get_value


def _product_demand_map(db: Session, window_days: int) -> dict[int, tuple[float, float]]:
    """product_id -> (avg_daily_demand, demand_std) over the trailing window (ending yesterday)."""
    start = (date.today() - timedelta(days=window_days + 1)).isoformat()
    rows = db.execute(
        select(Sale.product_id, Sale.sale_date, func.sum(Sale.quantity))
        .where(Sale.sale_date >= start)
        .group_by(Sale.product_id, Sale.sale_date)
    ).all()
    per_product: dict[int, dict[str, float]] = {}
    for pid, d, q in rows:
        per_product.setdefault(pid, {})[d] = float(q)
    out = {}
    for pid, daily in per_product.items():
        # Fill missing days with 0 across the window so mean/std are honest.
        series = np.zeros(window_days)
        d0 = date.today() - timedelta(days=window_days + 1)
        for i in range(window_days):
            iso = (d0 + timedelta(days=i + 1)).isoformat()
            series[i] = daily.get(iso, 0.0)
        out[pid] = (float(series.mean()), float(series.std(ddof=1)) if window_days > 1 else 0.0)
    return out


def _latest_stock_map(db: Session) -> dict[int, int]:
    """product_id -> most recent closing_stock."""
    latest = (
        select(InventoryDaily.product_id, func.max(InventoryDaily.date).label("max_date"))
        .group_by(InventoryDaily.product_id)
        .subquery()
    )
    rows = db.execute(
        select(InventoryDaily.product_id, InventoryDaily.closing_stock)
        .join(latest, (latest.c.product_id == InventoryDaily.product_id)
              & (latest.c.max_date == InventoryDaily.date))
    ).all()
    return {pid: stock for pid, stock in rows}


def _stock_value_history(db: Session, days: int, product_ids: set[int]) -> list[dict]:
    """Daily total inventory value for the last `days` days, over given products."""
    start = (date.today() - timedelta(days=days)).isoformat()
    rows = db.execute(
        select(InventoryDaily.date, InventoryDaily.product_id, InventoryDaily.closing_stock)
        .where(InventoryDaily.date >= start)
    ).all()
    cost = dict(db.execute(select(Product.id, Product.unit_cost)).all())
    per_day: dict[str, float] = {}
    for d, pid, stock in rows:
        if pid not in product_ids:
            continue
        per_day[d] = per_day.get(d, 0.0) + stock * cost.get(pid, 0.0)
    out = []
    d0 = date.today() - timedelta(days=days)
    for i in range(days):
        iso = (d0 + timedelta(days=i + 1)).isoformat()
        out.append({"date": iso, "value": round(per_day.get(iso, 0.0), 2)})
    return out


def compute_dashboard(db: Session, category: str | None = None, period: int = 90) -> dict:
    period = period if period in (7, 30, 90, 365) else 90
    window = int(get_value(db, "demand_window_days", 90))
    service_level = float(get_value(db, "service_level", 0.95))
    low_frac = float(get_value(db, "low_stock_fraction", 0.5))
    overstock_days = int(get_value(db, "overstock_days", 90))

    products = db.query(Product).all()
    cat_names = dict(db.execute(select(Category.id, Category.name)).all())
    if category:
        keep = {cid for cid, name in cat_names.items() if name == category}
        products = [p for p in products if p.category_id in keep]

    demand = _product_demand_map(db, window)
    stock = _latest_stock_map(db)

    from app.analytics.inventory import (classify_status, days_of_inventory, reorder_point,
                                         safety_stock, stockout_risk)

    statuses: dict[int, str] = {}
    risks: dict[int, str] = {}
    tiers: dict[int, str] = {}
    total_value = 0.0
    total_units = 0
    risk_products: list[dict] = []
    overstock_products: list[dict] = []
    impact_rows: list[dict] = []

    for p in products:
        cur = stock.get(p.id, 0)
        add, dstd = demand.get(p.id, (0.0, 0.0))
        ss = safety_stock(dstd, p.lead_time_days, service_level)
        rop = reorder_point(add, dstd, p.lead_time_days, service_level)
        doi = days_of_inventory(cur, add)
        st = classify_status(cur, add, rop, doi, overstock_days, low_frac)
        statuses[p.id] = st
        rk = stockout_risk(cur, add, dstd, p.lead_time_days, ss)
        risks[p.id] = rk["risk"]
        from app.analytics.inventory import risk_tier
        tier = risk_tier(rk["days_to_zero"], rk["projected_stock_at_lead_time"], ss, rop)
        tiers[p.id] = tier
        total_value += cur * p.unit_cost
        total_units += cur
        impact_rows.append({
            "product_id": p.id, "name": p.name, "category": cat_names.get(p.category_id, "?"),
            "current_stock": cur, "avg_daily_demand": add, "demand_std": dstd,
            "lead_time_days": p.lead_time_days, "days_to_zero": rk["days_to_zero"],
            "selling_price": p.selling_price, "unit_cost": p.unit_cost,
            "overstock_days": overstock_days,
        })
        if st == "Critical" or rk["risk"] == "High":
            risk_products.append({"id": p.id, "name": p.name, "status": st, "risk": rk["risk"],
                                  "tier": tier, "stock": cur, "days_to_zero": rk["days_to_zero"]})
        if st == "Overstock":
            overstock_products.append({"id": p.id, "name": p.name, "stock": cur, "doi": doi})

    # --- KPI cards with previous-period comparison -------------------------------
    cur_start = (date.today() - timedelta(days=period)).isoformat()
    prev_start = (date.today() - timedelta(days=2 * period)).isoformat()
    sales_now = db.scalar(select(func.coalesce(func.sum(Sale.revenue), 0.0)).where(Sale.sale_date >= cur_start))
    sales_prev = db.scalar(select(func.coalesce(func.sum(Sale.revenue), 0.0))
                           .where(Sale.sale_date >= prev_start, Sale.sale_date < cur_start))
    sold_now = db.scalar(select(func.coalesce(func.sum(Sale.quantity), 0)).where(Sale.sale_date >= cur_start))

    inv_hist = _stock_value_history(db, period, {p.id for p in products})
    value_prev = inv_hist[0]["value"] if inv_hist else 0.0
    avg_inv_value = float(np.mean([h["value"] for h in inv_hist])) if inv_hist else 0.0
    cogs = sold_now * float(np.mean([p.unit_cost for p in products])) if products else 0.0
    turnover = (cogs / avg_inv_value) if avg_inv_value > 0 else None

    # Supplier delay rate from recent delivered/late POs.
    po_start = (date.today() - timedelta(days=period)).isoformat()
    po_total = db.scalar(select(func.count()).select_from(PurchaseOrder)
                         .where(PurchaseOrder.order_date >= po_start))
    po_late = db.scalar(select(func.count()).select_from(PurchaseOrder)
                        .where(PurchaseOrder.order_date >= po_start,
                               PurchaseOrder.status.in_(["Delayed"])
                               | ((PurchaseOrder.actual_date != None) & (PurchaseOrder.actual_date > PurchaseOrder.expected_date))))  # noqa: E711
    delay_rate = (po_late / po_total * 100) if po_total else None

    def delta(now_v, prev_v):
        if prev_v in (None, 0) or now_v is None:
            return None
        return round((now_v - prev_v) / prev_v * 100, 1)

    kpis = {
        "inventory_value": {"value": round(total_value, 2), "prev": round(value_prev, 2), "change_pct": delta(total_value, value_prev), "unit": "₹"},
        "inventory_units": {"value": total_units, "prev": None, "change_pct": None, "unit": "units"},
        "stockout_risks": {"value": len(risk_products), "prev": None, "change_pct": None, "unit": "products"},
        "overstock_products": {"value": len(overstock_products), "prev": None, "change_pct": None, "unit": "products"},
        "inventory_turnover": {"value": round(turnover, 2) if turnover else None, "prev": None, "change_pct": None, "unit": "x"},
        "supplier_delay_rate": {"value": round(delay_rate, 1) if delay_rate is not None else None, "prev": None, "change_pct": None, "unit": "%"},
    }

    # --- Inventory health mix -----------------------------------------------------
    status_counts = {"Healthy": 0, "Low Stock": 0, "Critical": 0, "Overstock": 0}
    for st in statuses.values():
        if st in status_counts:
            status_counts[st] += 1
    n_products = max(len(products), 1)
    health = [{"name": k, "count": v, "pct": round(v / n_products * 100, 1)} for k, v in status_counts.items()]

    # --- Demand trend: total daily units sold, actual vs forecast continuation ----
    trend_start = (date.today() - timedelta(days=period)).isoformat()
    trend_q = (
        select(Sale.sale_date, func.sum(Sale.quantity))
        .where(Sale.sale_date >= trend_start)
    )
    if category:
        trend_q = trend_q.join(Product, Sale.product_id == Product.id).where(
            Product.category_id.in_(keep))
    trend_rows = db.execute(
        trend_q.group_by(Sale.sale_date).order_by(Sale.sale_date)
    ).all()
    trend_map = dict(trend_rows)
    demand_trend = []
    # Anchor the window to the newest sale actually present in the DB. Anchoring to
    # "today" breaks whenever the clock crosses a day boundary after seeding: the
    # trailing day would silently render as zero demand.
    last_sale = db.execute(select(func.max(Sale.sale_date))).scalar()
    if trend_rows and last_sale:
        d0 = date.fromisoformat(str(last_sale)) - timedelta(days=period - 1)
        vals = []
        for i in range(period):
            iso = (d0 + timedelta(days=i)).isoformat()
            v = float(trend_map.get(iso, 0))
            vals.append(v)
            demand_trend.append({"date": iso, "actual": v})
    from app.analytics.forecasting import forecast_series
    fc = forecast_series([t["date"] for t in demand_trend], vals, horizon=min(14, max(7, period // 6)))
    demand_chart = []
    for t in demand_trend:
        demand_chart.append({"date": t["date"], "actual": t["actual"], "forecast": None, "lower": None, "upper": None})
    for fp in fc.forecast:
        demand_chart.append({"date": fp.date, "actual": None, "forecast": fp.yhat,
                             "lower": fp.lower, "upper": fp.upper})

    # 30-day aggregate forecast (executive view KPI)
    fc30 = forecast_series([t["date"] for t in demand_trend], vals, horizon=30)
    forecast_demand_30d = round(sum(p.yhat for p in fc30.forecast), 0) if fc30.forecast else None

    # --- Alerts -------------------------------------------------------------------
    def _plural(n: int, word: str) -> str:
        return f"{n} {word}" if n == 1 else f"{n} {word}s"

    alerts: list[dict] = []
    for rp in sorted(risk_products, key=lambda x: (x["days_to_zero"] if x["days_to_zero"] is not None else 1e9))[:6]:
        alerts.append({
            "type": "Critical Stock", "severity": "critical", "title": rp["name"],
            "message": f"Expected to stock out in {_plural(max(1, round(rp['days_to_zero'])), 'day')} at current demand."
                       if rp["days_to_zero"] is not None else "No recent demand — review listing.",
            "cta": {"label": "View Product", "link": f"/products/{rp['id']}"},
        })
    for op in overstock_products[:3]:
        doi = op["doi"] or 0
        alerts.append({
            "type": "Overstock", "severity": "warning", "title": op["name"],
            "message": f"Inventory covers {round(doi)} days of demand — well above policy.",
            "cta": {"label": "View Product", "link": f"/products/{op['id']}"},
        })
    sup_rows = db.execute(select(Supplier.id, Supplier.name, Supplier.on_time_rate)).all()
    for sid, sname, otr in sup_rows:
        recent = db.execute(
            select(PurchaseOrder.status, PurchaseOrder.expected_date, PurchaseOrder.actual_date)
            .where(PurchaseOrder.supplier_id == sid, PurchaseOrder.order_date >= po_start)
        ).all()
        if len(recent) >= 4:
            ontime = sum(1 for st, exp, act in recent if act and act <= exp)
            rate = ontime / len(recent) * 100
            if rate < 75:
                alerts.append({
                    "type": "Supplier Risk", "severity": "warning", "title": sname,
                    "message": f"On-time delivery is {rate:.0f}% over the last {period} days.",
                    "cta": {"label": "View Supplier", "link": f"/suppliers/{sid}"},
                })
                break

    # --- Executive summary (dynamic) ---------------------------------------------
    top_cat_risk = None
    cat_risk_counts: dict[str, int] = {}
    for p in products:
        if risks.get(p.id) == "High":
            cname = cat_names.get(p.category_id, "?")
            cat_risk_counts[cname] = cat_risk_counts.get(cname, 0) + 1
    if cat_risk_counts:
        top_cat_risk = max(cat_risk_counts, key=cat_risk_counts.get)
    value_chg = kpis["inventory_value"]["change_pct"]
    parts = []
    if value_chg is not None:
        direction = "increased" if value_chg >= 0 else "decreased"
        parts.append(f"Inventory value {direction} {abs(value_chg)}% over the last {period} days")
    if sales_prev:
        demand_chg = round((sales_now - sales_prev) / sales_prev * 100, 1)
        parts.append(f"Revenue {'rose' if demand_chg >= 0 else 'fell'} {abs(demand_chg)}% versus the prior period")
    parts.append(f"{_plural(len(risk_products), 'product')} {'is' if len(risk_products) == 1 else 'are'} at high stock-out risk"
                 + (f", primarily within {top_cat_risk}" if top_cat_risk else ""))
    parts.append(f"{_plural(len(overstock_products), 'product')} {'is' if len(overstock_products) == 1 else 'are'} overstocked beyond {overstock_days} days of cover")
    if delay_rate is not None:
        parts.append(f"supplier delay rate is {delay_rate:.1f}% across recent purchase orders")
    summary = ". ".join(parts) + "."

    # --- Business impact (estimates, derived) -----------------------------------
    from app.analytics.impact import business_impact
    holding_rate = float(get_value(db, "holding_cost_rate", 0.20))
    impact = business_impact(impact_rows, holding_cost_rate=holding_rate)

    # --- Supply Chain Health Score (explainable composite) -----------------------
    from app.analytics.health_score import health_score
    tier_counts = {t: sum(1 for v in tiers.values() if v == t) for t in ("LOW", "MEDIUM", "HIGH", "CRITICAL")}
    sup_rows = db.execute(select(Supplier.id, Supplier.name, Supplier.on_time_rate, Supplier.defect_rate,
                                 Supplier.unit_cost, Supplier.reliability_score)).all()
    from app.analytics.supplier_score import score_suppliers
    sup_scored = score_suppliers([{
        "id": r[0], "name": r[1], "on_time_rate": r[2], "defect_rate": r[3],
        "unit_cost": r[4], "reliability_score": r[5], "orders": 0} for r in sup_rows])
    mean_supplier = (float(np.mean([r.total for r in sup_scored])) if sup_scored else None)
    on_time = (100 - delay_rate) if delay_rate is not None else None
    fc_mape = fc.metrics.get("MAPE") if fc.metrics else None
    hs = health_score(status_counts, tier_counts, mean_supplier, fc_mape, on_time)
    health_score_out = {
        "total": hs.total, "grade": hs.grade,
        "components": hs.components,
    }

    # --- Data-derived insights (replaces any static bullet list) -----------------
    insights = _generate_insights(products, tiers, impact, cat_names, delay_rate,
                                  sup_scored, fc_mape, overstock_products)

    return {
        "kpis": kpis,
        "inventory_health": health,
        "risk_tier_counts": tier_counts,
        "business_impact": impact,
        "health_score": health_score_out,
        "insights": insights,
        "forecast_demand_30d": forecast_demand_30d,
        "demand_trend": demand_chart,
        "forecast_method": fc.method,
        "alerts": alerts,
        "summary": summary,
        "period": period,
        "category": category,
        "db_status": db_manager_status(),
    }


def _generate_insights(products, tiers, impact, cat_names, delay_rate,
                       sup_scored, fc_mape, overstock_products) -> list[dict]:
    """Short, data-derived statements — each must cite its number."""
    insights: list[dict] = []
    n_crit = sum(1 for v in tiers.values() if v == "CRITICAL")
    n_high = sum(1 for v in tiers.values() if v == "HIGH")
    if n_crit or n_high:
        insights.append({
            "icon": "alert", "tone": "critical",
            "text": (f"{n_crit} product{n_crit != 1 and 's' or ''} at CRITICAL stock-out risk"
                     f"{f' and {n_high} more at HIGH risk' if n_high else ''} — "
                     f"revenue exposure ≈ ₹{impact['revenue_at_risk']:,.0f} (estimate)."),
        })
    if impact["top_risk_category"]:
        insights.append({
            "icon": "target", "tone": "warning",
            "text": f"{impact['top_risk_category']} carries the highest stock-out exposure.",
        })
    if impact["excess_inventory_value"] > 0:
        insights.append({
            "icon": "package", "tone": "info",
            "text": (f"Excess inventory worth ≈ ₹{impact['excess_inventory_value']:,.0f} "
                     f"(estimate) — potential holding savings ≈ ₹{impact['potential_savings']:,.0f}/year."),
        })
    if delay_rate is not None and delay_rate >= 15:
        insights.append({
            "icon": "truck", "tone": "warning",
            "text": f"{delay_rate:.0f}% of recent purchase orders arrived late.",
        })
    if sup_scored:
        worst = sup_scored[-1]
        insights.append({
            "icon": "truck", "tone": "info",
            "text": (f"Lowest-scored supplier: {worst.name} ({worst.total:.0f}/100, "
                     f"on-time {worst.on_time_rate * 100:.0f}%, defects {worst.defect_rate * 100:.1f}%)."),
        })
    if fc_mape is not None:
        insights.append({
            "icon": "trend", "tone": "info",
            "text": (f"Aggregate forecast error (MAPE) is {fc_mape:.1f}% — "
                     f"{'reliable' if fc_mape < 15 else 'use with caution'} for planning."),
        })
    if overstock_products:
        worst_over = max(overstock_products, key=lambda o: (o["doi"] or 0))
        insights.append({
            "icon": "package", "tone": "info",
            "text": (f"{worst_over['name']} holds {worst_over['doi']:.0f} days of stock — "
                     f"the largest overstock in the portfolio."),
        })
    return insights[:6]

    return {
        "kpis": kpis,
        "inventory_health": health,
        "demand_trend": demand_chart,
        "forecast_method": fc.method,
        "alerts": alerts,
        "summary": summary,
        "period": period,
        "category": category,
        "db_status": db_manager_status(),
    }


def db_manager_status() -> dict:
    from app.database.session import db_manager
    return db_manager.status()
