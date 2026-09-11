"""Deterministic demo data generator.

Simulates one year of daily demand per product jointly with inventory movements
(closing = opening + received - sold, stockouts included) and derives purchase
orders from replenishment events, so every analytic in the app is internally
consistent. Supplier performance stats are computed FROM the generated POs.
"""
from __future__ import annotations

import math
from datetime import date, datetime, timedelta

import numpy as np
from sqlalchemy import delete, func, select
from sqlalchemy.orm import Session

from app.database.session import Base, db_manager
from app.models import Category, InventoryDaily, Product, PurchaseOrder, Sale, Setting, Supplier, User

RNG_SEED = 42
DAYS = 365
END_DATE = date.today() - timedelta(days=1)  # seed ends yesterday; "today" has no partial data

CATEGORY_SPECS: list[dict] = [
    # name, unit-cost range (₹), margin range, demand scale (units/day), weekend uplift
    {"name": "Electronics", "cost": (400, 18000), "margin": (1.25, 1.5), "demand": (1.2, 9), "weekend": 1.15},
    {"name": "Home Appliances", "cost": (700, 9000), "margin": (1.3, 1.6), "demand": (0.8, 5), "weekend": 1.2},
    {"name": "Fashion", "cost": (200, 2500), "margin": (1.6, 2.2), "demand": (2, 12), "weekend": 1.35},
    {"name": "Grocery", "cost": (20, 400), "margin": (1.2, 1.5), "demand": (8, 40), "weekend": 1.1},
    {"name": "Beauty", "cost": (80, 1200), "margin": (1.5, 2.0), "demand": (1.5, 9), "weekend": 1.15},
    {"name": "Sports", "cost": (300, 4000), "margin": (1.4, 1.8), "demand": (1, 6), "weekend": 1.3},
    {"name": "Office Supplies", "cost": (40, 900), "margin": (1.3, 1.7), "demand": (2, 14), "weekend": 0.7},
    {"name": "Accessories", "cost": (60, 1500), "margin": (1.6, 2.2), "demand": (2, 11), "weekend": 1.25},
    {"name": "Furniture", "cost": (1500, 15000), "margin": (1.3, 1.7), "demand": (0.3, 2), "weekend": 1.2},
    {"name": "Personal Care", "cost": (50, 700), "margin": (1.4, 1.9), "demand": (2, 13), "weekend": 1.1},
]

# Signature products guaranteed to exist for the demo narrative. Each carries
# fixed economic parameters (within the seed's own deterministic discipline) so
# the resulting analytics tell the intended story — but every classification is
# still computed at runtime by the analytics layer from the seeded rows.
SIGNATURE_PRODUCTS = {"Electronics": ["Wireless Mouse", "27in Monitor"],
                      "Office Supplies": ["Laptop Bag"],
                      "Home Appliances": ["Air Fryer 4L"]}

# Fixed spec for the marquee demo scenario (see README §Demo Scenario):
# Laptop Bag: ~20/day demand, 10-day lead time, ~120 units left, spike recently
# passed -> projected stock-out BEFORE replenishment arrives -> CRITICAL / ORDER NOW.
SIGNATURE_SPECS: dict[str, dict] = {
    "Laptop Bag": {
        "base_daily": 20.0, "trend": 0.10, "spike_start": 325, "spike_mult": 1.30,
        "closing_stock": 200, "opening_stock": 240, "order_qty": 500,
        "unit_cost": 640.0, "margin": 1.65, "lead_time_days": 10,
    },
}

PRODUCT_NAMES: dict[str, list[str]] = {
    "Electronics": ["Wireless Mouse", "Mechanical Keyboard", "27in Monitor", "USB-C Hub", "Bluetooth Speaker",
                    "Noise-Cancel Headphones", "Smart Watch", "Tablet 10in", "Power Bank 20K", "Webcam HD",
                    "Wireless Earbuds", "External SSD 1TB", "HDMI Cable 2m", "Phone Stand", "LED Ring Light",
                    "Router AC1200", "Graphics Tablet", "Laptop Cooling Pad", "Smart Bulb", "Action Camera"],
    "Home Appliances": ["Air Fryer 4L", "Steam Iron", "Mixer Grinder", "Electric Kettle", "Vacuum Cleaner",
                        "Rice Cooker", "Water Purifier", "Ceiling Fan", "Toaster 2-Slice", "Immersion Blender",
                        "Room Heater", "Air Cooler", "Hand Blender", "Sandwich Maker", "Coffee Maker",
                        "Humidifier", "Deep Fryer", "Chimney Filter", "Induction Cooktop", "Juicer"],
    "Fashion": ["Cotton T-Shirt", "Denim Jacket", "Running Shoes", "Formal Shirt", "Summer Dress",
                "Hoodie Fleece", "Chino Trousers", "Leather Belt", "Polo Shirt", "Track Pants",
                "Kurti Set", "Blazer Navy", "Sneakers White", "Woolen Sweater", "Cargo Shorts",
                "Silk Scarf", "Rain Jacket", "Linen Kurta", "Athletic Socks", "Party Dress"],
    "Grocery": ["Basmati Rice 5kg", "Olive Oil 1L", "Green Tea 250g", "Almonds 500g", "Honey 500g",
                "Wheat Flour 5kg", "Brown Sugar 1kg", "Pasta Penne 500g", "Peanut Butter 350g", "Oats 1kg",
                "Coffee Beans 250g", "Dark Chocolate 90%", "Tomato Ketchup", "Coconut Water 12pk", "Protein Bars",
                "Chia Seeds 200g", "Ghee 1L", "Masala Spice Set", "Fruit Jam 400g", "Green Moong 1kg"],
    "Beauty": ["Face Serum", "Sunscreen SPF50", "Lipstick Matte", "Shampoo Argan", "Face Moisturizer",
               "Perfume 50ml", "Hair Dryer", "Nail Polish Set", "Face Mask Pack", "Body Lotion",
               "Kajal Eyeliner", "Beard Oil", "Makeup Brush Set", "Anti-Dandruff Shampoo", "Toner Rose",
               "Lip Balm SPF", "Charcoal Soap", "Hair Serum", "BB Cream", "Eye Shadow Palette"],
    "Sports": ["Yoga Mat 6mm", "Dumbbell Set 10kg", "Football Size 5", "Badminton Racket", "Cricket Bat",
               "Resistance Bands", "Jump Rope", "Cycling Helmet", "Tennis Balls 3pk", "Gym Gloves",
               "Foam Roller", "Basketball Indoor", "Swimming Goggles", "Wrist Weights", "Kettlebell 8kg",
               "Table Tennis Set", "Ankle Support", "Camping Tent 2P", "Sleeping Bag", "Skateboard"],
    "Office Supplies": ["A4 Paper Ream", "Gel Pen Pack", "Sticky Notes", "Binder Clips", "Whiteboard Marker",
                        "Stapler Heavy", "Folder File Pack", "Envelopes 50pk", "Desk Organizer", "Laptop Bag",
                        "Calculator Scientific", "Highlighter Set", "Notebook A5 3pk", "Scissors Steel",
                        "Tape Dispenser", "Push Pins", "Rubber Bands", "Marker Permanent", "Label Maker", "Clipboard"],
    "Accessories": ["Phone Case Clear", "Screen Protector", "Canvas Backpack", "Sunglasses UV400", "Travel Wallet",
                    "Keychain Metal", "Watch Strap 22mm", "Cable Organizer", "Camera Strap", "Tote Bag",
                    "Passport Cover", "Luggage Tag", "Belt Bag", "Card Holder RFID", "Gaming Mousepad",
                    "Headphone Stand", "Tripod Mini", "Water Bottle 1L", "Umbrella Compact", "Hat Baseball"],
    "Furniture": ["Office Chair Ergo", "Study Desk 120cm", "Bookshelf 4-Tier", "Coffee Table", "Bedside Table",
                  "TV Unit Oak", "Dining Chair", "Wardrobe 2-Door", "Sofa 3-Seater", "Filing Cabinet",
                  "Recliner Chair", "Standing Desk", "Shoe Rack 5-Tier", "Console Table", "Bar Stool",
                  "Bed Frame Queen", "Dresser Mirror", "Corner Shelf", "Gaming Chair", "Futon Sofa Bed"],
    "Personal Care": ["Electric Toothbrush", "Toothpaste Herbal", "Bath Towel Set", "Hair Conditioner",
                      "Shaving Razor 4pk", "Deodorant Spray", "Face Wash Neem", "Body Wash Citrus",
                      "Hand Sanitizer", "Cotton Buds 200pk", "Foot Cream", "Dental Floss", "Loofah Pack",
                      "Bath Sponge", "Talcum Powder", "Mouthwash 500ml", "Hair Gel", "Sunscreen Gel",
                      "Lip Care Winter", "Knee Support"],
}

SUPPLIER_NAMES = [
    "Nexus Components Pvt Ltd", "OrbitTraders Global", "VegaSupply Co", "PrimeSource Industries",
    "BlueRiver Imports", "Vertex Goods LLP", "SummitWorks Trading", "Aurora Distributors",
    "Quantum Retail Supply", "EastBridge Traders", "MetroWholesale Hub", "Sterling Procurement",
    "Sunrise Logistics Ltd", "IronClad Vendors", "Zenith Supply Partners",
]

REGIONS = ["North", "South", "East", "West"]

SETTING_DEFAULTS: list[tuple[str, str, str, str]] = [
    ("service_level", "0.95", "float", "Service level (cycle) — Z=1.65 at 95%"),
    ("ordering_cost", "500", "float", "Ordering cost per PO (₹, demo assumption)"),
    ("holding_cost_rate", "0.20", "float", "Annual holding cost as % of unit cost (demo assumption)"),
    ("demand_window_days", "90", "int", "Historical window for average daily demand (days)"),
    ("forecast_days", "30", "int", "Default forecast horizon (days)"),
    ("low_stock_fraction", "0.5", "float", "Low Stock when stock < fraction of reorder point"),
    ("overstock_days", "90", "int", "Overstock when days of inventory exceed this (days)"),
    ("currency", "INR", "str", "Display currency"),
    ("date_format", "DD MMM YYYY", "str", "Display date format"),
]


def _craft_path(name: str, fixed: dict, lead: int, selling_price: float,
                unit_cost: float) -> dict:
    """Deterministic 365-day path for a signature demo product.

    Receipts every 30 days are sized to next-cycle demand plus a cover buffer,
    and the final receipt is sized so the year ends at exactly
    `fixed['closing_stock']` with no inbound pipeline. A pending PO is placed
    `lead - 3` days before year-end so it arrives after the window closes (the
    'order placed, not yet arrived' story). The live analytics engine — never
    this file — classifies the resulting situation.
    """
    base = float(fixed["base_daily"])
    trend = float(fixed["trend"])
    spike_start = int(fixed["spike_start"])          # e.g. 325 -> spike on days 325-345
    spike_mult = float(fixed["spike_mult"])
    closing_target = int(fixed["closing_stock"])
    buffer = int(fixed.get("cycle_buffer", 240))
    qty = int(fixed["order_qty"])
    region_cycle = ["North", "South", "East", "West"]

    demand: list[int] = []
    for d in range(DAYS):
        dow = (END_DATE - timedelta(days=DAYS - 1 - d)).weekday()
        weekend = 1.25 if dow >= 5 else 1.0
        seasonal = 1.0 + 0.12 * math.sin(2 * math.pi * d / 91)
        f = base * (1 + trend * d / DAYS) * weekend * seasonal
        if spike_start <= d < spike_start + 21:
            f *= spike_mult
        demand.append(max(1, int(round(f))))

    # Receipt days: every 30 days starting at day 0, last one at day 330 so the
    # final 34 days run down to the target closing stock with nothing inbound.
    receive_days = [d for d in range(0, DAYS, 30) if d <= 330]
    final_receive = max(receive_days)

    inv_rows, sale_rows, po_events = [], [], []
    pending_order_day = DAYS - lead + 3          # ordered just before window end
    pipeline: dict[int, int] = {}
    stock = int(fixed.get("opening_stock") or base * 12)

    for d in range(DAYS):
        day = END_DATE - timedelta(days=DAYS - 1 - d)
        opening = stock
        received = 0
        if d in receive_days:
            # Size the receipt against ACTUAL stock so sales are never clamped
            # (which would corrupt the demand record) and the final leg lands
            # exactly on the target closing stock.
            nxt = next((r for r in receive_days if r > d), DAYS)
            if d == final_receive:
                need = sum(demand[d:DAYS]) + closing_target
            else:
                need = sum(demand[d:nxt]) + buffer
            received = max(0, need - opening)
            pipeline[d] = received
        received = pipeline.pop(d, 0)
        sold = min(demand[d], max(opening + received, 0))
        closing_stock = opening + received - sold
        stock = closing_stock
        inv_rows.append({"date": day.isoformat(), "opening_stock": opening,
                         "received_quantity": received, "sold_quantity": sold,
                         "closing_stock": closing_stock})
        sale_rows.append({"date": day.isoformat(), "quantity": sold,
                          "revenue": round(sold * selling_price, 2),
                          "region": region_cycle[d % 4]})
        if d == pending_order_day:
            po_events.append({"order_idx": d, "qty": qty, "lead": lead,
                              "arrival_idx": d + lead})

    return {"unit_cost": unit_cost, "selling_price": selling_price, "inv": inv_rows,
            "sales": sale_rows, "po_events": po_events}


def _simulate_product(name: str, cat: dict, supplier: Supplier, rng: np.random.Generator,
                      fixed: dict | None = None) -> dict:
    """Simulate 365 days of demand + stock for one product; return rows + replenishment events.

    `fixed` pins the economic/demand parameters for signature demo products so the
    seeded data tells a reproducible story. The resulting classification is still
    fully derived at runtime by the analytics layer — nothing downstream knows
    these products were pinned.
    """
    unit_cost = float(fixed["unit_cost"]) if fixed else float(rng.uniform(*cat["cost"]))
    selling_price = (round(unit_cost * fixed["margin"], 2) if fixed
                     else round(unit_cost * float(rng.uniform(*cat["margin"])), 2))
    base_daily = float(fixed["base_daily"]) if fixed else float(rng.uniform(*cat["demand"]))
    trend = float(fixed["trend"]) if fixed else float(rng.uniform(-0.25, 0.45))
    spike_start = int(fixed["spike_start"]) if fixed else int(rng.integers(150, 320))
    spike_mult = (float(fixed["spike_mult"]) if fixed
                  else (float(rng.uniform(1.25, 1.5)) if rng.random() < 0.18 else 1.0))

    lead = supplier.lead_time_days
    safety = 1.65 * base_daily * math.sqrt(lead) * 0.6
    reorder_point = base_daily * lead + safety
    # Cover varies widely: lean buyers (~30 days) vs bulk buyers (~130 days) ->
    # produces a realistic mix of Healthy / Low / Critical / Overstock products
    # (bulk buyers breach the 90-day overstock policy and surface in analytics).
    order_qty = (int(fixed["order_qty"]) if fixed and fixed.get("order_qty")
                 else max(20, int(base_daily * float(rng.uniform(30, 130)))))

    if fixed and fixed.get("opening_stock") is not None:
        stock = int(fixed["opening_stock"])
    else:
        stock = int(base_daily * rng.uniform(18, 40)) + int(reorder_point)
    if fixed:
        # Signature demo product: use a fully crafted deterministic path (weekly
        # pattern + a recent demand spike + scheduled replenishments) so the
        # year-end state tells the intended story reproducibly.
        return _craft_path(name, fixed, lead, selling_price, unit_cost)
    pipeline: dict[int, int] = {}                      # day_index -> incoming qty
    inv_rows: list[dict] = []
    sale_rows: list[dict] = []
    po_events: list[dict] = []
    open_po = False

    for d in range(DAYS):
        day = END_DATE - timedelta(days=DAYS - 1 - d)
        dow = day.weekday()
        weekend = 1.25 if dow >= 5 else 1.0
        seasonal = 1.0 + 0.12 * math.sin(2 * math.pi * d / 91)
        demand_f = base_daily * (1 + trend * d / DAYS) * weekend * seasonal
        if spike_start <= d < spike_start + 21:
            demand_f *= spike_mult
        demand = int(rng.poisson(max(demand_f, 0.05)))

        opening = stock
        received = pipeline.pop(d, 0)
        sold = min(demand, max(opening + received, 0))
        closing = opening + received - sold
        stock = closing

        inv_rows.append({
            "date": day.isoformat(), "opening_stock": opening,
            "received_quantity": received, "sold_quantity": sold, "closing_stock": closing,
        })
        region = REGIONS[int(rng.integers(0, 4))]
        sale_rows.append({
            "date": day.isoformat(), "quantity": sold,
            "revenue": round(sold * selling_price, 2), "region": region,
        })

        # Replenishment policy: order when below reorder point (one open PO at a time).
        if not open_po and closing < reorder_point * 1.15 and closing + sum(pipeline.values()) < reorder_point * 1.15:
            arrival = d + lead
            pipeline[arrival] = pipeline.get(arrival, 0) + order_qty
            open_po = True
            po_events.append({"order_idx": d, "qty": order_qty, "lead": lead, "arrival_idx": arrival})
        if po_events and d >= po_events[-1]["arrival_idx"]:
            open_po = False  # last PO has arrived -> policy may order again

    return {"unit_cost": unit_cost, "selling_price": selling_price, "inv": inv_rows,
            "sales": sale_rows, "po_events": po_events}


def seed_demo_data() -> dict:
    """Reset and reseed the entire database. Returns summary counts."""
    engine = db_manager.engine()
    Base.metadata.create_all(engine)
    db = db_manager.sessionmaker()()

    # Wipe (order matters for FKs; SQLite has FKs off by default, Postgres enforced).
    for model in (Sale, InventoryDaily, PurchaseOrder, Product, Supplier, Category, User, Setting):
        db.execute(delete(model))
    db.commit()

    rng = np.random.default_rng(RNG_SEED)
    now = datetime.utcnow()

    categories = [Category(name=c["name"]) for c in CATEGORY_SPECS]
    db.add_all(categories)
    db.flush()

    suppliers: list[Supplier] = []
    for i, sname in enumerate(SUPPLIER_NAMES):
        perf = rng.random()
        s = Supplier(
            name=sname,
            contact_email=f"sales@{sname.split()[0].lower()}.example.com",
            lead_time_days=int(rng.integers(5, 26)),
            unit_cost=round(float(rng.uniform(0.92, 1.12)), 3),   # cost index vs market
            on_time_rate=round(float(np.clip(0.72 + perf * 0.25 + rng.uniform(-0.03, 0.03), 0.6, 0.99)), 3),
            defect_rate=round(float(np.clip(0.005 + (1 - perf) * 0.05 + rng.uniform(0, 0.01), 0.002, 0.08)), 4),
            reliability_score=round(float(np.clip(0.7 + rng.random() * 0.3, 0.5, 1.0)), 3),
        )
        suppliers.append(s)
    db.add_all(suppliers)
    db.flush()

    # Assign each category 2-4 suppliers; every supplier serves at least one category
    # (so all 15 appear in supplier analytics), and each product picks one supplier.
    cat_suppliers: dict[int, list[Supplier]] = {cat.id: [] for cat in categories}
    cat_ids = [c.id for c in categories]
    for i, s in enumerate(suppliers):
        cat_suppliers[cat_ids[i % len(cat_ids)]].append(s)
    for cid in cat_ids:
        k = int(rng.integers(1, 3))  # extra suppliers beyond the guaranteed one
        extra = [s for s in rng.choice(suppliers, size=k, replace=False) if s not in cat_suppliers[cid]]
        cat_suppliers[cid].extend(extra)

    products: list[Product] = []
    sim_results: list[dict] = []
    sku_n = 0
    for cat, spec in zip(categories, CATEGORY_SPECS):
        names = PRODUCT_NAMES[spec["name"]]
        n_products = 12 if len(names) >= 12 else len(names)
        forced = [n for n in SIGNATURE_PRODUCTS.get(spec["name"], []) if n in names]
        remaining = [n for n in names if n not in forced]
        chosen = forced + list(rng.choice(remaining, size=n_products - len(forced), replace=False))
        for pname in chosen:
            sku_n += 1
            supplier = cat_suppliers[cat.id][int(rng.integers(0, len(cat_suppliers[cat.id])))]
            fixed = SIGNATURE_SPECS.get(pname)
            if fixed is not None:
                # Signature product: bind it to the category supplier whose lead
                # time matches the demo spec (adjusted once, pre-commit).
                target_lead = int(fixed["lead_time_days"])
                supplier = min(cat_suppliers[cat.id],
                               key=lambda s: abs(s.lead_time_days - target_lead))
                supplier.lead_time_days = target_lead
            sim = _simulate_product(pname, spec, supplier, rng, fixed=fixed)
            lead = supplier.lead_time_days
            p = Product(
                sku=f"{cat.name[:3].upper()}-{sku_n:03d}",
                name=pname,
                category_id=cat.id,
                supplier_id=supplier.id,
                unit_cost=round(sim["unit_cost"], 2),
                selling_price=sim["selling_price"],
                lead_time_days=lead,
                active=bool(rng.random() > 0.02),
                created_at=now,
            )
            products.append(p)
            sim_results.append(sim)
    db.add_all(products)
    db.flush()

    po_rows: list[PurchaseOrder] = []
    for p, sim in zip(products, sim_results):
        supplier = next(s for s in suppliers if s.id == p.supplier_id)
        for ev in sim["po_events"]:
            order_day = END_DATE - timedelta(days=DAYS - 1 - ev["order_idx"])
            expected = order_day + timedelta(days=ev["lead"])
            if expected > END_DATE:
                # Ordered near the end of the window: still in the pipeline, not yet delivered.
                po_rows.append(PurchaseOrder(
                    po_number=f"PO-{order_day.strftime('%y%m')}-{len(po_rows) + 1:04d}",
                    product_id=p.id, supplier_id=supplier.id,
                    quantity=ev["qty"], unit_cost=p.unit_cost,
                    order_date=order_day.isoformat(), expected_date=expected.isoformat(),
                    actual_date=None, status="In Transit",
                ))
                continue
            delay_days = int(rng.choice([0, 1, 2, 3, 5], p=[0.86, 0.06, 0.04, 0.02, 0.02]))
            actual = expected + timedelta(days=delay_days)
            po_rows.append(PurchaseOrder(
                po_number=f"PO-{order_day.strftime('%y%m')}-{len(po_rows) + 1:04d}",
                product_id=p.id, supplier_id=supplier.id,
                quantity=ev["qty"], unit_cost=p.unit_cost,
                order_date=order_day.isoformat(), expected_date=expected.isoformat(),
                actual_date=actual.isoformat(), status="Delivered",
            ))
            # NOTE: receipts are already inside sim["inv"] via the pipeline; do not add again.

    # Recompute closing-stock chain after receipt adjustments (keep ledger consistent).
    for p, sim in zip(products, sim_results):
        running = None
        for row in sim["inv"]:
            if running is None:
                running = row["closing_stock"]
            else:
                row["opening_stock"] = running
                row["closing_stock"] = row["opening_stock"] + row["received_quantity"] - row["sold_quantity"]
                running = row["closing_stock"]

    # Recent in-flight POs (Draft/Pending/In Transit/Delayed/Cancelled) for a live-looking pipeline.
    recent_products = list(rng.choice(products, size=28, replace=False))
    for i, p in enumerate(recent_products):
        order_day = END_DATE - timedelta(days=int(rng.integers(1, 20)))
        expected = order_day + timedelta(days=p.lead_time_days)
        r = rng.random()
        if r < 0.12:
            status, actual, exp_eff = "Draft", None, expected
        elif r < 0.3:
            status, actual, exp_eff = "Pending", None, expected
        elif r < 0.55:
            status, actual, exp_eff = "In Transit", None, expected
        elif r < 0.68:
            status, actual, exp_eff = "Delayed", None, expected + timedelta(days=int(rng.integers(2, 9)))
        elif r < 0.75:
            status, actual, exp_eff = "Cancelled", None, expected
        else:  # already delivered quickly
            status, actual = "Delivered", min(expected - timedelta(days=int(rng.integers(0, 2))), END_DATE)
            exp_eff = expected
        po_rows.append(PurchaseOrder(
            po_number=f"PO-{order_day.strftime('%y%m')}-{len(po_rows) + 1:04d}",
            product_id=p.id, supplier_id=p.supplier_id,
            quantity=int(rng.integers(50, 300)), unit_cost=p.unit_cost,
            order_date=order_day.isoformat(), expected_date=exp_eff.isoformat(),
            actual_date=actual.isoformat() if actual else None, status=status,
        ))

    # --- Procurement-risk scenarios (deterministic, reproducible) ---
    #  1) Second-source splits: most products shift a slice of their delivered
    #     POs to a second category supplier (85/15-style) -> concentration data.
    #  2) Purchase-price step-ups: a few products see a +10-16% unit-cost
    #     increase in the last ~95 days -> price-variance alerts.
    #  The remainder stay single-source -> dependency-risk list.
    # Only supplier_id / unit_cost change; quantities and dates never do, so
    # the inventory ledger remains exactly consistent.
    eligible = [p for p in products
                if sum(1 for po in po_rows if po.status == "Delivered" and po.product_id == p.id) >= 6]
    step_up = set(rng.choice(eligible, size=min(6, len(eligible)), replace=False).tolist()) if eligible else set()
    split_pool = [p for p in eligible if p not in step_up]
    no_split = set(rng.choice(split_pool, size=min(28, len(split_pool)), replace=False).tolist()) if split_pool else set()
    price_cutoff = (END_DATE - timedelta(days=95)).isoformat()
    for p in products:
        rows = sorted((po for po in po_rows if po.status == "Delivered" and po.product_id == p.id),
                      key=lambda po: po.order_date)
        if len(rows) < 6:
            continue
        if p in step_up:
            for po in rows:
                if po.order_date >= price_cutoff:
                    po.unit_cost = round(po.unit_cost * float(rng.uniform(1.10, 1.16)), 2)
            continue
        if p in no_split:
            continue
        cands = [s for s in cat_suppliers[p.category_id] if s.id != p.supplier_id]
        if not cands:
            continue
        sec = cands[int(rng.integers(0, len(cands)))]
        n_move = max(1, int(len(rows) * float(rng.uniform(0.12, 0.22))))
        for po in rows[-n_move:]:
            po.supplier_id = sec.id

    db.add_all(po_rows)

    # Bulk sales + inventory.
    sales_objs = []
    for p, sim in zip(products, sim_results):
        for s in sim["sales"]:
            sales_objs.append(Sale(product_id=p.id, sale_date=s["date"], quantity=s["quantity"],
                                   revenue=s["revenue"], region=s["region"]))
    inv_objs = []
    for p, sim in zip(products, sim_results):
        for r in sim["inv"]:
            inv_objs.append(InventoryDaily(product_id=p.id, date=r["date"],
                                           opening_stock=r["opening_stock"],
                                           received_quantity=r["received_quantity"],
                                           sold_quantity=r["sold_quantity"],
                                           closing_stock=r["closing_stock"]))
    db.bulk_save_objects(sales_objs)
    db.bulk_save_objects(inv_objs)

    # Users + settings.
    db.add_all([
        User(name="Aarav Sharma", email="admin@supplychainiq.com", role="admin"),
        User(name="Priya Menon", email="manager@supplychainiq.com", role="manager"),
    ])
    db.add_all([Setting(key=k, value=v, kind=kind, label=label) for k, v, kind, label in SETTING_DEFAULTS])

    # Derive supplier observed stats from generated POs (internal consistency).
    po_stats: dict[int, dict] = {}
    for po in po_rows:
        st = po_stats.setdefault(po.supplier_id, {"n": 0, "ontime": 0})
        st["n"] += 1
        if po.actual_date and po.actual_date <= po.expected_date:
            st["ontime"] += 1
    for s in suppliers:
        st = po_stats.get(s.id)
        if st and st["n"] >= 3:
            s.on_time_rate = round(st["ontime"] / st["n"], 3)
    db.commit()

    counts = {
        "categories": db.scalar(select(func.count()).select_from(Category)),
        "suppliers": db.scalar(select(func.count()).select_from(Supplier)),
        "products": db.scalar(select(func.count()).select_from(Product)),
        "sales": db.scalar(select(func.count()).select_from(Sale)),
        "inventory_rows": db.scalar(select(func.count()).select_from(InventoryDaily)),
        "purchase_orders": db.scalar(select(func.count()).select_from(PurchaseOrder)),
        "users": db.scalar(select(func.count()).select_from(User)),
    }
    db.close()
    return counts
