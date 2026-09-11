"""Supplier service: scored listing, detail pack with monthly trends and narrative."""
from __future__ import annotations

from datetime import date, timedelta

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.analytics.supplier_score import supplier_risk_level, score_suppliers
from app.models import Category, Product, PurchaseOrder, Supplier


def _observed_stats(db: Session, days: int | None = None) -> dict[int, dict]:
    q = db.query(PurchaseOrder)
    if days:
        cutoff = (date.today() - timedelta(days=days)).isoformat()
        q = q.filter(PurchaseOrder.order_date >= cutoff)
    out: dict[int, dict] = {}
    for po in q.all():
        st = out.setdefault(po.supplier_id, {"orders": 0, "ontime": 0, "delayed": 0,
                                             "spend": 0.0, "qty": 0})
        st["orders"] += 1
        st["qty"] += po.quantity
        st["spend"] += po.quantity * po.unit_cost
        if po.actual_date:
            if po.actual_date <= po.expected_date:
                st["ontime"] += 1
            else:
                st["delayed"] += 1
    return out


def list_suppliers(db: Session, search: str | None = None, risk: str | None = None,
                   sort: str = "score") -> dict:
    sups = db.query(Supplier).all()
    stats = _observed_stats(db)
    rows = []
    for s in sups:
        st = stats.get(s.id, {"orders": 0, "ontime": 0, "delayed": 0, "spend": 0.0, "qty": 0})
        rows.append({
            "id": s.id, "name": s.name, "contact_email": s.contact_email,
            "lead_time_days": s.lead_time_days, "unit_cost": s.unit_cost,
            "on_time_rate": s.on_time_rate, "defect_rate": s.defect_rate,
            "reliability_score": s.reliability_score,
            "orders": st["orders"], "total_spend": round(st["spend"], 2),
            "ontime_observed": (round(st["ontime"] / st["orders"], 3) if st["orders"] else None),
            "product_count": db.scalar(select(func.count()).select_from(Product)
                                       .where(Product.supplier_id == s.id)) or 0,
        })
    scored = score_suppliers(rows)
    items = []
    for r in scored:
        d = dict(r.__dict__)
        base = next(x for x in rows if x["id"] == r.supplier_id)
        d["id"] = r.supplier_id
        d.update({"ontime_observed": base["ontime_observed"], "total_spend": base["total_spend"],
                  "product_count": base["product_count"], "contact_email": base["contact_email"]})
        d["risk_level"] = supplier_risk_level(r)
        items.append(d)
    if search:
        like = search.lower()
        items = [i for i in items if like in i["name"].lower()]
    if risk and risk != "All":
        items = [i for i in items if i["risk_level"] == risk]
    keymap = {"score": lambda x: x["total"], "name": lambda x: x["name"].lower(),
              "ontime": lambda x: x["on_time_rate"], "lead": lambda x: x["lead_time_days"],
              "cost": lambda x: x["unit_cost"], "orders": lambda x: x["orders"]}
    items.sort(key=keymap.get(sort, keymap["score"]), reverse=(sort != "name"))
    return {"items": items, "weights": {"delivery": 30, "quality": 25, "cost": 25, "reliability": 20}}


def supplier_detail(db: Session, supplier_id: int) -> dict:
    s = db.get(Supplier, supplier_id)
    if s is None:
        raise LookupError(f"Supplier {supplier_id} not found")

    stats = _observed_stats(db)
    st = stats.get(s.id, {"orders": 0, "ontime": 0, "delayed": 0, "spend": 0.0, "qty": 0})
    # Score against the FULL supplier set so min-max normalization is meaningful.
    all_sups = db.query(Supplier).all()
    scored_all = score_suppliers([{
        "id": x.id, "name": x.name, "on_time_rate": x.on_time_rate, "defect_rate": x.defect_rate,
        "unit_cost": x.unit_cost, "reliability_score": x.reliability_score,
        "orders": stats.get(x.id, {"orders": 0})["orders"]} for x in all_sups])
    row = next(r for r in scored_all if r.supplier_id == s.id)

    products = db.query(Product).filter(Product.supplier_id == s.id).all()
    cats = dict(db.execute(select(Category.id, Category.name)).all())
    cat_counts: dict[str, int] = {}
    for p in products:
        cname = cats.get(p.category_id, "?")
        cat_counts[cname] = cat_counts.get(cname, 0) + 1

    # Monthly trends (12 months): on-time %, defect proxy via delayed, cost index, volume
    cutoff = (date.today() - timedelta(days=365)).isoformat()
    pos = db.query(PurchaseOrder).filter(PurchaseOrder.supplier_id == s.id,
                                         PurchaseOrder.order_date >= cutoff).all()
    monthly: dict[str, dict] = {}
    for po in pos:
        m = po.order_date[:7]
        b = monthly.setdefault(m, {"orders": 0, "ontime": 0, "delayed": 0, "qty": 0, "spend": 0.0, "cost_sum": 0.0})
        b["orders"] += 1
        b["qty"] += po.quantity
        b["spend"] += po.quantity * po.unit_cost
        b["cost_sum"] += po.unit_cost
        if po.actual_date:
            if po.actual_date <= po.expected_date:
                b["ontime"] += 1
            else:
                b["delayed"] += 1
    delivery_trend, cost_trend, volume_trend = [], [], []
    for m in sorted(monthly):
        b = monthly[m]
        delivered = b["ontime"] + b["delayed"]
        rate = round(b["ontime"] / delivered * 100, 1) if delivered else None
        delivery_trend.append({"month": m, "on_time_pct": rate, "delayed": b["delayed"]})
        cost_trend.append({"month": m, "avg_unit_cost": round(b["cost_sum"] / b["orders"], 3)})
        volume_trend.append({"month": m, "orders": b["orders"], "quantity": b["qty"]})

    # Narrative summary (dynamic, explainable)
    best_aspect, worst_aspect = None, None
    comp = {"delivery": row.delivery_pts, "quality": row.quality_pts,
            "cost": row.cost_pts, "reliability": row.reliability_pts}
    best_aspect = max(comp, key=comp.get)
    worst_aspect = min(comp, key=comp.get)
    aspect_text = {"delivery": "on-time delivery", "quality": "low defect rates",
                   "cost": "competitive unit cost", "reliability": "reliable operations"}
    ontime_obs = (round(st["ontime"] / st["orders"] * 100, 1) if st["orders"] else None)
    summary = (
        f"{s.name} scores {row.total}/100 overall, with its strongest area being "
        f"{aspect_text[best_aspect]} ({comp[best_aspect]:.0f}/100) and its weakest {aspect_text[worst_aspect]} "
        f"({comp[worst_aspect]:.0f}/100). "
        + (f"Across {st['orders']} recent purchase orders its observed on-time rate is {ontime_obs}% "
           f"versus a {s.on_time_rate * 100:.0f}% baseline; "
           if st["orders"] and ontime_obs is not None else
           f"No recent purchase orders on record; ")
        + f"average lead time is {s.lead_time_days} days at a cost index of {s.unit_cost:.2f} "
        f"(1.00 = market). It currently supplies {len(products)} products."
    )

    return {
        "id": s.id, "name": s.name, "contact_email": s.contact_email,
        "lead_time_days": s.lead_time_days, "unit_cost": s.unit_cost,
        "on_time_rate": s.on_time_rate, "defect_rate": s.defect_rate,
        "reliability_score": s.reliability_score,
        "score": {"total": row.total, "delivery": row.delivery_pts, "quality": row.quality_pts,
                  "cost": row.cost_pts, "reliability": row.reliability_pts,
                  "weights": {"delivery": 30, "quality": 25, "cost": 25, "reliability": 20}},
        "risk_level": supplier_risk_level(row),
        "kpis": {"orders": st["orders"], "total_spend": round(st["spend"], 2),
                 "total_units": st["qty"],
                 "ontime_observed_pct": ontime_obs,
                 "delayed": st["delayed"]},
        "products": [{"id": p.id, "sku": p.sku, "name": p.name,
                      "category": cats.get(p.category_id, "?")} for p in products[:50]],
        "category_mix": cat_counts,
        "delivery_trend": delivery_trend,
        "cost_trend": cost_trend,
        "volume_trend": volume_trend,
        "summary": summary,
    }
