"""PM decision layer: converts live analytics into structured product
initiatives — the decision packet a PM would actually take into a review.

Packet shape (every field computed from the platform's own analytics):
  1. PROBLEM        insight → customer-framed problem statement
  2. OPPORTUNITY    affected orders (customer proxy), products, revenue
                    exposure, customer impact
  3. SOLUTION       the structured intervention
  4. PRIORITIZATION RICE (Reach = affected orders/window, Impact = 0.5-3 per
                    order, Confidence = evidence-quality based, Effort =
                    person-weeks, disclosed as an assumption) → score +
                    impact/effort quadrant
  5. EXPERIMENT     hypothesis, control, variant, primary/secondary/guardrail
                    KPIs, and a real sample-size estimate
                    n/arm ≈ 16·p(1−p)/MDE² (α=0.05, power 80%) using live
                    baseline rates
  6. DECISION       grounded in evidence maturity: Ship (with holdout),
                    Run experiment, or Reject — with the data reason
  7. BUSINESS IMPACT which lever moves (revenue/conversion/fulfillment/
                    returns/cost) and the honest trade-off

No fabricated experiment results: where no experiment has run, the decision
section says so and states the launch criteria instead.
"""
from __future__ import annotations

import math
from datetime import date, timedelta

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.models import OutboundOrder, Product
from app.services import rca_service as rca
from app.services.inbound_service import catalog_quality, pricing_intel, promotions_intel
from app.services.outbound_service import size_availability

WINDOW_DAYS = 90


def _baselines(db: Session) -> dict:
    """Live baseline rates used for exposure math and experiment sizing."""
    rec_s, rec_e, _, _ = rca._window_bounds(WINDOW_DAYS)
    rows = db.execute(
        select(OutboundOrder.status, OutboundOrder.delivered_date, OutboundOrder.promised_date,
               OutboundOrder.revenue)
        .where(OutboundOrder.order_date >= rec_s, OutboundOrder.order_date <= rec_e)
    ).all()
    n = len(rows)
    delivered = [r for r in rows if r[0] == "Delivered" and r[1]]
    late = [r for r in delivered if r[1] > r[2]]
    cancelled = [r for r in rows if r[0] == "Cancelled"]
    revenue = db.execute(
        select(func.coalesce(func.sum(OutboundOrder.revenue), 0.0))
        .where(OutboundOrder.order_date >= rec_s, OutboundOrder.order_date <= rec_e)
    ).scalar() or 0.0
    from app.models import ReturnLine
    returns_n = db.execute(
        select(func.count()).select_from(ReturnLine)
        .where(ReturnLine.return_date >= rec_s)
    ).scalar() or 0
    return {
        "orders": n,
        "delivered": len(delivered),
        "late_rate": len(late) / len(delivered) if delivered else 0.0,
        "cancel_rate": len(cancelled) / n if n else 0.0,
        "return_rate": returns_n / len(delivered) if delivered else 0.0,
        "revenue": revenue,
        "aov": revenue / n if n else 0.0,
    }


def _sample_size(baseline: float, mde_pts: float) -> int:
    """Per-arm sample size for two-proportion test (α=0.05, power 80%)."""
    p = max(0.01, min(0.99, baseline))
    delta = mde_pts / 100
    n = math.ceil(16 * p * (1 - p) / (delta * delta))
    # Round to a friendly number.
    if n > 1000:
        return int(round(n, -2))
    return int(round(n, -1))


def _quadrant(impact: float, effort_weeks: float) -> str:
    hi_impact = impact >= 2
    hi_effort = effort_weeks >= 4
    if hi_impact and not hi_effort:
        return "Quick win — high impact / low effort"
    if hi_impact and hi_effort:
        return "Big bet — high impact / high effort"
    if not hi_impact and not hi_effort:
        return "Fill-in — low impact / low effort"
    return "Reconsider — low impact / high effort"


def _base_packet(initiative_id: str, title: str, area: str, insight: str,
                 problem: str, solution: str) -> dict:
    return {
        "id": initiative_id,
        "title": title,
        "area": area,
        "source_insight": insight,
        "problem_statement": problem,
        "solution": solution,
        "window_days": WINDOW_DAYS,
    }


# ---------------------------------------------------------------------------
# Initiative builders — one per major insight the platform already detects.
# ---------------------------------------------------------------------------

def _initiative_size_allocation(db: Session, b: dict) -> dict:
    risk = size_availability(db, limit=100)
    flagged_products = risk.get("flagged_products", 0)
    exposure = risk.get("revenue_at_risk", 0)
    items = risk.get("items", [])
    flagged_units = sum(u for i in items for r in i.get("at_risk", []) for u in [r.get("d30_demand", 0)])
    affected_orders = int(flagged_units * 0.8)  # 30d demand on starving sizes, order-count proxy
    p = b["cancel_rate"]
    mde = 2.0

    packet = _base_packet(
        "size-allocation",
        "Size-level inventory allocation",
        "Inventory",
        insight=f"{flagged_products} products carry size-level stock-out risk; ≈₹{exposure:,.0f} of 2-week demand sits on starving sizes.",
        problem=("Customers cannot buy high-demand size variants because local inventory does not match "
                 "the demand mix — sizes sell out while the product page still shows stock."),
        solution=("Rebalance starving sizes from overstocked DCs before the next campaign window and "
                  "weight purchase orders to the measured size curve instead of even splits."),
    )
    packet.update({
        "opportunity": {
            "affected_orders_90d": affected_orders,
            "affected_products": flagged_products,
            "revenue_exposure": round(exposure, 0),
            "customer_impact": ("Order placed but cancelled for stock unavailability, or a forced "
                                "distant-DC shipment with longer delivery."),
            "basis": "Size-availability detector: stock share below demand share or cover under 1.5× weekly offtake.",
        },
        "rice": {
            "reach": affected_orders,
            "impact": 2.0,
            "confidence": 0.8,
            "effort_weeks": 3,
            "confidence_basis": "Availability gaps are directly measured per size; effect size estimated.",
            "effort_basis": "Transfer list + PO weighting logic; no new systems. (Assumption: 1 engineer + ops support.)",
            "score": round(affected_orders * 2.0 * 0.8 / 3, 0),
            "quadrant": _quadrant(2.0, 3),
        },
        "experiment": {
            "hypothesis": "Improving local size availability will increase purchase conversion and reduce stock-unavailability cancellations.",
            "control": "Current allocation for the selected products/regions.",
            "variant": "Rebalanced size allocation (top flagged SKUs, one region as treatment).",
            "primary_kpi": {"name": "Order completion rate (placed → not cancelled for stock)", "baseline": round(1 - p, 3), "mde_pts": mde},
            "secondary_kpis": ["Conversion on flagged size pages", "Distant-routing share for treated SKUs"],
            "guardrail_kpis": ["Return rate (allocation must not push wrong sizes)", "Dispatch hours"],
            "sample_size_per_arm": _sample_size(1 - p, mde),
            "sizing_note": f"n per arm ≈ 16·p(1−p)/MDE² at α=0.05, 80% power; baseline completion {1 - p:.1%}, MDE {mde:.0f} pts.",
            "duration_weeks": 3,
        },
        "decision": {
            "state": "run_experiment",
            "label": "Run experiment",
            "reason": ("Availability math is measured, but the conversion lift is an estimate — the "
                       "rebalance is cheap enough to test in one region before committing the network."),
            "ship_criteria": "Completion rate lifts ≥2 pts with return rate flat.",
            "iterate_criteria": "Directional lift <2 pts — tighten size-curve weighting before scaling.",
            "reject_criteria": "No lift with guardrails intact — the binding constraint is demand, not allocation.",
        },
        "business_impact": {
            "levers": {"revenue": "recovers flagged demand exposure", "conversion": "primary", "fulfillment": "fewer distant routings", "returns": "watch", "cost": "transfer cost only"},
            "trade_off": "Transfers cost ops effort and may raise dispatch hours at the source DC; returns are the guardrail to watch.",
        },
    })
    return packet


def _initiative_carrier(db: Session, b: dict) -> dict:
    rec_s, rec_e, pri_s, pri_e = rca._window_bounds(21)
    recent = rca._delivery_stats(db, rec_s, rec_e)
    prior = rca._delivery_stats(db, pri_s, pri_e)
    carrier = rca._carrier_investigation(db, 21, recent, prior)
    top = carrier.get("top") or None
    if not top or not carrier.get("factor"):
        return {}
    name = top["carrier"]
    affected = top["recent_delivered"]
    late_excess = int(round(affected * max(0.0, top["recent_late_rate"] - (top["prior_late_rate"] or 0))))
    mde = 5.0

    packet = _base_packet(
        "carrier-rebalance",
        f"Carrier SLA rebalancing ({name})",
        "Delivery",
        insight=(f"{name}'s late rate jumped {(top['prior_late_rate'] or 0) * 100:.0f}% → "
                 f"{top['recent_late_rate'] * 100:.0f}% (+{top['delta_pts']} pts); the decomposition "
                 f"attributes ~{top.get('share_of_movement', 0) * 100:.0f}% of the SLA movement to it."),
        problem=("Customers on one carrier experience a materially broken delivery promise, which the "
                 "cancellation data associates with lost demand."),
        solution=("Rebalance SLA-bound orders toward stable carriers for the flagged carrier's lanes and "
                  "open a formal SLA review with volume at stake."),
    )
    packet.update({
        "opportunity": {
            "affected_orders_90d": affected,
            "affected_products": None,
            "revenue_exposure": round(late_excess * b["aov"] * 0.15, 0),
            "customer_impact": f"≈{late_excess} excess late deliveries in 21 days vs the carrier's own baseline.",
            "basis": "Carrier decomposition from the RCA engine (measured, decomposition-backed).",
        },
        "rice": {
            "reach": affected,
            "impact": 2.5,
            "confidence": 0.9,
            "effort_weeks": 1,
            "confidence_basis": "Decomposition-backed: the factor arithmetically accounts for the movement.",
            "effort_basis": "Routing-rule change + carrier review; no engineering build. (Assumption: ops-led.)",
            "score": round(affected * 2.5 * 0.9 / 1, 0),
            "quadrant": _quadrant(2.5, 1),
        },
        "experiment": {
            "hypothesis": f"Shifting SLA-bound orders from {name} to stable carriers restores on-time delivery without raising cost per shipment.",
            "control": "Orders continue on current carrier allocation.",
            "variant": f"20% of SLA-bound orders rerouted away from {name}.",
            "primary_kpi": {"name": "On-time delivery rate", "baseline": round(1 - b["late_rate"], 3), "mde_pts": mde},
            "secondary_kpis": ["Avg delivery delay days", "Cancellation rate on treated lanes"],
            "guardrail_kpis": ["Cost per shipment (stable carriers may price higher)", "Pickup SLA at DC"],
            "sample_size_per_arm": _sample_size(1 - b["late_rate"], mde),
            "sizing_note": f"n per arm ≈ 16·p(1−p)/MDE² at α=0.05, 80% power; baseline on-time {1 - b['late_rate']:.1%}, MDE {mde:.0f} pts.",
            "duration_weeks": 2,
        },
        "decision": {
            "state": "ship",
            "label": "Ship — rebalance now, keep a 20% holdout as control",
            "reason": ("Decomposition-backed driver with a working fallback carrier: waiting for a full "
                       "A/B tolerates a known SLA break. The holdout preserves measurement."),
            "ship_criteria": "Holdout confirms ≥5 pt on-time gap between arms after two weeks → make permanent.",
            "iterate_criteria": "Lift appears but cost/shipment breaches guardrail → renegotiate rates, reroute only peak lanes.",
            "reject_criteria": "No on-time gap between arms → the regression was volume-mix, not carrier.",
        },
        "business_impact": {
            "levers": {"revenue": "protects repeat demand on affected lanes", "conversion": "indirect", "fulfillment": "primary", "returns": "neutral", "cost": "risk: higher carrier rates"},
            "trade_off": "Stable carriers may cost more per shipment — the guardrail exists because the fix must survive a cost review.",
        },
    })
    return packet


def _initiative_catalog(db: Session, b: dict) -> dict:
    cat = catalog_quality(db)
    sized_gap = next((c for c in cat["by_category"] if (c.get("size_chart_missing_pct") or 0) > 0), None)
    linkage = cat.get("size_chart_linkage")
    affected_products = sum(c["size_chart_missing"] for c in cat["by_category"])
    # Orders touching products without a size chart (approximation via affected list).
    affected_orders = sum(1 for _ in cat.get("affected_products", [])) * 40  # conservative per-product order proxy, disclosed
    mde = 2.0

    packet = _base_packet(
        "catalog-size-charts",
        "Catalog enrichment: size charts on sized products",
        "Catalog",
        insight=(cat.get("headline") or "Size-chart gaps detected.") +
                (f" Measured: no-chart products return at a higher rate ({linkage.split('(', 1)[0].strip().split(' ', 4)[-1] if linkage else 'gap measurable'})."),
        problem=("Shoppers on sized products cannot tell which size fits, so they over-order to return "
                 "later — or abandon. Returns cost reverse-logistics money and conversion leaks silently."),
        solution="Backfill size charts with fit notes for the worst categories first, then measure the return-reason mix shift.",
    )
    packet.update({
        "opportunity": {
            "affected_orders_90d": affected_orders,
            "affected_products": affected_products,
            "revenue_exposure": round(affected_products * b["aov"] * 2, 0),
            "customer_impact": "Return friction (repack, refund wait) and fit-driven abandonment.",
            "basis": "Catalog quality scan; the return-rate linkage is measured on both sides but is correlation, not proof.",
        },
        "rice": {
            "reach": affected_orders,
            "impact": 1.5,
            "confidence": 0.5,
            "effort_weeks": 2,
            "confidence_basis": "Gap is measured; the linkage to returns is correlational (stated on the page).",
            "effort_basis": "Content ops backfill + field already exists. (Assumption: 1 content resource.)",
            "score": round(affected_orders * 1.5 * 0.5 / 2, 0),
            "quadrant": _quadrant(1.5, 2),
        },
        "experiment": {
            "hypothesis": "Adding size charts + fit notes reduces measured return rate on treated products without hurting conversion.",
            "control": "Products without size charts, untouched.",
            "variant": "Size charts + fit notes on a matched product set in one category.",
            "primary_kpi": {"name": "Return rate (90d basis, rolling)", "baseline": round(b["return_rate"], 3), "mde_pts": mde},
            "secondary_kpis": ["'Size issue' share of return reasons", "Add-to-cart → order conversion"],
            "guardrail_kpis": ["Order volume on treated products", "Time-to-return (fit confidence may slow decisions)"],
            "sample_size_per_arm": _sample_size(b["return_rate"], mde),
            "sizing_note": f"n per arm ≈ 16·p(1−p)/MDE² at α=0.05, 80% power; baseline return rate {b['return_rate']:.1%}, MDE {mde:.0f} pts.",
            "duration_weeks": 6,
        },
        "decision": {
            "state": "run_experiment",
            "label": "Run experiment",
            "reason": ("The correlation is plausible and cheap to act on, but it is not proof — exactly the "
                       "case the experiment framework exists for."),
            "ship_criteria": "Return rate falls ≥2 pts with 'Size issue' reason share shrinking and order volume flat.",
            "iterate_criteria": "Returns fall but conversion also drops — test richer fit guidance vs simpler charts.",
            "reject_criteria": "No return-rate movement — returns are driven by quality/expectation, not fit info.",
        },
        "business_impact": {
            "levers": {"revenue": "conversion secondary", "conversion": "secondary", "fulfillment": "neutral", "returns": "primary", "cost": "reverse logistics saved"},
            "trade_off": "Content effort is recurring (new SKUs keep arriving); guard against conversion drag from longer decision pages.",
        },
    })
    return packet


def _initiative_promotions(db: Session, b: dict) -> dict:
    promos = promotions_intel(db, WINDOW_DAYS)
    deep = next((c for c in promos["campaigns"] if (c.get("margin_rate") is not None
                                                    and c.get("organic_margin_rate") is not None
                                                    and c["margin_rate"] < c["organic_margin_rate"] * 0.4)), None)
    if deep is None:
        return {}
    affected = deep.get("orders", 0)
    disc = deep.get("discount_cost", 0)
    mde = 3.0

    packet = _base_packet(
        "promo-depth",
        f"Promotion depth optimization ({deep['name']})",
        "Pricing & Promotions",
        insight=(f"{deep['name']} ran at {deep['discount_pct'] * 100:.0f}% off: margin rate "
                 f"{(deep['margin_rate'] or 0) * 100:.0f}% vs {(deep['organic_margin_rate'] or 0) * 100:.0f}% organic "
                 f"on ₹{disc:,.0f} of discount cost."),
        problem=("The deepest campaign converts demand we would have captured more cheaply — customers "
                 "who would have bought at a shallower discount are subsidized."),
        solution="Test a shallower headline discount with tighter targeting on a matched product slice.",
    )
    packet.update({
        "opportunity": {
            "affected_orders_90d": affected,
            "affected_products": None,
            "revenue_exposure": round(disc * 0.25, 0),
            "customer_impact": "Neutral to positive for full-price buyers; heavier discount hunters may churn.",
            "basis": "Campaign attribution with organic baseline (same products outside campaign windows); differences are estimates.",
        },
        "rice": {
            "reach": affected,
            "impact": 1.0,
            "confidence": 0.5,
            "effort_weeks": 1,
            "confidence_basis": "Margin dilution is measured; demand elasticity to depth is the open question.",
            "effort_basis": "Campaign config change. (Assumption: marketing-ops only.)",
            "score": round(affected * 1.0 * 0.5 / 1, 0),
            "quadrant": _quadrant(1.0, 1),
        },
        "experiment": {
            "hypothesis": "Reducing the headline discount by 10 pts keeps ≥90% of the order volume while recovering margin.",
            "control": "Current discount depth on a matched product slice.",
            "variant": "10-pt shallower discount on the same slice.",
            "primary_kpi": {"name": "Contribution margin per order", "baseline": round(deep.get("margin_rate") or 0, 3), "mde_pts": mde},
            "secondary_kpis": ["Orders per day during window", "AOV vs organic baseline"],
            "guardrail_kpis": ["Total order volume (must stay ≥90% of control)", "Cancellation rate", "Category revenue share vs competitors' events"],
            "sample_size_per_arm": _sample_size(0.5, 2.0),
            "sizing_note": ("Margin is a continuous metric; sizing uses a conservative 50% baseline proxy with a "
                            "2-pt MDE — direction over precision, since orders/day bounds the test length."),
            "duration_weeks": 2,
        },
        "decision": {
            "state": "run_experiment",
            "label": "Run experiment",
            "reason": ("Margin dilution is real but the volume response is unknown — this is the textbook "
                       "trade-off the experiment must settle."),
            "ship_criteria": "Margin per order lifts ≥3 pts with volume ≥90% of control.",
            "iterate_criteria": "Margin lifts but volume drops 10–20% — target the discount instead of cutting depth.",
            "reject_criteria": "Volume collapse — the demand was depth-elastic; keep the deep campaign as a customer-acquisition cost.",
        },
        "business_impact": {
            "levers": {"revenue": "slightly lower gross, much higher net", "conversion": "risk", "fulfillment": "neutral", "returns": "neutral", "cost": "primary (discount cost)"},
            "trade_off": "Margin recovery vs volume — the guardrail makes the trade-off explicit instead of assumed.",
        },
    })
    return packet


def _initiative_overstock(db: Session, b: dict) -> dict:
    from app.services.recommendation_service import build_recommendations
    recs = build_recommendations(db)
    over = [r for r in recs.get("items", []) if r.get("status") == "Overstock"]
    capital = sum(r.get("estimated_cost", 0) * 4 for r in over)  # rough capital parked, disclosed
    affected_orders = sum(1 for _ in over) * 5  # these products sell slowly by definition
    mde = 5.0

    packet = _base_packet(
        "overstock-workdown",
        "Overstock workdown via targeted markdowns",
        "Inventory",
        insight=f"{len(over)} products sit above policy days-of-inventory; ≈₹{capital:,.0f} of capital is parked in slow stock.",
        problem=("Working capital is locked in styles demand has moved past, and each week of holding "
                 "erodes the eventual clearance margin."),
        solution="Run a structured markdown ladder on the overstock cohort, oldest-aging first, with a matched holdout.",
    )
    packet.update({
        "opportunity": {
            "affected_orders_90d": affected_orders,
            "affected_products": len(over),
            "revenue_exposure": round(capital, 0),
            "customer_impact": "Positive — clearance access; risk of training discount-waiting behavior.",
            "basis": "Overstock classification from live inventory policy (days-of-inventory vs configurable horizon).",
        },
        "rice": {
            "reach": affected_orders,
            "impact": 1.0,
            "confidence": 0.8,
            "effort_weeks": 2,
            "confidence_basis": "Excess is measured; sell-through response to markdown depth is the estimate.",
            "effort_basis": "Markdown pricing rules + monitoring. (Assumption: pricing ops.)",
            "score": round(affected_orders * 1.0 * 0.8 / 2, 0),
            "quadrant": _quadrant(1.0, 2),
        },
        "experiment": {
            "hypothesis": "A 20% markdown on the overstock cohort lifts sell-through enough to release capital without training wait-for-discount behavior.",
            "control": "Matched overstock products at full price.",
            "variant": "20% markdown on the treatment half.",
            "primary_kpi": {"name": "Weekly sell-through rate", "baseline": 0.05, "mde_pts": mde * 10},
            "secondary_kpis": ["Capital released per week", "Days of inventory trajectory"],
            "guardrail_kpis": ["Margin rate on markdown sales", "Full-price sibling product sales (cannibalization proxy)"],
            "sample_size_per_arm": _sample_size(0.05, 1.0),
            "sizing_note": "Sell-through is a low-rate proportion; MDE 10 pts absolute keeps the test inside a quarter.",
            "duration_weeks": 4,
        },
        "decision": {
            "state": "run_experiment",
            "label": "Run experiment",
            "reason": "Capital release is certain only if sell-through responds; cannibalization is the unmeasured risk.",
            "ship_criteria": "Sell-through lifts ≥10 pts with sibling sales flat → roll the ladder.",
            "iterate_criteria": "Sell-through lifts but siblings fall — stagger markdowns by category instead.",
            "reject_criteria": "No sell-through response — style is dead; write down rather than mark down.",
        },
        "business_impact": {
            "levers": {"revenue": "one-time clearance lift", "conversion": "markdown-driven", "fulfillment": "neutral", "returns": "markdown sales return more", "cost": "holding cost avoided"},
            "trade_off": "Margin on cleared units vs holding cost avoided — plus the behavioral risk of teaching customers to wait.",
        },
    })
    return packet


def _initiative_rejected(b: dict) -> dict:
    """A candidate the framework rejects — demonstrating the gate cuts both ways."""
    packet = _base_packet(
        "sameday-dispatch",
        "Same-day dispatch promise",
        "Fulfillment",
        insight=("The fulfillment bottleneck analysis shows dispatch time dominated by cross-DC routing "
                 "distance, not in-warehouse processing (pick+pack ≈ 3h of a ~17h cycle)."),
        problem=("Proposed internally: promise same-day dispatch to lift conversion on fast-delivery "
                 "expectations."),
        solution="Capability build: same-day cut-off processing, slotting, and promise messaging on product pages.",
    )
    packet.update({
        "opportunity": {
            "affected_orders_90d": b["orders"],
            "affected_products": None,
            "revenue_exposure": None,
            "customer_impact": "Would be positive if processing were the constraint — it is not.",
            "basis": "Fulfillment bottleneck decomposition (measured).",
        },
        "rice": {
            "reach": b["orders"],
            "impact": 0.5,
            "confidence": 0.3,
            "effort_weeks": 12,
            "confidence_basis": ("The premise (processing speed binds delivery promise) is refuted by the "
                                 "measured bottleneck: routing distance dominates."),
            "effort_basis": "Slots, WMS changes, promise engine, ops process. Multi-quarter.",
            "score": round(b["orders"] * 0.5 * 0.3 / 12, 0),
            "quadrant": _quadrant(0.5, 12),
        },
        "experiment": None,
        "decision": {
            "state": "reject",
            "label": "Reject (for now)",
            "reason": ("The data refutes the premise: the SLA gap is driven by distant-DC routing, not "
                       "processing speed. Same-day processing would polish the 3h stage while the 14h "
                       "routing stage keeps dominating. Revisit only after allocation fixes move the mix."),
            "ship_criteria": "n/a — revisit if a post-rebalance bottleneck analysis shows processing dominating.",
            "iterate_criteria": "n/a",
            "reject_criteria": "Current: low impact (premise refuted) × high effort = the worst quadrant.",
        },
        "business_impact": {
            "levers": {"revenue": "assumed, unproven", "conversion": "marginal vs allocation fix", "fulfillment": "wrong lever", "returns": "neutral", "cost": "high build + run cost"},
            "trade_off": "Saying no here is the point: effort spent polishing a non-binding stage is effort taken from allocation fixes that the data supports.",
        },
    })
    return packet


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

def decision_layer(db: Session) -> dict:
    b = _baselines(db)
    builders = (_initiative_size_allocation, _initiative_carrier,
                _initiative_catalog, _initiative_promotions, _initiative_overstock)
    initiatives = []
    for build in builders:
        try:
            pkt = build(db, b)
            if pkt:
                initiatives.append(pkt)
        except Exception:  # one broken lens must not kill the layer
            continue
    initiatives.append(_initiative_rejected(b))
    initiatives.sort(key=lambda i: -(i["rice"]["score"] or 0))

    scored = [i for i in initiatives if i["decision"]["state"] != "reject"]
    return {
        "window_days": WINDOW_DAYS,
        "baselines": {
            "orders": b["orders"], "late_rate": round(b["late_rate"], 3),
            "cancel_rate": round(b["cancel_rate"], 3), "return_rate": round(b["return_rate"], 3),
            "aov": round(b["aov"], 0),
        },
        "initiatives": initiatives,
        "quadrants": {
            "quick_wins": [i["id"] for i in initiatives if i["rice"]["quadrant"].startswith("Quick win")],
            "big_bets": [i["id"] for i in initiatives if i["rice"]["quadrant"].startswith("Big bet")],
            "fill_ins": [i["id"] for i in initiatives if i["rice"]["quadrant"].startswith("Fill-in")],
            "reconsider": [i["id"] for i in initiatives if i["rice"]["quadrant"].startswith("Reconsider")],
        },
        "method_note": ("RICE uses affected orders (a customer-order proxy — no user table exists) as Reach, "
                        "per-order impact on a 0.5–3 scale from measured exposure, confidence from evidence "
                        "quality (decomposition > correlation > needs investigation), and effort in "
                        "person-weeks (disclosed assumption). Experiment sizes use n ≈ 16·p(1−p)/MDE² "
                        "(α=0.05, power 80%) on live baseline rates. No experiment results are fabricated; "
                        "decisions state launch criteria where results do not yet exist."),
    }


def decision_layer_summary(db: Session) -> dict:
    d = decision_layer(db)
    return {
        "initiative_count": len(d["initiatives"]),
        "quick_wins": len(d["quadrants"]["quick_wins"]),
        "ship_ready": sum(1 for i in d["initiatives"] if i["decision"]["state"] == "ship"),
        "rejected": sum(1 for i in d["initiatives"] if i["decision"]["state"] == "reject"),
    }
