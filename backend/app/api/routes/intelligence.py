"""Intelligence endpoints: anomalies, scenarios, segmentation, procurement, control tower."""
from fastapi import APIRouter, Depends, Query

from app.database.session import get_db
from app.services.anomaly_service import scan_anomalies, supplier_delay_anomalies
from app.services.scenario_service import service_cost_curve, simulate_for_product
from app.services.network_scenario_service import compare_network, simulate_network
from app.services.intelligence_service import (abcxyz_matrix, inventory_aging,
                                               procurement_intelligence,
                                               slow_movers, velocity_matrix)
from app.services.control_tower_service import control_tower

router = APIRouter(tags=["intelligence"])


@router.get("/control-tower")
def get_control_tower(db=Depends(get_db)):
    return control_tower(db)


@router.get("/anomalies")
def get_anomalies(threshold: float = Query(default=2.5, ge=1.0, le=5.0), db=Depends(get_db)):
    data = scan_anomalies(db, threshold=threshold)
    data["supplier_delays"] = supplier_delay_anomalies(db)
    return data


@router.get("/scenarios/network")
def get_network_scenario(
    demand_pct: float = Query(default=0.0, ge=-50, le=100),
    lead_delta_days: int = Query(default=0, ge=-5, le=30),
    home_allocation: float = Query(default=100.0, ge=40, le=150),
    service_level: float | None = Query(default=None, ge=0.5, le=0.999),
    promo_uplift_pct: float = Query(default=0.0, ge=0, le=60),
    promo_discount: float = Query(default=0.0, ge=0, le=50),
    capacity_factor: float = Query(default=100.0, ge=60, le=120),
    label: str = Query(default="Scenario", max_length=60),
    db=Depends(get_db),
):
    """Network-level what-if. NOTE: registered before /scenarios/{product_id}."""
    return simulate_network(
        db, demand_pct=demand_pct, lead_delta_days=lead_delta_days,
        home_allocation=home_allocation, service_level=service_level,
        promo_uplift_pct=promo_uplift_pct, promo_discount=promo_discount,
        capacity_factor=capacity_factor, label=label)


@router.get("/scenarios/network/compare")
def get_network_compare(
    a_demand_pct: float = Query(default=0.0, ge=-50, le=100),
    a_lead_delta_days: int = Query(default=0, ge=-5, le=30),
    a_home_allocation: float = Query(default=100.0, ge=40, le=150),
    a_service_level: float | None = Query(default=None, ge=0.5, le=0.999),
    a_promo_uplift_pct: float = Query(default=0.0, ge=0, le=60),
    a_promo_discount: float = Query(default=0.0, ge=0, le=50),
    a_capacity_factor: float = Query(default=100.0, ge=60, le=120),
    a_label: str = Query(default="A", max_length=60),
    b_demand_pct: float = Query(default=0.0, ge=-50, le=100),
    b_lead_delta_days: int = Query(default=0, ge=-5, le=30),
    b_home_allocation: float = Query(default=100.0, ge=40, le=150),
    b_service_level: float | None = Query(default=None, ge=0.5, le=0.999),
    b_promo_uplift_pct: float = Query(default=0.0, ge=0, le=60),
    b_promo_discount: float = Query(default=0.0, ge=0, le=50),
    b_capacity_factor: float = Query(default=100.0, ge=60, le=120),
    b_label: str = Query(default="B", max_length=60),
    db=Depends(get_db),
):
    def _inputs(m):
        return {"demand_pct": m["demand_pct"], "lead_delta_days": m["lead_delta_days"],
                "home_allocation": m["home_allocation"], "service_level": m["service_level"],
                "promo_uplift_pct": m["promo_uplift_pct"], "promo_discount": m["promo_discount"],
                "capacity_factor": m["capacity_factor"]}
    a_map = {"demand_pct": a_demand_pct, "lead_delta_days": a_lead_delta_days,
             "home_allocation": a_home_allocation, "service_level": a_service_level,
             "promo_uplift_pct": a_promo_uplift_pct, "promo_discount": a_promo_discount,
             "capacity_factor": a_capacity_factor}
    b_map = {"demand_pct": b_demand_pct, "lead_delta_days": b_lead_delta_days,
             "home_allocation": b_home_allocation, "service_level": b_service_level,
             "promo_uplift_pct": b_promo_uplift_pct, "promo_discount": b_promo_discount,
             "capacity_factor": b_capacity_factor}
    scenarios = [
        {"label": a_label, "inputs": _inputs(a_map)},
        {"label": b_label, "inputs": _inputs(b_map)},
    ]
    return compare_network(db, scenarios)


@router.get("/scenarios/{product_id}")
def get_scenario(
    product_id: int,
    demand_change_pct: float = Query(default=0.0, ge=-90, le=300),
    lead_time_delta_days: int = Query(default=0, ge=-20, le=60),
    safety_stock: float | None = Query(default=None, ge=0),
    stock: int | None = Query(default=None, ge=0),
    service_level: float | None = Query(default=None, ge=0.5, le=0.999),
    db=Depends(get_db),
):
    result = simulate_for_product(
        db, product_id, demand_change_pct=demand_change_pct,
        lead_time_delta_days=lead_time_delta_days,
        safety_stock_override=safety_stock, stock_override=stock,
        service_level=service_level)
    if result is None:
        from app.utils.errors import APIError
        raise APIError(f"Product {product_id} not found", status_code=404)
    return result


@router.get("/scenarios/{product_id}/cost-curve")
def get_cost_curve(product_id: int, db=Depends(get_db)):
    result = service_cost_curve(db, product_id)
    if result is None:
        from app.utils.errors import APIError
        raise APIError(f"Product {product_id} not found", status_code=404)
    return result


@router.get("/abc-xyz")
def get_abcxyz(db=Depends(get_db)):
    return abcxyz_matrix(db)


@router.get("/inventory-aging")
def get_aging(db=Depends(get_db)):
    return inventory_aging(db)


@router.get("/velocity-matrix")
def get_velocity(db=Depends(get_db)):
    return velocity_matrix(db)


@router.get("/slow-movers")
def get_slow_movers(db=Depends(get_db)):
    return slow_movers(db)


@router.get("/procurement-intelligence")
def get_procurement(db=Depends(get_db)):
    return procurement_intelligence(db)
