"""Inbound Intelligence: procurement risk linkage, catalog quality, pricing,
and promotions.

One module, four lenses on the inbound side of a fashion e-commerce business.
House rules apply throughout: every number is computed from the tables, causal
language is avoided unless both sides of a comparison are actually measured,
and forward-looking figures are labelled as estimates.
"""
from __future__ import annotations

from collections import defaultdict
from datetime import date, timedelta

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.models import (Category, OutboundOrder, Product, Promotion,
                        PurchaseOrder, ReturnLine, Sale, Supplier)

SIZED_CATEGORIES = {"Fashion", "Footwear", "Sportswear"}


# ---------------------------------------------------------------------------
# 1 · PROCUREMENT — which supplier decisions create downstream inventory risk?
# ---------------------------------------------------------------------------

def procurement_linkage(db: Session, days: int = 120) -> dict:
    """Connect inbound reliability (lead time, on-time, defects, cost) to
    downstream inventory consequences (stock-outs, overstock) per supplier."""
    since = (date.today() - timedelta(days=days)).isoformat()

    # Actual inbound performance from POs (not the supplier's self-reported rate).
    pos = db.execute(
        select(PurchaseOrder.supplier_id, PurchaseOrder.expected_date, PurchaseOrder.actual_date,
               PurchaseOrder.status, PurchaseOrder.quantity)
        .where(PurchaseOrder.order_date >= since)
    ).all()
    agg: dict[int, dict] = defaultdict(lambda: {"pos": 0, "late": 0, "late_days": 0.0,
                                                "cancelled": 0, "qty": 0})
    for sid, expected, actual, status, qty in pos:
        a = agg[sid]
        a["pos"] += 1
        a["qty"] += int(qty or 0)
        if status == "Cancelled":
            a["cancelled"] += 1
        elif actual and expected and actual > expected:
            a["late"] += 1
            a["late_days"] += (date.fromisoformat(actual) - date.fromisoformat(expected)).days

    sups = {s.id: s for s in db.execute(select(Supplier)).scalars()}
    prods = db.execute(select(Product.id, Product.supplier_id, Product.name)).all()

    # Downstream consequence 1: stock-out exposure — at-risk products sourced
    # from each supplier (reads the recommendation engine's risk projection).
    from app.services.recommendation_service import build_recommendations
    recs = build_recommendations(db)
    risk_items = [r for r in recs.get("items", []) if r.get("severity") in ("critical", "warning")]

    # Downstream consequence 2: overstock (capital parked) per supplier —
    # same classify_status source the dashboard uses (status == "Overstock").
    overstock_ids = {r["product_id"] for r in recs.get("items", []) if r.get("status") == "Overstock"}

    suppliers_out = []
    for sid, s in sups.items():
        a = agg.get(sid, {"pos": 0, "late": 0, "late_days": 0.0, "cancelled": 0, "qty": 0})
        on_time = (1 - a["late"] / a["pos"]) if a["pos"] else None
        avg_late = (a["late_days"] / a["late"]) if a["late"] else 0.0
        # PO-weighted lead time: expected lead minus how much it actually slipped.
        sp_products = [p for p in prods if p[1] == sid]
        sp_ids = {p[0] for p in sp_products}
        suppliers_out.append({
            "supplier_id": sid,
            "supplier": s.name,
            "lead_time_days": s.lead_time_days,
            "po_on_time_rate": round(on_time, 3) if on_time is not None else None,
            "avg_days_late": round(avg_late, 1),
            "pos_window": a["pos"],
            "cancelled_share": round(a["cancelled"] / a["pos"], 3) if a["pos"] else None,
            "defect_rate": s.defect_rate,
            "cost_index": s.unit_cost,
            "stockout_products": sum(1 for r in risk_items if r.get("product_id") in sp_ids),
            "overstock_products": sum(1 for pid in overstock_ids if pid in sp_ids),
        })

    # Risk linkage: rank suppliers whose inbound slippage coincides with
    # downstream stock-out exposure on the products they feed.
    def risk_score(r: dict) -> float:
        late_pen = (1 - r["po_on_time_rate"]) if r["po_on_time_rate"] is not None else 0.5
        return late_pen * 2 + r["stockout_products"] + r["overstock_products"] * 0.2

    suppliers_out.sort(key=risk_score, reverse=True)
    flagged = [r for r in suppliers_out if risk_score(r) >= 1.0]

    # Concentration: share of active SKUs and spend by supplier.
    spend_rows = db.execute(
        select(Supplier.name, func.coalesce(func.sum(PurchaseOrder.quantity * PurchaseOrder.unit_cost), 0.0))
        .join(PurchaseOrder, PurchaseOrder.supplier_id == Supplier.id)
        .where(PurchaseOrder.order_date >= since)
        .group_by(Supplier.name)
    ).all()
    spend_total = sum(v for _, v in spend_rows) or 1.0
    concentration = sorted(
        [{"supplier": n, "spend": round(v, 0), "spend_share": round(v / spend_total, 3)}
         for n, v in spend_rows],
        key=lambda x: -x["spend_share"],
    )
    hhi = round(sum(s["spend_share"] ** 2 for s in concentration), 3)

    return {
        "window_days": days,
        "suppliers": suppliers_out,
        "flagged": [r["supplier"] for r in flagged[:6]],
        "concentration": {"top": concentration[:6], "hhi": hhi,
                          "top3_share": round(sum(s["spend_share"] for s in concentration[:3]), 3)},
        "stockout_by_supplier": {
            r["supplier"]: r["stockout_products"] for r in suppliers_out if r["stockout_products"] > 0
        },
    }


# ---------------------------------------------------------------------------
# 2 · CATALOG QUALITY — missing attributes and their business implication
# ---------------------------------------------------------------------------

def catalog_quality(db: Session) -> dict:
    """Attribute completeness by category with the customer-facing implication.

    A size chart on a sized product is not cosmetic: without it, size-guessing
    shows up later as "Size issue" returns (the measured #1 reason in this
    dataset) — the linkage below is stated with measured return rates on both
    sides, never as a causal guarantee.
    """
    products = db.execute(select(Product)).scalars().all()
    cat_names = {c.id: c.name for c in db.execute(select(Category)).scalars()}

    # Measured 90d return rate per product (delivered-order basis), so the
    # size-chart linkage can cite real numbers instead of benchmarks.
    since = (date.today() - timedelta(days=90)).isoformat()
    delivered_by_pid = dict(db.execute(
        select(OutboundOrder.product_id, func.count())
        .where(OutboundOrder.order_date >= since, OutboundOrder.status == "Delivered")
        .group_by(OutboundOrder.product_id)).all())
    returned_by_pid = dict(db.execute(
        select(OutboundOrder.product_id, func.count())
        .select_from(ReturnLine)
        .join(OutboundOrder, OutboundOrder.id == ReturnLine.order_id)
        .where(OutboundOrder.order_date >= since)
        .group_by(OutboundOrder.product_id)).all())

    by_cat: dict[str, dict] = defaultdict(lambda: {
        "products": 0, "color": 0, "material": 0, "description": 0,
        "image": 0, "size_chart_missing": 0, "size_chart_expected": 0,
    })
    for p in products:
        c = by_cat[cat_names.get(p.category_id, "?")]
        c["products"] += 1
        c["color"] += p.color is None or p.color == ""
        c["material"] += p.material is None or p.material == ""
        c["description"] += p.description is None or p.description == ""
        c["image"] += p.images_json is None or p.images_json == ""
        if cat_names.get(p.category_id, "") in SIZED_CATEGORIES:
            c["size_chart_expected"] += 1
            c["size_chart_missing"] += p.size_chart_json is None or p.size_chart_json == ""

    def ret_rate(pids: list[int]) -> float | None:
        n_del = sum(delivered_by_pid.get(pid, 0) for pid in pids)
        n_ret = sum(returned_by_pid.get(pid, 0) for pid in pids)
        return round(n_ret / n_del, 4) if n_del else None

    sized_products = [p.id for p in products
                      if cat_names.get(p.category_id, "") in SIZED_CATEGORIES
                      and (p.size_chart_json is None or p.size_chart_json == "")]
    sized_complete = [p.id for p in products
                      if cat_names.get(p.category_id, "") in SIZED_CATEGORIES
                      and p.size_chart_json]

    cats = []
    for name, c in by_cat.items():
        n = c["products"]
        gaps = c["color"] + c["material"] + c["description"] + c["image"]
        cats.append({
            "category": name,
            "products": n,
            "complete_pct": round((1 - gaps / (4 * n)) * 100, 1) if n else 100.0,
            "missing": {k: c[k] for k in ("color", "material", "description", "image")},
            "size_chart_missing": c["size_chart_missing"],
            "size_chart_missing_pct": round(c["size_chart_missing"] / c["size_chart_expected"] * 100, 1)
            if c["size_chart_expected"] else None,
        })
    cats.sort(key=lambda x: x["complete_pct"])

    no_chart_rate = ret_rate(sized_products)
    chart_rate = ret_rate(sized_complete)
    linkage = None
    if no_chart_rate is not None and chart_rate is not None and no_chart_rate > chart_rate:
        linkage = (f"Products without a size chart returned at {no_chart_rate * 100:.1f}% vs "
                   f"{chart_rate * 100:.1f}% for products with one (measured, last 90 days). "
                   "Correlation, not proof — but it matches 'Size issue' being the top return reason.")

    total = len(products)
    gaps_total = sum(c["color"] + c["material"] + c["description"] + c["image"] for c in by_cat.values())
    worst = next((c for c in cats if c["size_chart_missing_pct"]), None)

    return {
        "total_products": total,
        "complete_pct": round((1 - gaps_total / (4 * total)) * 100, 1) if total else 100.0,
        "by_category": cats,
        "size_chart_linkage": linkage,
        "headline": (f"{worst['size_chart_missing_pct']}% of products in {worst['category']} have "
                     f"incomplete size attributes" if worst else "Catalog is fully attributed"),
        "affected_products": sorted(
            ({"sku": p.sku, "name": p.name, "category": cat_names.get(p.category_id, "?"),
              "gaps": [g for g, has in (("color", p.color), ("material", p.material),
                                        ("description", p.description), ("images", p.images_json),
                                        ("size chart", p.size_chart_json)) if not has]}
             for p in products
             if (not p.color or not p.material or not p.description
                 or not p.images_json
                 or (cat_names.get(p.category_id, "") in SIZED_CATEGORIES and not p.size_chart_json))),
            key=lambda r: -len(r["gaps"]),
        )[:12],
    }


# ---------------------------------------------------------------------------
# 3 · PRICING — margin, discounting, and what price moves did to sales
# ---------------------------------------------------------------------------

def pricing_intel(db: Session, days: int = 90) -> dict:
    since = (date.today() - timedelta(days=days)).isoformat()
    prev_since = (date.today() - timedelta(days=2 * days)).isoformat()

    # Revenue basis: sales ledger (365-day product economics use it too).
    rows = db.execute(
        select(Sale.product_id, func.sum(Sale.quantity), func.sum(Sale.revenue))
        .where(Sale.sale_date >= since)
        .group_by(Sale.product_id)
    ).all()
    prev_rows = dict((pid, (q, r)) for pid, q, r in db.execute(
        select(Sale.product_id, func.sum(Sale.quantity), func.sum(Sale.revenue))
        .where(Sale.sale_date >= prev_since, Sale.sale_date < since)
        .group_by(Sale.product_id)).all())
    prods = {p.id: p for p in db.execute(select(Product)).scalars()}

    # Approximate realized revenue in the window after MRP discounting.
    disc_rows = db.execute(
        select(OutboundOrder.product_id, func.coalesce(func.sum(OutboundOrder.paid_price * OutboundOrder.quantity), 0.0))
        .where(OutboundOrder.order_date >= since, OutboundOrder.campaign_id.is_not(None))
        .group_by(OutboundOrder.product_id)).all()
    realized_discount = {pid: v for pid, v in disc_rows}

    items = []
    for pid, qty, rev in rows:
        p = prods.get(pid)
        if p is None or not qty:
            continue
        mrp = p.mrp or p.selling_price
        discount_pct = round(max(0.0, 1 - p.selling_price / mrp), 3)
        margin_pct = round(max(0.0, (p.selling_price - p.unit_cost) / p.selling_price), 3)
        pq, prev = prev_rows.get(pid, (0, 0.0))
        q_change = (qty - pq) / pq if pq else None
        # Discounted revenue actually realized via attributed campaign orders.
        realized = realized_discount.get(pid, 0.0)
        est_rev = (rev - realized) if realized and realized < rev else rev
        est_margin_pct = round(max(0.0, (est_rev - qty * p.unit_cost) / est_rev), 3) if est_rev else margin_pct
        items.append({
            "product_id": pid, "sku": p.sku, "product": p.name,
            "category": p.category.name if p.category else "?",
            "cost": p.unit_cost, "price": p.selling_price, "mrp": mrp,
            "discount_pct": discount_pct, "margin_pct": margin_pct, "est_margin_pct": est_margin_pct,
            "units": int(qty), "revenue": round(rev, 0),
            "units_change": round(q_change, 3) if q_change is not None else None,
        })

    high_disc_low_margin = [i for i in items if i["discount_pct"] >= 0.20 and i["margin_pct"] <= 0.35]
    high_disc_low_margin.sort(key=lambda i: -(i["discount_pct"] - i["margin_pct"]))
    low_margin = sorted(items, key=lambda i: i["margin_pct"])[:8]

    # Price changes: unit economics moved (price_prev != price). Sales reaction
    # is measured as the units change between the current and prior window —
    # reported as observed movement, never as proven causation.
    price_moves = []
    for p in prods.values():
        if p.price_prev is None or p.price_prev == p.selling_price:
            continue
        up = p.selling_price > p.price_prev
        cur = next((i for i in items if i["product_id"] == p.id), None)
        pq = prev_rows.get(p.id, (0, 0.0))[0]
        move = {
            "product_id": p.id, "sku": p.sku, "product": p.name,
            "category": p.category.name if p.category else "?",
            "prev_price": p.price_prev, "new_price": p.selling_price,
            "change_pct": round((p.selling_price - p.price_prev) / p.price_prev, 3),
            "direction": "up" if up else "down",
            "units_current": cur["units"] if cur else 0,
            "units_prior": int(pq or 0),
            "units_change_pct": (round((cur["units"] - pq) / pq, 3) if cur and pq else None),
        }
        price_moves.append(move)
    decliners = [m for m in price_moves
                 if m["direction"] == "up" and m["units_change_pct"] is not None and m["units_change_pct"] < -0.10]
    decliners.sort(key=lambda m: m["units_change_pct"])
    improvers = [m for m in price_moves
                 if m["units_change_pct"] is not None and m["units_change_pct"] > 0.05]
    improvers.sort(key=lambda m: -m["units_change_pct"])

    note = ("Units moved between windows is an observed change, not proof the "
            "price change caused it — seasonality and campaigns overlap.")

    return {
        "window_days": days,
        "avg_margin_pct": round(sum(i["margin_pct"] for i in items) / len(items), 3) if items else None,
        "products": items[:60],
        "high_discount_low_margin": high_disc_low_margin[:8],
        "lowest_margin": low_margin,
        "price_moves": sorted(price_moves, key=lambda m: -abs(m["change_pct"]))[:12],
        "declining_after_increase": decliners[:6],
        "improving_after_change": improvers[:6],
        "interpretation_note": note,
    }


# ---------------------------------------------------------------------------
# 4 · PROMOTIONS — campaign → traffic → orders → revenue → margin
# ---------------------------------------------------------------------------

def promotions_intel(db: Session, days: int = 90) -> dict:
    """Trade-off view: campaigns lift orders and revenue, but the discount is
    paid out of margin. The comparison baseline is organic revenue rate on the
    same campaign products, so the impact line is an estimate, not a promise."""
    since = (date.today() - timedelta(days=days)).isoformat()
    campaigns = db.execute(select(Promotion)).scalars().all()
    order_rows = db.execute(
        select(OutboundOrder)
        .where(OutboundOrder.order_date >= since)
    ).scalars().all()
    prods = {p.id: p for p in db.execute(select(Product)).scalars()}

    window_periods = {(c.start_date, c.end_date) for c in campaigns}
    campaign_ids = {c.id for c in campaigns}

    def _unit_revenue(o: OutboundOrder, prods: dict[int, Product]) -> float:
        base = prods[o.product_id].selling_price if o.product_id in prods else 0.0
        return (o.paid_price if o.paid_price is not None else base)

    def order_stats(orders: list[OutboundOrder]) -> dict:
        n = len(orders)
        units = sum(o.quantity for o in orders)
        rev = sum(_unit_revenue(o, prods) * o.quantity for o in orders)
        cost = sum(prods[o.product_id].unit_cost * o.quantity for o in orders if o.product_id in prods)
        delivered = sum(1 for o in orders if o.status == "Delivered")
        delivered_rev = sum(_unit_revenue(o, prods) * o.quantity for o in orders if o.status == "Delivered")
        delivered_cost = sum(prods[o.product_id].unit_cost * o.quantity
                             for o in orders if o.status == "Delivered" and o.product_id in prods)
        return {
            "orders": n, "units": units,
            "revenue": round(rev, 0),
            "delivered": delivered,
            "delivered_revenue": round(delivered_rev, 0),
            "margin": round(delivered_rev - delivered_cost, 0),
            "cancel_rate": round(1 - delivered / n, 3) if n else None,
        }

    out = []
    for c in campaigns:
        tagged = [o for o in order_rows if o.campaign_id == c.id]
        if not tagged:
            out.append({"id": c.id, "name": c.name, "kind": c.kind, "discount_pct": c.discount_pct,
                        "start": c.start_date, "end": c.end_date, "orders": 0})
            continue
        s = order_stats(tagged)
        # Organic baseline: same products, outside any campaign window.
        c_pids = {o.product_id for o in tagged}
        organic_orders = [o for o in order_rows
                          if o.product_id in c_pids and o.campaign_id not in campaign_ids
                          and not any(ws <= o.order_date <= we for ws, we in window_periods)]
        organic = order_stats(organic_orders) if organic_orders else None
        margin_rate = (s["margin"] / s["delivered_revenue"]) if s["delivered_revenue"] else None
        out.append({
            "id": c.id, "name": c.name, "kind": c.kind, "discount_pct": c.discount_pct,
            "start": c.start_date, "end": c.end_date, **s,
            "avg_order_value": round(s["revenue"] / s["orders"], 0) if s["orders"] else None,
            "organic": organic,
            "organic_aov": (round(organic["revenue"] / organic["orders"], 0)
                            if organic and organic["orders"] else None),
            "aov_delta_pct": (round((s["revenue"] / s["orders"]) / (organic["revenue"] / organic["orders"]) - 1, 3)
                              if organic and organic["orders"] else None),
            "margin_rate": round(margin_rate, 3) if margin_rate is not None else None,
            "organic_margin_rate": (round(organic["margin"] / organic["delivered_revenue"], 3)
                                    if organic and organic["delivered_revenue"] else None),
            "discount_cost": round(sum(
                ((prods[o.product_id].selling_price if o.product_id in prods else 0) - (o.paid_price or 0)) * o.quantity
                for o in tagged if o.paid_price is not None and o.product_id in prods), 0),
        })

    out.sort(key=lambda c: -c.get("revenue", 0))
    total_rev = sum(c.get("revenue", 0) for c in out)
    total_disc = sum(c.get("discount_cost", 0) for c in out)
    total_margin = sum(c.get("margin", 0) for c in out)
    return {
        "window_days": days,
        "campaigns": out,
        "totals": {"revenue": round(total_rev, 0), "discount_cost": round(total_disc, 0),
                   "margin": round(total_margin, 0),
                   "orders": sum(c.get("orders", 0) for c in out)},
        "tradeoff_note": ("Revenue is gross of discount; margin already pays for it. The organic "
                          "baseline is the same products outside campaign windows — differences are "
                          "estimates, not causal guarantees (seasonality overlaps campaigns)."),
    }


def _days_between(a: str, b: str) -> int:
    return (date.fromisoformat(b) - date.fromisoformat(a)).days + 1


def inbound_summary(db: Session, days: int = 90) -> dict:
    """One call powering the Inbound Intelligence page's headline strip."""
    proc = procurement_linkage(db)
    cat = catalog_quality(db)
    pricing = pricing_intel(db, days)
    promos = promotions_intel(db, days)
    return {
        "procurement": {"flagged": proc["flagged"], "hhi": proc["concentration"]["hhi"],
                        "top3_share": proc["concentration"]["top3_share"]},
        "catalog": {"complete_pct": cat["complete_pct"], "headline": cat["headline"]},
        "pricing": {"avg_margin_pct": pricing["avg_margin_pct"],
                    "high_discount_count": len(pricing["high_discount_low_margin"])},
        "promotions": promos["totals"],
    }
