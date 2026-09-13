"""Product Intelligence endpoints — grounded PM analytics answers."""
from fastapi import APIRouter, Depends, Query

from app.database.session import get_db
from app.services.product_intelligence_service import (
    executive_summary, experiment_ideas, explain, llm_polish, validate_recommendation)

router = APIRouter(prefix="/pi", tags=["product-intelligence"])


@router.get("/questions")
def pi_questions(db=Depends(get_db)):
    from app.services.product_intelligence_service import _grounds
    g = _grounds(db)
    return {
        "questions": [
            {"id": "delivery", "q": "Why is delivery performance declining?",
             "answerable": g["delivery"]["late_rate_pct"] is not None and (g["delivery"]["delivered_orders"] or 0) >= 30},
            {"id": "cancellations", "q": "Why are cancellations rising?",
             "answerable": g["customer"]["cancel_rate_pct"] is not None},
            {"id": "returns", "q": "What is driving returns?",
             "answerable": g["returns_90d"]["return_rate_pct"] is not None},
            {"id": "availability", "q": "Where is availability hurting revenue?",
             "answerable": g["inventory"]["size_flagged_products"] is not None},
            {"id": "pricing", "q": "How are promotions and pricing affecting margin?",
             "answerable": g["pricing"]["avg_margin_pct"] is not None or bool(g["promotions"]["campaigns"])},
        ],
        "detected_problems": [p["id"] for p in g["trends"]["problems"]],
        "data_quality": g["data_quality"],
    }


@router.get("/ask")
def pi_ask(
    q: str = Query(..., min_length=3, max_length=300),
    days: int = Query(default=21, ge=7, le=90),
    db=Depends(get_db),
):
    return llm_polish(explain(db, q, days=days))


@router.get("/validate")
def pi_validate(
    recommendation: str = Query(..., min_length=3, max_length=300),
    days: int = Query(default=21, ge=7, le=90),
    db=Depends(get_db),
):
    return llm_polish(validate_recommendation(db, recommendation, days=days))


@router.get("/experiments")
def pi_experiments(
    problem: str | None = Query(default=None, max_length=60),
    days: int = Query(default=21, ge=7, le=90),
    db=Depends(get_db),
):
    return experiment_ideas(db, problem=problem, days=days)


@router.get("/executive-summary")
def pi_exec_summary(days: int = Query(default=21, ge=7, le=90), db=Depends(get_db)):
    return executive_summary(db, days=days)
