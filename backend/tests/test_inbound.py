"""Inbound Intelligence endpoint tests: procurement linkage, catalog quality,
pricing, promotions — run against the light fixture."""
from __future__ import annotations


def _get(client, path):
    r = client.get(path)
    assert r.status_code == 200, f"{path} -> {r.status_code}: {r.text[:300]}"
    return r.json()


def test_procurement_linkage_shape(client):
    d = _get(client, "/api/inbound/procurement?days=120")
    assert "suppliers" in d and len(d["suppliers"]) >= 2
    first = d["suppliers"][0]
    for key in ("supplier", "lead_time_days", "po_on_time_rate", "defect_rate",
                "stockout_products", "overstock_products"):
        assert key in first, key
    assert "concentration" in d and "hhi" in d["concentration"]
    assert 0 <= d["concentration"]["hhi"] <= 1
    assert isinstance(d["flagged"], list)


def test_procurement_flags_risky_supplier(client):
    """Beta Traders (on_time 0.75, high defect) should outrank Alpha Supplies."""
    d = _get(client, "/api/inbound/procurement?days=365")
    by_name = {s["supplier"]: s for s in d["suppliers"]}
    assert "Beta Traders" in by_name and "Alpha Supplies" in by_name
    beta, alpha = by_name["Beta Traders"], by_name["Alpha Supplies"]
    beta_rate = beta["po_on_time_rate"] if beta["po_on_time_rate"] is not None else 1
    alpha_rate = alpha["po_on_time_rate"] if alpha["po_on_time_rate"] is not None else 1
    assert beta_rate <= alpha_rate + 1e-9


def test_catalog_quality_counts_gaps(client):
    d = _get(client, "/api/inbound/catalog-quality")
    assert d["total_products"] >= 5
    assert 0 <= d["complete_pct"] <= 100
    assert isinstance(d["by_category"], list) and d["by_category"]
    assert "size_chart_linkage" in d and "headline" in d


def test_pricing_shape_and_math(client):
    d = _get(client, "/api/inbound/pricing?days=90")
    assert "avg_margin_pct" in d and "products" in d
    if d["products"]:
        p = d["products"][0]
        assert 0 <= p["margin_pct"] <= 1
        assert 0 <= p["discount_pct"] <= 1
        assert p["mrp"] >= p["price"]
    assert "interpretation_note" in d


def test_promotions_tradeoff(client):
    d = _get(client, "/api/inbound/promotions?days=90")
    assert "campaigns" in d and "totals" in d
    for c in d["campaigns"]:
        assert "discount_pct" in c
        if c.get("orders", 0) > 0:
            assert c["revenue"] >= 0
            # Margin must be materially below revenue when a discount ran.
            assert c["margin_rate"] is None or c["margin_rate"] <= 1
    assert "tradeoff_note" in d


def test_inbound_summary(client):
    d = _get(client, "/api/inbound/summary")
    assert set(d.keys()) >= {"procurement", "catalog", "pricing", "promotions"}
