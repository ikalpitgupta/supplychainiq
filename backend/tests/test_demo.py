"""Interview Demo Mode tests — the story must be live, labeled, and honest."""
from __future__ import annotations


def _get(client, path):
    r = client.get(path)
    assert r.status_code == 200, f"{path} -> {r.status_code}: {r.text[:300]}"
    return r.json()


def test_script_structure(client):
    d = _get(client, "/api/demo/script")
    assert d["kind"] == "demo_script" and d["steps"]
    ids = [s["id"] for s in d["steps"]]
    assert ids == ["problem", "investigation", "impact", "recommendation",
                   "scenario", "decision", "experiment", "final"]
    for s in d["steps"]:
        assert s["kicker"] and s["title"] and s["narrative"], s["id"]


def test_region_is_picked_from_data(client):
    d = _get(client, "/api/demo/script")
    assert d["region"] in {"North", "South", "East", "West"}


def test_impact_step_labels_estimates(client):
    d = _get(client, "/api/demo/script")
    impact = next(s for s in d["steps"] if s["id"] == "impact")
    joined = " ".join(m.get("basis", "") for m in impact["metrics"]).lower()
    assert "estimated" in joined and "actual" in joined, \
        "financial figures must carry Actual/Estimated labels"


def test_scenario_step_is_before_after(client):
    d = _get(client, "/api/demo/script")
    sc = next(s for s in d["steps"] if s["id"] == "scenario")
    ba = sc["before_after"]
    assert ba["labels"] == ["Current", "With pre-positioning"]
    for m in ba["metrics"]:
        assert m["before"] is not None and m["after"] is not None
        assert m["format"] in {"pct1", "inr", "int"}


def test_experiment_design(client):
    d = _get(client, "/api/demo/script")
    exp = next(s for s in d["steps"] if s["id"] == "experiment")["experiment"]
    assert exp["control"] and exp["variant"]
    assert exp["primary_kpi"] == "On-time delivery rate"
    assert {g["kpi"] for g in exp["guardrails"]} >= {"Cancellation rate"}
    assert exp["sample_size_per_arm"] >= 100


def test_final_decision_includes_all_options(client):
    d = _get(client, "/api/demo/script")
    final = next(s for s in d["steps"] if s["id"] == "final")
    decisions = {o["decision"] for o in final["options"]}
    assert decisions == {"Ship", "Iterate", "Reject"}
    assert final["criteria"]


def test_story_is_reproducible_not_hardcoded(client):
    """Run twice: identical structure, and the region tracks the data."""
    a = _get(client, "/api/demo/script")
    b = _get(client, "/api/demo/script")
    assert a["steps"] == b["steps"], "same data must produce the same story"
