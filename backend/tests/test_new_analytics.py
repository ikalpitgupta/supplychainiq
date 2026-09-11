"""Tests for the new analytics layer: impact math, health score, risk tiers."""
import math

import pytest

from app.analytics.health_score import health_score
from app.analytics.impact import (business_impact, excess_inventory_value,
                                  excess_units, potential_savings, revenue_at_risk)
from app.analytics.inventory import risk_tier


class TestRevenueAtRisk:
    def test_hand_computed_example(self):
        # 20/day demand, 10-day lead, stock runs out in 6 days:
        # shortfall = 20 * (10-6) = 80 units; 80 * ₹250 = ₹20,000
        rows = [{"avg_daily_demand": 20, "lead_time_days": 10,
                 "days_to_zero": 6.0, "selling_price": 250}]
        assert revenue_at_risk(rows) == pytest.approx(20_000)

    def test_zero_when_replenishment_covers_demand(self):
        rows = [{"avg_daily_demand": 20, "lead_time_days": 10,
                 "days_to_zero": 12.0, "selling_price": 250}]
        assert revenue_at_risk(rows) == 0.0

    def test_zero_demand_contributes_nothing(self):
        rows = [{"avg_daily_demand": 0, "lead_time_days": 10,
                 "days_to_zero": None, "selling_price": 250}]
        assert revenue_at_risk(rows) == 0.0

    def test_sums_across_products(self):
        rows = [
            {"avg_daily_demand": 10, "lead_time_days": 10, "days_to_zero": 5.0, "selling_price": 100},  # 50*100
            {"avg_daily_demand": 20, "lead_time_days": 10, "days_to_zero": 8.0, "selling_price": 50},   # 40*50
        ]
        assert revenue_at_risk(rows) == pytest.approx(5_000 + 2_000)


class TestExcessInventory:
    def test_hand_computed_example(self):
        # 1200 units on hand, 5/day demand, 90-day policy:
        # excess = 1200 - 450 = 750 units * ₹40 = ₹30,000
        rows = [{"current_stock": 1200, "avg_daily_demand": 5,
                 "overstock_days": 90, "unit_cost": 40}]
        assert excess_inventory_value(rows) == pytest.approx(30_000)

    def test_zero_demand_counts_all_stock(self):
        rows = [{"current_stock": 300, "avg_daily_demand": 0,
                 "overstock_days": 90, "unit_cost": 10}]
        assert excess_inventory_value(rows) == pytest.approx(3_000)
        assert excess_units(300, 0, 90) == 300

    def test_within_policy_is_zero(self):
        rows = [{"current_stock": 100, "avg_daily_demand": 5,
                 "overstock_days": 90, "unit_cost": 40}]
        assert excess_inventory_value(rows) == 0.0


class TestPotentialSavings:
    def test_holding_rate_translation(self):
        # ₹12,000 excess * 20% annual holding = ₹2,400
        assert potential_savings(12_000, 0.20) == pytest.approx(2_400)

    def test_never_negative(self):
        assert potential_savings(-100, 0.2) == 0.0


class TestBusinessImpact:
    def test_bundle_and_hotspot(self):
        rows = [
            {"product_id": 1, "category": "Electronics", "current_stock": 100,
             "avg_daily_demand": 20, "lead_time_days": 10, "days_to_zero": 4.0,
             "selling_price": 500, "unit_cost": 300, "overstock_days": 90},
            {"product_id": 2, "category": "Grocery", "current_stock": 5000,
             "avg_daily_demand": 10, "lead_time_days": 5, "days_to_zero": 500.0,
             "selling_price": 30, "unit_cost": 20, "overstock_days": 90},
        ]
        out = business_impact(rows, holding_cost_rate=0.2)
        # Product 1: shortfall = 20*(10-4) = 120 units * 500 = 60,000
        assert out["revenue_at_risk"] == pytest.approx(60_000)
        # Product 2: excess = 5000 - 900 = 4100 units * 20 = 82,000
        assert out["excess_inventory_value"] == pytest.approx(82_000)
        assert out["potential_savings"] == pytest.approx(16_400)
        assert out["top_risk_category"] == "Electronics"
        assert out["top_excess_category"] == "Grocery"
        assert "estimate" in out["basis"]["revenue_at_risk"].lower()


class TestHealthScore:
    def test_perfect_score(self):
        res = health_score(
            status_counts={"Healthy": 10, "Low Stock": 0, "Critical": 0, "Overstock": 0},
            risk_tier_counts={"LOW": 10, "MEDIUM": 0, "HIGH": 0, "CRITICAL": 0},
            mean_supplier_score=100.0, forecast_mape=0.0, on_time_pct=100.0,
        )
        assert res.total == pytest.approx(100.0)
        assert res.grade == "Excellent"

    def test_mixed_dataset(self):
        res = health_score(
            status_counts={"Healthy": 6, "Low Stock": 2, "Critical": 1, "Overstock": 1},
            risk_tier_counts={"LOW": 6, "MEDIUM": 2, "HIGH": 1, "CRITICAL": 1},
            mean_supplier_score=80.0, forecast_mape=10.0, on_time_pct=90.0,
        )
        # hand-computed: inventory 60*.25 + stockout 80*.25 + suppliers 80*.2
        # + forecasting 90*.15 + overstock 90*.10 + procurement 90*.05
        expected = 60 * .25 + 80 * .25 + 80 * .2 + 90 * .15 + 90 * .10 + 90 * .05
        assert res.total == pytest.approx(round(expected, 1))
        # every component carries its inputs for the "why" UI
        assert res.components["suppliers"]["detail"]
        assert res.components["forecasting"]["detail"].startswith("backtest MAPE 10.0%")

    def test_missing_data_is_neutral_not_zero(self):
        res = health_score(
            status_counts={"Healthy": 1, "Low Stock": 0, "Critical": 0, "Overstock": 0},
            risk_tier_counts={"LOW": 1, "MEDIUM": 0, "HIGH": 0, "CRITICAL": 0},
            mean_supplier_score=None, forecast_mape=None, on_time_pct=None,
        )
        assert res.components["suppliers"]["score"] == 70.0
        assert "neutral" in res.components["forecasting"]["detail"]

    def test_weights_sum_to_one(self):
        from app.analytics.health_score import WEIGHTS
        assert pytest.approx(sum(WEIGHTS.values())) == 1.0


class TestRiskTier:
    def test_critical_stockout_before_replenishment(self):
        # 120 units, 20/day -> out in 6 days; lead time 10 -> CRITICAL
        tier = risk_tier(days_to_zero=6.0, projected_at_lead_time=120 - 200,
                         safety=100, rop=300)
        assert tier == "CRITICAL"

    def test_high_dips_below_safety_before_arrival(self):
        # stock lasts 15 days, lead 10 -> arrives with 50 left, safety 100
        assert risk_tier(15.0, 150 - 100, safety=100, rop=300) == "HIGH"

    def test_medium_between_safety_and_rop(self):
        # arrives with 150 units: above safety (100) but below ROP (300)
        assert risk_tier(40.0, 150.0, safety=100, rop=300) == "MEDIUM"

    def test_low_at_or_above_rop(self):
        assert risk_tier(60.0, 600 - 100, safety=100, rop=300) == "LOW"

    def test_zero_demand_is_low(self):
        assert risk_tier(None, 120, safety=0, rop=0) == "LOW"


class TestDataQualityEndpoint:
    def test_report_shape_and_score(self, client):
        res = client.get("/api/data-quality")
        assert res.status_code == 200
        body = res.json()
        assert 0 <= body["score"] <= 100
        names = {c["name"] for c in body["checks"]}
        assert "Inventory ledger consistency" in names
        assert "Negative inventory" in names
        assert "Duplicate PO numbers" in names
        assert "Products without supplier" in names

    def test_clean_fixture_ledger_perfect(self, client):
        body = client.get("/api/data-quality").json()
        ledger = next(c for c in body["checks"] if c["name"] == "Inventory ledger consistency")
        assert ledger["issue_count"] == 0


class TestRecommendationExplainability:
    def test_every_recommendation_carries_why_impact_and_tier(self, client, auth_headers):
        body = client.get("/api/recommendations", headers=auth_headers).json()
        for item in body["items"]:
            assert item["risk_tier"] in {"LOW", "MEDIUM", "HIGH", "CRITICAL"}
            steps = item["why"]["steps"]
            labels = {s["label"] for s in steps}
            assert {"Current stock", "Reorder point (demand×LT + safety)",
                    "Days until stock-out"} <= labels
            assert item["why"]["verdict"]
            assert "→" in item["impact"]["risk_movement"]

    def test_dashboard_carries_impact_and_health_score(self, client, auth_headers):
        body = client.get("/api/dashboard", headers=auth_headers).json()
        bi = body["business_impact"]
        assert bi["revenue_at_risk"] >= 0 and bi["excess_inventory_value"] >= 0
        assert "estimate" in bi["basis"]["revenue_at_risk"].lower()
        assert 0 <= body["health_score"]["total"] <= 100
        assert set(body["health_score"]["components"]) == {
            "inventory", "stockout", "suppliers", "forecasting", "overstock", "procurement"}
        assert body["risk_tier_counts"] == {
            k: body["risk_tier_counts"].get(k, 0)
            for k in ("LOW", "MEDIUM", "HIGH", "CRITICAL")}
        assert isinstance(body["insights"], list) and body["insights"]
        assert all("text" in i for i in body["insights"])

    def test_product_detail_carries_decision_packet(self, client, auth_headers):
        body = client.get("/api/products/1", headers=auth_headers).json()
        assert body["risk_tier"] in {"LOW", "MEDIUM", "HIGH", "CRITICAL"}
        assert body["decision"]["action"] in {"NO ACTION", "MONITOR", "REORDER SOON",
                                               "ORDER NOW", "REDUCE FUTURE ORDERS", "REVIEW SUPPLIER"}
        assert body["timeline"]["lead_time_days"] > 0
        assert "stockout_day" in body["timeline"]
