"""Product Intelligence — a PM analytics tool, not a chatbot.

Four grounded AI use cases, one discipline: the analytics layer owns every
number. The service assembles a *grounds packet* (measured facts + explicitly
absent facts) and composes the answer deterministically; an optional LLM pass
(OPENAI_API_KEY or ANTHROPIC_API_KEY set) may rephrase the prose but receives
the same packet and the same instruction — every figure must come from the
packet, and "insufficient data" is the required answer when a question's
evidence is missing.

Endpoints:
  GET /api/pi/questions                 — the questions the ground can answer
  GET /api/pi/ask?q=...                 — insight explanation (structured)
  GET /api/pi/validate?recommendation=… — recommendation validation
  GET /api/pi/experiments?problem=…     — experiment ideas for a problem
  GET /api/pi/executive-summary         — analytics → business language
"""
from __future__ import annotations

import json
import os
from datetime import date, timedelta

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.models import OutboundOrder, Product, ReturnLine, Sale
from app.services.anomaly_service import scan_anomalies, supplier_delay_anomalies
from app.services.data_quality_service import data_quality_report
from app.services.inbound_service import catalog_quality, pricing_intel, promotions_intel
from app.services.outbound_service import customer_impact, delivery_sla, returns_intel, size_availability
from app.services.recommendation_service import build_recommendations
from app.services.rca_service import analyze as rca_analyze
from app.services.settings_service import get_value

INSUFFICIENT = "Insufficient data to confidently determine the cause."


# ---------------------------------------------------------------------------
# Grounds packet — the only facts any answer may cite.
# ---------------------------------------------------------------------------

def _grounds(db: Session, days: int = 21) -> dict:
    """Collect measured facts once per request. Every entry is computed from
    tables; `absent` lists what the dataset genuinely cannot support."""
    since = (date.today() - timedelta(days=days)).isoformat()

    delivered_n = db.execute(
        select(func.count()).select_from(OutboundOrder)
        .where(OutboundOrder.order_date >= since, OutboundOrder.status == "Delivered")).scalar() or 0

    dq = data_quality_report(db)
    sla = delivery_sla(db, days=30)
    impacts = customer_impact(db, days=30)
    sizing = size_availability(db, limit=5)
    returns = returns_intel(db, days=90)
    rca = rca_analyze(db, days=days)
    recs = build_recommendations(db)
    catalog = catalog_quality(db)
    pricing = pricing_intel(db, days=90)
    promos = promotions_intel(db, days=90)
    anomalies = scan_anomalies(db)

    return {
        "window_days": days,
        "delivery": {
            "delivered_orders": delivered_n,
            "late_rate_pct": round((1 - sla["on_time_rate"]) * 100, 1) if sla.get("on_time_rate") is not None else None,
            "worst_region": sla["by_region"][0] if sla.get("by_region") else None,
            "worst_carrier": sla["by_carrier"][0] if sla.get("by_carrier") else None,
            "top_delay_reason": sla["delay_reasons"][0] if sla.get("delay_reasons") else None,
        },
        "trends": {
            "late_rate_prior_pct": round(rca["problems"][0]["prior"] * 100, 1)
                if rca["problems"] and rca["problems"][0].get("prior") is not None else None,
            "problems": [
                {"id": p["id"], "area": p["area"], "title": p["title"], "statement": p["statement"],
                 "contributing_factor": p["contributing_factor"], "recommendation": p["recommendation"],
                 "tree": p.get("tree", [])}
                for p in rca["problems"]
            ],
        },
        "customer": {
            "cancel_rate_pct": impacts["recent"]["cancel_rate_pct"],
            "cancelled_revenue": impacts["recent"]["cancelled_revenue"],
            "late_rate_pct": impacts["recent"]["late_rate_pct"],
            "prior": impacts["prior"],
            "findings": impacts["findings"],
        },
        "inventory": {
            "risk_tier_counts": recs.get("risk_tier_counts", {}),
            "size_flagged_products": sizing["flagged_products"],
            "size_revenue_at_risk": sizing["revenue_at_risk"],
            "top_size_risk": ({"product": sizing["items"][0]["product"],
                               "sizes": [a["size"] for a in sizing["items"][0]["at_risk"]],
                               "revenue_at_risk": sizing["items"][0]["revenue_at_risk"]}
                              if sizing.get("items") else None),
        },
        "returns_90d": {
            "return_rate_pct": returns["return_rate_pct"],
            "top_reason": returns["by_reason"][0] if returns.get("by_reason") else None,
            "top_category": ({"category": returns["by_category"][0]["category"],
                              "return_rate_pct": returns["by_category"][0]["return_rate_pct"]}
                             if returns.get("by_category") else None),
        },
        "catalog": {"complete_pct": catalog["complete_pct"], "headline": catalog["headline"]},
        "pricing": {
            "avg_margin_pct": pricing.get("avg_margin_pct"),
            "declining_after_increase": len(pricing.get("declining_after_increase", [])),
            "note": pricing.get("interpretation_note"),
        },
        "promotions": {
            "campaigns": len(promos.get("campaigns", [])),
            "totals": promos.get("totals"),
            "tradeoff_note": promos.get("tradeoff_note"),
        },
        "anomalies": [
            {"label": a["label"], "z": a["z"],
             "explanation": a.get("explanation") or f"Demand spike at z={a['z']:.1f}"}
            for a in anomalies.get("anomalies", [])[:3]
        ],
        "supplier_anomalies": [
            {"label": a["label"], "value": a["value"], "baseline_mean": a["baseline_mean"],
             "explanation": a["explanation"]}
            for a in supplier_delay_anomalies(db)[:3]
        ],
        "data_quality": {"score": dq["score"], "status": dq["status"], "total_issues": dq["total_issues"]},
        "absent": [
            "sessions or page views (no traffic table — conversion cannot be computed)",
            "customer identifiers (orders are not linked to users)",
            "carrier SLA contracts or cost-per-shipment",
            "marketing spend outside campaign windows",
        ],
    }


def _confidence(grounds: dict, *required_facts) -> dict:
    """Confidence reflects both data quality and how many required facts exist."""
    have = [f for f in required_facts if f is not None]
    if len(have) < len(required_facts):
        return {"level": "low", "note": INSUFFICIENT}
    dq = grounds["data_quality"]["score"]
    n = grounds["delivery"]["delivered_orders"]
    if dq >= 95 and n >= 1000:
        return {"level": "high", "note": f"Data quality {dq}/100 across {n:,} delivered orders in window."}
    if dq >= 90:
        return {"level": "medium", "note": f"Data quality {dq}/100 — {grounds['data_quality']['total_issues']} open issues."}
    return {"level": "low", "note": f"Data quality {dq}/100 — treat numbers as provisional."}


# ---------------------------------------------------------------------------
# 1 · Insight explanation
# ---------------------------------------------------------------------------

def explain(db: Session, question: str, days: int = 21) -> dict:
    g = _grounds(db, days)
    q = (question or "").lower()
    d = g["delivery"]

    if any(w in q for w in ("delivery", "sla", "late", "dispatch", "fulfil", "fulfill")):
        if d["late_rate_pct"] is None or d["delivered_orders"] < 30:
            return _insufficient(q, g, "late-delivery outcomes in the window")
        prior = g["trends"]["late_rate_prior_pct"]
        evidence = [f"Late rate {prior}% → {d['late_rate_pct']}% across {d['delivered_orders']:,} delivered orders."
                    if prior is not None else f"Late rate {d['late_rate_pct']}% across {d['delivered_orders']:,} delivered orders."]
        drivers = []
        if g["trends"]["problems"]:
            p0 = g["trends"]["problems"][0]
            cf = p0["contributing_factor"]
            if isinstance(cf, dict):
                drivers.append(f"{cf.get('factor', 'Driver')}: {cf.get('verdict', '')}".rstrip(": "))
            elif cf:
                drivers.append(str(cf))
        if d["worst_carrier"]:
            wc = d["worst_carrier"]
            drivers.append(f"Carrier: {wc['key']} runs a {wc['late_rate_pct']}% late rate on {wc['delivered']} deliveries.")
        if d["worst_region"]:
            wr = d["worst_region"]
            drivers.append(f"Region: {wr['key']} at {wr['late_rate_pct']}% late on {wr['delivered']} deliveries.")
        if d["top_delay_reason"]:
            tr = d["top_delay_reason"]
            drivers.append(f"Delay reason mix: “{tr['reason']}” leads with {tr['count']} orders.")
        return {
            "question": question, "kind": "insight", "insufficient": False,
            "insight": (f"Delivery performance is declining: late-delivery rate is {d['late_rate_pct']}% "
                        f"in the last {g['window_days']} days"
                        + (f", up from {prior}% in the prior window" if prior is not None else "") + "."),
            "evidence": evidence,
            "possible_drivers": drivers,
            "recommendation": (g["trends"]["problems"][0]["recommendation"] if g["trends"]["problems"]
                               else "Rebalance SLA-bound orders toward carriers and lanes running closest to promise."),
            "kpi_to_track": ["Late-delivery rate (weekly)", "Average dispatch hours", "Share of orders routed from the home DC"],
            "experiment": {
                "hypothesis": "Rebalancing SLA-bound orders toward stable carriers lowers the late rate.",
                "primary_kpi": "Late-delivery rate",
                "guardrail": "Cost per shipment (no contract in data — measure internally before scaling).",
            },
            "investigate": ["Carrier SLA review (data shows which carrier, the contract is off-platform)",
                            f"Regional lane performance ({d['worst_region']['key']} is worst)" if d["worst_region"] else "Regional lane performance"],
            "confidence": _confidence(g, d["late_rate_pct"], prior),
        }

    if any(w in q for w in ("cancel", "cancellation")):
        c = g["customer"]
        if c["cancel_rate_pct"] is None:
            return _insufficient(q, g, "cancellation outcomes")
        return {
            "question": question, "kind": "insight", "insufficient": False,
            "insight": f"Cancellation rate is {c['cancel_rate_pct']}% of placed orders, an estimated {_inr(c['cancelled_revenue'])} of demand lost before dispatch.",
            "evidence": [f for f in c["findings"] if "cancel" in f.lower()] or [f"Cancellation rate {c['cancel_rate_pct']}% in the recent half-window."],
            "possible_drivers": ([f"Late-delivery rate moved to {c['late_rate_pct']}% over the same period — the two moved together."
                                  if isinstance(c["late_rate_pct"], (int, float)) else None] +
                                 ["Pre-dispatch cancellation suggests availability or promise failures, not post-delivery dissatisfaction."]),
            "recommendation": "Fix the upstream promise: size availability and dispatch latency move cancellations (they moved together in-window).",
            "kpi_to_track": ["Cancellation rate (daily)", "Late-delivery rate", "Size-level availability on top sellers"],
            "experiment": {"hypothesis": "Improving local size availability reduces pre-dispatch cancellations.",
                           "primary_kpi": "Cancellation rate", "guardrail": "Holding cost from redistributed stock."},
            "investigate": ["Which sizes cancelled orders were waiting for", "Dispatch latency on cancelled orders"],
            "confidence": _confidence(g, c["cancel_rate_pct"]),
        }

    if any(w in q for w in ("return",)):
        r = g["returns_90d"]
        if r["return_rate_pct"] is None:
            return _insufficient(q, g, "returns in the 90-day window")
        return {
            "question": question, "kind": "insight", "insufficient": False,
            "insight": f"Returns run at {r['return_rate_pct']}% of delivered orders over 90 days"
                       + (f", led by “{r['top_reason']['reason']}” ({r['top_reason']['count']} returns)." if r["top_reason"] else "."),
            "evidence": ([f"Top return reason: {r['top_reason']['reason']} ({r['top_reason']['count']} cases)." if r["top_reason"] else None,
                          f"Highest-return category: {r['top_category']['category']} at {r['top_category']['return_rate_pct']}%." if r["top_category"] else None]),
            "possible_drivers": ["Size/fit mismatch dominates the reason mix — linked to missing size charts in the catalog.",
                                 "Category mix: sized categories structurally return more than one-size goods."],
            "recommendation": "Close the size-chart gap first — catalog completeness is measured, and its absence correlates with the top return reason.",
            "kpi_to_track": ["Return rate by category (weekly)", "Share of orders with size-chart products", "“Size issue” return share"],
            "experiment": {"hypothesis": "Adding size charts to the worst categories lowers size-driven returns.",
                           "primary_kpi": "Size-issue return rate", "guardrail": "Conversion on updated product pages."},
            "investigate": [f"Catalog completeness is {g['catalog']['complete_pct']}% — {g['catalog']['headline']}"],
            "confidence": _confidence(g, r["return_rate_pct"]),
        }

    if any(w in q for w in ("stock", "inventory", "availab")):
        inv = g["inventory"]
        if inv["size_flagged_products"] is None:
            return _insufficient(q, g, "size-level availability signals")
        return {
            "question": question, "kind": "insight", "insufficient": False,
            "insight": (f"{inv['size_flagged_products']} products carry size-level availability risk; "
                        f"estimated {_inr(inv['size_revenue_at_risk'])} revenue at risk over two weeks."),
            "evidence": ([f"Top exposure: {inv['top_size_risk']['product']} — sizes {', '.join(inv['top_size_risk']['sizes'])} starving."
                          if inv["top_size_risk"] else None,
                          f"Network risk tiers: {inv['risk_tier_counts']}."]),
            "possible_drivers": ["Stock share below demand share at size level (fair-share mismatch).",
                                 "Allocation concentrated away from the demand-origin region."],
            "recommendation": "Rebalance the flagged sizes toward demand-heavy DCs; the watch-list names the products.",
            "kpi_to_track": ["Size availability index (top sellers)", "Size-driven cancellations", "Cross-region routing share"],
            "experiment": {"hypothesis": "Pre-positioning starving sizes in demand-heavy DCs lifts conversion and cuts cancellations.",
                           "primary_kpi": "Size-driven cancellation rate", "guardrail": "Inter-DC transfer cost."},
            "investigate": ["Open Size Availability Risk for the product-level matrix"],
            "confidence": _confidence(g, inv["size_flagged_products"]),
        }

    if any(w in q for w in ("promo", "campaign", "discount", "margin", "pricing", "price")):
        p = g["pricing"]
        pr = g["promotions"]
        if p["avg_margin_pct"] is None and not pr["campaigns"]:
            return _insufficient(q, g, "margin or campaign data")
        return {
            "question": question, "kind": "insight", "insufficient": False,
            "insight": (f"Average product margin is {round(p['avg_margin_pct'] * 100, 1)}%; "
                        f"{pr['campaigns']} campaigns ran in the window with {_inr(pr['totals']['discount_cost'])} given away in discounts."
                        if p["avg_margin_pct"] is not None and pr["totals"] else
                        f"{pr['campaigns']} campaigns in-window with {_inr(pr['totals']['discount_cost'])} in discounts." if pr["totals"] else
                        "Margin data present but no campaigns ran in the window."),
            "evidence": [p["note"], pr["tradeoff_note"]],
            "possible_drivers": ["Deep discount depth buys orders but pays margin (measured per campaign).",
                                 f"{p['declining_after_increase']} products show declining units after price increases — observed, not proven causal."],
            "recommendation": "Rank campaigns by margin rate vs organic baseline; trim depth where margin rate collapses.",
            "kpi_to_track": ["Campaign margin rate vs organic", "Discount cost as % of campaign revenue", "Post-change unit velocity"],
            "experiment": {"hypothesis": "A shallower discount keeps most of the order lift while recovering margin.",
                           "primary_kpi": "Campaign margin rate", "guardrail": "Orders per campaign day."},
            "investigate": ["Open Inbound Intelligence → Pricing for the decliner list"],
            "confidence": _confidence(g, p["avg_margin_pct"] if p["avg_margin_pct"] is not None else (pr["totals"] or {}).get("discount_cost")),
        }

    if any(w in q for w in ("conversion", "traffic", "session", "visit", "click", "funnel")):
        # Explicitly absent source — the honest refusal, not a guess.
        return _insufficient(q, g, "traffic, sessions or conversion events — no such table exists in this dataset")

    # No mapped topic → fall through to executive framing or honest refusal.
    return _general(q, g, question)


def _insufficient(q: str, g: dict, missing: str) -> dict:
    return {
        "question": q, "kind": "insight", "insufficient": True,
        "insight": INSUFFICIENT,
        "evidence": [f"No {missing} found in the current dataset window."],
        "possible_drivers": [],
        "recommendation": "Widen the data window or connect the missing source before asking for a causal story.",
        "kpi_to_track": [], "experiment": None,
        "investigate": [], "confidence": {"level": "low", "note": INSUFFICIENT},
    }


def _general(q: str, g: dict, question: str) -> dict:
    """A grounded overview for open questions — no invented specifics."""
    d, c = g["delivery"], g["customer"]
    parts = []
    if d["late_rate_pct"] is not None:
        parts.append(f"late-delivery rate {d['late_rate_pct']}%")
    if c["cancel_rate_pct"] is not None:
        parts.append(f"cancellations {c['cancel_rate_pct']}%")
    if g["returns_90d"]["return_rate_pct"] is not None:
        parts.append(f"returns {g['returns_90d']['return_rate_pct']}% (90d)")
    if g["inventory"]["size_flagged_products"]:
        parts.append(f"{g['inventory']['size_flagged_products']} products with size-level availability risk")
    if not parts:
        return _insufficient(q, g, "signal in any tracked area")
    return {
        "question": question, "kind": "insight", "insufficient": False,
        "insight": "No specific driver matches that question; here is the measured state of the network.",
        "evidence": [f"Currently measurable: " + ", ".join(parts) + "."],
        "possible_drivers": [p["title"] for p in g["trends"]["problems"]][:3],
        "recommendation": "Rephrase toward delivery, cancellations, returns, availability, or pricing — or open the Executive Summary.",
        "kpi_to_track": [], "experiment": None, "investigate": [],
        "confidence": {"level": "medium", "note": "Overview only — the question did not map to a specific investigation."},
    }


# ---------------------------------------------------------------------------
# 2 · Recommendation validation
# ---------------------------------------------------------------------------

def validate_recommendation(db: Session, recommendation: str, days: int = 21) -> dict:
    g = _grounds(db, days)
    r = (recommendation or "").lower()
    supporting, risks, missing = [], [], list(g["absent"])

    def add_if(cond, text, list_):
        if cond:
            list_.append(text)
            return True
        return False

    if any(w in r for w in ("carrier", "rebalance carrier", "rebalanc")):
        d = g["delivery"]
        wc = d.get("worst_carrier")
        if wc:
            supporting.append(f"{wc['key']} runs {wc['late_rate_pct']}% late on {wc['delivered']} delivered orders (worst carrier).")
        else:
            missing.append("carrier-level late rates")
        if g["trends"]["problems"]:
            supporting.append(g["trends"]["problems"][0]["statement"])
        risks.append("Volume shift may exceed the stable carrier's capacity — not visible in this data (no carrier capacity table).")
        risks.append("Cost per shipment unknown; the rebalance could raise freight spend silently.")
        kpi, exp = "Late-delivery rate", {"hypothesis": "Shifting SLA-bound volume off the worst carrier cuts the network late rate.",
                                          "primary_kpi": "Late-delivery rate",
                                          "guardrail": "Cost per shipment (measure internally)"}
    elif any(w in r for w in ("size", "allocation", "pre-position", "rebalance stock", "transfer")):
        inv = g["inventory"]
        if inv["top_size_risk"]:
            supporting.append(f"Size availability risk is measured: {inv['size_flagged_products']} products, {_inr(inv['size_revenue_at_risk'])} at risk — worst: {inv['top_size_risk']['product']} ({', '.join(inv['top_size_risk']['sizes'])}).")
        else:
            missing.append("size-level availability signals")
        if g["customer"]["cancel_rate_pct"] is not None:
            supporting.append(f"Cancellation rate {g['customer']['cancel_rate_pct']}% ({_inr(g['customer']['cancelled_revenue'])} lost pre-dispatch) — the downstream cost the fix targets.")
        risks.append("Transfer lead times and inter-DC cost are not in the data — the fix's own latency is unmeasured.")
        risks.append("Demand share by size is a 30-day window; a style shift can starve a different size next month.")
        kpi, exp = "Size-driven cancellation rate", {"hypothesis": "Pre-positioning starving sizes near demand cuts cancellations.",
                                                     "primary_kpi": "Size-driven cancellation rate",
                                                     "guardrail": "Transfer + holding cost"}
    elif any(w in r for w in ("price", "discount", "promo", "margin")):
        p, pr = g["pricing"], g["promotions"]
        if p["avg_margin_pct"] is not None:
            supporting.append(f"Average margin {round(p['avg_margin_pct'] * 100, 1)}%; {p['declining_after_increase']} products declined after increases (observed, not proven).")
        if pr["totals"]:
            supporting.append(f"Campaigns gave away {_inr(pr['totals']['discount_cost'])} for {_inr(pr['totals']['revenue'])} gross revenue in-window.")
        risks.append("Seasonality overlaps campaigns — the organic baseline is an estimate, not a causal control.")
        kpi, exp = "Campaign margin rate", {"hypothesis": "Trimming discount depth keeps most volume while recovering margin.",
                                            "primary_kpi": "Campaign margin rate", "guardrail": "Orders per campaign day"}
    else:
        # Unknown recommendation: validate only against the measured state.
        supporting.append("No measured driver matches this recommendation; only the network state can be cited.")
        risks.append("Acting without a measured driver risks fixing an unrelated metric.")
        kpi, exp = "Pick the KPI the change is supposed to move", None

    sufficient = len(supporting) >= 2
    return {
        "recommendation": recommendation, "kind": "validation",
        "supporting_evidence": supporting,
        "potential_risks": risks,
        "missing_information": missing,
        "suggested_kpi": kpi,
        "suggested_experiment": exp,
        "verdict": ("Supported by the measured data — pilot before scaling."
                    if sufficient else
                    "Directionally plausible but insufficient measured support in this dataset — treat as a hypothesis."),
        "confidence": (_confidence(g, *supporting) if sufficient
                       else {"level": "low", "note": INSUFFICIENT}),
    }


# ---------------------------------------------------------------------------
# 3 · Experiment ideas for a detected problem
# ---------------------------------------------------------------------------

def experiment_ideas(db: Session, problem: str | None = None, days: int = 21) -> dict:
    g = _grounds(db, days)
    probs = {p["id"]: p for p in g["trends"]["problems"]}
    inv = g["inventory"]
    ret = g["returns_90d"]

    def _n(p_base: float, mde_pts: float) -> int:
        p = max(0.01, min(0.99, p_base))
        return max(100, int((16 * p * (1 - p) / (mde_pts / 100) ** 2 + 99) // 100 * 100))

    ideas = []
    if not problem or problem in ("delivery-late-rate",):
        if g["delivery"]["late_rate_pct"] is not None:
            base = 1 - g["delivery"]["late_rate_pct"] / 100
            ideas.append({
                "problem_id": "delivery-late-rate",
                "title": "Carrier rebalance for SLA-bound orders",
                "hypothesis": "Routing SLA-bound orders away from the worst carrier lowers the network late rate by ≥3 pts.",
                "design": "50/50 split of new SLA-bound orders: standard routing vs rebalanced routing, 4 weeks.",
                "primary_kpi": "Late-delivery rate",
                "secondary_kpis": ["Average dispatch hours", "Share routed from home DC"],
                "guardrail": "Cost per shipment (internal measure — not in dataset)",
                "sample_size_per_arm": _n(base, 3),
                "basis": f"Baseline on-time {round(base * 100, 1)}% across {g['delivery']['delivered_orders']:,} delivered orders.",
            })
    if not problem or problem in ("cancellation-rate", "size-availability"):
        if g["customer"]["cancel_rate_pct"] is not None:
            base = g["customer"]["cancel_rate_pct"] / 100
            ideas.append({
                "problem_id": "cancellation-rate",
                "title": "Size pre-positioning in demand-heavy DCs",
                "hypothesis": "Raising starving-size availability near demand cuts pre-dispatch cancellations by ≥2 pts.",
                "design": "Pre-position the flagged sizes for the top 10 exposed products; hold a matched control set, 6 weeks.",
                "primary_kpi": "Pre-dispatch cancellation rate",
                "secondary_kpis": ["Size availability index", "Cross-region routing share"],
                "guardrail": "Transfer + holding cost",
                "sample_size_per_arm": _n(base, 2),
                "basis": f"Baseline cancellation rate {g['customer']['cancel_rate_pct']}% (recent half-window).",
            })
    if not problem or problem in ("returns", "size-availability"):
        if ret["return_rate_pct"] is not None:
            base = ret["return_rate_pct"] / 100
            ideas.append({
                "problem_id": "returns",
                "title": "Size-chart completion on worst-return categories",
                "hypothesis": "Publishing size charts on exposed product pages lowers size-driven returns by ≥2 pts.",
                "design": "Add charts to half the exposed products (A/B by product), 6 weeks.",
                "primary_kpi": "Size-issue return rate",
                "secondary_kpis": ["Return rate by category"],
                "guardrail": "Conversion on treated pages",
                "sample_size_per_arm": _n(base, 2),
                "basis": f"Baseline return rate {ret['return_rate_pct']}% over 90 days.",
            })

    if problem and problem not in {i["problem_id"] for i in ideas}:
        return {"problem": problem, "kind": "experiments", "ideas": [],
                "note": INSUFFICIENT + f" No measured problem matches “{problem}” in this window.",
                "detected_problems": list(probs.keys())}
    return {"problem": problem or "all", "kind": "experiments", "ideas": ideas,
            "note": "Sample sizes: two-proportion test approximation (α=0.05, 80% power) on the measured baseline.",
            "detected_problems": list(probs.keys())}


# ---------------------------------------------------------------------------
# 4 · Executive summary
# ---------------------------------------------------------------------------

def _inr(v: float | None) -> str:
    """Compact Indian-format money: ₹X.XXL / ₹X.XCr / ₹X,XXX."""
    if v is None:
        return "—"
    if v >= 10_000_000:
        return f"₹{v / 10_000_000:.2f} Cr"
    if v >= 100_000:
        return f"₹{v / 100_000:.1f} L"
    return f"₹{v:,.0f}"


def executive_summary(db: Session, days: int = 21) -> dict:
    g = _grounds(db, days)
    d, c = g["delivery"], g["customer"]
    sentences = []

    if d["late_rate_pct"] is not None:
        prior = g["trends"]["late_rate_prior_pct"]
        move = (f" up from {prior}%" if prior is not None and prior != d["late_rate_pct"]
                else " (steady vs the prior window)" if prior is not None else "")
        sentences.append(f"Delivery: late rate is {d['late_rate_pct']}%{move} across {d['delivered_orders']:,} delivered orders.")
    if c["cancel_rate_pct"] is not None:
        sentences.append(f"Demand leaked: {c['cancel_rate_pct']}% of orders cancelled pre-dispatch (≈{_inr(c['cancelled_revenue'])}).")
    if g["inventory"]["size_flagged_products"]:
        sentences.append(f"Availability: {g['inventory']['size_flagged_products']} products carry size-level risk ({_inr(g['inventory']['size_revenue_at_risk'])} at two-week exposure).")
    if g["returns_90d"]["return_rate_pct"] is not None:
        sentences.append(f"Returns: {g['returns_90d']['return_rate_pct']}% of delivered orders (90d)"
                         + (f", led by {g['returns_90d']['top_reason']['reason']}." if g["returns_90d"]["top_reason"] else "."))
    if g["promotions"]["totals"]:
        sentences.append(f"Promotions: {_inr(g['promotions']['totals']['discount_cost'])} in discounts for {_inr(g['promotions']['totals']['revenue'])} gross.")
    if g["anomalies"]:
        sentences.append(f"Demand signal: {g['anomalies'][0]['explanation']}")

    actions = [p["recommendation"] for p in g["trends"]["problems"][:2]]
    if g["inventory"]["size_flagged_products"] and len(actions) < 2:
        actions.append("Rebalance starving sizes toward demand-heavy DCs (top exposure named in Inventory Intelligence).")

    n_problems = len(g["trends"]["problems"])
    return {
        "kind": "executive_summary",
        "window_days": g["window_days"],
        "headline": (f"Network is {'holding' if not g['trends']['problems'] else 'under pressure'}: "
                     + (f"{n_problems} detected movement{'s' if n_problems != 1 else ''} under investigation. " if n_problems else "")
                     + (f"Data quality {g['data_quality']['score']}/100 ({g['data_quality']['status']}).")),
        "summary": sentences or ["Insufficient data to summarize the network this window."],
        "actions": actions or ["No action beyond the standing order book is indicated by the current data."],
        "confidence": _confidence(g, d["late_rate_pct"] if d["late_rate_pct"] is not None else c["cancel_rate_pct"]),
        "not_measured": g["absent"],
    }


# ---------------------------------------------------------------------------
# Optional LLM polish — same packet, same rules; skipped when no key is set.
# ---------------------------------------------------------------------------

def llm_polish(answer: dict) -> dict:
    """If an LLM key is configured, rewrite ONLY the free-text fields with the
    same rule: no numbers beyond the packet. Failure falls back silently."""
    key_openai, key_ant = os.environ.get("OPENAI_API_KEY"), os.environ.get("ANTHROPIC_API_KEY")
    if not (key_openai or key_ant):
        answer["narrative_source"] = "deterministic (analytics-owned)"
        return answer
    try:
        packet = json.dumps({k: v for k, v in answer.items() if k != "confidence"}, default=str)
        system = ("You are a PM analytics editor. Rewrite 'insight', 'recommendation' and list prose "
                  "to be crisper. HARD RULE: you may not introduce any number, currency or percentage "
                  "that is not already in the packet; keep every figure verbatim; if evidence is thin, "
                  "say 'Insufficient data to confidently determine the cause.'")
        import httpx
        if key_openai:
            r = httpx.post("https://api.openai.com/v1/chat/completions",
                           headers={"Authorization": f"Bearer {key_openai}"},
                           json={"model": "gpt-4o-mini",
                                 "messages": [{"role": "system", "content": system},
                                              {"role": "user", "content": packet}], "temperature": 0.2},
                           timeout=20)
            text = r.json()["choices"][0]["message"]["content"] if r.status_code == 200 else None
        else:
            r = httpx.post("https://api.anthropic.com/v1/messages",
                           headers={"x-api-key": key_ant, "anthropic-version": "2023-06-01"},
                           json={"model": "claude-3-5-haiku-20241022", "max_tokens": 1200,
                                 "system": system, "messages": [{"role": "user", "content": packet}]},
                           timeout=20)
            text = (r.json()["content"][0]["text"] if r.status_code == 200 and r.json().get("content") else None)
        if text:
            answer["narrative_polished"] = text
            answer["narrative_source"] = "llm-polished (numbers from analytics packet)"
        else:
            answer["narrative_source"] = "deterministic (analytics-owned)"
    except Exception:
        answer["narrative_source"] = "deterministic (analytics-owned)"
    return answer
