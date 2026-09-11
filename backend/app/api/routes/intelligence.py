"""Intelligence endpoints: anomalies, scenarios, segmentation, procurement, control tower."""
from fastapi import APIRouter, Depends, Query

from app.database.session import get_db
from app.services.anomaly_service import scan_anomalies, supplier_delay_anomalies
from app.services.scenario_service import service_cost_curve, simulate_for_product
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
