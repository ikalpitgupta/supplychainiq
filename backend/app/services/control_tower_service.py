"""Control Tower: five-stage supply chain health (SUPPLIERS → PURCHASE ORDERS →
WAREHOUSE → INVENTORY → CUSTOMERS). Each stage gets a 0-100 score computed from
its own domain signals, an issue count, and clickable critical alerts.
"""
from __future__ import annotations

from datetime import date, timedelta

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.models import (Category, InventoryDaily, Product, PurchaseOrder, Sale, Supplier)
from app.services.anomaly_service import scan_anomalies, supplier_delay_anomalies
from app.services.dashboard_service import _latest_stock_map, _product_demand_map
from app.services.settings_service import get_value


def control_tower(db: Session) -> dict:
    window = int(get_value(db, "demand_window_days", 90))
    service_level = float(get_value(db, "service_level", 0.95))
    overstock_days = int(get_value(db, "overstock_days", 90))
    period_start = (date.today() - timedelta(days=90)).isoformat()

    products = db.query(Product).all()
    cats = dict(db.execute(select(Category.id, Category.name)).all())
    sups = db.query(Supplier).all()
    stock = _latest_stock_map(db)
    demand = _product_demand_map(db, window)

    from app.analytics.inventory import (classify_status, days_of_inventory,
                                         reorder_point, risk_tier, safety_stock,
                                         stockout_risk)
    from app.analytics.impact import revenue_at_risk

    # ---- Inventory stage ------------------------------------------------------
    statuses = {"Healthy": 0, "Low Stock": 0, "Critical": 0, "Overstock": 0}
    tiers = {"LOW": 0, "MEDIUM": 0, "HIGH": 0, "CRITICAL": 0}
    risk_rows = []
    overstock_rows = []
    impact_rows = []
    for p in products:
        cur = stock.get(p.id, 0)
        add, dstd = demand.get(p.id, (0.0, 0.0))
        ss = safety_stock(dstd, p.lead_time_days, service_level)
        rop = reorder_point(add, dstd, p.lead_time_days, service_level)
        doi = days_of_inventory(cur, add)
        st = classify_status(cur, add, rop, doi, overstock_days, 0.5)
        rk = stockout_risk(cur, add, dstd, p.lead_time_days, ss)
        tier = risk_tier(rk["days_to_zero"], rk["projected_stock_at_lead_time"], ss, rop)
        statuses[st] = statuses.get(st, 0) + 1
        tiers[tier] = tiers.get(tier, 0) + 1
        if tier in ("CRITICAL", "HIGH"):
            risk_rows.append({"id": p.id, "name": p.name, "tier": tier,
                              "days_to_zero": rk["days_to_zero"], "stock": cur,
                              "link": f"/products/{p.id}"})
        if st == "Overstock":
            overstock_rows.append({"id": p.id, "name": p.name, "doi": doi,
                                   "link": f"/inventory?status=Overstock"})
        impact_rows.append({
            "avg_daily_demand": add, "lead_time_days": p.lead_time_days,
            "days_to_zero": rk["days_to_zero"], "selling_price": p.selling_price,
            "current_stock": cur, "unit_cost": p.unit_cost, "overstock_days": overstock_days,
            "category": cats.get(p.category_id, "?"),
        })
    holding_rate = float(get_value(db, "holding_cost_rate", 0.20))
    from app.analytics.impact import business_impact
    impact = business_impact(impact_rows, holding_cost_rate=holding_rate)

    inv_score = (statuses["Healthy"] / max(len(products), 1)) * 100
    inventory_stage = {
        "stage": "INVENTORY", "score": round(inv_score, 0),
        "issues": statuses["Critical"] + statuses["Low Stock"] + statuses["Overstock"],
        "detail": (f"{statuses['Healthy']} healthy · {statuses['Low Stock']} low · "
                   f"{statuses['Critical']} critical · {statuses['Overstock']} overstock"),
        "alerts": sorted(risk_rows, key=lambda r: r["days_to_zero"] or 1e9)[:5]
                  + overstock_rows[:2],
    }

    # ---- Suppliers stage --------------------------------------------------------
    delay_anoms = supplier_delay_anomalies(db)
    mean_score = (sum(s.on_time_rate for s in sups) / len(sups) * 100) if sups else 70
    supplier_stage = {
        "stage": "SUPPLIERS", "score": round(mean_score, 0),
        "issues": len(delay_anoms),
        "detail": f"{len(sups)} suppliers · mean on-time {mean_score:.0f}%",
        "alerts": [{"id": a["key"], "name": a["label"], "tier": "HIGH",
                    "detail": a["explanation"], "link": a["investigate_link"]}
                   for a in delay_anoms[:4]],
    }

    # ---- Purchase orders stage ---------------------------------------------------
    pos = db.query(PurchaseOrder).filter(PurchaseOrder.order_date >= period_start).all()
    open_pos = [po for po in pos if po.status in ("Draft", "Pending", "Ordered", "In Transit")]
    late_pos = [po for po in pos if po.status == "Delayed"
                or (po.actual_date and po.actual_date > po.expected_date)]
    po_score = (1 - len(late_pos) / len(pos)) * 100 if pos else 100
    prod_names = {p.id: p.name for p in products}
    po_stage = {
        "stage": "PURCHASE ORDERS", "score": round(po_score, 0),
        "issues": len(late_pos),
        "detail": f"{len(pos)} POs (90d) · {len(open_pos)} open · {len(late_pos)} late",
        "alerts": [{"id": po.id, "name": f"{po.po_number} — {prod_names.get(po.product_id, '?')}",
                    "tier": "HIGH", "detail": f"status {po.status}", "link": "/purchase-orders"}
                   for po in late_pos[:4]],
    }

    # ---- Warehouse stage (working capital + excess) --------------------------------
    total_units = sum(stock.values())
    total_value = sum(stock.get(p.id, 0) * p.unit_cost for p in products)
    excess_value = impact["excess_inventory_value"]
    wh_score = max(0.0, 100 - excess_value / max(total_value, 1) * 200)  # 50% excess -> 0
    warehouse_stage = {
        "stage": "WAREHOUSE", "score": round(wh_score, 0),
        "issues": 1 if excess_value > 0 else 0,
        "detail": (f"{total_units:,} units · ₹{total_value / 1e7:.2f} Cr value · "
                   f"₹{excess_value / 1e5:.1f}L excess"),
        "alerts": [{"id": 0, "name": "Excess inventory",
                    "tier": "MEDIUM",
                    "detail": f"₹{excess_value:,.0f} above policy cover (estimate)",
                    "link": "/inventory?status=Overstock"}] if excess_value > 0 else [],
    }

    # ---- Customers stage (demand + anomalies) ----------------------------------------
    anomalies = scan_anomalies(db, limit=6)
    cust_score = max(0.0, 100 - len(anomalies["anomalies"]) * 8)
    customers_stage = {
        "stage": "CUSTOMERS", "score": round(cust_score, 0),
        "issues": len(anomalies["anomalies"]),
        "detail": (f"{len(anomalies['anomalies'])} demand spikes · "
                   f"₹{impact['revenue_at_risk'] / 1e5:.1f}L revenue at risk (estimate)"),
        "alerts": [{"id": a["key"], "name": a["label"], "tier": "HIGH",
                    "detail": a["explanation"], "link": a["investigate_link"]}
                   for a in anomalies["anomalies"][:4]],
    }

    overall = round(sum(s["score"] for s in
                        (supplier_stage, po_stage, warehouse_stage, inventory_stage, customers_stage)) / 5, 0)

    return {
        "overall_score": overall,
        "stages": [supplier_stage, po_stage, warehouse_stage, inventory_stage, customers_stage],
        "summary": {
            "stockout_risks": tiers["CRITICAL"] + tiers["HIGH"],
            "critical": tiers["CRITICAL"],
            "overstock_count": statuses["Overstock"],
            "revenue_at_risk": impact["revenue_at_risk"],
            "excess_value": impact["excess_inventory_value"],
            "potential_savings": impact["potential_savings"],
            "demand_anomalies": len(anomalies["anomalies"]),
            "supplier_delays": len(delay_anoms),
            "late_pos": len(late_pos),
        },
        "period_days": 90,
    }
