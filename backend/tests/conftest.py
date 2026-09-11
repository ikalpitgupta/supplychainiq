"""Test fixtures: isolated SQLite database with a small, fast dataset."""
from __future__ import annotations

import os
import sys
from pathlib import Path

# Must be set before importing app modules (db_manager resolves once per process).
os.environ["DATABASE_URL"] = "postgresql+psycopg2://x:x@127.0.0.1:1/none"
os.environ["SQLITE_FALLBACK_URL"] = "sqlite:///./test_api.db"
os.environ["TOKEN_SECRET"] = "test-secret"

BACKEND_DIR = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND_DIR))

import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

from app.database.session import Base, db_manager  # noqa: E402
from app.main import app  # noqa: E402


@pytest.fixture(scope="session")
def client():
    engine = db_manager.engine()
    Base.metadata.create_all(engine)
    _seed_light(db_manager.sessionmaker()())
    with TestClient(app) as c:
        yield c


def _seed_light(db) -> None:
    """Small deterministic dataset: 2 categories, 2 suppliers, 4 products, 60 days of data."""
    from datetime import date, timedelta

    from app.models import Category, InventoryDaily, Product, PurchaseOrder, Sale, Setting, Supplier

    for model in (Sale, InventoryDaily, PurchaseOrder, Product, Supplier, Category, Setting):
        db.query(model).delete()
    db.commit()

    c1 = Category(name="Electronics")
    c2 = Category(name="Office Supplies")
    s1 = Supplier(name="Alpha Supplies", lead_time_days=10, unit_cost=1.0,
                  on_time_rate=0.95, defect_rate=0.01, reliability_score=0.9)
    s2 = Supplier(name="Beta Traders", lead_time_days=15, unit_cost=0.9,
                  on_time_rate=0.75, defect_rate=0.04, reliability_score=0.7)
    db.add_all([c1, c2, s1, s2])
    db.commit()

    # Steady 10/day demand product, high-stock product, zero-demand product, spiky product,
    # and a zero-demand zero-stock product (exercises the "nothing to cover yet" path).
    specs = [
        ("STEADY-001", "Steady Widget", c1.id, s1.id, 100.0, 150.0, 10.0),
        ("HIGH-002", "High Stock Item", c1.id, s2.id, 50.0, 80.0, 2.0),
        ("DEAD-003", "Zero Demand Item", c2.id, s1.id, 200.0, 300.0, 0.0),
        ("SPIKY-004", "Spiky Seller", c2.id, s2.id, 30.0, 55.0, 8.0),
        ("GHOST-005", "Ghost Product", c2.id, s1.id, 100.0, 150.0, 0.0),
    ]
    products = []
    for sku, name, cat, sup, cost, price, daily in specs:
        products.append(Product(sku=sku, name=name, category_id=cat, supplier_id=sup,
                                unit_cost=cost, selling_price=price, lead_time_days=10))
    db.add_all(products)
    db.commit()

    start = date.today() - timedelta(days=61)
    sales, inv = [], []
    for p, (sku, _, _, _, _, _, daily) in zip(products, specs):
        stock = 0 if sku == "GHOST-005" else 500
        for i in range(60):
            day = (start + timedelta(days=i + 1)).isoformat()
            wanted = 0 if daily == 0 else int(daily + (i % 7 - 3))  # mild weekly pattern
            qty = max(0, min(wanted, stock))  # can't sell more than is on hand (keeps the ledger consistent)
            sales.append(Sale(product_id=p.id, sale_date=day, quantity=qty,
                              revenue=round(qty * p.selling_price, 2), region="North"))
            opening = stock
            stock = max(opening - qty, 0)
            inv.append(InventoryDaily(product_id=p.id, date=day, opening_stock=opening,
                                      received_quantity=0, sold_quantity=qty, closing_stock=stock))
    db.bulk_save_objects(sales)
    db.bulk_save_objects(inv)

    db.add_all([
        PurchaseOrder(po_number="PO-T-0001", product_id=products[0].id, supplier_id=s1.id,
                      quantity=200, unit_cost=100.0, order_date=(date.today() - timedelta(days=20)).isoformat(),
                      expected_date=(date.today() - timedelta(days=10)).isoformat(),
                      actual_date=(date.today() - timedelta(days=9)).isoformat(), status="Delivered"),
        PurchaseOrder(po_number="PO-T-0002", product_id=products[1].id, supplier_id=s2.id,
                      quantity=150, unit_cost=50.0, order_date=(date.today() - timedelta(days=15)).isoformat(),
                      expected_date=(date.today() - timedelta(days=2)).isoformat(),
                      actual_date=None, status="In Transit"),
    ])
    db.add_all([
        Setting(key="service_level", value="0.95", kind="float", label="Service level"),
        Setting(key="ordering_cost", value="500", kind="float", label="Ordering cost"),
        Setting(key="holding_cost_rate", value="0.20", kind="float", label="Holding rate"),
        Setting(key="demand_window_days", value="60", kind="int", label="Window"),
        Setting(key="forecast_days", value="30", kind="int", label="Horizon"),
        Setting(key="low_stock_fraction", value="0.5", kind="float", label="Low frac"),
        Setting(key="overstock_days", value="90", kind="int", label="Overstock"),
    ])
    db.commit()


@pytest.fixture(scope="session")
def auth_headers(client):
    res = client.post("/api/auth/login", json={"email": "admin@supplychainiq.com", "password": "admin123"})
    token = res.json()["token"]
    return {"Authorization": f"Bearer {token}"}
