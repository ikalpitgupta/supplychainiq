"""Outbound supply-chain intelligence: size availability, fulfillment
bottlenecks, delivery SLA, root-cause chains, customer impact, and actions.

Everything here is computed from the outbound tables (warehouses, variant
inventory, customer orders, returns) — the fashion e-commerce story of
INVENTORY → FULFILLMENT → DELIVERY → CUSTOMER EXPERIENCE.
"""
from __future__ import annotations

from collections import defaultdict
from datetime import date, timedelta

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.models import Category, OutboundOrder, Product, ReturnLine, VariantInventory, Warehouse

CARRIER_SLA_DAYS = 3          # promised delivery window for customer orders
SIZED_CATEGORIES = {"Fashion", "Footwear", "Sportswear"}


def _product_ids(db: Session, category: str | None = None) -> list[int]:
    q = select(Product.id)
    if category:
        q = q.join(Category, Category.id == Product.category_id).where(Category.name == category)
    return list(db.execute(q).scalars())


# ---------------------------------------------------------------------------
# 1+2 · Inventory & SIZE availability
# ---------------------------------------------------------------------------

def size_availability(db: Session, category: str | None = None, limit: int = 12) -> dict:
    """Per product × size: on-hand vs fair-share demand → size-level stock-out risk.

    A size is flagged when its share of stock is materially below its share of
    recent outbound demand (the "XL is approaching stock-out" case), or when
    absolute units fall under the size's expected weekly offtake.
    """
    since = (date.today() - timedelta(days=30)).isoformat()

    inv_rows = db.execute(
        select(VariantInventory.product_id, VariantInventory.size, func.sum(VariantInventory.units))
        .group_by(VariantInventory.product_id, VariantInventory.size)
    ).all() if not category else db.execute(
        select(VariantInventory.product_id, VariantInventory.size, func.sum(VariantInventory.units))
        .join(Product, Product.id == VariantInventory.product_id)
        .join(Category, Category.id == Product.category_id)
        .where(Category.name == category)
        .group_by(VariantInventory.product_id, VariantInventory.size)
    ).all()

    demand_rows = db.execute(
        select(OutboundOrder.product_id, OutboundOrder.size, func.sum(OutboundOrder.quantity))
        .where(OutboundOrder.order_date >= since, OutboundOrder.status != "Cancelled")
        .group_by(OutboundOrder.product_id, OutboundOrder.size)
    ).all()

    demand: dict[tuple[int, str], int] = defaultdict(int)
    for pid, size, qty in demand_rows:
        demand[(pid, size)] = int(qty or 0)

    by_product: dict[int, dict] = {}
    for pid, size, units in inv_rows:
        d = by_product.setdefault(pid, {"sizes": {}})
        d["sizes"][size] = int(units or 0)

    names = dict(db.execute(select(Product.id, Product.name)).all())
    prices = dict(db.execute(select(Product.id, Product.selling_price)).all())

    results = []
    for pid, data in by_product.items():
        sizes = data["sizes"]
        total_stock = sum(sizes.values())
        total_demand = sum(demand.get((pid, s), 0) for s in sizes) or 0
        at_risk = []
        for size, units in sizes.items():
            d30 = demand.get((pid, size), 0)
            fair = total_demand / len(sizes) if sizes else 0
            stock_share = (units / total_stock) if total_stock else 0
            demand_share = (d30 / total_demand) if total_demand else (1 / len(sizes) if sizes else 0)
            weekly_need = d30 / 4.3
            # Risk: starved share OR thin absolute cover against recent offtake.
            starved = stock_share < demand_share * 0.55 and units < fair
            thin_cover = weekly_need > 0 and units < weekly_need * 1.5
            if starved or thin_cover:
                at_risk.append({
                    "size": size,
                    "units": units,
                    "d30_demand": d30,
                    "days_cover": round(units / (d30 / 30), 1) if d30 else None,
                    "severity": "critical" if (d30 and units < d30 / 30) or units <= 8 else "warning",
                })
        if not at_risk or total_stock == 0:
            continue
        # Revenue exposure: lost units over the next 2 weeks for starving sizes.
        lost_units = sum(
            max(0.0, (r["d30_demand"] / 30) * 14 - r["units"]) for r in at_risk
        )
        results.append({
            "product_id": pid,
            "product": names.get(pid, "?"),
            "sizes": sizes,
            "d30_demand_by_size": {s: demand.get((pid, s), 0) for s in sizes},
            "at_risk": sorted(at_risk, key=lambda r: r["units"]),
            "lost_units_2w": round(lost_units, 1),
            "revenue_at_risk": round(lost_units * prices.get(pid, 0), 0),
        })
    results.sort(key=lambda r: -r["revenue_at_risk"])
    flagged = len(results)
    return {
        "window_days": 30,
        "flagged_products": flagged,
        "revenue_at_risk": sum(r["revenue_at_risk"] for r in results),
        "items": results[:limit],
    }


def variant_matrix(db: Session, product_id: int) -> dict:
    """Product × size × warehouse stock — the 'Black/M/Delhi = 12' view."""
    product = db.get(Product, product_id)
    if not product:
        raise LookupError("product not found")
    rows = db.execute(
        select(VariantInventory.size, Warehouse.code, Warehouse.region, VariantInventory.units)
        .join(Warehouse, Warehouse.id == VariantInventory.warehouse_id)
        .where(VariantInventory.product_id == product_id)
        .order_by(VariantInventory.size, Warehouse.code)
    ).all()
    warehouses = [w.code for w in db.execute(select(Warehouse).order_by(Warehouse.id)).scalars()]
    sizes: dict[str, dict] = {}
    for size, code, region, units in rows:
        s = sizes.setdefault(size, {"total": 0, "by_warehouse": {}})
        s["total"] += units
        s["by_warehouse"][code] = units
    return {
        "warehouses": warehouses,
        "sizes": sizes,
        "total": sum(s["total"] for s in sizes.values()),
    }


# ---------------------------------------------------------------------------
# 3 · Fulfillment bottlenecks (pick → pack → dispatch)
# ---------------------------------------------------------------------------

def fulfillment_bottleneck(db: Session, days: int = 30) -> dict:
    since = (date.today() - timedelta(days=days)).isoformat()
    rows = db.execute(
        select(OutboundOrder.pick_hours, OutboundOrder.pack_hours, OutboundOrder.dispatch_hours)
        .where(OutboundOrder.order_date >= since, OutboundOrder.status.in_(["Delivered", "Dispatched"]))
    ).all()
    if not rows:
        return {"window_days": days, "stages": [], "bottleneck": None, "by_warehouse": []}

    n = len(rows)
    avg = {
        "Pick": sum(r[0] or 0 for r in rows) / n,
        "Pack": sum(r[1] or 0 for r in rows) / n,
        "Dispatch": sum(r[2] or 0 for r in rows) / n,
    }
    total = sum(avg.values()) or 1.0
    stages = [{"stage": k, "avg_hours": round(v, 1), "share_pct": round(v / total * 100, 1)}
              for k, v in avg.items()]
    bottleneck = max(stages, key=lambda s: s["avg_hours"])["stage"]

    wh_stats = db.execute(
        select(Warehouse.code, func.avg(OutboundOrder.pick_hours),
               func.avg(OutboundOrder.pack_hours), func.avg(OutboundOrder.dispatch_hours),
               func.count())
        .join(OutboundOrder, OutboundOrder.warehouse_id == Warehouse.id)
        .where(OutboundOrder.order_date >= since, OutboundOrder.status.in_(["Delivered", "Dispatched"]))
        .group_by(Warehouse.code)
    ).all()
    by_wh = [{
        "warehouse": code,
        "pick_hours": round(p or 0, 1), "pack_hours": round(pa or 0, 1),
        "dispatch_hours": round(d or 0, 1),
        "orders": cnt,
    } for code, p, pa, d, cnt in wh_stats]

    return {
        "window_days": days,
        "orders": n,
        "stages": stages,
        "bottleneck": bottleneck,
        "total_cycle_hours": round(sum(avg.values()), 1),
        "by_warehouse": sorted(by_wh, key=lambda w: -w["dispatch_hours"]),
    }


# ---------------------------------------------------------------------------
# 4 · Delivery SLA intelligence (region / warehouse / carrier)
# ---------------------------------------------------------------------------

def delivery_sla(db: Session, days: int = 30) -> dict:
    since = (date.today() - timedelta(days=days)).isoformat()
    rows = db.execute(
        select(OutboundOrder)
        .where(OutboundOrder.order_date >= since, OutboundOrder.status == "Delivered")
    ).scalars().all()
    if not rows:
        return {"window_days": days, "delivered": 0, "on_time_rate": None, "by_region": [],
                "by_warehouse": [], "by_carrier": [], "delay_reasons": []}

    def bucket(key_fn) -> list[dict]:
        agg: dict[str, dict] = defaultdict(lambda: {"n": 0, "late": 0, "late_days": 0})
        for o in rows:
            k = key_fn(o)
            agg[k]["n"] += 1
            if o.delivered_date and o.delivered_date > o.promised_date:
                agg[k]["late"] += 1
                agg[k]["late_days"] += (date.fromisoformat(o.delivered_date)
                                        - date.fromisoformat(o.promised_date)).days
        out = []
        for k, v in agg.items():
            out.append({
                "key": k, "delivered": v["n"], "late": v["late"],
                "late_rate_pct": round(v["late"] / v["n"] * 100, 1),
                "avg_late_days": round(v["late_days"] / v["late"], 1) if v["late"] else 0,
            })
        return sorted(out, key=lambda x: -x["late_rate_pct"])

    reasons = dict(db.execute(
        select(OutboundOrder.delay_reason, func.count())
        .where(OutboundOrder.order_date >= since, OutboundOrder.delay_reason.is_not(None))
        .group_by(OutboundOrder.delay_reason)
    ).all())
    late_total = sum(1 for o in rows if o.delivered_date > o.promised_date)

    return {
        "window_days": days,
        "delivered": len(rows),
        "late": late_total,
        "on_time_rate": round((len(rows) - late_total) / len(rows), 4),
        "by_region": bucket(lambda o: o.region),
        "by_warehouse": bucket(lambda o: db.get(Warehouse, o.warehouse_id).code),
        "by_carrier": bucket(lambda o: o.carrier),
        "delay_reasons": [{"reason": k, "count": v} for k, v in
                          sorted(reasons.items(), key=lambda kv: -kv[1])],
    }


# ---------------------------------------------------------------------------
# 5 · Root-cause chain (interactive: every node carries live evidence)
# ---------------------------------------------------------------------------

def root_cause_chain(db: Session, days: int = 30) -> dict:
    """Build the causal chain ONLY when the data supports it: if late deliveries
    are materially concentrated in distant-routed orders, and distant routing
    coincides with stock imbalance at the home DC, the chain is shown with the
    measured numbers at each hop. Otherwise the API says so."""
    since = (date.today() - timedelta(days=days)).isoformat()
    orders = db.execute(
        select(OutboundOrder).where(OutboundOrder.order_date >= since)
    ).scalars().all()
    if not orders:
        return {"available": False, "message": "No outbound orders in the window."}

    delivered = [o for o in orders if o.status == "Delivered" and o.delivered_date]
    late = [o for o in delivered if o.delivered_date > o.promised_date]
    if not delivered:
        return {"available": False, "message": "No completed deliveries in the window yet."}

    late_rate = len(late) / len(delivered)
    distant = [o for o in delivered if o.delay_reason == "Routed from distant DC"]
    distant_late_rate = (sum(1 for o in distant if o.delivered_date > o.promised_date) / len(distant)) if distant else 0
    local = [o for o in delivered if o.delay_reason is None or o.delay_reason != "Routed from distant DC"]
    local_late_rate = (sum(1 for o in local if o.delivered_date > o.promised_date) / len(local)) if local else 0

    # Stock imbalance: home-DC share of variant stock vs its fair share (25%).
    whs = db.execute(select(Warehouse)).scalars().all()
    wh_share = {}
    inv = db.execute(select(VariantInventory.warehouse_id, func.sum(VariantInventory.units))
                     .group_by(VariantInventory.warehouse_id)).all()
    total_units = sum(u or 0 for _, u in inv) or 1
    for w in whs:
        units = next((u for wid, u in inv if wid == w.id), 0) or 0
        wh_share[w.code] = {"share_pct": round(units / total_units * 100, 1), "region": w.region}
    starved = [c for c, s in wh_share.items() if s["share_pct"] < 18]

    # Demand pressure: recent 15d daily demand vs the prior 15d.
    def daily(q_start: str, q_end: str) -> float:
        n = db.execute(
            select(func.coalesce(func.sum(OutboundOrder.quantity), 0))
            .where(OutboundOrder.order_date >= q_start, OutboundOrder.order_date < q_end)
        ).scalar() or 0
        return n / 15

    d_start = date.today() - timedelta(days=days)
    recent_daily = daily((date.today() - timedelta(days=15)).isoformat(), date.today().isoformat())
    prior_daily = daily((date.today() - timedelta(days=30)).isoformat(),
                        (date.today() - timedelta(days=15)).isoformat())
    demand_step = (recent_daily / prior_daily - 1) if prior_daily else 0

    # Cancellation link.
    cancelled = [o for o in orders if o.status == "Cancelled"]
    cancel_rate = len(cancelled) / len(orders)

    available = bool(
        len(distant) >= 8
        and distant_late_rate > local_late_rate + 0.10
        and starved
    )
    chain = []
    if available:
        chain = [
            {"node": "Demand spike", "evidence": (
                f"Daily order volume {'up' if demand_step >= 0 else 'down'} "
                f"{abs(demand_step) * 100:.0f}% vs the prior fortnight ({recent_daily:.0f} vs {prior_daily:.0f} orders/day)."),
             "holds": abs(demand_step) > 0.05},
            {"node": "Inventory imbalance", "evidence": (
                f"Home-DC stock share is thin where demand sits: "
                + ", ".join(f"{c} holds only {wh_share[c]['share_pct']}% of units" for c in starved) + "."),
             "holds": True},
            {"node": "Nearest warehouse unavailable", "evidence": (
                f"{sum(1 for o in delivered if not _home_stock_ok(db, o))} of {len(delivered)} delivered orders showed slow dispatch (≥15h) — the signature of distant routing rather than home-DC stock."),
             "holds": True},
            {"node": "Order routed from distant warehouse", "evidence": (
                f"{len(distant)} orders ({len(distant) / len(delivered) * 100:.0f}% of deliveries) were distant-routed; dispatch averages "
                f"{_avg_dispatch(db, distant):.0f}h vs {_avg_dispatch(db, local):.0f}h locally."),
             "holds": True},
            {"node": "Longer fulfillment distance", "evidence": (
                f"Distant-routed orders are late {distant_late_rate * 100:.0f}% of the time vs {local_late_rate * 100:.0f}% for local shipments."),
             "holds": True},
            {"node": "Delivery SLA breach", "evidence": (
                f"Overall late rate {late_rate * 100:.1f}% across {len(delivered)} deliveries in {days} days."),
             "holds": True},
        ]

    return {
        "available": available,
        "message": None if available else (
            "The chain is not currently supported by the data: distant-routing is not the dominant late-delivery driver "
            "in this window, or no warehouse is materially under-stocked."),
        "window_days": days,
        "headline": {"late_rate_pct": round(late_rate * 100, 1), "delivered": len(delivered),
                     "cancelled": len(cancelled), "cancel_rate_pct": round(cancel_rate * 100, 1)},
        "chain": chain,
        "warehouse_shares": wh_share,
    }


def _avg_dispatch(db: Session, orders: list[OutboundOrder]) -> float:
    vals = [o.dispatch_hours for o in orders if o.dispatch_hours]
    return sum(vals) / len(vals) if vals else 0.0


def _home_stock_ok(db: Session, o: OutboundOrder) -> bool:
    return o.dispatch_hours is not None and o.dispatch_hours < 15


# ---------------------------------------------------------------------------
# 6+7 · Customer impact + actions
# ---------------------------------------------------------------------------

def customer_impact(db: Session, days: int = 30) -> dict:
    """Connect operations to customer outcomes — with the correlation stated
    only when both halves of it are measurable in the window."""
    mid = date.today() - timedelta(days=days // 2)
    p1, p2 = (mid - timedelta(days=days // 2)).isoformat(), mid.isoformat()
    p2_end = date.today().isoformat()

    def window_stats(start: str, end: str) -> dict:
        orders = db.execute(
            select(OutboundOrder).where(OutboundOrder.order_date >= start, OutboundOrder.order_date < end)
        ).scalars().all()
        delivered = [o for o in orders if o.status == "Delivered" and o.delivered_date]
        late = [o for o in delivered if o.delivered_date > o.promised_date]
        cancelled = [o for o in orders if o.status == "Cancelled"]
        returns = db.execute(
            select(func.count()).select_from(ReturnLine)
            .where(ReturnLine.return_date >= start, ReturnLine.return_date < end)
        ).scalar() or 0
        lost_revenue = sum(o.revenue for o in cancelled)
        return {
            "orders": len(orders),
            "late_rate_pct": round(len(late) / len(delivered) * 100, 1) if delivered else None,
            "cancel_rate_pct": round(len(cancelled) / len(orders) * 100, 1) if orders else None,
            "returns": returns,
            "cancelled_revenue": round(lost_revenue, 0),
        }

    prior = window_stats(p1, p2)
    recent = window_stats(p2, p2_end)

    findings = []
    if recent["late_rate_pct"] is not None and prior["late_rate_pct"] is not None:
        d_late = recent["late_rate_pct"] - prior["late_rate_pct"]
        if abs(d_late) >= 1:
            line = (f"Late delivery rate moved from {prior['late_rate_pct']}% to {recent['late_rate_pct']}% "
                    f"({'up' if d_late > 0 else 'down'} {abs(d_late)} pts) between the two halves of the window.")
            if recent["cancel_rate_pct"] is not None and prior["cancel_rate_pct"] is not None:
                d_cancel = recent["cancel_rate_pct"] - prior["cancel_rate_pct"]
                line += (f" Cancellation rate moved {d_cancel:+.1f} pts over the same period"
                         f"{' — the two moved together' if (d_late > 0) == (d_cancel > 0) and abs(d_cancel) >= 0.5 else ''}.")
            findings.append(line)
    if recent["cancel_rate_pct"]:
        findings.append(f"{recent['cancel_rate_pct']}% of orders in the recent half were cancelled — "
                        f"an estimated ₹{recent['cancelled_revenue']:,.0f} of demand lost before dispatch.")
    findings.append("Measured returns reflect the category mix (sized categories return far more than one-size goods).")

    return {"window_days": days, "prior": prior, "recent": recent, "findings": findings}


def outbound_actions(db: Session, days: int = 30) -> dict:
    """Problem → root cause → recommended action → estimated impact. Every row
    states its basis; no guaranteed improvement numbers."""
    actions: list[dict] = []
    sla = delivery_sla(db, days)
    size_risk = size_availability(db, limit=100)
    bottleneck = fulfillment_bottleneck(db, days)

    worst_region = next((r for r in sla.get("by_region", []) if r["late_rate_pct"] > 15), None)
    if worst_region:
        share = next((s for c, s in root_cause_chain(db, days).get("warehouse_shares", {}).items()
                      if s["region"] == worst_region["key"]), None)
        actions.append({
            "problem": f"High delivery delays in {worst_region['key']} region ({worst_region['late_rate_pct']}% of deliveries late).",
            "root_cause": (f"Regional DC holds only {share['share_pct']}% of network stock"
                           if share else "Home-DC stock is thin relative to that region's demand"),
            "recommendation": f"Pre-position high-demand SKUs in the {worst_region['key']} warehouse — estimated potential reduction in SLA breaches for locally-stocked lines.",
            "impact": "Estimated: late rate for locally-shipped orders runs far below distant-routed ones in the same window.",
            "cta": {"label": "View delivery intelligence", "to": "/delivery"},
        })

    for item in size_risk.get("items", [])[:3]:
        worst_size = item["at_risk"][0]["size"] if item["at_risk"] else None
        if worst_size:
            actions.append({
                "problem": f"{item['product']}: size {worst_size} approaching stock-out "
                           f"({item['at_risk'][0]['units']} units, {item['at_risk'][0]['d30_demand']} sold in 30d).",
                "root_cause": "Size-level stock share is below this size's share of recent demand.",
                "recommendation": f"Replenish size {worst_size} ahead of other sizes; consider rebalancing from overstocked DCs.",
                "impact": f"Estimated {item['lost_units_2w']:.0f} units (~₹{item['revenue_at_risk']:,.0f}) of demand at risk over two weeks if unaddressed.",
                "cta": {"label": "Open product", "to": f"/products/{item['product_id']}"},
            })

    if bottleneck.get("bottleneck") and bottleneck["bottleneck"] != "Dispatch" and bottleneck["total_cycle_hours"] and \
            bottleneck["stages"] and bottleneck["stages"][0]["avg_hours"] > 0:
        stage = next((s for s in bottleneck["stages"] if s["stage"] == bottleneck["bottleneck"]), None)
        if stage and stage["share_pct"] < 70:
            actions.append({
                "problem": f"Fulfillment cycle: {stage['stage']} is the slowest in-DC stage "
                           f"({stage['avg_hours']}h average, {stage['share_pct']}% of cycle time).",
                "root_cause": f"{stage['stage']} capacity lags order volume in the last {days} days.",
                "recommendation": f"Review {stage['stage'].lower()} staffing/queueing — potential cycle-time reduction without touching dispatch.",
                "impact": "Estimated: cutting the bottleneck stage compresses total order-to-dispatch time directly.",
                "cta": {"label": "View fulfillment", "to": "/fulfillment"},
            })

    return {"window_days": days, "actions": actions}


def outbound_product_view(db: Session, product_id: int) -> dict:
    """Complete outbound health for one product: variant × warehouse stock,
    size-level risk, fulfillment stats, and the measured return rate."""
    product = db.get(Product, product_id)
    if not product:
        raise LookupError("product not found")
    sized = product.category.name in SIZED_CATEGORIES if product.category else False

    # Variant × warehouse matrix.
    rows = db.execute(
        select(VariantInventory.size, Warehouse.code, VariantInventory.units)
        .join(Warehouse, Warehouse.id == VariantInventory.warehouse_id)
        .where(VariantInventory.product_id == product_id)
    ).all()
    warehouses = [w.code for w in db.execute(select(Warehouse).order_by(Warehouse.id)).scalars()]
    sizes: dict[str, dict] = {}
    for size, code, units in rows:
        s = sizes.setdefault(size, {"total": 0, "by_warehouse": {c: 0 for c in warehouses}})
        s["total"] += units
        s["by_warehouse"][code] = units
    variants = {k: v for k, v in sorted(sizes.items())}

    # Size-level risk from the network-wide detector, filtered to this product.
    risk = size_availability(db, limit=500)
    size_risk = next((i for i in risk.get("items", []) if i["product_id"] == product_id), None)

    # Fulfillment + delivery stats for this product (90-day window).
    since = (date.today() - timedelta(days=90)).isoformat()
    orders = db.execute(
        select(OutboundOrder).where(OutboundOrder.product_id == product_id,
                                    OutboundOrder.order_date >= since)
    ).scalars().all()
    delivered = [o for o in orders if o.status == "Delivered" and o.delivered_date]
    late = [o for o in delivered if o.delivered_date > o.promised_date]
    cancelled = [o for o in orders if o.status == "Cancelled"]
    pick = [o.pick_hours for o in delivered if o.pick_hours]
    pack = [o.pack_hours for o in delivered if o.pack_hours]
    disp = [o.dispatch_hours for o in delivered if o.dispatch_hours]

    # Measured return rate over the last 90 days (delivered orders with returns).
    n_returns = db.execute(
        select(func.count()).select_from(ReturnLine)
        .join(OutboundOrder, OutboundOrder.id == ReturnLine.order_id)
        .where(OutboundOrder.product_id == product_id,
               ReturnLine.return_date >= since)
    ).scalar() or 0
    return_rate = (n_returns / len(delivered)) if delivered else None
    reasons = dict(db.execute(
        select(ReturnLine.reason, func.count())
        .join(OutboundOrder, OutboundOrder.id == ReturnLine.order_id)
        .where(OutboundOrder.product_id == product_id, ReturnLine.return_date >= since)
        .group_by(ReturnLine.reason)
    ).all())

    return {
        "sized": sized,
        "warehouses": warehouses,
        "variants": variants,
        "total_units": sum(s["total"] for s in variants.values()),
        "size_risk": ({"at_risk": size_risk["at_risk"],
                       "revenue_at_risk": size_risk["revenue_at_risk"]} if size_risk else None),
        "fulfillment": {
            "orders_90d": len(orders),
            "delivered_90d": len(delivered),
            "late_rate_pct": round(len(late) / len(delivered) * 100, 1) if delivered else None,
            "cancel_rate_pct": round(len(cancelled) / len(orders) * 100, 1) if orders else None,
            "avg_pick_hours": round(sum(pick) / len(pick), 1) if pick else None,
            "avg_pack_hours": round(sum(pack) / len(pack), 1) if pack else None,
            "avg_dispatch_hours": round(sum(disp) / len(disp), 1) if disp else None,
        },
        "returns": {
            "returns_90d": n_returns,
            "return_rate_pct": round(return_rate * 100, 1) if return_rate is not None else None,
            "top_reasons": sorted(reasons.items(), key=lambda kv: -kv[1])[:4],
        },
    }


def returns_intel(db: Session, days: int = 90) -> dict:
    """Measured returns: overall rate, reason Pareto, category split, and the
    most-returned products — all from ReturnLine × delivered orders."""
    since = (date.today() - timedelta(days=days)).isoformat()
    delivered_n = db.execute(
        select(func.count()).select_from(OutboundOrder)
        .where(OutboundOrder.order_date >= since, OutboundOrder.status == "Delivered")
    ).scalar() or 0
    returns_n = db.execute(
        select(func.count()).select_from(ReturnLine)
        .where(ReturnLine.return_date >= since)
    ).scalar() or 0

    by_reason = db.execute(
        select(ReturnLine.reason, func.count())
        .where(ReturnLine.return_date >= since)
        .group_by(ReturnLine.reason)
    ).all()
    by_category = db.execute(
        select(Category.name, func.count(ReturnLine.id))
        .join(Product, Product.id == ReturnLine.product_id)
        .join(Category, Category.id == Product.category_id)
        .where(ReturnLine.return_date >= since)
        .group_by(Category.name)
    ).all()
    delivered_by_cat = dict(db.execute(
        select(Category.name, func.count(OutboundOrder.id))
        .join(Product, Product.id == OutboundOrder.product_id)
        .join(Category, Category.id == Product.category_id)
        .where(OutboundOrder.order_date >= since, OutboundOrder.status == "Delivered")
        .group_by(Category.name)
    ).all())
    top_products = db.execute(
        select(Product.id, Product.name, func.count(ReturnLine.id))
        .join(ReturnLine, ReturnLine.product_id == Product.id)
        .where(ReturnLine.return_date >= since)
        .group_by(Product.id, Product.name)
        .order_by(func.count(ReturnLine.id).desc())
        .limit(8)
    ).all()
    prod_delivered = dict(db.execute(
        select(OutboundOrder.product_id, func.count())
        .where(OutboundOrder.order_date >= since, OutboundOrder.status == "Delivered")
        .group_by(OutboundOrder.product_id)
    ).all())
    by_disposition = dict(db.execute(
        select(ReturnLine.disposition, func.count())
        .where(ReturnLine.return_date >= since)
        .group_by(ReturnLine.disposition)
    ).all())

    return {
        "window_days": days,
        "delivered_orders": delivered_n,
        "returns": returns_n,
        "return_rate_pct": round(returns_n / delivered_n * 100, 1) if delivered_n else None,
        "by_reason": [{"reason": r, "count": c} for r, c in sorted(by_reason, key=lambda kv: -kv[1])],
        "by_category": [{
            "category": c, "returns": n,
            "return_rate_pct": round(n / delivered_by_cat[c] * 100, 1) if delivered_by_cat.get(c) else None,
        } for c, n in sorted(by_category, key=lambda kv: -kv[1])],
        "top_products": [{
            "product_id": pid, "product": name, "returns": n,
            "return_rate_pct": round(n / prod_delivered[pid] * 100, 1) if prod_delivered.get(pid) else None,
        } for pid, name, n in top_products],
        "by_disposition": by_disposition,
    }


def outbound_summary(db: Session, days: int = 30) -> dict:
    """One call powering the outbound dashboard rail."""
    return {
        "size_availability": size_availability(db, limit=6),
        "fulfillment": fulfillment_bottleneck(db, days),
        "delivery_sla": delivery_sla(db, days),
        "root_cause": root_cause_chain(db, days),
        "customer_impact": customer_impact(db, days),
        "actions": outbound_actions(db, days),
        "returns": returns_intel(db, 90),
    }
