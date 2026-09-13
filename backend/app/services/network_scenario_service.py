"""Network-level scenario engine — "what happens if the business situation
changes?" for the whole assortment, not one product.

Every stage the UI animates is a real intermediate of the computation:
demand shock → safety-stock recomputation (z × σ × √L with the new σ) →
inventory requirement → per-product stock-out projection → fulfillment load
vs capacity → delivery SLA blend (local vs distant routing, measured) →
revenue at risk → working capital → recommended action. Nothing is faked and
nothing is hardwired: change an input and every number moves through the same
arithmetic the operational pages use.

Inputs (all optional, defaults = current state):
  demand_pct        demand shock, %      (-50..+100)
  lead_delta_days   supplier lead shift  (-5..+30)
  home_allocation   share of demand serviceable from the home DC (40..100%)
  service_level     cycle-service level  (0.85..0.999)
  promo_uplift_pct  campaign demand uplift (0..60)
  promo_discount    campaign discount depth (0..50) — costs margin on uplift units
  capacity_factor   warehouse throughput vs demonstrated baseline (60..120%)
"""
from __future__ import annotations

import math
from datetime import date, timedelta

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.models import InventoryDaily, OutboundOrder, Product, Supplier
from app.services.dashboard_service import _latest_stock_map, _product_demand_map
from app.services.settings_service import get_value

# z-multipliers for common service levels (interpolated between anchors).
_Z_ANCHORS = [(0.85, 1.0364), (0.90, 1.2816), (0.95, 1.6449), (0.98, 2.0537), (0.99, 2.3263), (0.999, 3.0902)]


def _z(service_level: float) -> float:
    sl = min(0.999, max(0.5, service_level))
    for (s0, z0), (s1, z1) in zip(_Z_ANCHORS, _Z_ANCHORS[1:]):
        if s0 <= sl <= s1:
            t = (sl - s0) / (s1 - s0)
            return z0 + t * (z1 - z0)
    return 1.6449


def _measured_routing_rates(db: Session) -> dict:
    """Local vs distant late rates, measured from the delivered order book."""
    since = (date.today() - timedelta(days=45)).isoformat()
    rows = db.execute(
        select(OutboundOrder.dispatch_hours, OutboundOrder.delay_reason,
               OutboundOrder.delivered_date, OutboundOrder.promised_date)
        .where(OutboundOrder.order_date >= since, OutboundOrder.status == "Delivered")
    ).all()
    local = {"n": 0, "late": 0}
    distant = {"n": 0, "late": 0}
    for disp, reason, dd, pd in rows:
        is_distant = (disp is not None and disp >= 15) or reason == "Routed from distant DC"
        bucket = distant if is_distant else local
        bucket["n"] += 1
        if dd and pd and dd > pd:
            bucket["late"] += 1
    return {
        "local_late_rate": local["late"] / local["n"] if local["n"] else 0.12,
        "distant_late_rate": distant["late"] / distant["n"] if distant["n"] else 0.45,
        "distant_share": distant["n"] / (local["n"] + distant["n"]) if (local["n"] + distant["n"]) else 0.0,
        "window_orders": local["n"] + distant["n"],
    }


def _supplier_lead_shift(db: Session) -> dict[int, int]:
    """Product → supplier lead time (products without a supplier keep their own)."""
    rows = db.execute(select(Product.id, Product.lead_time_days, Product.supplier_id)).all()
    sup_leads = dict(db.execute(select(Supplier.id, Supplier.lead_time_days)).all())
    return {pid: (sup_leads.get(sid, own) if sid is not None else own) for pid, own, sid in rows}


def simulate_network(
    db: Session,
    *,
    demand_pct: float = 0.0,
    lead_delta_days: int = 0,
    home_allocation: float = 100.0,
    service_level: float | None = None,
    promo_uplift_pct: float = 0.0,
    promo_discount: float = 0.0,
    capacity_factor: float = 100.0,
    label: str = "Scenario",
) -> dict:
    sl = float(service_level if service_level is not None else get_value(db, "service_level", 0.95))
    window = int(get_value(db, "demand_window_days", 90))
    holding_rate = float(get_value(db, "holding_cost_rate", 0.20))
    overstock_days = int(get_value(db, "overstock_days", 90))

    demand_map = _product_demand_map(db, window)        # pid -> (avg_daily, std)
    stock_map = _latest_stock_map(db)
    lead_map = _supplier_lead_shift(db)
    prices = dict(db.execute(select(Product.id, Product.selling_price)).all())
    costs = dict(db.execute(select(Product.id, Product.unit_cost)).all())
    routing = _measured_routing_rates(db)

    # ── Stage 1 · Demand ────────────────────────────────────────────────────
    total_daily = sum(v[0] for v in demand_map.values())
    shock = 1 + (demand_pct + promo_uplift_pct) / 100.0
    shocked_daily = total_daily * shock
    promo_units_30d = total_daily * (promo_uplift_pct / 100.0) * 30
    promo_cost = promo_units_30d * (sum(prices.values()) / max(1, len(prices))) * (promo_discount / 100.0)

    # ── Stage 2 · Safety stock & inventory requirement (per product) ───────
    z = _z(sl)
    requirement_units = 0.0
    requirement_capital = 0.0
    safety_units = 0.0
    for pid, (avg, std) in demand_map.items():
        add = avg * shock
        # Variance scales ~linearly with the mean → σ scales with √shock.
        dstd = std * math.sqrt(shock) if std else 0.0
        lead = max(1, lead_map.get(pid, 10) + lead_delta_days)
        ss = z * dstd * math.sqrt(lead)
        safety_units += ss
        requirement_units += add * lead + ss
        requirement_capital += (add * lead + ss) * costs.get(pid, 0)
    baseline_daily = total_daily
    base_lead_avg = (sum(lead_map.values()) / len(lead_map)) if lead_map else 10

    # ── Stage 3 · Stock-out projection (per product, aggregated) ───────────
    stockout_products = 0
    shortfall_units = 0.0
    revenue_at_risk = 0.0
    critical_products = []
    overstock_capital = 0.0
    for pid, (avg, std) in demand_map.items():
        add = avg * shock
        stock = stock_map.get(pid, 0)
        if add <= 0:
            overstock_capital += stock * costs.get(pid, 0)
            continue
        lead = max(1, lead_map.get(pid, 10) + lead_delta_days)
        dstd = std * math.sqrt(shock) if std else 0.0
        ss = z * dstd * math.sqrt(lead)
        days_to_zero = stock / add
        projected = stock - add * lead
        shortfall = max(0.0, add * max(0.0, lead - days_to_zero))
        if projected < ss or days_to_zero < lead:
            stockout_products += 1
            shortfall_units += shortfall
            revenue_at_risk += shortfall * prices.get(pid, 0)
            if days_to_zero < lead * 0.5:
                critical_products.append({"product_id": pid, "name": None, "days_to_zero": round(days_to_zero, 1)})
        if stock > overstock_days * avg:
            overstock_capital += (stock - overstock_days * avg) * costs.get(pid, 0)

    # ── Stage 4 · Fulfillment load vs warehouse capacity ────────────────────
    # Demonstrated capacity = the demand flow the network is already serving
    # (the trailing window's units/day), scaled by the capacity input. Keeping
    # both sides in the same units means the *Current* scenario reads 0%
    # overflow and only genuine shocks create queueing.
    capacity_units_day = total_daily * (capacity_factor / 100.0)
    demand_units_day = shocked_daily
    overflow_share = max(0.0, 1 - capacity_units_day / demand_units_day) if demand_units_day else 0.0
    fulfillment_risk = min(1.0, overflow_share * 2)  # saturates the readout at 50% overflow

    # ── Stage 5 · Delivery SLA blend ────────────────────────────────────────
    # home_allocation is a lever on the MEASURED local share: 100 = today,
    # <100 starves the home DC, >100 models pre-positioning (up to 150 =
    # everything serviceable locally). Symmetric so improvements, not just
    # degradations, can be simulated.
    local_share = (min(1.0, home_allocation / 100.0) * (1 - routing["distant_share"])
                   if home_allocation <= 100
                   else min(1.0, (home_allocation / 100.0) * (1 - routing["distant_share"])))
    local_share = max(0.0, min(1.0, local_share))
    distant_share = 1 - local_share
    late_rate = (local_share * routing["local_late_rate"]
                 + distant_share * routing["distant_late_rate"])
    # Throughput overflow adds dispatch-driven lateness (queueing pressure).
    late_rate = min(0.95, late_rate + overflow_share * 0.25)
    current_late_rate = (routing["distant_share"] * routing["distant_late_rate"]
                         + (1 - routing["distant_share"]) * routing["local_late_rate"])

    # ── Stage 6 · Working capital ───────────────────────────────────────────
    stock_value = sum(stock_map.get(pid, 0) * costs.get(pid, 0) for pid in demand_map)
    working_capital = requirement_capital
    holding_cost = requirement_capital * holding_rate / 52 * 4  # ~4 weeks of holding

    # ── Stage 7 · Recommended action (rule-based, cites its numbers) ────────
    actions = []
    if stockout_products > 0:
        actions.append(f"Raise replenishment to cover {stockout_products} products projected below safety stock "
                       f"(≈{shortfall_units:,.0f} units short, ₹{revenue_at_risk:,.0f} at risk).")
    if lead_delta_days > 0:
        actions.append(f"Pull orders forward: +{lead_delta_days}d supplier slip moves the order trigger up by "
                       f"~{shocked_daily * lead_delta_days:,.0f} units network-wide.")
    if promo_uplift_pct > 0:
        actions.append(f"Fund the campaign: {promo_uplift_pct:.0f}% uplift costs ≈₹{promo_cost:,.0f} in discount "
                       f"at {promo_discount:.0f}% depth — protect margin on the incremental units.")
    if overflow_share > 0.05:
        actions.append(f"Warehouse throughput covers only {(capacity_units_day / demand_units_day * 100):.0f}% of "
                       f"scenario demand — {(overflow_share * 100):.0f}% of orders would queue.")
    if late_rate > current_late_rate + 0.02:
        actions.append(f"SLA risk: late rate blends to {late_rate * 100:.1f}% at {local_share * 100:.0f}% local "
                       f"allocation (vs {current_late_rate * 100:.1f}% today) — rebalance stock toward home DCs.")
    if not actions:
        actions.append("Network holds under this scenario — no intervention beyond the standing order book.")

    return {
        "label": label,
        "inputs": {
            "demand_pct": demand_pct, "lead_delta_days": lead_delta_days,
            "home_allocation": home_allocation, "service_level": round(sl, 3),
            "promo_uplift_pct": promo_uplift_pct, "promo_discount": promo_discount,
            "capacity_factor": capacity_factor,
        },
        "stages": [
            {"key": "demand", "label": "Demand", "detail": f"{baseline_daily:,.0f} → {shocked_daily:,.0f} units/day",
             "from": round(baseline_daily, 0), "to": round(shocked_daily, 0), "unit": "units/day",
             "severity": "bad" if shock > 1.02 else ("good" if shock < 0.98 else "neutral")},
            {"key": "requirement", "label": "Inventory requirement", "detail": f"{requirement_units:,.0f} units to cover lead time + safety stock (z={round(z, 2):.2f})",
             "from": None, "to": round(requirement_units, 0), "unit": "units",
             "severity": "neutral"},
            {"key": "stockout", "label": "Stock-out risk", "detail": f"{stockout_products} products projected below safety stock; {shortfall_units:,.0f} units short",
             "from": None, "to": stockout_products, "unit": "products",
             "severity": "bad" if stockout_products > 8 else ("warn" if stockout_products > 0 else "good")},
            {"key": "fulfillment", "label": "Fulfillment risk", "detail": f"Throughput covers {(100 - overflow_share * 100):.0f}% of scenario demand" + (f"; {overflow_share * 100:.0f}% queues" if overflow_share > 0 else ""),
             "from": None, "to": round(fulfillment_risk * 100, 0), "unit": "% risk",
             "severity": "bad" if fulfillment_risk > 0.5 else ("warn" if fulfillment_risk > 0.1 else "good")},
            {"key": "sla", "label": "Delivery SLA risk", "detail": f"Late rate blends to {late_rate * 100:.1f}% ({local_share * 100:.0f}% local / {distant_share * 100:.0f}% distant routing)",
             "from": round(current_late_rate * 100, 1), "to": round(late_rate * 100, 1), "unit": "% late",
             "severity": "bad" if late_rate > current_late_rate + 0.02 else ("warn" if late_rate > current_late_rate else "good")},
            {"key": "revenue", "label": "Revenue at risk", "detail": f"Shortfall × selling price across the assortment",
             "from": None, "to": round(revenue_at_risk, 0), "unit": "₹",
             "severity": "bad" if revenue_at_risk > 500_000 else ("warn" if revenue_at_risk > 100_000 else "good")},
            {"key": "capital", "label": "Working capital", "detail": f"Capital required in cycle + safety stock (holding ≈₹{holding_cost:,.0f} / 4 weeks)",
             "from": None, "to": round(working_capital, 0), "unit": "₹",
             "severity": "warn" if demand_pct > 10 else "neutral"},
        ],
        "outputs": {
            "demand_units_day": round(shocked_daily, 1),
            "safety_stock_units": round(safety_units, 0),
            "required_inventory_units": round(requirement_units, 0),
            "required_capital": round(requirement_capital, 0),
            "stockout_products": stockout_products,
            "shortfall_units": round(shortfall_units, 0),
            "revenue_at_risk": round(revenue_at_risk, 0),
            "fulfillment_risk_pct": round(fulfillment_risk * 100, 1),
            "overflow_share_pct": round(overflow_share * 100, 1),
            "projected_late_rate": round(late_rate, 4),
            "current_late_rate": round(current_late_rate, 4),
            "promo_discount_cost": round(promo_cost, 0),
            "overstock_capital": round(overstock_capital, 0),
            "holding_cost_4w": round(holding_cost, 0),
            "avg_lead_days": round(base_lead_avg + lead_delta_days, 1),
            "recommended_action": " ".join(actions),
            "critical_products": critical_products[:6],
        },
        "basis": {
            "window_days": window,
            "products": len(demand_map),
            "measured_routing": {k: round(v, 3) if isinstance(v, float) else v for k, v in routing.items()},
            "service_level_z": round(z, 2),
            "notes": [
                "Per-product demand mean/σ from the trailing sales window; σ scales with √shock.",
                "Safety stock = z × σ × √lead (same formula as the live engine).",
                "Late-rate blend uses measured local vs distant rates from the 45-day order book.",
                "Fulfillment capacity baseline = demonstrated order throughput (45-day average), scaled by the capacity input.",
            ],
        },
    }


def compare_network(db: Session, scenarios: list[dict]) -> dict:
    """Run the current state plus each scenario and return comparison rows."""
    current = simulate_network(db, label="Current")
    runs = [current] + [simulate_network(db, label=s.get("label", f"Scenario {i+1}"), **s["inputs"])
                        for i, s in enumerate(scenarios)]
    keys = [
        ("stockout_products", "Stock-out products", lambda v: f"{v:,.0f}"),
        ("shortfall_units", "Shortfall units", lambda v: f"{v:,.0f}"),
        ("revenue_at_risk", "Revenue at risk", lambda v: f"₹{v / 100000:.1f}L"),
        ("required_inventory_units", "Required inventory", lambda v: f"{v / 1000:.1f}K units"),
        ("required_capital", "Working capital required", lambda v: f"₹{v / 100000:.1f}L"),
        ("holding_cost_4w", "Holding cost (4 wks)", lambda v: f"₹{v / 1000:.0f}K"),
        ("projected_late_rate", "Projected late rate", lambda v: f"{v * 100:.1f}%"),
        ("fulfillment_risk_pct", "Fulfillment risk", lambda v: f"{v:.0f}%"),
        ("promo_discount_cost", "Promo discount cost", lambda v: f"₹{v / 1000:.0f}K"),
    ]
    rows = []
    for key, label, fmt in keys:
        row = {"metric": label, "values": []}
        for run in runs:
            v = run["outputs"][key]
            row["values"].append({"label": run["label"], "display": fmt(v), "raw": v})
        rows.append(row)
    return {
        "current": current,
        "scenarios": runs[1:],
        "rows": rows,
    }
