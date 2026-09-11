"""Advanced analytics: inventory, procurement, sales, efficiency + ABC + dynamic insights."""
from __future__ import annotations

from datetime import date, timedelta

import numpy as np
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.analytics.abc import abc_classify, abc_summary
from app.models import Category, InventoryDaily, Product, PurchaseOrder, Sale, Supplier
from app.services.settings_service import get_value


def _month_key(iso_date: str) -> str:
    return iso_date[:7]


def analytics_overview(db: Session, period_days: int = 365) -> dict:
    start = (date.today() - timedelta(days=period_days)).isoformat()

    sales_rows = db.execute(
        select(Sale.sale_date, Sale.product_id, Sale.quantity, Sale.revenue)
        .where(Sale.sale_date >= start)).all()
    inv_rows = db.execute(
        select(InventoryDaily.date, InventoryDaily.product_id, InventoryDaily.closing_stock)
        .where(InventoryDaily.date >= start)).all()
    cost = dict(db.execute(select(Product.id, Product.unit_cost)).all())
    price = dict(db.execute(select(Product.id, Product.selling_price)).all())
    pos = db.query(PurchaseOrder).filter(PurchaseOrder.order_date >= start).all()

    # ---- Inventory section ------------------------------------------------------
    inv_value_by_day: dict[str, float] = {}
    units_by_day: dict[str, int] = {}
    for d, pid, s in inv_rows:
        inv_value_by_day[d] = inv_value_by_day.get(d, 0.0) + s * cost.get(pid, 0)
        units_by_day[d] = units_by_day.get(d, 0) + s
    days_sorted = sorted(inv_value_by_day)
    avg_inv_value = float(np.mean(list(inv_value_by_day.values()))) if inv_value_by_day else 0.0
    cogs = sum(q * cost.get(pid, 0) for _, pid, q, _ in sales_rows)
    revenue = sum(r for *_, r in sales_rows)
    turnover = cogs / avg_inv_value if avg_inv_value > 0 else None
    dio = (avg_inv_value / cogs * period_days) if cogs > 0 else None
    holding_cost = avg_inv_value * float(get_value(db, "holding_cost_rate", 0.20))

    stockout_days = sum(1 for _, pid, s in inv_rows if s <= 0)
    zero_demand_products = 0
    sold_by_product: dict[int, int] = {}
    for _, pid, q, _ in sales_rows:
        sold_by_product[pid] = sold_by_product.get(pid, 0) + q
    for pid in cost:
        if sold_by_product.get(pid, 0) == 0:
            zero_demand_products += 1

    # ---- Procurement section ----------------------------------------------------
    spend = sum(po.quantity * po.unit_cost for po in pos)
    delivered = [po for po in pos if po.actual_date]
    ontime = sum(1 for po in delivered if po.actual_date <= po.expected_date)
    avg_lead = None
    if delivered:
        gaps = [(date.fromisoformat(po.actual_date) - date.fromisoformat(po.order_date)).days
                for po in delivered]
        avg_lead = float(np.mean(gaps))
    spend_by_supplier: dict[str, float] = {}
    sup_names = dict(db.execute(select(Supplier.id, Supplier.name)).all())
    for po in pos:
        sname = sup_names.get(po.supplier_id, "?")
        spend_by_supplier[sname] = spend_by_supplier.get(sname, 0.0) + po.quantity * po.unit_cost
    ppv = None  # purchase price variance vs product master cost
    variances = [abs(po.unit_cost - cost.get(po.product_id, po.unit_cost)) / cost[po.product_id] * 100
                 for po in pos if po.product_id in cost and cost.get(po.product_id)]
    ppv = float(np.mean(variances)) if variances else None

    # ---- Sales section ----------------------------------------------------------
    monthly_rev: dict[str, float] = {}
    monthly_units: dict[str, int] = {}
    for d, pid, q, r in sales_rows:
        m = _month_key(d)
        monthly_rev[m] = monthly_rev.get(m, 0.0) + r
        monthly_units[m] = monthly_units.get(m, 0) + q
    revenue_trend = [{"month": m, "revenue": round(v, 2)} for m, v in sorted(monthly_rev.items())]
    units_trend = [{"month": m, "units": v} for m, v in sorted(monthly_units.items())]

    top_products = sorted(
        [{"product_id": pid,
          "revenue": round(sum(r for d2, p2, q2, r in sales_rows if p2 == pid), 2),
          "units": sold_by_product.get(pid, 0)}
         for pid in sold_by_product],
        key=lambda x: x["revenue"], reverse=True)[:10]
    prod_names = dict(db.execute(select(Product.id, Product.name)).all())
    for t in top_products:
        t["name"] = prod_names.get(t["product_id"], "?")

    # ---- ABC --------------------------------------------------------------------
    annual_days = min(period_days, 365)
    products_for_abc = []
    for pid, name in prod_names.items():
        units = sold_by_product.get(pid, 0) * (365 / annual_days if annual_days else 1)
        products_for_abc.append({
            "id": pid, "sku": "", "name": name, "category": "",
            "annual_demand": int(units), "unit_cost": cost.get(pid, 0)})
    cats = dict(db.execute(select(Product.id, Product.category_id)).all())
    cat_names = dict(db.execute(select(Category.id, Category.name)).all())
    for r in products_for_abc:
        r["category"] = cat_names.get(cats.get(r["id"]), "?")
    abc_rows = abc_classify(products_for_abc)
    abc_items = [{
        "product_id": r.product_id, "sku": r.sku, "name": r.name, "category": r.category,
        "annual_demand": r.annual_demand, "unit_cost": r.unit_cost,
        "consumption_value": r.consumption_value, "value_share": round(r.value_share * 100, 2),
        "cumulative_share": round(r.cumulative_share * 100, 2), "class": r.class_,
    } for r in abc_rows]
    abc_summary_rows = [{
        "class": s["class"], "sku_count": s["sku_count"],
        "sku_share": round(s["sku_share"] * 100, 1),
        "value_share": round(s["value_share"] * 100, 1),
        "value": s["value"],
    } for s in abc_summary(abc_rows)]
    pareto = [{"rank": i + 1, "cumulative_share": round(r["cumulative_share"], 2),
               "class": r["class"]} for i, r in enumerate(abc_items)]

    # ---- Dynamic insights ---------------------------------------------------------
    insights: list[dict] = []
    a_rows = [r for r in abc_items if r["class"] == "A"]
    if a_rows:
        top20_share = sum(r["value_share"] for r in a_rows)
        insights.append({
            "title": "Value concentration",
            "text": (f"{len(a_rows)} products ({a_rows and round(len(a_rows) / max(len(abc_items), 1) * 100, 0)}% "
                     f"of SKUs) account for {top20_share:.0f}% of total consumption value — "
                     f"these deserve tighter monitoring and priority replenishment."),
            "severity": "info", "link": "/analytics#abc"})
    # Supplier trade-off: cheapest vs slowest
    sups = db.query(Supplier).all()
    if sups and pos:
        delays = {s.id: 0 for s in sups}
        counts = {s.id: 0 for s in sups}
        for po in delivered:
            if po.actual_date > po.expected_date:
                delays[po.supplier_id] = delays.get(po.supplier_id, 0) + 1
            counts[po.supplier_id] = counts.get(po.supplier_id, 0) + 1
        delay_rates = {sid: (delays[sid] / counts[sid] * 100 if counts[sid] else 0) for sid in counts}
        cheapest = min(sups, key=lambda s: s.unit_cost)
        if delay_rates.get(cheapest.id, 0) > 10:
            insights.append({
                "title": "Supplier trade-off",
                "text": (f"{cheapest.name} has the lowest cost index ({cheapest.unit_cost:.2f}) but a "
                         f"{delay_rates[cheapest.id]:.0f}% delay rate — cheap may not mean economical "
                         f"once expediting and stock-outs are priced in."),
                "severity": "warning", "link": "/suppliers"})
    # Inventory vs sales growth divergence
    if len(revenue_trend) >= 3:
        half = len(revenue_trend) // 2
        rev_first = sum(r["revenue"] for r in revenue_trend[:half])
        rev_second = sum(r["revenue"] for r in revenue_trend[half:])
        inv_first = sum(v for d, v in inv_value_by_day.items() if d < days_sorted[len(days_sorted) // 2]) or 1
        inv_second = sum(v for d, v in inv_value_by_day.items() if d >= days_sorted[len(days_sorted) // 2])
        rev_chg = (rev_second - rev_first) / rev_first * 100 if rev_first else 0
        inv_chg = (inv_second - inv_first) / inv_first * 100 if inv_first else 0
        if abs(inv_chg - rev_chg) > 5:
            insight_text = (f"Inventory value changed {inv_chg:+.0f}% while revenue changed {rev_chg:+.0f}% "
                            f"in the same period"
                            + (" — inventory is growing faster than sales, watch for overstock."
                               if inv_chg > rev_chg else " — sales are outpacing inventory investment."))
            insights.append({"title": "Inventory vs sales", "text": insight_text,
                             "severity": "warning" if inv_chg > rev_chg else "info",
                             "link": "/analytics"})
    # Category risk hotspot
    if products_for_abc:
        sold_zero = [pid for pid in cost if sold_by_product.get(pid, 0) == 0]
        if sold_zero:
            insights.append({
                "title": "Dead stock watch",
                "text": (f"{len(sold_zero)} products recorded zero sales in the last {period_days} days — "
                         f"candidates for markdown or discontinuation."),
                "severity": "warning", "link": "/inventory?status=Overstock"})

    # ---- Efficiency section -------------------------------------------------------
    po_total = len(pos)
    delayed = sum(1 for po in pos if po.status == "Delayed"
                  or (po.actual_date and po.actual_date > po.expected_date))
    open_pos = sum(1 for po in pos if po.status in ("Draft", "Pending", "Ordered", "In Transit"))
    cancelled = sum(1 for po in pos if po.status == "Cancelled")

    return {
        "period_days": period_days,
        "inventory": {
            "turnover": round(turnover, 2) if turnover else None,
            "days_inventory_outstanding": round(dio, 1) if dio else None,
            "avg_inventory_value": round(avg_inv_value, 2),
            "holding_cost_annual": round(holding_cost, 2),
            "stockout_days": stockout_days,
            "zero_demand_products": zero_demand_products,
            "current_inventory_value": round(list(inv_value_by_day.values())[-1], 2) if inv_value_by_day else 0,
        },
        "procurement": {
            "total_spend": round(spend, 2),
            "po_count": po_total,
            "on_time_pct": round(ontime / len(delivered) * 100, 1) if delivered else None,
            "avg_lead_time_days": round(avg_lead, 1) if avg_lead else None,
            "purchase_price_variance_pct": round(ppv, 2) if ppv is not None else None,
            "spend_by_supplier": [{"supplier": k, "spend": round(v, 2)}
                                  for k, v in sorted(spend_by_supplier.items(),
                                                     key=lambda kv: -kv[1])[:10]],
        },
        "sales": {
            "units_sold": sum(sold_by_product.values()),
            "revenue": round(revenue, 2),
            "revenue_trend": revenue_trend,
            "units_trend": units_trend,
            "top_products": top_products,
        },
        "efficiency": {
            "open_purchase_orders": open_pos,
            "delayed_purchase_orders": delayed,
            "delayed_pct": round(delayed / po_total * 100, 1) if po_total else None,
            "cancelled_purchase_orders": cancelled,
            "supplier_on_time_pct": round(ontime / len(delivered) * 100, 1) if delivered else None,
        },
        "abc": {"items": abc_items, "summary": abc_summary_rows, "pareto": pareto},
        "insights": insights,
    }
