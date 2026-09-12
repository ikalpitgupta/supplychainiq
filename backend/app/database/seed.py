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
from app.models import (Category, InventoryDaily, OutboundOrder, Product, Promotion, PurchaseOrder,
                        ReturnLine, Sale, Setting, Supplier, User, VariantInventory, Warehouse)

RNG_SEED = 42
DAYS = 365
END_DATE = date.today() - timedelta(days=1)  # seed ends yesterday; "today" has no partial data

# Catalog attribute pools (Inbound Intelligence · Catalog Quality).
COLORS = ["Black", "White", "Navy", "Olive", "Ivory", "Maroon", "Mustard", "Teal", "Blush", "Charcoal"]
MATERIALS = ["Cotton", "Rayon", "Denim", "Viscose", "Linen Blend", "Silk Blend", "Genuine Leather", "PU", "Georgette"]

CATEGORY_SPECS: list[dict] = [
    # Fashion e-commerce assortment (Myntra-style marketplace), ordered by
    # demand weight: apparel first, then footwear/beauty, then adjacencies.
    # name, unit-cost range (₹), margin range, demand scale (units/day), weekend uplift
    {"name": "Fashion", "cost": (180, 3500), "margin": (1.6, 2.4), "demand": (2.5, 14), "weekend": 1.45},
    {"name": "Footwear", "cost": (350, 4500), "margin": (1.55, 2.1), "demand": (1.5, 9), "weekend": 1.4},
    {"name": "Beauty", "cost": (80, 1400), "margin": (1.6, 2.3), "demand": (1.5, 10), "weekend": 1.25},
    {"name": "Accessories", "cost": (60, 1800), "margin": (1.7, 2.4), "demand": (2, 10), "weekend": 1.35},
    {"name": "Bags & Luggage", "cost": (250, 3200), "margin": (1.5, 2.0), "demand": (0.8, 6), "weekend": 1.3},
    {"name": "Sportswear", "cost": (200, 2800), "margin": (1.5, 1.95), "demand": (1, 7), "weekend": 1.3},
    {"name": "Home & Living", "cost": (150, 3000), "margin": (1.45, 1.9), "demand": (0.8, 5), "weekend": 1.2},
    {"name": "Personal Care", "cost": (50, 700), "margin": (1.4, 1.9), "demand": (2, 13), "weekend": 1.1},
]

# Signature products guaranteed to exist for the demo narrative. Each carries
# fixed economic parameters (within the seed's own deterministic discipline) so
# the resulting analytics tell the intended story — but every classification is
# still computed at runtime by the analytics layer from the seeded rows.
SIGNATURE_PRODUCTS = {"Fashion": ["Festive Kurta Set"],
                      "Footwear": ["Chunky Sneakers"],
                      "Beauty": ["Vitamin C Face Serum"]}

# Fixed spec for the marquee demo scenario (see README §Demo Scenario):
# Festive Kurta Set: ~20/day demand, 10-day lead time, ~120 units left, spike
# recently passed -> projected stock-out BEFORE replenishment arrives ->
# CRITICAL / ORDER NOW. (Fashion hero SKU: festive-season demand spike story.)
SIGNATURE_SPECS: dict[str, dict] = {
    "Festive Kurta Set": {
        "base_daily": 20.0, "trend": 0.10, "spike_start": 325, "spike_mult": 1.30,
        "closing_stock": 200, "opening_stock": 240, "order_qty": 500,
        "unit_cost": 640.0, "margin": 1.65, "lead_time_days": 10,
    },
}

PRODUCT_NAMES: dict[str, list[str]] = {
    "Fashion": ["Festive Kurta Set", "Floral Maxi Dress", "Slim Fit Jeans", "Oversized T-Shirt", "Linen Shirt",
                "Anarkali Gown", "Denim Jacket", "Pleated Skirt", "Chikankari Kurta", "Palazzo Pants",
                "Relaxed Cargo Pants", "Bodycon Party Dress", "Rayon Co-ord Set", "Cotton Jumpsuit",
                "Silk Blend Saree", "Hooded Sweatshirt", "Poplin Shirt Dress", "Wide-Leg Trousers",
                "Printed Kaftan", "Chino Shorts"],
    "Footwear": ["Chunky Sneakers", "White Court Sneakers", "Running Shoes", "Block Heels", "Kolhapuri Sandals",
                 "Tan Loafers", "Ankle Boots", "Ballet Flats", "Slip-On Sneakers", "Knit Joggers",
                 "Sports Sandals", "Oxford Formal Shoes", "Wedge Sandals", "Canvas Sneakers", "Heeled Mules",
                 "Trail Shoes", "EVA Flip Flops", "Platform Heels", "Embroidered Mojaris", "Football Studs"],
    "Beauty": ["Vitamin C Face Serum", "Sunscreen SPF50", "Lipstick Matte", "Shampoo Argan", "Face Moisturizer",
               "Perfume 50ml", "Nail Polish Set", "Sheet Mask Pack", "Body Lotion", "Kajal Eyeliner",
               "Lip Oil Tint", "Makeup Brush Set", "Anti-Dandruff Shampoo", "Toner Rose", "Lip Balm SPF",
               "Charcoal Soap", "Hair Serum", "BB Cream", "Eye Shadow Palette", "Setting Spray"],
    "Accessories": ["Layered Necklace", "Sunglasses UV400", "Leather Belt", "Silk Scarf", "Analog Watch",
                    "Hoop Earrings", "Charm Bracelet", "Ring Stack Set", "Hair Claw Clips", "Beanie Cap",
                    "Socks 3pk", "Scrunchie Set", "Silk Tie", "Cufflinks Brass", "Baseball Cap",
                    "Bandana Print", "Silver Anklet", "Vintage Brooch", "Straw Hat", "Phone Sling"],
    "Bags & Luggage": ["Canvas Tote Bag", "Mini Backpack", "Laptop Tote", "Evening Clutch", "Sling Bag",
                       "Weekender Duffel", "Bi-Fold Wallet", "Passport Cover", "Crossbody Bag", "Cabin Trolley 55cm",
                       "Card Holder RFID", "Bucket Bag", "Drawstring Backpack", "Jute Tote", "Pouch Organiser",
                       "Belt Bag", "Structured Handbag", "Luggage Tag", "Gym Duffel", "Puffy Tote"],
    "Sportswear": ["Yoga Leggings", "Training T-Shirt", "Gym Shorts", "Sports Bra", "Track Jacket",
                   "Seamless Leggings", "Running Tights", "Compression Tee", "Gym Tank", "Windbreaker",
                   "Wicking Socks 2pk", "Training Gloves", "Yoga Mat 6mm", "Speed Jump Rope", "Dumbbell Pair 5kg",
                   "Shaker Bottle 700ml", "Ankle Support", "Swim Goggles", "Badminton Racket", "Cycling Helmet"],
    "Home & Living": ["Queen Bedsheet Set", "Cushion Cover 5pk", "Scented Candle", "Ceramic Mug Set", "Wall Art Print",
                      "Storage Basket", "Table Runner", "Dinner Set 16pc", "Ceramic Planter", "Photo Frame Set",
                      "String Lights", "Woven Rug 3x5", "Sheer Curtains 2pc", "Wooden Table Lamp", "Bath Towel Set",
                      "Kitchen Jar Set", "Cork Coasters 6pk", "Glass Vase", "Serving Tray Wooden", "Throw Blanket"],
    "Personal Care": ["Electric Toothbrush", "Herbal Toothpaste", "Bath Towel Set", "Hair Conditioner",
                      "Shaving Razor 4pk", "Deodorant Spray", "Neem Face Wash", "Citrus Body Wash",
                      "Hand Sanitizer", "Cotton Buds 200pk", "Foot Cream", "Dental Floss", "Loofah Pack",
                      "Bath Sponge", "Talcum Powder", "Mouthwash 500ml", "Hair Gel", "Sunscreen Gel",
                      "Lip Care Winter", "Knee Support"],
}

SUPPLIER_NAMES = [
    "Arvind Textiles Pvt Ltd", "Bombay Fashions Hub", "Kalathur Weaves", "UrbanStitch Apparel",
    "GlowCare Cosmetics", "SoleCraft Footwear", "Aura Beauty Labs", "Zen Leather Goods",
    "LoomAndLoop Knitwear", "PearlRoute Jewellery", "Denimo Mills", "Verve Activewear",
    "HomeAura Living", "SilkRoute Traders", "Metro Garments Co",
]

REGIONS = ["North", "South", "East", "West"]

# --- Outbound supply chain (fashion e-commerce) -----------------------------
# Regional DCs; each customer region maps to its home warehouse.
WAREHOUSE_ROWS: list[dict] = [
    {"code": "DEL", "name": "Delhi North DC", "region": "North"},
    {"code": "MUM", "name": "Mumbai West DC", "region": "West"},
    {"code": "BLR", "name": "Bengaluru South DC", "region": "South"},
    {"code": "CCU", "name": "Kolkata East DC", "region": "East"},
]
REGION_HOME_DC = {"North": "DEL", "West": "MUM", "South": "BLR", "East": "CCU"}
REGION_WAREHOUSE_SHARE = {"North": 0.32, "West": 0.28, "South": 0.22, "East": 0.18}

SIZE_WEIGHTS: dict[str, float] = {"XS": 0.06, "S": 0.16, "M": 0.26, "L": 0.26, "XL": 0.17, "XXL": 0.09}
SIZED_CATEGORIES = {"Fashion", "Footwear", "Sportswear"}
CARRIERS = ["BlueDart", "Delhivery", "Ekart", "XpressBees"]

# Category-level return-rate experience, used to seed returns so the measured
# rates in the app land near realistic fashion e-commerce levels.
RETURN_RATE_BY_CATEGORY: dict[str, float] = {
    "Fashion": 0.22, "Footwear": 0.26, "Sportswear": 0.18, "Accessories": 0.10,
    "Bags & Luggage": 0.09, "Home & Living": 0.07, "Beauty": 0.04, "Personal Care": 0.04,
}
RETURN_REASONS_SIZED = [("Size issue", 0.38), ("Fit issue", 0.22), ("Quality concern", 0.14),
                        ("Not as described", 0.14), ("Changed mind", 0.12)]
RETURN_REASONS_ONE_SIZE = [("Quality concern", 0.30), ("Not as described", 0.28),
                           ("Changed mind", 0.26), ("Damaged in transit", 0.16)]

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
    from app.database.migrations import run_light_migrations
    run_light_migrations(engine)
    db = db_manager.sessionmaker()()

    # Wipe (order matters for FKs; SQLite has FKs off by default, Postgres enforced).
    for model in (ReturnLine, OutboundOrder, VariantInventory, Warehouse,
                  Promotion, Sale, InventoryDaily, PurchaseOrder, Product, Supplier, Category, User, Setting):
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
            # Catalog attributes (Inbound Intelligence · Catalog Quality): most
            # products ship complete, a deterministic slice carries gaps for the
            # quality scan. Signature products are always complete so the hero
            # demo looks its best. MRP/discount bands and a slice of recent price
            # changes feed the Pricing section.
            is_sig = fixed is not None
            sized_cat = spec["name"] in SIZED_CATEGORIES
            r_color, r_mat, r_desc, r_img = (float(rng.random()) for _ in range(4))
            r_sizechart = float(rng.random())
            color = str(rng.choice(COLORS))
            material = str(rng.choice(MATERIALS))
            mrp_mult = float(rng.choice([1.0, 1.15, 1.2, 1.35, 1.5], p=[0.35, 0.25, 0.15, 0.15, 0.1]))
            price_up = (not is_sig) and float(rng.random()) < 0.10
            price_down = (not is_sig) and (not price_up) and float(rng.random()) < 0.08
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
                color=None if (not is_sig and r_color < 0.08) else color,
                material=None if (not is_sig and r_mat < 0.16) else material,
                description=(None if (not is_sig and r_desc < 0.24) else
                             f"{pname} — {material.lower()} {spec['name'].lower()} essential in {color.lower()}; "
                             "everyday wearability with easy care."),
                images_json=(None if (not is_sig and r_img < 0.12) else
                             f'"[/img/{sku_n:03d}.jpg","/img/{sku_n:03d}-2.jpg"]'),
                size_chart_json=(None if (not is_sig and sized_cat and r_sizechart < 0.22) else
                                 '{"S":"38","M":"40","L":"42","XL":"44"}'),
                mrp=round(sim["selling_price"] * mrp_mult, 2),
                price_prev=(round(sim["selling_price"] / 1.12, 2) if price_up else
                            round(sim["selling_price"] * 0.90, 2) if price_down else None),
                price_changed_at=((now - timedelta(days=int(rng.integers(10, 55))))
                                  if (price_up or price_down) else None),
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

    # ------------------------------------------------------------------
    # Outbound supply chain: warehouses, variant stock, customer orders,
    # returns. This is the fashion e-commerce OUTBOUND story — inventory
    # imbalance → longer routes → SLA breaches → cancellations/returns.
    # ------------------------------------------------------------------
    whs = [Warehouse(**w) for w in WAREHOUSE_ROWS]
    db.add_all(whs)
    db.flush()

    cat_name_by_id = {c.id: c.name for c in categories}
    prod_cat_name = {p.id: cat_name_by_id[p.category_id] for p in products}

    # Variant inventory: split each product's closing stock across sizes and
    # warehouses (sized categories by size weights; others "One Size"). The
    # South DC deliberately holds only ~40% of its fair share → regional
    # imbalance. Sums reconcile with the legacy ledger's closing stock.
    variant_objs: list[VariantInventory] = []
    stock_split: dict[int, dict[str, dict[int, int]]] = {}   # pid → size → wh_id → units
    for p, sim in zip(products, sim_results):
        total_units = max(0, int(sim["inv"][-1]["closing_stock"]))
        if total_units == 0:
            continue
        sized = cat_name_by_id[p.category_id] in SIZED_CATEGORIES
        sizes = list(SIZE_WEIGHTS) if sized else ["One Size"]
        weights = [SIZE_WEIGHTS[s] for s in sizes] if sized else [1.0]
        wsum = sum(weights)
        shares_raw = [REGION_WAREHOUSE_SHARE[wh.region] * (0.4 if wh.code == "BLR" else 1.0) for wh in whs]
        ssum = sum(shares_raw)
        for size, w in zip(sizes, weights):
            size_units = int(round(total_units * w / wsum))
            for wid, share in enumerate(shares_raw):
                units = int(round(size_units * share / ssum))
                if units > 0:
                    variant_objs.append(VariantInventory(
                        product_id=p.id, size=size, warehouse_id=whs[wid].id, units=units))
                    stock_split.setdefault(p.id, {}).setdefault(size, {})[whs[wid].id] = units
    db.add_all(variant_objs)

    # Promotion campaigns: three windows inside the outbound period. Orders
    # placed inside a window are attributed to the campaign with the discounted
    # paid price — the Promotions analysis derives conversion and margin
    # impact from these rows, nothing is asserted.
    campaign_objs = [
        Promotion(name="End of Season Sale", kind="End of Season", discount_pct=0.30,
                  start_date=(END_DATE - timedelta(days=75)).isoformat(),
                  end_date=(END_DATE - timedelta(days=61)).isoformat()),
        Promotion(name="Independence Day Flash", kind="Flash", discount_pct=0.20,
                  start_date=(END_DATE - timedelta(days=45)).isoformat(),
                  end_date=(END_DATE - timedelta(days=39)).isoformat()),
        Promotion(name="Festive Dhamaka", kind="Festive", discount_pct=0.40,
                  start_date=(END_DATE - timedelta(days=21)).isoformat(),
                  end_date=(END_DATE - timedelta(days=8)).isoformat()),
    ]
    db.add_all(campaign_objs)
    db.flush()

    # Outbound orders: last 90 days. Each order ships from the customer's home
    # DC when that DC is reasonably stocked for the size; otherwise it is
    # distant-routed (longer dispatch + more lateness) — the designed causal
    # chain. Fulfillment stage durations live on the row so bottleneck analysis
    # is computed, not asserted.
    out_start = (END_DATE - timedelta(days=90)).isoformat()
    order_objs: list[OutboundOrder] = []
    delivered_orders: list[OutboundOrder] = []
    order_seq = 0
    for p, sim in zip(products, sim_results):
        sized = cat_name_by_id[p.category_id] in SIZED_CATEGORIES
        sizes = list(SIZE_WEIGHTS) if sized else ["One Size"]
        size_probs = [SIZE_WEIGHTS[s] for s in sizes] if sized else [1.0]
        for r in sim["inv"]:
            if r["date"] < out_start or r["sold_quantity"] <= 0:
                continue
            lines = 1 if r["sold_quantity"] < 3 else 2
            base = r["sold_quantity"] // lines
            for ln in range(lines):
                qty = base + (1 if ln < r["sold_quantity"] % lines else 0)
                if qty <= 0:
                    continue
                order_seq += 1
                region = REGIONS[int(rng.choice(4, p=[0.32, 0.28, 0.22, 0.18]))]
                home = next(wh for wh in whs if wh.code == REGION_HOME_DC[region])
                size = str(rng.choice(sizes, p=size_probs))
                size_stock = stock_split.get(p.id, {}).get(size, {})
                total_size = sum(size_stock.values()) or 1
                local_share = size_stock.get(home.id, 0) / total_size
                local = local_share >= 0.25          # home DC reasonably stocked?
                order_day = date.fromisoformat(r["date"])
                promised = order_day + timedelta(days=3)

                # Campaign attribution: orders inside a campaign window have a
                # 55% likelihood of carrying the campaign tag with the discounted
                # paid price (the rest are organic traffic that overlaps the sale).
                promo = next((c for c in campaign_objs
                              if date.fromisoformat(c.start_date) <= order_day
                              <= date.fromisoformat(c.end_date)), None)
                if promo is not None and float(rng.random()) < 0.55:
                    order_campaign = promo.id
                    paid_price = round(p.selling_price * (1 - promo.discount_pct), 2)
                else:
                    order_campaign = None
                    paid_price = None

                pick_h = round(float(rng.uniform(1.4, 3.0)), 1)
                pack_h = round(float(rng.uniform(0.5, 1.5)), 1)
                disp_h = round(float(rng.uniform(5, 10)) if local else float(rng.uniform(20, 34)), 1)
                carrier = str(rng.choice(CARRIERS))

                roll = float(rng.random())
                cancelled = roll < (0.16 if not local else 0.07)
                recent = (END_DATE - order_day).days <= 3
                if cancelled:
                    status, delivered, reason = "Cancelled", None, "Stock unavailability at home DC" if not local else None
                elif recent:
                    status, delivered, reason = "In Progress", None, None
                else:
                    on_time = local and float(rng.random()) < 0.93 or (not local and float(rng.random()) < 0.55)
                    if on_time:
                        status, delivered, reason = "Delivered", promised, None
                    else:
                        status = "Delivered"
                        delivered = promised + timedelta(days=int(rng.integers(1, 4)))
                        if delivered > END_DATE:
                            delivered = END_DATE
                        if not local:
                            reason = str(rng.choice(["Routed from distant DC", "Carrier delay"], p=[0.6, 0.4]))
                        else:
                            reason = str(rng.choice(["Carrier delay", "High volume at DC"], p=[0.7, 0.3]))
                    if status == "Delivered":
                        reason = reason if delivered and delivered > promised else None

                o = OutboundOrder(
                    order_number=f"SO-{order_day.strftime('%y%m')}-{order_seq:06d}",
                    product_id=p.id, size=size, warehouse_id=home.id, region=region,
                    quantity=qty, revenue=round(qty * p.selling_price, 2),
                    order_date=r["date"], promised_date=promised.isoformat(),
                    delivered_date=delivered.isoformat() if delivered else None,
                    pick_hours=pick_h if not cancelled else round(pick_h, 1),
                    pack_hours=pack_h if not cancelled else None,
                    dispatch_hours=disp_h if status in ("Delivered", "Dispatched") and not cancelled else None,
                    carrier=carrier, delay_reason=reason, status=status,
                    campaign_id=order_campaign, paid_price=paid_price,
                )
                order_objs.append(o)
                if status == "Delivered" and delivered:
                    delivered_orders.append(o)
    db.add_all(order_objs)
    db.flush()

    # Returns: measured from delivered orders using category return-rate
    # experience, with reason mixes that differ for sized vs one-size goods.
    return_objs: list[ReturnLine] = []
    for o in delivered_orders:
        rate = RETURN_RATE_BY_CATEGORY.get(prod_cat_name[o.product_id], 0.08)
        if float(rng.random()) >= rate:
            continue
        sized = prod_cat_name[o.product_id] in SIZED_CATEGORIES
        pool = RETURN_REASONS_SIZED if sized else RETURN_REASONS_ONE_SIZE
        reason = str(rng.choice([r for r, _ in pool], p=[w for _, w in pool]))
        rdate = min(date.fromisoformat(o.delivered_date) + timedelta(days=int(rng.integers(2, 6))), END_DATE)
        return_objs.append(ReturnLine(
            order_id=o.id, product_id=o.product_id, return_date=rdate.isoformat(),
            reason=reason,
            disposition=str(rng.choice(["Restock", "Refurbish", "Write-off"], p=[0.82, 0.12, 0.06])),
        ))
    db.add_all(return_objs)

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
        "warehouses": db.scalar(select(func.count()).select_from(Warehouse)),
        "variant_rows": db.scalar(select(func.count()).select_from(VariantInventory)),
        "outbound_orders": db.scalar(select(func.count()).select_from(OutboundOrder)),
        "returns": db.scalar(select(func.count()).select_from(ReturnLine)),
        "users": db.scalar(select(func.count()).select_from(User)),
    }
    db.close()
    return counts
