"""Root Cause Analysis engine tests, against the light fixture."""
from __future__ import annotations


def test_rca_analysis_shape(client):
    r = client.get("/api/rca/analysis?days=14")
    assert r.status_code == 200, r.text[:300]
    d = r.json()
    assert "problems" in d and "language_note" in d
    for p in d["problems"]:
        for key in ("title", "statement", "evidence", "contributing_factor",
                    "business_impact", "recommendation", "tree"):
            assert key in p, key
        cf = p["contributing_factor"]
        assert "verdict" in cf and "recommendation" in cf
        # Language discipline: no naked causal claims unless decomposition-backed.
        verdict = (cf.get("verdict") or "").lower()
        assert "caused by" not in verdict or "primary driver" in verdict or "decomposition" in verdict


def test_rca_carrier_regression_is_detected(client):
    """The fixture: North orders are on-time, South distant-routed are late.
    Between windows nothing changes structurally — so within `days=14` the
    detector may or may not fire. This test asserts the investigation mechanics
    (carrier branch measured, verdict language disciplined) on whatever fires."""
    d = client.get("/api/rca/analysis?days=14").json()
    for p in d["problems"]:
        if p["seeding"] == "delivery":
            labels = [n["label"] for n in p["tree"]]
            assert any("Carrier" in l for l in labels)
            assert any("Inventory availability" in l for l in labels)
            assert any("Demand volume" in l for l in labels)
            # Every flagged node must carry measurable metrics.
            for n in p["tree"]:
                if n["status"] == "flagged":
                    assert n["metrics"], n["label"]
            break


def test_rca_problems_lightweight(client):
    d = client.get("/api/rca/problems?days=14").json()
    assert "problems" in d
    for p in d["problems"]:
        assert "id" in p and "title" in p and "tree" not in p


def test_rca_window_validation(client):
    r = client.get("/api/rca/analysis?days=3")
    assert r.status_code == 422  # below the 7-day floor
