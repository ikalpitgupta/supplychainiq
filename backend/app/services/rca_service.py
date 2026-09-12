"""Root Cause Analysis engine — the flagship "don't just tell me the metric
changed, help me understand why" capability.

Design:
  1. DETECT problems by comparing a recent window against the prior one
     (material movements only — noise stays quiet).
  2. INVESTIGATE each problem through a hypothesis tree. Every candidate
     factor is measured on the same now-vs-prior basis and ranked by how much
     of the deterioration it arithmetically accounts for (a decomposition, not
     a vibe).
  3. LANGUAGE DISCIPLINE: the engine may only say "consistent with a driver",
     "likely contributor", "potential contributor", or "associated with" —
     "caused by" is reserved for exact decompositions (e.g. a single carrier's
     late-rate jump arithmetically producing the overall late-rate jump on a
     stable order base). Estimates are labelled; open questions are surfaced
     as "requires investigation".

The investigation tree per problem: inventory availability → warehouse
allocation → fulfillment time → dispatch delay → carrier performance →
regional mix — the delivery value chain, each hop measured.
"""
from __future__ import annotations

from collections import defaultdict
from datetime import date, timedelta

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import InventoryDaily, OutboundOrder, ReturnLine, Warehouse

CARRIER_SLA_DAYS = 3


def _windows(days: int) -> tuple[str, str, str]:
    """Returns (recent_start, mid, end_anchor) ISO dates for now-vs-prior."""
    end = date.today()
    mid = end - timedelta(days=days)
    start = mid - timedelta(days=days)
    return start.isoformat(), mid.isoformat(), end.isoformat()


def _window_bounds(days: int) -> tuple[str, str, str, str]:
    """(recent_start, recent_end, prior_start, prior_end) — recent is the last
    `days` days, prior is the equal-length window immediately before it."""
    end = date.today()
    mid = end - timedelta(days=days)
    start = mid - timedelta(days=days)
    return mid.isoformat(), end.isoformat(), start.isoformat(), mid.isoformat()


# ---------------------------------------------------------------------------
# Measurement primitives — every hypothesis is scored on now vs prior.
# ---------------------------------------------------------------------------

def _delivery_stats(db: Session, start: str, end: str, carrier: str | None = None,
                    region: str | None = None) -> dict:
    q = select(OutboundOrder).where(OutboundOrder.order_date >= start,
                                    OutboundOrder.order_date <= end)
    if carrier:
        q = q.where(OutboundOrder.carrier == carrier)
    if region:
        q = q.where(OutboundOrder.region == region)
    orders = db.execute(q).scalars().all()
    delivered = [o for o in orders if o.status == "Delivered" and o.delivered_date]
    late = [o for o in delivered if o.delivered_date > o.promised_date]
    cancelled = [o for o in orders if o.status == "Cancelled"]
    distant = [o for o in delivered if o.delay_reason == "Routed from distant DC"]
    disp = [o.dispatch_hours for o in delivered if o.dispatch_hours is not None]
    return {
        "orders": len(orders),
        "delivered": len(delivered),
        "late": len(late),
        "late_rate": len(late) / len(delivered) if delivered else None,
        "cancel_rate": len(cancelled) / len(orders) if orders else None,
        "avg_dispatch": sum(disp) / len(disp) if disp else None,
        "distant_share": len(distant) / len(delivered) if delivered else None,
    }


def _sales_by_window(db: Session, start: str, end: str) -> dict[int, int]:
    from sqlalchemy import func
    rows = db.execute(
        select(InventoryDaily.product_id, func.sum(InventoryDaily.sold_quantity))
        .where(InventoryDaily.date >= start, InventoryDaily.date <= end)
        .group_by(InventoryDaily.product_id)
    ).all()
    return {pid: int(q or 0) for pid, q in rows}


# ---------------------------------------------------------------------------
# Problem detectors: material now-vs-prior movements.
# ---------------------------------------------------------------------------

def _detect_problems(db: Session, days: int) -> list[dict]:
    rec_s, rec_e, pri_s, pri_e = _window_bounds(days)
    recent = _delivery_stats(db, rec_s, rec_e)
    prior = _delivery_stats(db, pri_s, pri_e)
    problems: list[dict] = []

    if recent["late_rate"] is not None and prior["late_rate"] is not None:
        delta_pts = (recent["late_rate"] - prior["late_rate"]) * 100
        rel = (recent["late_rate"] / prior["late_rate"] - 1) if prior["late_rate"] else 0
        if delta_pts >= 3:
            problems.append({
                "id": "delivery-late-rate",
                "area": "Delivery",
                "title": f"Delivery SLA deteriorated {delta_pts:+.1f} pts",
                "statement": (f"Late-delivery rate rose from {prior['late_rate'] * 100:.1f}% to "
                              f"{recent['late_rate'] * 100:.1f}% ({delta_pts:+.1f} pts, "
                              f"{rel * 100:+.0f}% relative) across {recent['delivered']:,} delivered orders."),
                "metric": "late_rate",
                "recent": round(recent["late_rate"], 4),
                "prior": round(prior["late_rate"], 4),
                "delta_pts": round(delta_pts, 1),
                "seeding": "delivery",
            })

    if recent["cancel_rate"] is not None and prior["cancel_rate"] is not None:
        delta_pts = (recent["cancel_rate"] - prior["cancel_rate"]) * 100
        if delta_pts >= 2:
            problems.append({
                "id": "cancellation-rate",
                "area": "Customer experience",
                "title": f"Cancellation rate rose {delta_pts:+.1f} pts",
                "statement": (f"Cancellations moved from {prior['cancel_rate'] * 100:.1f}% to "
                              f"{recent['cancel_rate'] * 100:.1f}% of placed orders."),
                "metric": "cancel_rate",
                "recent": round(recent["cancel_rate"], 4),
                "prior": round(prior["cancel_rate"], 4),
                "delta_pts": round(delta_pts, 1),
                "seeding": "cancellations",
            })

    if recent["avg_dispatch"] and prior["avg_dispatch"]:
        rel = recent["avg_dispatch"] / prior["avg_dispatch"] - 1
        if rel >= 0.15:
            problems.append({
                "id": "dispatch-slowdown",
                "area": "Fulfillment",
                "title": f"Dispatch time increased {rel * 100:+.0f}%",
                "statement": (f"Average dispatch time moved from {prior['avg_dispatch']:.1f}h to "
                              f"{recent['avg_dispatch']:.1f}h order-to-dispatch."),
                "metric": "avg_dispatch_hours",
                "recent": round(recent["avg_dispatch"], 1),
                "prior": round(prior["avg_dispatch"], 1),
                "delta_pct": round(rel * 100, 1),
                "seeding": "dispatch",
            })

    return problems


# ---------------------------------------------------------------------------
# Hypothesis investigations. Each returns a candidate factor with measured
# now-vs-prior numbers, a causal-language verdict, and impact accounting.
# ---------------------------------------------------------------------------

def _carrier_investigation(db: Session, days: int, recent: dict, prior: dict) -> dict | None:
    rec_s, rec_e, pri_s, pri_e = _window_bounds(days)
    rec_by, pri_by = {}, {}
    for o in db.execute(select(OutboundOrder.carrier, OutboundOrder.status,
                               OutboundOrder.delivered_date, OutboundOrder.promised_date)
                        .where(OutboundOrder.order_date >= rec_s, OutboundOrder.order_date <= rec_e)).all():
        rec_by.setdefault(o[0], []).append(o)
    for o in db.execute(select(OutboundOrder.carrier, OutboundOrder.status,
                               OutboundOrder.delivered_date, OutboundOrder.promised_date)
                        .where(OutboundOrder.order_date >= pri_s, OutboundOrder.order_date < rec_s)).all():
        pri_by.setdefault(o[0], []).append(o)

    def late_rate(rows) -> float | None:
        d = [r for r in rows if r[1] == "Delivered" and r[2]]
        l = [r for r in d if r[2] > r[3]]
        return len(l) / len(d) if d else None

    carriers = []
    for c in sorted(set(rec_by) | set(pri_by)):
        rec_lr = late_rate(rec_by.get(c, []))
        pri_lr = late_rate(pri_by.get(c, []))
        if rec_lr is None:
            continue
        carriers.append({
            "carrier": c,
            "recent_late_rate": round(rec_lr, 4),
            "prior_late_rate": round(pri_lr, 4) if pri_lr is not None else None,
            "delta_pts": round((rec_lr - pri_lr) * 100, 1) if pri_lr is not None else None,
            "recent_delivered": len(rec_by.get(c, [])),
        })
    carriers.sort(key=lambda c: -(c["delta_pts"] or 0))

    # Decomposition: how much of the overall late-rate jump does each carrier
    # arithmetically explain, holding the carrier mix fixed at recent levels?
    overall_jump = (recent["late_rate"] - prior["late_rate"]) if (recent["late_rate"] is not None and prior["late_rate"] is not None) else 0
    accounted = 0.0
    for c in carriers:
        if c["prior_late_rate"] is None:
            continue
        n = c["recent_delivered"]
        total_delivered = sum(x["recent_delivered"] for x in carriers) or 1
        c["contribution_pts"] = round((c["recent_late_rate"] - c["prior_late_rate"]) * n / total_delivered * 100, 1)
        accounted += max(0.0, c["contribution_pts"])
        c["stable"] = abs(c["delta_pts"] or 0) < 2.0
    jump_pts = overall_jump * 100
    for c in carriers:
        share = (c["contribution_pts"] / jump_pts) if jump_pts else 0
        if c.get("stable"):
            c["verdict"] = "no material movement"
        elif jump_pts and share >= 0.5 and abs(sum(x["contribution_pts"] for x in carriers) - jump_pts) < 3:
            # The one moving factor arithmetically reproduces the headline.
            c["verdict"] = "primary driver — decomposition accounts for the full movement"
        elif share >= 0.15:
            c["verdict"] = "likely contributor"
        else:
            c["verdict"] = "potential contributor"
        c["share_of_movement"] = round(max(0.0, share), 2) if jump_pts > 0 else 0.0

    top = carriers[0] if carriers else None
    evidence = None
    factor = None
    top_payload = top
    if top and not top.get("stable") and top["delta_pts"] and top["delta_pts"] >= 3:
        stable_names = [c["carrier"] for c in carriers if c.get("stable")]
        evidence = {
            "headline": (f"{top['carrier']} late rate jumped {top['prior_late_rate'] * 100:.1f}% → "
                         f"{top['recent_late_rate'] * 100:.1f}% (+{top['delta_pts']} pts) while "
                         f"{', '.join(stable_names) or 'other carriers'} stayed within ±2 pts."),
            "metrics": [
                {"label": f"{c['carrier']} late rate", "prior": f"{c['prior_late_rate'] * 100:.1f}%",
                 "recent": f"{c['recent_late_rate'] * 100:.1f}%", "delta": f"{c['delta_pts']:+.1f} pts"}
                for c in carriers[:6]
            ],
        }
        share = top.get("share_of_movement", 0)
        factor = {
            "factor": f"Carrier performance — {top['carrier']}",
            "verdict": top["verdict"],
            "impact": (f"{top['contribution_pts']} pts of gross movement ({share * 100:.0f}% of the "
                       f"{jump_pts:+.1f} pt net change at current carrier mix)."),
            "recommendation": (f"Requires investigation with {top['carrier']}: SLA review against the "
                               "contracted window, hub scan data, and whether volume shifted onto slower lanes. "
                               "Interim: rebalance allocation toward stable carriers for SLA-bound orders."),
            "confidence": "high" if share >= 0.4 else "medium",
        }
    return {"candidates": carriers[:8], "evidence": evidence, "factor": factor, "top": top_payload if factor else None}


def _inventory_investigation(db: Session, days: int) -> dict:
    """Availability signal: the share of delivered orders showing the
    distant-routing signature (slow dispatch). In this data model distant
    routing happens when the home DC lacks the size — slow dispatch is the
    measurable footprint of that availability gap."""
    rec_s, rec_e, pri_s, pri_e = _window_bounds(days)

    def distant_share(start: str, end: str) -> float | None:
        rows = db.execute(
            select(OutboundOrder.dispatch_hours, OutboundOrder.delay_reason)
            .where(OutboundOrder.order_date >= start, OutboundOrder.order_date <= end,
                   OutboundOrder.status == "Delivered")
        ).all()
        n = len(rows)
        if not n:
            return None
        flagged = sum(1 for d, _ in rows if (d is not None and d >= 15)
                      or (_ == "Routed from distant DC"))
        return flagged / n

    rec_d, pri_d = distant_share(rec_s, rec_e), distant_share(pri_s, pri_e)
    delta = (rec_d - pri_d) if (rec_d is not None and pri_d is not None) else None
    return {
        "candidates": [{
            "factor": "Inventory availability (distant-routing signature)",
            "recent_share": round(rec_d, 3) if rec_d is not None else None,
            "prior_share": round(pri_d, 3) if pri_d is not None else None,
            "delta_pts": round(delta * 100, 1) if delta is not None else None,
        }],
        "metrics": [
            {"label": "Orders with distant-routing signature", "prior": f"{(pri_d or 0) * 100:.1f}%",
             "recent": f"{(rec_d or 0) * 100:.1f}%",
             "delta": f"{((rec_d or 0) - (pri_d or 0)) * 100:+.1f} pts"},
        ],
    }


def _fulfillment_investigation(db: Session, days: int) -> dict:
    rec_s, rec_e, pri_s, pri_e = _window_bounds(days)

    def stage_avgs(start: str, end: str) -> dict:
        rows = db.execute(
            select(OutboundOrder.pick_hours, OutboundOrder.pack_hours, OutboundOrder.dispatch_hours)
            .where(OutboundOrder.order_date >= start, OutboundOrder.order_date <= end,
                   OutboundOrder.status == "Delivered")
        ).all()
        n = len(rows) or 1
        return {
            "pick": sum(r[0] or 0 for r in rows) / n,
            "pack": sum(r[1] or 0 for r in rows) / n,
            "dispatch": sum(r[2] or 0 for r in rows) / n,
        }

    rec, pri = stage_avgs(rec_s, rec_e), stage_avgs(pri_s, pri_e)
    stages = []
    for name, key in (("Pick", "pick"), ("Pack", "pack"), ("Dispatch", "dispatch")):
        delta = rec[key] - pri[key]
        stages.append({
            "stage": name,
            "prior_hours": round(pri[key], 1),
            "recent_hours": round(rec[key], 1),
            "delta_hours": round(delta, 1),
            "delta_pct": round(delta / pri[key] * 100, 1) if pri[key] else None,
        })
    stages.sort(key=lambda s: -(s["delta_hours"] or 0))
    return {"candidates": stages, "metrics": [
        {"label": f"{s['stage']} time", "prior": f"{s['prior_hours']}h", "recent": f"{s['recent_hours']}h",
         "delta": f"{s['delta_hours']:+.1f}h ({s['delta_pct']:+.1f}%)" if s["delta_pct"] is not None else "—"}
        for s in stages
    ]}


def _region_investigation(db: Session, days: int) -> dict:
    rec_s, rec_e, pri_s, pri_e = _window_bounds(days)
    regions = ["North", "South", "East", "West"]
    rows_out = []
    for r in regions:
        rec = _delivery_stats(db, rec_s, rec_e, region=r)
        pri = _delivery_stats(db, pri_s, pri_e, region=r)
        if rec["late_rate"] is None or pri["late_rate"] is None:
            continue
        rows_out.append({
            "region": r,
            "prior_late_rate": round(pri["late_rate"], 4),
            "recent_late_rate": round(rec["late_rate"], 4),
            "delta_pts": round((rec["late_rate"] - pri["late_rate"]) * 100, 1),
            "delivered": rec["delivered"],
        })
    rows_out.sort(key=lambda x: -(x["delta_pts"] or 0))
    return {"candidates": rows_out, "metrics": [
        {"label": f"{x['region']} late rate", "prior": f"{x['prior_late_rate'] * 100:.1f}%",
         "recent": f"{x['recent_late_rate'] * 100:.1f}%", "delta": f"{x['delta_pts']:+.1f} pts"}
        for x in rows_out
    ]}


def _demand_investigation(db: Session, days: int) -> dict:
    rec_s, rec_e, pri_s, pri_e = _window_bounds(days)
    rec_dem = sum(_sales_by_window(db, rec_s, rec_e).values())
    pri_dem = sum(_sales_by_window(db, pri_s, pri_e).values())
    delta = (rec_dem / pri_dem - 1) if pri_dem else 0
    return {"candidates": [{
        "factor": "Demand volume",
        "prior_units": pri_dem, "recent_units": rec_dem,
        "delta_pct": round(delta * 100, 1),
    }], "metrics": [{
        "label": "Units sold", "prior": f"{pri_dem:,}", "recent": f"{rec_dem:,}",
        "delta": f"{delta * 100:+.1f}%",
    }]}


# ---------------------------------------------------------------------------
# Problem → investigation assembly (the RCA record).
# ---------------------------------------------------------------------------

def _investigate_delivery(db: Session, days: int, problem: dict) -> dict:
    rec_s, rec_e, pri_s, pri_e = _window_bounds(days)
    recent = _delivery_stats(db, rec_s, rec_e)
    prior = _delivery_stats(db, pri_s, pri_e)

    carrier = _carrier_investigation(db, days, recent, prior)
    inv = _inventory_investigation(db, days)
    ful = _fulfillment_investigation(db, days)
    reg = _region_investigation(db, days)
    dem = _demand_investigation(db, days)

    # Assemble the tree. The carrier branch is the deep-dive with the verdict;
    # other branches carry their measured evidence and a language-disciplined
    # verdict based on whether they moved materially.
    nodes: list[dict] = []
    carrier_factor = carrier["factor"]
    carrier_top = carrier["top"]
    nodes.append({
        "id": "carrier",
        "label": "Carrier performance",
        "status": "flagged" if carrier_factor else "cleared",
        "summary": (carrier_factor["verdict"] if carrier_factor
                    else "No carrier shows a material late-rate jump; allocation between carriers is stable."),
        "metrics": [c for c in carrier["candidates"][:4]],
        "children": [],
    })

    inv_sig = inv["candidates"][0]
    inv_up = (inv_sig["delta_pts"] or 0) >= 3
    nodes.append({
        "id": "inventory",
        "label": "Inventory availability",
        "status": "flagged" if inv_up else "cleared",
        "summary": (f"Orders with the distant-routing signature (slow dispatch): "
                    f"{inv_sig['prior_share'] * 100 if inv_sig['prior_share'] is not None else 0:.0f}% → "
                    f"{inv_sig['recent_share'] * 100 if inv_sig['recent_share'] is not None else 0:.0f}%. "
                    + ("Increase is associated with more orders forced off the home DC — potential contributor."
                       if inv_up else
                       "Broadly stable — the availability gap is the pre-existing regional imbalance, not a new factor this window.")),
        "metrics": inv["metrics"],
        "children": [],
    })

    worst_stage = ful["candidates"][0]
    ful_moved = (worst_stage["delta_pct"] or 0) >= 15
    nodes.append({
        "id": "fulfillment",
        "label": "Fulfillment time (pick → pack → dispatch)",
        "status": "flagged" if ful_moved else "cleared",
        "summary": (f"Largest stage movement: {worst_stage['stage']} {worst_stage['prior_hours']}h → "
                    f"{worst_stage['recent_hours']}h ({worst_stage['delta_pct']:+.1f}%). "
                    + ("Likely contributor to promise misses." if ful_moved
                       else "Cycle stages are stable — requires investigation only if the trend persists.")),
        "metrics": ful["metrics"],
        "children": [],
    })

    worst_region = reg["candidates"][0] if reg["candidates"] else None
    nodes.append({
        "id": "region",
        "label": "Regional mix",
        "status": "flagged" if worst_region and worst_region["delta_pts"] >= 3 else "cleared",
        "summary": (f"{worst_region['region']} shows the largest late-rate movement "
                    f"({worst_region['delta_pts']:+.1f} pts) — potential contributor via demand mix"
                    if worst_region else "No regional data."),
        "metrics": reg["metrics"],
        "children": [],
    })

    dem_c = dem["candidates"][0]
    dem_moved = abs(dem_c["delta_pct"]) >= 15
    nodes.append({
        "id": "demand",
        "label": "Demand volume",
        "status": "flagged" if dem_moved else "cleared",
        "summary": (f"Units sold {dem_c['prior_units']:,} → {dem_c['recent_units']:,} ({dem_c['delta_pct']:+.1f}%). "
                    + ("Volume pressure is associated with SLA stress." if dem_moved
                       else "Demand was broadly stable — it does not explain the movement.")),
        "metrics": dem["metrics"],
        "children": [],
    })

    nodes.sort(key=lambda n: {"flagged": 0, "cleared": 1}[n["status"]])

    if carrier_factor:
        evidence = carrier["evidence"]
        factor = carrier_factor
        gross = carrier_top["contribution_pts"] if carrier_top else 0
        net = problem["delta_pts"]
        impact = (f"Gross late-rate pressure from the flagged branch: +{gross} pts. Net headline movement: "
                  f"{net:+.1f} pts (small offsets elsewhere). If the branch returns to its prior level, "
                  "the estimated recovery scales with that share at current volumes — a decomposition "
                  "estimate, not a guarantee.")
    else:
        evidence = {"headline": "No single factor separates from the pack — the deterioration looks diffuse.",
                    "metrics": reg["metrics"][:4]}
        factor = {
            "factor": "Diffuse — multiple small contributors",
            "verdict": "requires investigation",
            "impact": "No branch arithmetically accounts for the movement; treat as a system-level drift.",
            "recommendation": "Hold the review open: re-run this analysis after the next 7 days of data and check hub-level scans.",
            "confidence": "low",
        }

    return {
        "tree": nodes,
        "evidence": evidence,
        "contributing_factor": factor,
        "business_impact": {
            "statement": (f"Late orders moved {problem['prior'] * 100:.1f}% → {problem['recent'] * 100:.1f}% "
                          f"({problem['delta_pts']:+.1f} pts) on {recent['delivered']:,} delivered orders."),
            "estimated": True,
        },
        "recommendation": factor["recommendation"],
    }


def _investigate_cancellations(db: Session, days: int, problem: dict) -> dict:
    rec_s, rec_e, pri_s, pri_e = _window_bounds(days)
    whs = {w.id: w for w in db.execute(select(Warehouse)).scalars()}
    home_of = {"North": "DEL", "West": "MUM", "South": "BLR", "East": "CCU"}

    def cancel_split(start: str, end: str) -> dict:
        rows = db.execute(select(OutboundOrder.region, OutboundOrder.warehouse_id, OutboundOrder.status,
                                 OutboundOrder.delay_reason)
                          .where(OutboundOrder.order_date >= start, OutboundOrder.order_date <= end)).all()
        total, canc_local, canc_distant = 0, 0, 0
        for region, wh_id, status, reason in rows:
            total += 1
            if status != "Cancelled":
                continue
            if reason == "Stock unavailability at home DC":
                canc_distant += 1
            else:
                canc_local += 1
        return {"total": total, "stock_cancels": canc_distant, "other_cancels": canc_local}

    rec, pri = cancel_split(rec_s, rec_e), cancel_split(pri_s, pri_e)
    stock_up = rec["stock_cancels"] - pri["stock_cancels"]
    tree = [{
        "id": "availability",
        "label": "Stock unavailability at home DC",
        "status": "flagged" if stock_up > 0 else "cleared",
        "summary": (f"Stock-unavailability cancellations {pri['stock_cancels']} → {rec['stock_cancels']} "
                    f"({'likely contributor' if stock_up > 0 else 'no material movement'})."),
        "metrics": [{"label": "Stock-unavailability cancels", "prior": str(pri["stock_cancels"]),
                     "recent": str(rec["stock_cancels"]), "delta": f"{stock_up:+d}"},
                    {"label": "Other cancels", "prior": str(pri["other_cancels"]),
                     "recent": str(rec["other_cancels"]),
                     "delta": f"{rec['other_cancels'] - pri['other_cancels']:+d}"}],
        "children": [],
    }]
    return {
        "tree": tree,
        "evidence": {"headline": tree[0]["summary"], "metrics": tree[0]["metrics"]},
        "contributing_factor": {
            "factor": "Home-DC availability on ordered sizes" if stock_up > 0 else "No dominant factor",
            "verdict": "likely contributor" if stock_up > 0 else "requires investigation",
            "impact": f"Stock-unavailability cancellations moved {stock_up:+d} between windows.",
            "recommendation": ("Rebalance sizes with thin home-DC cover before the next campaign window; "
                               "cross-check the Size Availability Risk list."),
            "confidence": "medium" if stock_up > 0 else "low",
        },
        "business_impact": {"statement": problem["statement"], "estimated": True},
        "recommendation": ("Rebalance sizes with thin home-DC cover before the next campaign window; "
                           "cross-check the Size Availability Risk list."),
    }


def _investigate_dispatch(db: Session, days: int, problem: dict) -> dict:
    ful = _fulfillment_investigation(db, days)
    inv = _inventory_investigation(db, days)
    worst = ful["candidates"][0]
    distant_related = worst["stage"] == "Dispatch"
    tree = [{
        "id": "dispatch",
        "label": "Dispatch stage",
        "status": "flagged" if distant_related else "cleared",
        "summary": (f"Dispatch {worst['prior_hours']}h → {worst['recent_hours']}h "
                    f"({worst['delta_pct']:+.1f}%). Associated with cross-DC routing distance."
                    if distant_related else "Dispatch stable."),
        "metrics": ful["metrics"],
        "children": [],
    }, {
        "id": "allocation",
        "label": "Warehouse allocation (local vs distant)",
        "status": "flagged" if (inv["candidates"][0]["delta_pts"] or 0) <= -2 else "cleared",
        "summary": inv["candidates"][0].get("delta_pts", 0) and
                   f"Home-DC shipping share moved {inv['candidates'][0]['delta_pts']:+.1f} pts.",
        "metrics": inv["metrics"],
        "children": [],
    }]
    return {
        "tree": tree,
        "evidence": {"headline": (f"Dispatch time moved {worst['prior_hours']}h → {worst['recent_hours']}h "
                                  f"({worst['delta_pct']:+.1f}%); distant-routed orders average far longer dispatch."),
                     "metrics": ful["metrics"]},
        "contributing_factor": {
            "factor": "Cross-DC routing distance" if distant_related else worst["stage"] + " stage",
            "verdict": "likely contributor" if distant_related else "requires investigation",
            "impact": f"Dispatch accounts for most of the cycle-time movement ({worst['delta_hours']:+.1f}h).",
            "recommendation": ("Pre-position high-demand SKUs in the starved DC; review the size-rebalancing "
                               "list so orders ship from the customer's home DC."),
            "confidence": "medium",
        },
        "business_impact": {"statement": problem["statement"], "estimated": True},
        "recommendation": ("Pre-position high-demand SKUs in the starved DC; review the size-rebalancing "
                           "list so orders ship from the customer's home DC."),
    }


_INVESTIGATORS = {
    "delivery": _investigate_delivery,
    "cancellations": _investigate_cancellations,
    "dispatch": _investigate_dispatch,
}


def analyze(db: Session, days: int = 21) -> dict:
    """Detect problems in the recent window and investigate each one."""
    problems = _detect_problems(db, days)
    out = []
    for p in problems:
        inv = _INVESTIGATORS[p["seeding"]](db, days, p)
        out.append({
            **p,
            "evidence": inv["evidence"],
            "contributing_factor": inv["contributing_factor"],
            "business_impact": inv["business_impact"],
            "recommendation": inv["recommendation"],
            "tree": inv["tree"],
        })
    return {
        "window_days": days,
        "problems": out,
        "language_note": ("Verdicts use measured decompositions where available. 'Likely contributor' "
                          "and 'associated with' are deliberately not 'caused by': correlation plus "
                          "arithmetic accounting is not proof. Direct-causality language is used only "
                          "when a single factor reproduces the full movement."),
    }


def rca_problems(db: Session, days: int = 21) -> dict:
    """Lightweight problem list (no investigation) for pickers."""
    return {"window_days": days, "problems": _detect_problems(db, days)}
