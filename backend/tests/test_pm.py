"""PM decision layer tests: packet structure, RICE math, experiment sizing,
and decision-state honesty."""
from __future__ import annotations


def _get(client, path):
    r = client.get(path)
    assert r.status_code == 200, f"{path} -> {r.status_code}: {r.text[:300]}"
    return r.json()


def test_decision_layer_shape(client):
    d = _get(client, "/api/pm/decisions")
    assert d["initiatives"], "expected at least one initiative"
    for i in d["initiatives"]:
        for key in ("id", "title", "problem_statement", "solution", "opportunity",
                    "rice", "decision", "business_impact"):
            assert key in i, key
        r = i["rice"]
        assert set(r) >= {"reach", "impact", "confidence", "effort_weeks", "score", "quadrant"}
        assert r["impact"] <= 3 and r["confidence"] <= 1
        # Score must reproduce RICE arithmetic.
        expected = r["reach"] * r["impact"] * r["confidence"] / r["effort_weeks"]
        assert abs(r["score"] - expected) < max(1.0, expected * 0.01)


def test_rice_ordering(client):
    d = _get(client, "/api/pm/decisions")
    scores = [i["rice"]["score"] for i in d["initiatives"]]
    assert scores == sorted(scores, reverse=True)


def test_experiment_design_fields(client):
    d = _get(client, "/api/pm/decisions")
    exps = [i["experiment"] for i in d["initiatives"] if i.get("experiment")]
    assert exps
    for e in exps:
        for key in ("hypothesis", "control", "variant", "primary_kpi",
                    "guardrail_kpis", "sample_size_per_arm"):
            assert key in e, key
        assert e["sample_size_per_arm"] > 0
        # Guardrails present and distinct from the primary KPI.
        assert e["primary_kpi"]["name"] not in e["guardrail_kpis"]


def test_decision_states_are_honest(client):
    d = _get(client, "/api/pm/decisions")
    states = {i["id"]: i["decision"]["state"] for i in d["initiatives"]}
    # The rejected proposal must exist and must not fabricate an experiment.
    assert "sameday-dispatch" in states
    assert states["sameday-dispatch"] == "reject"
    rejected = next(i for i in d["initiatives"] if i["id"] == "sameday-dispatch")
    assert rejected["experiment"] is None
    for i in d["initiatives"]:
        if i["decision"]["state"] == "run_experiment":
            assert i["experiment"] is not None


def test_quadrant_buckets(client):
    d = _get(client, "/api/pm/decisions")
    total = sum(len(v) for v in d["quadrants"].values())
    assert total == len(d["initiatives"])
    assert "sameday-dispatch" in d["quadrants"]["reconsider"]
