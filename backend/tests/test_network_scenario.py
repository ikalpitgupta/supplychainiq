"""Network scenario engine tests — real-math guarantees, not just shape.

The engine must behave like arithmetic, not a look-up table:
  - Current (all-default) scenario must be calm: no overflow, SLA unchanged.
  - Demand +X must monotonically raise shortfall/revenue-at-risk.
  - Lead-time slip must extend the average lead time and the order trigger.
  - Promo discount cost must be positive when an uplift + depth are set.
  - The compare endpoint returns Current plus every requested scenario.
"""
from __future__ import annotations


def _get(client, path):
    r = client.get(path)
    assert r.status_code == 200, f"{path} -> {r.status_code}: {r.text[:300]}"
    return r.json()


def test_current_scenario_is_calm(client):
    d = _get(client, "/api/scenarios/network?label=Current")
    assert d["outputs"]["fulfillment_risk_pct"] == 0.0, "no overflow at baseline"
    assert d["outputs"]["current_late_rate"] == d["outputs"]["projected_late_rate"], \
        "SLA must not move when no input changes"
    assert d["outputs"]["stockout_products"] >= 0
    assert d["stages"] and d["stages"][0]["key"] == "demand"


def test_stage_chain_shape(client):
    d = _get(client, "/api/scenarios/network?demand_pct=20")
    keys = [s["key"] for s in d["stages"]]
    assert keys == ["demand", "requirement", "stockout", "fulfillment", "sla",
                    "revenue", "capital"]
    for s in d["stages"]:
        assert s["detail"], "each stage needs a human-readable detail line"
        assert s["severity"] in {"good", "warn", "bad", "neutral"}
    assert d["outputs"]["recommended_action"], "action must always be present"
    assert d["basis"]["products"] > 0 and d["basis"]["service_level_z"] > 0


def test_demand_shock_monotone(client):
    lo = _get(client, "/api/scenarios/network?demand_pct=10")["outputs"]
    hi = _get(client, "/api/scenarios/network?demand_pct=40")["outputs"]
    assert hi["revenue_at_risk"] >= lo["revenue_at_risk"], "higher demand cannot lower revenue risk"
    assert hi["required_inventory_units"] > lo["required_inventory_units"]
    assert hi["demand_units_day"] > lo["demand_units_day"]


def test_lead_slip_extends_trigger(client):
    base = _get(client, "/api/scenarios/network")["outputs"]
    slipped = _get(client, "/api/scenarios/network?lead_delta_days=7")["outputs"]
    assert slipped["avg_lead_days"] == base["avg_lead_days"] + 7
    assert slipped["required_inventory_units"] > base["required_inventory_units"], \
        "longer lead time must raise the inventory requirement"


def test_service_level_raises_safety_stock(client):
    low = _get(client, "/api/scenarios/network?service_level=0.90")["outputs"]
    high = _get(client, "/api/scenarios/network?service_level=0.99")["outputs"]
    assert high["safety_stock_units"] > low["safety_stock_units"], \
        "higher z must buy more safety stock"
    assert high["required_capital"] > low["required_capital"]


def test_promo_costs_are_measured(client):
    d = _get(client, "/api/scenarios/network?promo_uplift_pct=25&promo_discount=40")
    o = d["outputs"]
    assert o["promo_discount_cost"] > 0, "an uplift with depth must cost discount money"
    assert o["demand_units_day"] > _get(client, "/api/scenarios/network")["outputs"]["demand_units_day"]


def test_capacity_and_allocation_create_risk(client):
    tight = _get(client, "/api/scenarios/network?home_allocation=50&capacity_factor=70")["outputs"]
    assert tight["fulfillment_risk_pct"] > 0, "starved capacity must show queueing"
    assert tight["overflow_share_pct"] > 0


def test_compare_endpoint(client):
    d = _get(client, "/api/scenarios/network/compare"
                     "?a_demand_pct=20&a_lead_delta_days=5"
                     "&b_demand_pct=-15&b_home_allocation=70")
    assert {s["label"] for s in d["scenarios"]} == {"A", "B"}
    assert d["current"]["label"] == "Current"
    assert d["rows"], "comparison rows must exist"
    for row in d["rows"]:
        assert "metric" in row and len(row["values"]) == 3, row
        for cell in row["values"]:
            assert "label" in cell and "display" in cell and "raw" in cell, cell
