"""Business-logic tests: the formulas the whole product rests on."""
import math

import pytest

from app.analytics.abc import abc_classify, abc_summary
from app.analytics.eoq import eoq, recommended_order_qty
from app.analytics.forecasting import forecast_series
from app.analytics.inventory import (classify_status, days_of_inventory, days_until_reorder,
                                     reorder_point, safety_stock, stockout_risk, z_for_service_level)
from app.analytics.supplier_score import score_suppliers, supplier_risk_level


class TestSafetyStock:
    def test_formula_at_95(self):
        # Z=1.65, sigma=10, LT=9 -> 1.65*10*3 = 49.5
        assert safety_stock(10, 9, 0.95) == pytest.approx(49.5)

    def test_scales_with_sqrt_lead_time(self):
        lt4 = safety_stock(10, 4, 0.95)
        lt16 = safety_stock(10, 16, 0.95)
        assert lt16 == pytest.approx(lt4 * 2)  # sqrt(16)/sqrt(4) = 2

    def test_zero_std_is_zero(self):
        assert safety_stock(0, 10, 0.95) == 0

    def test_service_level_z_mapping(self):
        assert z_for_service_level(0.95) == 1.65
        assert z_for_service_level(0.99) == 2.33


class TestReorderPoint:
    def test_formula(self):
        # 20/day * 10 days + safety(5, 10, .95)=1.65*5*sqrt(10)=26.088... -> 226.088...
        expected = 20 * 10 + 1.65 * 5 * math.sqrt(10)
        assert reorder_point(20, 5, 10, 0.95) == pytest.approx(expected)

    def test_zero_lead_time_equals_safety(self):
        assert reorder_point(20, 5, 0, 0.95) == pytest.approx(safety_stock(5, 1, 0.95))


class TestDaysOfInventory:
    def test_simple_division(self):
        assert days_of_inventory(120, 20) == pytest.approx(6.0)

    def test_zero_demand_returns_none(self):
        assert days_of_inventory(120, 0) is None

    def test_days_until_reorder_negative_when_below(self):
        assert days_until_reorder(50, 10, 100) == pytest.approx(-5.0)


class TestEOQ:
    def test_canonical_example(self):
        # sqrt(2*12000*100/2) = sqrt(1,200,000) ≈ 1095.4 -> 1095
        assert eoq(annual_demand=12000, ordering_cost=100, holding_cost_per_unit=2) == 1095

    def test_guards_zero_inputs(self):
        assert eoq(0, 100, 2) == 0
        assert eoq(1000, 0, 2) == 0
        assert eoq(1000, 100, 0) == 0

    def test_recommended_qty_covers_lead_time(self):
        qty = recommended_order_qty(avg_daily_demand=10, unit_cost=50, lead_time_days=14,
                                    safety=20, ordering_cost=500, holding_cost_rate=0.2)
        assert qty >= math.ceil(10 * (14 + 14) + 20)  # never below cycle cover


class TestStockoutRisk:
    def test_high_risk_when_stockout_before_arrival(self):
        r = stockout_risk(current_stock=30, avg_daily_demand=10, demand_std=2,
                          lead_time_days=10, safety=10)
        assert r["risk"] == "High"
        assert r["days_to_zero"] == pytest.approx(3.0)

    def test_low_risk_when_covered(self):
        r = stockout_risk(current_stock=1000, avg_daily_demand=5, demand_std=1,
                          lead_time_days=7, safety=5)
        assert r["risk"] == "Low"

    def test_medium_risk_between(self):
        # Stock lasts 15 days; crosses the safety level at day 9 — one day BEFORE
        # the replenishment arrives (lead time 10) — but never stocks out -> Medium
        r = stockout_risk(current_stock=150, avg_daily_demand=10, demand_std=5,
                          lead_time_days=10, safety=60)
        assert r["risk"] == "Medium"
        assert r["days_to_zero"] == pytest.approx(15.0)

    def test_zero_demand_no_risk(self):
        r = stockout_risk(100, 0, 0, 10, 5)
        assert r["risk"] == "None"


class TestClassifyStatus:
    def test_critical_when_below_half_rop(self):
        assert classify_status(40, 10, 200, 4.0, 90, 0.5) == "Critical"

    def test_low_stock_band(self):
        assert classify_status(150, 10, 200, 15.0, 90, 0.5) == "Low Stock"

    def test_healthy_above_rop(self):
        assert classify_status(500, 10, 200, 50.0, 90, 0.5) == "Healthy"

    def test_overstock_on_doi(self):
        assert classify_status(5000, 10, 200, 500.0, 90, 0.5) == "Overstock"

    def test_zero_demand_with_stock_is_overstock(self):
        assert classify_status(100, 0, 0, None, 90, 0.5) == "Overstock"


class TestSupplierScore:
    def test_ranking_and_components(self):
        rows = [
            {"id": 1, "name": "Good", "on_time_rate": 0.98, "defect_rate": 0.005,
             "unit_cost": 1.10, "reliability_score": 0.95, "orders": 10},
            {"id": 2, "name": "CheapButSlow", "on_time_rate": 0.70, "defect_rate": 0.03,
             "unit_cost": 0.90, "reliability_score": 0.6, "orders": 10},
        ]
        scored = score_suppliers(rows)
        assert scored[0].name == "Good"
        assert scored[0].total > scored[1].total
        # cheap supplier must have the best cost points
        assert scored[1].cost_pts > scored[0].cost_pts

    def test_risk_levels(self):
        rows = [
            {"id": 1, "name": "A", "on_time_rate": 0.99, "defect_rate": 0.001,
             "unit_cost": 1.0, "reliability_score": 1.0, "orders": 5},
            {"id": 2, "name": "B", "on_time_rate": 0.60, "defect_rate": 0.08,
             "unit_cost": 1.2, "reliability_score": 0.5, "orders": 5},
        ]
        scored = score_suppliers(rows)
        assert supplier_risk_level(scored[0]) == "Low"
        assert supplier_risk_level(scored[1]) == "High"

    def test_single_supplier_neutral(self):
        scored = score_suppliers([{"id": 1, "name": "Solo", "on_time_rate": 0.9,
                                   "defect_rate": 0.01, "unit_cost": 1.0,
                                   "reliability_score": 0.8, "orders": 3}])
        assert scored[0].total == 80.0  # all-equal normalization


class TestABC:
    def test_pareto_classification(self):
        # 3 products with heavily skewed value
        products = [
            {"id": 1, "sku": "A", "name": "Big", "category": "X", "annual_demand": 100, "unit_cost": 900},
            {"id": 2, "sku": "B", "name": "Mid", "category": "X", "annual_demand": 100, "unit_cost": 90},
            {"id": 3, "sku": "C", "name": "Small", "category": "X", "annual_demand": 10, "unit_cost": 10},
        ]
        rows = abc_classify(products)
        assert rows[0].class_ == "A"
        summary = abc_summary(rows)
        a = next(s for s in summary if s["class"] == "A")
        assert a["value_share"] > 0.85  # 90000/(90000+9000+100)

    def test_empty(self):
        assert abc_classify([]) == []


class TestForecasting:
    def test_produces_horizon_and_metrics(self):
        import numpy as np
        rng = np.random.default_rng(7)
        vals = list(50 + 10 * np.sin(np.arange(120) / 6) + rng.normal(0, 2, 120))
        dates = [f"2026-{1 + i // 30:02d}-{1 + i % 30:02d}" for i in range(120)]
        res = forecast_series(dates, vals, horizon=14)
        assert len(res.forecast) == 14
        assert res.method in ("Moving Average (14d)", "Moving Average (28d)", "Exponential Smoothing (Holt)")
        assert res.metrics["MAE"] is not None
        assert all(p.upper >= p.lower for p in res.forecast)

    def test_insufficient_data(self):
        res = forecast_series(["2026-01-01"] * 5, [1, 2, 3, 4, 5], horizon=7)
        assert res.method == "Insufficient data"

    def test_no_negative_forecast(self):
        vals = [0, 0, 0, 1, 0, 0, 0, 2, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0]
        dates = [f"2026-01-{i + 1:02d}" for i in range(20)]
        res = forecast_series(dates, vals, horizon=7)
        assert all(p.yhat >= 0 for p in res.forecast)
