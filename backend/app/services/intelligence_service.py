"""Intelligence service: cross-cutting analytics powering the Control Tower,
ABC-XYZ matrix, inventory aging, and procurement intelligence.
"""
from __future__ import annotations

from datetime import date, timedelta

import numpy as np
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.analytics.procurement import (price_trend, product_concentration,
                                       supplier_concentration)
from app.analytics.segmentation import (AGING_ORDER, abcxyz_strategy, aging_bucket,
                                        slow_mover_reason, velocity_segment, xyz_class)
from app.analytics.abc import abc_classify
from app.models import (Category, InventoryDaily, Product, PurchaseOrder, Sale, Supplier)
from app.services.settings_service import get_value


# --------------------------------------------------------------------------- #
# Shared loaders
# --------------------------------------------------------------------------- #
def _load_core(db: Session) -> dict:
    products = db.query(Product).all()
    cats = dict(db.execute(select(Category.id, Category.name)).all())
    sups = {s.id: s for s in db.query(Supplier).all()}
    latest = (select(InventoryDaily.product_id, func.max(InventoryDaily.date).label("m"))
              .group_by(InventoryDaily.product_id).subquery())
    stock_rows = db.execute(
        select(InventoryDaily.product_id, InventoryDaily.closing_stock, InventoryDaily.date)
        .join(latest, (latest.c.product_id == InventoryDaily.product_id)
              & (latest.c.m == InventoryDaily.date))).all()
    stock = {pid: (s, d) for pid, s, d in stock_rows}
    window = int(get_value(db, "demand_window_days", 90))
    start = (date.today() - timedelta(days=window)).isoformat()
    demand_rows = db.execute(
        select(Sale.product_id, func.sum(Sale.quantity))
        .where(Sale.sale_date >= start).group_by(Sale.product_id)).all()
    sold = {pid: float(q) for pid, q in demand_rows}
    # daily series per product for std computation (windowed)
    sale_days = db.execute(
        select(Sale.product_id, Sale.sale_date, func.sum(Sale.quantity))
        .where(Sale.sale_date >= start).group_by(Sale.product_id, Sale.sale_date)).all()
    per_day: dict[int, dict[str, float]] = {}
    for pid, d, q in sale_days:
        per_day.setdefault(pid, {})[d] = float(q)
    return {"products": products, "cats": cats, "sups": sups, "stock": stock,
            "sold": sold, "per_day": per_day, "window": window}


def _demand_stats(core: dict, product_id: int) -> tuple[float, float]:
    daily = core["per_day"].get(product_id, {})
    series = np.zeros(core["window"])
    end = date.today()
    for i in range(core["window"]):
        iso = (end - timedelta(days=core["window"] - 1 - i + 1)).isoformat()
        series[i] = daily.get(iso, 0.0)
    return float(series.mean()), float(series.std(ddof=1)) if core["window"] > 1 else 0.0


# --------------------------------------------------------------------------- #
# ABC-XYZ
# --------------------------------------------------------------------------- #
def abcxyz_matrix(db: Session) -> dict:
    core = _load_core(db)
    rows = []
    for p in core["products"]:
        add, dstd = _demand_stats(core, p.id)
        annual = add * 365
        stock, _ = core["stock"].get(p.id, (0, None))
        rows.append({
            "id": p.id, "name": p.name, "sku": p.sku,
            "category": core["cats"].get(p.category_id, "?"),
            "annual_demand": round(annual), "unit_cost": p.unit_cost,
            "avg_daily_demand": round(add, 2), "demand_std": round(dstd, 2),
            "inventory_value": round(stock * p.unit_cost, 2),
        })
    abc_rows = abc_classify(rows)
    abc_by_id = {r.product_id: r.class_ for r in abc_rows}
    for r in rows:
        abc = abc_by_id.get(r["id"], "C")
        xyz = xyz_class(r["demand_std"], r["avg_daily_demand"])
        r["abc"] = abc
        r["xyz"] = xyz
        r["segment"] = f"{abc}{xyz}"
        r["strategy"] = abcxyz_strategy(abc, xyz)
    summary: dict[str, dict] = {}
    for r in rows:
        seg = summary.setdefault(r["segment"], {"segment": r["segment"], "count": 0,
                                                "inventory_value": 0.0, "annual_value": 0.0})
        seg["count"] += 1
        seg["inventory_value"] += r["inventory_value"]
        seg["annual_value"] += r["annual_demand"] * r["unit_cost"]
    return {
        "items": rows,
        "summary": sorted(summary.values(), key=lambda s: (s["segment"][0], s["segment"][1])),
        "legend": {
            "A/B/C": "annual consumption value share (A ≤80%, B ≤95%, C rest)",
            "X/Y/Z": "demand variability via coefficient of variation (X <0.5, Y 0.5-1.0, Z >1.0)",
        },
    }


# --------------------------------------------------------------------------- #
# Aging + velocity + slow movers
# --------------------------------------------------------------------------- #
def inventory_aging(db: Session) -> dict:
    core = _load_core(db)
    buckets = {b: {"bucket": b, "units": 0, "value": 0.0, "products": 0} for b in AGING_ORDER}
    for p in core["products"]:
        stock, last_date = core["stock"].get(p.id, (0, None))
        if stock <= 0 or last_date is None:
            continue
        # Aging proxy: days since this product was last replenished. Without
        # lot-level tracking, days-since-last-receipt is the standard retail
        # proxy for stock age (a sale does not make the remaining units newer).
        last_receipt = db.execute(
            select(func.max(InventoryDaily.date))
            .where(InventoryDaily.product_id == p.id,
                   InventoryDaily.received_quantity > 0)
        ).scalar()
        ref = date.fromisoformat(str(last_receipt or last_date))
        days_idle = (date.today() - ref).days
        b = buckets[aging_bucket(days_idle)]
        b["units"] += stock
        b["value"] += stock * p.unit_cost
        b["products"] += 1
    total_value = sum(b["value"] for b in buckets.values())
    out = []
    for b in AGING_ORDER:
        bk = buckets[b]
        bk["value"] = round(bk["value"], 2)
        bk["pct"] = round(bk["value"] / total_value * 100, 1) if total_value else 0.0
        out.append(bk)
    stale = buckets["90+"]
    return {
        "buckets": out,
        "stale_value": stale["value"],
        "stale_products": stale["products"],
        "total_value": round(total_value, 2),
        "note": ("Aging proxy: days since the inventory record last moved. Lot-level "
                 "receipt dating would sharpen this — a stated limitation."),
    }


def velocity_matrix(db: Session) -> dict:
    core = _load_core(db)
    items = []
    for p in core["products"]:
        add, _ = _demand_stats(core, p.id)
        stock, _ = core["stock"].get(p.id, (0, None))
        value = stock * p.unit_cost
        items.append({"id": p.id, "name": p.name, "sku": p.sku,
                      "category": core["cats"].get(p.category_id, "?"),
                      "avg_daily_demand": round(add, 2),
                      "inventory_value": round(value, 2)})
    if not items:
        return {"items": [], "quadrants": {}}
    d_med = float(np.median([i["avg_daily_demand"] for i in items]))
    v_med = float(np.median([i["inventory_value"] for i in items]))
    quads: dict[str, list] = {"Star": [], "Fast Moving": [], "Slow Moving": [], "Dead Stock": []}
    for i in items:
        seg = velocity_segment(i["avg_daily_demand"], i["inventory_value"], d_med, v_med)
        i["segment"] = seg
        quads[seg].append(i)
    return {
        "items": items,
        "quadrants": {k: {"count": len(v), "value": round(sum(x["inventory_value"] for x in v), 2)}
                      for k, v in quads.items()},
        "thresholds": {"demand_median": round(d_med, 2), "value_median": round(v_med, 2)},
    }


def slow_movers(db: Session) -> dict:
    core = _load_core(db)
    overstock_days = int(get_value(db, "overstock_days", 90))
    out = []
    for p in core["products"]:
        add, _ = _demand_stats(core, p.id)
        stock, _ = core["stock"].get(p.id, (0, None))
        if stock <= 0:
            continue
        doi = (stock / add) if add > 0 else None
        excess_units = max(0.0, stock - overstock_days * add) if add > 0 else float(stock)
        excess_value = excess_units * p.unit_cost
        reason = slow_mover_reason(add, doi, excess_value)
        if reason:
            out.append({
                "product_id": p.id, "name": p.name, "sku": p.sku,
                "category": core["cats"].get(p.category_id, "?"),
                "avg_daily_demand": round(add, 2),
                "days_of_inventory": round(doi, 1) if doi is not None else None,
                "stock": stock, "excess_units": round(excess_units),
                "excess_value": round(excess_value, 2),
                "recommendation": reason,
            })
    out.sort(key=lambda x: x["excess_value"], reverse=True)
    return {"items": out[:15],
            "total_excess_value": round(sum(x["excess_value"] for x in out), 2)}


# --------------------------------------------------------------------------- #
# Procurement intelligence
# --------------------------------------------------------------------------- #
def procurement_intelligence(db: Session) -> dict:
    cutoff = (date.today() - timedelta(days=365)).isoformat()
    pos = db.query(PurchaseOrder).filter(PurchaseOrder.order_date >= cutoff,
                                         PurchaseOrder.status != "Cancelled").all()
    spend_by_sup: dict[int, float] = {}
    spend_by_product_sup: dict[int, dict[int, float]] = {}
    product_pos: dict[int, list] = {}
    for po in pos:
        spend = po.quantity * po.unit_cost
        spend_by_sup[po.supplier_id] = spend_by_sup.get(po.supplier_id, 0.0) + spend
        spend_by_product_sup.setdefault(po.product_id, {})
        spend_by_product_sup[po.product_id][po.supplier_id] = (
            spend_by_product_sup[po.product_id].get(po.supplier_id, 0.0) + spend)
        product_pos.setdefault(po.product_id, []).append({
            "order_date": po.order_date, "unit_cost": po.unit_cost, "quantity": po.quantity})
    total_spend = sum(spend_by_sup.values())

    sups = {s.id: s for s in db.query(Supplier).all()}
    conc = supplier_concentration(spend_by_sup, total_spend)
    conc_shares = [{**s, "supplier": sups[s["supplier_id"]].name if s["supplier_id"] in sups else "?"}
                   for s in conc["shares"]]

    single_source = []
    price_alerts = []
    prod_names = {p.id: p for p in db.query(Product).all()}
    for pid, sup_spend in spend_by_product_sup.items():
        pc = product_concentration(sup_spend)
        if pid not in prod_names:
            continue
        p = prod_names[pid]
        if len(sup_spend) == 1:
            # Single-source dependency: 100% of volume from one supplier.
            sid = next(iter(sup_spend))
            single_source.append({
                "product_id": pid, "name": p.name, "sku": p.sku,
                "supplier_id": sid,
                "supplier": sups.get(sid).name if sid in sups else "?",
                "annual_spend": round(sum(sup_spend.values()), 2),
                "lead_time_days": p.lead_time_days,
                "share_pct": 100.0,
                "suggestion": ("Single-source dependency: all purchase volume comes from one "
                               "supplier. Analytical suggestion: qualify a backup source before "
                               "the next replenishment cycle."),
            })
        elif pc:
            single_source.append({
                "product_id": pid, "name": p.name, "sku": p.sku,
                "supplier_id": pc["top_supplier_id"],
                "supplier": sups.get(pc["top_supplier_id"]).name if pc["top_supplier_id"] in sups else "?",
                "annual_spend": round(sum(sup_spend.values()), 2),
                "lead_time_days": p.lead_time_days,
                "share_pct": pc["share_pct"],
                "suggestion": pc["suggestion"],
            })
        trend = price_trend(product_pos.get(pid, []))
        if trend and trend["change_pct"] >= 5:
            p = prod_names[pid]
            annual_units = sum(r["quantity"] for r in product_pos[pid])
            impact = annual_units * (trend["recent_avg_cost"] - trend["prior_avg_cost"])
            price_alerts.append({
                "product_id": pid, "name": p.name, "sku": p.sku,
                **trend,
                "annualized_impact": round(impact, 2),
                "note": (f"Average unit cost {trend['change_pct']:+.1f}% in the last 90 days "
                         f"vs the prior window; ~₹{impact:,.0f} annualized at current volumes."),
            })
    single_source.sort(key=lambda x: x["annual_spend"], reverse=True)
    price_alerts.sort(key=lambda x: abs(x["annualized_impact"]), reverse=True)

    opportunities = []
    for s in conc_shares[:3]:
        sup = sups.get(s["supplier_id"])
        if sup is None:
            continue
        alternatives = sorted(
            ((o for o in db.query(Supplier).all() if o.id != sup.id)),
            key=lambda o: abs(o.unit_cost - sup.unit_cost))[:2]
        if alternatives:
            alt = alternatives[0]
            opportunities.append({
                "supplier": sup.name, "annual_spend": round(spend_by_sup.get(sup.id, 0.0), 2),
                "on_time_pct": round(sup.on_time_rate * 100, 1),
                "alternative": alt.name,
                "alternative_on_time_pct": round(alt.on_time_rate * 100, 1),
                "note": (f"{sup.name} carries ₹{spend_by_sup.get(sup.id, 0):,.0f} of annual spend. "
                         f"{alt.name} operates at a comparable cost index ({alt.unit_cost:.2f} vs "
                         f"{sup.unit_cost:.2f}) with {alt.on_time_rate * 100:.0f}% on-time delivery — "
                         f"a candidate for volume-split negotiation."),
            })
    return {
        "total_spend": round(total_spend, 2),
        "concentration": {**conc, "shares": conc_shares},
        "single_source": single_source[:8],
        "price_alerts": price_alerts[:8],
        "opportunities": opportunities,
        "window_days": 365,
    }
