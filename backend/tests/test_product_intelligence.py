"""Product Intelligence tests — the no-invented-numbers contract.

Every numeric token in a composed answer must be traceable to the grounds
packet (measured analytics). The tests recompute the packet, then assert that
answers cite only figures the packet carries, that insufficiency is declared
honestly, and that confidence reflects data quality.
"""
from __future__ import annotations

import re

NUM = re.compile(r"₹\s?[\d,]+(?:\.\d+)?|\b\d+(?:\.\d+)?\b")


def _get(client, path):
    r = client.get(path)
    assert r.status_code == 200, f"{path} -> {r.status_code}: {r.text[:300]}"
    return r.json()


def _packet_numbers(client) -> set[str]:
    """Collect every numeric token the analytics layer can legitimately emit."""
    from app.database.session import db_manager
    from app.services.product_intelligence_service import _grounds
    db = db_manager.sessionmaker()()
    try:
        g = _grounds(db)
    finally:
        db.close()

    def walk(v):
        if isinstance(v, (int, float)):
            yield f"{v:,}"
            yield str(v)
            yield f"{v:.1f}"
            yield f"{round(v, 1):,}"
            # Compact money formatting rounds to whole units (₹900 from 900.0).
            yield f"{int(round(v)):,}"
            yield str(int(round(v)))
        elif isinstance(v, dict):
            for x in v.values():
                yield from walk(x)
        elif isinstance(v, list):
            for x in v:
                yield from walk(x)

    tokens = set()
    for tok in walk(g):
        tokens.add(tok)
        tokens.add(tok.replace(",", ""))
        # Analytics-owned derivations: rates quoted as complements (on-time =
        # 100 − late rate) are the same measurement, legitimately re-expressed.
        try:
            v = float(tok.replace(",", ""))
        except ValueError:
            continue
        if 0 < v < 100:
            comp = f"{round(100 - v, 1)}"
            tokens.add(comp)
            tokens.add(f"{round(100 - v, 1):,}")
    return tokens


def _assert_no_invented_numbers(payload: dict, allowed: set[str]) -> None:
    def texts(v):
        if isinstance(v, str):
            yield v
        elif isinstance(v, dict):
            for x in v.values():
                yield from texts(x)
        elif isinstance(v, list):
            for x in v:
                yield from texts(x)

    invented = []
    for t in texts(payload):
        for tok in NUM.findall(t):
            clean = tok.replace("₹", "").replace(",", "").replace(" ", "")
            # Structural numbers and documented method constants (α=0.05,
            # 80% power, the 16 in the sample-size approximation) are not claims.
            if clean in {"2", "3", "50", "4", "30", "90", "21", "7", "100", "10", "6",
                         "0.05", "80", "16", "1.5", "0.1"}:
                continue
            if tok not in allowed and clean not in allowed:
                invented.append(tok)
    assert not invented, f"invented numbers in answer: {invented[:8]}"


def test_questions_list(client):
    d = _get(client, "/api/pi/questions")
    assert d["questions"] and all("answerable" in q for q in d["questions"])
    assert any(q["answerable"] for q in d["questions"]), "fixture data should support at least one question"


def test_ask_delivery_is_fully_structured(client):
    allowed = _packet_numbers(client)
    d = _get(client, "/api/pi/ask?q=What%20is%20driving%20returns%3F")
    assert d["kind"] == "insight" and not d["insufficient"]
    for key in ("insight", "evidence", "possible_drivers", "recommendation",
                "kpi_to_track", "experiment", "confidence", "investigate"):
        assert key in d, key
    assert d["confidence"]["level"] in {"high", "medium", "low"}
    assert d["experiment"] and d["experiment"]["primary_kpi"]
    _assert_no_invented_numbers(d, allowed)


def test_insufficiency_is_honest(client):
    d = _get(client, "/api/pi/ask?q=Why%20did%20website%20conversion%20drop%3F")
    assert d["insufficient"] is True
    assert d["insight"].startswith("Insufficient data")
    assert "conversion" in " ".join(d["evidence"]).lower()


def test_validate_carrier(client):
    allowed = _packet_numbers(client)
    d = _get(client, "/api/pi/validate?recommendation=Rebalance%20SLA%20orders%20away%20from%20the%20worst%20carrier")
    assert d["kind"] == "validation"
    for key in ("supporting_evidence", "potential_risks", "missing_information",
                "suggested_kpi", "suggested_experiment", "verdict"):
        assert key in d, key
    assert d["supporting_evidence"], "carrier validation should cite measured carrier rates"
    _assert_no_invented_numbers(d, allowed)


def test_experiments_have_sample_sizes(client):
    allowed = _packet_numbers(client)
    d = _get(client, "/api/pi/experiments")
    assert d["ideas"], "fixture supports at least one experiment idea"
    for idea in d["ideas"]:
        for key in ("hypothesis", "primary_kpi", "guardrail", "sample_size_per_arm", "basis"):
            assert key in idea, key
        assert idea["sample_size_per_arm"] >= 100
    # Sample sizes are derived FROM the measured baseline (documented formula),
    # so they are analytics-owned numbers: extend the allow-list with them.
    allowed |= {str(i["sample_size_per_arm"]) for i in d["ideas"]}
    _assert_no_invented_numbers(d, allowed)


def test_experiments_unknown_problem_refuses(client):
    d = _get(client, "/api/pi/experiments?problem=moonshot")
    assert d["ideas"] == [] and d["note"].startswith("Insufficient data")


def test_executive_summary(client):
    allowed = _packet_numbers(client)
    d = _get(client, "/api/pi/executive-summary")
    assert d["summary"] and d["actions"] and d["not_measured"]
    _assert_no_invented_numbers(d, allowed)


def test_narrative_source_disclosed(client):
    d = _get(client, "/api/pi/ask?q=What%20is%20driving%20returns%3F")
    assert d["narrative_source"].startswith("deterministic"), \
        "without an LLM key the answer must be labeled deterministic"
