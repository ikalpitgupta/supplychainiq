"""Products, inventory, and forecast endpoints."""
from fastapi import APIRouter, Depends, Query
from sqlalchemy import select

from app.database.session import get_db
from app.models import Category, Product
from app.services.product_service import list_products, product_audit, product_detail, product_options
from app.services.settings_service import get_value

router = APIRouter(tags=["products"])


@router.get("/meta/categories")
def meta_categories(db=Depends(get_db)):
    """Distinct categories that actually have products — drives filter dropdowns."""
    rows = db.execute(
        select(Category.name).join(Product, Product.category_id == Category.id)
        .distinct().order_by(Category.name)
    ).scalars().all()
    return {"items": rows}


@router.get("/products")
def products(search: str | None = None, category: str | None = None, status: str | None = None,
             supplier_id: int | None = None, sort: str = "name", direction: str = "asc",
             page: int = 1, page_size: int = Query(default=20, le=200),
             db=Depends(get_db)):
    return list_products(db, search=search, category=category, status=status,
                         supplier_id=supplier_id, sort=sort, direction=direction,
                         page=page, page_size=page_size)


@router.get("/products/options")
def options(db=Depends(get_db)):
    return {"items": product_options(db)}


@router.get("/products/{product_id}")
def product(product_id: int, horizon: int = Query(default=30, le=120), db=Depends(get_db)):
    return product_detail(db, product_id, horizon_days=horizon)


@router.get("/products/{product_id}/audit")
def product_change_history(product_id: int, limit: int = Query(default=20, le=100), db=Depends(get_db)):
    """Field-level change history for one product, sourced from the import log."""
    try:
        return product_audit(db, product_id, limit=limit)
    except LookupError:
        from app.utils.errors import APIError
        raise APIError("Product not found", status_code=404)


@router.get("/inventory")
def inventory(search: str | None = None, category: str | None = None, status: str | None = None,
              supplier_id: int | None = None, sort: str = "name", direction: str = "asc",
              page: int = 1, page_size: int = Query(default=20, le=200),
              db=Depends(get_db)):
    """Inventory view = product list enriched with stock math (same engine)."""
    return list_products(db, search=search, category=category, status=status,
                         supplier_id=supplier_id, sort=sort, direction=direction,
                         page=page, page_size=page_size)


@router.get("/inventory/{product_id}")
def inventory_for_product(product_id: int, db=Depends(get_db)):
    return product_detail(db, product_id)


@router.get("/forecasts/{product_id}")
def forecast(product_id: int, horizon: int = Query(default=30, le=90),
             method: str = "auto", db=Depends(get_db)):
    from app.analytics.forecasting import forecast_series
    from app.services.product_service import _demand_series
    dates_vals = _demand_series(db, product_id, 180)
    result = forecast_series([d for d, _ in dates_vals], [v for _, v in dates_vals],
                             horizon=horizon, method=method,
                             include_gbm=str(get_value(db, "enable_gbm", "0")) == "1")
    return {
        "product_id": product_id,
        "method": result.method,
        "metrics": result.metrics,
        "history": [{"date": d, "quantity": v} for d, v in dates_vals],
        "forecast": [fp.__dict__ for fp in result.forecast],
    }
