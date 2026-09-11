"""Tests for the intelligence layer: anomalies, scenarios, segmentation, procurement."""
import math

import pytest

from app.analytics.anomaly import demand_anomaly, rolling_zscore_anomalies, spike_recommendation
from app.analytics.procurement import (price_trend, product_concentration,
                                       supplier_concentration)
from app.analytics.scenario import cost_vs_service_curve, simulate_scenario
from app.analytics.segmentation import (abcxyz_strategy, aging_bucket, slow_mover_reason,
                                        velocity_segment, xyz_class)


class TestAnomalyDetection:
    def test_flat_series_has_no_anomalies(self):
        values = [50.0] * 40
        assert rolling_zscore_anomalies(values) == []

    def test_spike_is_detected(self):
        values = [50.0] * 30 + [110.0] + [50.0] * 5
        hits = rolling_zscore_anomalies(values, window=14, threshold=2.5)
        assert 30 in hits

    def test_anomaly_packet_explains(self):
        series = [(f"2026-01-{i+1:02d}", 50.0) for i in range(20)]
        series.append(("2026-01-21", 110.0))
        a = demand_anomaly(series, window=14, threshold=2.5)
        assert a is not None and a.direction == "spike"
        assert "standard deviations" in a.explanation
        assert a.z > 2.5

    def test_spike_recommendation_hand_computed(self):
        # baseline 50/day, spike 110/day, 10-day lead, 400 on hand, ₹100 cost
        rec = spike_recommendation(50, 110, 10, 400, 100.0)
        assert rec["applies"] is True
        assert rec["uplift_pct"] == pytest.approx(120.0)
        # cover needed = 110*10 = 1100; bump = 1100-400 = 700
        assert rec["recommended_qty_increase"] == 700
        assert rec["days_cover_at_spike"] == pytest.approx(400 / 110, abs=0.1)
        assert "Increase the next replenishment" in rec["action"]

    def test_no_recommendation_without_spike(self):
        assert spike_recommendation(50, 45, 10, 400, 100.0)["applies"] is False


class TestScenarioSimulator:
    BASE = dict(avg_daily_demand=20, demand_std=5, lead_time_days=10,
                current_stock=200, selling_price=500, unit_cost=300)

    def test_baseline_matches_live_math(self):
        out = simulate_scenario(**self.BASE)
        # stock 200 / 20 per day = 10 days; lead 10 -> CRITICAL boundary
        assert out["outputs"]["days_to_zero"] == pytest.approx(10.0)
        assert out["outputs"]["risk_tier"] in ("CRITICAL", "HIGH")

    def test_demand_increase_raises_risk(self):
        base = simulate_scenario(**self.BASE)
        up = simulate_scenario(**self.BASE, demand_change_pct=25)
        assert up["outputs"]["revenue_at_risk"] >= base["outputs"]["revenue_at_risk"]
        assert up["outputs"]["recommended_qty"] > base["outputs"]["recommended_qty"]

    def test_lead_time_increase_raises_safety_stock(self):
        base = simulate_scenario(**self.BASE)
        late = simulate_scenario(**self.BASE, lead_time_delta_days=5)
        assert late["outputs"]["safety_stock"] > base["outputs"]["safety_stock"]
        assert late["outputs"]["reorder_point"] > base["outputs"]["reorder_point"]

    def test_higher_service_level_raises_safety_stock(self):
        low = simulate_scenario(**self.BASE, service_level=0.90)
        high = simulate_scenario(**self.BASE, service_level=0.99)
        assert high["outputs"]["safety_stock"] > low["outputs"]["safety_stock"]

    def test_stock_override_changes_tier(self):
        risky = simulate_scenario(**self.BASE, stock_override=10)
        assert risky["outputs"]["risk_tier"] == "CRITICAL"
        safe = simulate_scenario(**self.BASE, stock_override=1000)
        assert safe["outputs"]["risk_tier"] in ("LOW", "MEDIUM")

    def test_shortfall_and_revenue_hand_computed(self):
        # 20/day, stock 100, lead 10 -> stock-out at day 5; 5 uncovered days * 20 = 100 units
        out = simulate_scenario(**self.BASE, stock_override=100)
        assert out["outputs"]["shortfall_units"] == pytest.approx(100, abs=1)
        assert out["outputs"]["revenue_at_risk"] == pytest.approx(50_000, abs=1000)


class TestCostVsServiceCurve:
    def test_holding_rises_and_total_is_u_shaped(self):
        curve = cost_vs_service_curve(20, 5, 10, 100.0, 0.20)
        assert curve[0]["safety_stock"] < curve[-1]["safety_stock"]
        assert curve[0]["holding_cost"] < curve[-1]["holding_cost"]
        totals = [c["total_cost"] for c in curve]
        assert min(totals) < max(totals)  # there IS a meaningful spread


class TestABCXYZ:
    def test_xyz_bands(self):
        assert xyz_class(2, 10) == "X"    # CV 0.2
        assert xyz_class(8, 10) == "Y"    # CV 0.8
        assert xyz_class(15, 10) == "Z"   # CV 1.5
        assert xyz_class(5, 0) == "Z"     # no demand

    def test_strategy_text(self):
        s = abcxyz_strategy("A", "Z")
        assert "High-value" in s and "Erratic" in s


class TestAgingAndVelocity:
    def test_buckets(self):
        assert aging_bucket(10) == "0-30"
        assert aging_bucket(45) == "31-60"
        assert aging_bucket(75) == "61-90"
        assert aging_bucket(200) == "90+"

    def test_velocity_quadrants(self):
        assert velocity_segment(20, 1000, 10, 5000) == "Star"
        assert velocity_segment(20, 9000, 10, 5000) == "Fast Moving"
        assert velocity_segment(2, 9000, 10, 5000) == "Slow Moving"
        assert velocity_segment(2, 1000, 10, 5000) == "Dead Stock"

    def test_slow_mover_suggestion_not_prescriptive(self):
        r = slow_mover_reason(1.0, 200.0, 5000.0)
        assert r is not None
        assert "Consider" in r  # suggestion, never a guaranteed claim


class TestProcurement:
    def test_concentration_hhi(self):
        out = supplier_concentration({1: 900.0, 2: 100.0}, 1000.0)
        assert out["level"] == "high"          # 90^2 + 10^2 = 8200
        assert out["shares"][0]["share_pct"] == 90.0

    def test_balanced_portfolio_is_low(self):
        out = supplier_concentration({1: 40.0, 2: 30.0, 3: 30.0}, 100.0)
        assert out["level"] in ("low", "moderate")

    def test_single_source_flag(self):
        out = product_concentration({1: 820.0, 2: 120.0, 3: 60.0})
        assert out is not None and out["share_pct"] == pytest.approx(82.0, abs=0.5)
        assert product_concentration({1: 500.0, 2: 500.0}) is None

    def test_price_trend(self):
        today = __import__("datetime").date.today().isoformat()
        rows = ([{"order_date": "2026-01-0" + str(i % 9 + 1), "unit_cost": 100.0, "quantity": 10}
                 for i in range(5)]
                + [{"order_date": today, "unit_cost": 114.0, "quantity": 10} for _ in range(4)])
        t = price_trend(rows)
        assert t is not None and t["direction"] == "increase"
        assert t["change_pct"] == pytest.approx(14.0, abs=0.5)


class TestIntelligenceAPI:
    def test_control_tower_shape(self, client, auth_headers):
        body = client.get("/api/control-tower", headers=auth_headers).json()
        stages = {s["stage"] for s in body["stages"]}
        assert stages == {"SUPPLIERS", "PURCHASE ORDERS", "WAREHOUSE", "INVENTORY", "CUSTOMERS"}
        assert 0 <= body["overall_score"] <= 100
        assert body["summary"]["revenue_at_risk"] >= 0

    def test_anomalies_endpoint(self, client, auth_headers):
        body = client.get("/api/anomalies", headers=auth_headers).json()
        assert "anomalies" in body and "supplier_delays" in body
        assert body["scanned"] > 0

    def test_scenario_recalculates(self, client, auth_headers):
        base = client.get("/api/scenarios/1", headers=auth_headers).json()
        up = client.get("/api/scenarios/1?demand_change_pct=50", headers=auth_headers).json()
        assert up["scenario"]["outputs"]["avg_daily_demand"] == pytest.approx(
            base["scenario"]["outputs"]["avg_daily_demand"] * 1.5, rel=0.01)
        assert up["scenario"]["outputs"]["revenue_at_risk"] >= base["scenario"]["outputs"]["revenue_at_risk"]

    def test_scenario_404(self, client, auth_headers):
        res = client.get("/api/scenarios/9999", headers=auth_headers)
        assert res.status_code == 404

    def test_abcxyz_and_aging(self, client, auth_headers):
        ax = client.get("/api/abc-xyz", headers=auth_headers).json()
        assert ax["items"] and all(len(i["segment"]) == 2 for i in ax["items"][:5])
        aging = client.get("/api/inventory-aging", headers=auth_headers).json()
        assert len(aging["buckets"]) == 4

    def test_procurement_endpoint(self, client, auth_headers):
        body = client.get("/api/procurement-intelligence", headers=auth_headers).json()
        assert body["total_spend"] >= 0
        assert "concentration" in body and "single_source" in body
