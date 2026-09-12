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
    from app.database.migrations import run_light_migrations
    run_light_migrations(engine)
    _seed_light(db_manager.sessionmaker()())
    with TestClient(app) as c:
        yield c


def _seed_light(db) -> None:
    """Small deterministic dataset: 2 categories, 2 suppliers, 4 products, 60 days of data."""
    from datetime import date, timedelta

    from app.models import (Category, InventoryDaily, OutboundOrder, Product, Promotion, PurchaseOrder,
                            ReturnLine, Sale, Setting, Supplier, VariantInventory, Warehouse)

    for model in (ReturnLine, OutboundOrder, VariantInventory, Warehouse, Promotion,
                  Sale, InventoryDaily, PurchaseOrder, Product, Supplier, Category, Setting):
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
    for idx, (sku, name, cat, sup, cost, price, daily) in enumerate(specs):
        p = Product(sku=sku, name=name, category_id=cat, supplier_id=sup,
                    unit_cost=cost, selling_price=price, lead_time_days=10)
        # Catalog attributes + pricing history (Inbound Intelligence tests).
        if idx == 0:
            p.mrp = 180.0                      # 150/180 → ~17% list discount
            p.price_prev = 140.0               # price went UP since
            p.price_changed_at = date.today()
        elif idx == 1:
            p.color = None                     # catalog gaps
            p.description = None
            p.mrp = 100.0                      # 80/100 → 20% list discount
        elif idx == 2:
            p.price_prev = 270.0               # price up 300 vs 270
            p.price_changed_at = date.today()
        elif idx == 3:
            p.images_json = None
        products.append(p)
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

    # --- Outbound dataset (deterministic causal chain) ----------------------
    # 2 DCs: North well-stocked, South starved (~14% of units). South orders
    # distant-ship → longer dispatch → higher lateness/cancellation; returns
    # land on delivered orders so return-rate math has a denominator.
    wh_n = Warehouse(code="DEL", name="Delhi North DC", region="North")
    wh_s = Warehouse(code="BLR", name="Bengaluru South DC", region="South")
    db.add_all([wh_n, wh_s])
    db.commit()

    variant_objs = []
    for p in products[:4]:
        # XL is deliberately near-starved (1 unit network-wide) against an even
        # demand rotation — the "XL approaching stock-out" case.
        for size, (n_units, s_units) in (("M", (20, 4)), ("L", (20, 4)), ("XL", (1, 0))):
            variant_objs.append(VariantInventory(product_id=p.id, size=size, warehouse_id=wh_n.id, units=n_units))
            if s_units > 0:
                variant_objs.append(VariantInventory(product_id=p.id, size=size, warehouse_id=wh_s.id, units=s_units))
    db.add_all(variant_objs)
    db.commit()

    # One promotion with attributed orders so the promotions lens has data.
    promo = Promotion(name="Test Flash", kind="Flash", discount_pct=0.20,
                      start_date=(date.today() - timedelta(days=10)).isoformat(),
                      end_date=(date.today() - timedelta(days=4)).isoformat())
    db.add(promo)
    db.commit()

    rng = __import__("random").Random(7)
    order_objs = []
    for i in range(40):
        p = products[i % 4]
        size = ("M", "L", "XL")[i % 3]          # demand rotates evenly across sizes
        region = "South" if i % 2 == 0 else "North"
        wh = wh_s if region == "South" else wh_n
        order_day = date.today() - timedelta(days=i + 2)
        promised = order_day + timedelta(days=3)
        in_campaign = (date.today() - timedelta(days=10)) <= order_day <= (date.today() - timedelta(days=4))
        attributed = in_campaign and i % 2 == 0
        if region == "South":
            disp, on_time, cancelled = 24.0, rng.random() < 0.4, rng.random() < 0.15
        else:
            disp, on_time, cancelled = 8.0, rng.random() < 0.9, rng.random() < 0.05
        if cancelled:
            status, delivered = "Cancelled", None
        elif on_time:
            status, delivered = "Delivered", promised
        else:
            status, delivered = "Delivered", promised + timedelta(days=2)
        order_objs.append(OutboundOrder(
            order_number=f"SO-T-{i:05d}", product_id=p.id, size=size, warehouse_id=wh.id,
            region=region, quantity=2, revenue=round(2 * p.selling_price, 2),
            order_date=order_day.isoformat(), promised_date=promised.isoformat(),
            delivered_date=delivered.isoformat() if delivered else None,
            pick_hours=2.0 if not cancelled else 2.0,
            pack_hours=1.0 if not cancelled else None,
            dispatch_hours=disp if status == "Delivered" else None,
            carrier="BlueDart",
            delay_reason=("Routed from distant DC" if (region == "South" and status == "Delivered" and not on_time)
                          else ("Carrier delay" if (region == "North" and status == "Delivered" and not on_time) else None)),
            status=status,
            campaign_id=promo.id if attributed else None,
            paid_price=round(p.selling_price * 0.8, 2) if attributed else None,
        ))
    db.add_all(order_objs)
    db.commit()

    delivered_rows = [o for o in order_objs if o.status == "Delivered"]
    for j, o in enumerate(delivered_rows):
        if j % 4 == 0:  # ~25% of delivered orders get a return
            rdate = min(date.fromisoformat(o.delivered_date) + timedelta(days=3), date.today())
            db.add(ReturnLine(order_id=o.id, product_id=o.product_id, return_date=rdate.isoformat(),
                              reason="Size issue", disposition="Restock"))
    db.commit()

    db.add_all([
        PurchaseOrder(po_number="PO-T-0001", product_id=products[0].id, supplier_id=s1.id,
                      quantity=200, unit_cost=100.0, order_date=(date.today() - timedelta(days=20)).isoformat(),
                      expected_date=(date.today() - timedelta(days=10)).isoformat(),
                      actual_date=(date.today() - timedelta(days=11)).isoformat(), status="Delivered"),
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
