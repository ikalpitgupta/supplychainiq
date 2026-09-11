"""CSV import/export: products, sales, inventory, suppliers in; 4 entities out.

Import validates every row and returns a per-row report; malformed rows never
crash the process. Export streams CSV from live data.
"""
from __future__ import annotations

import csv
import io
from datetime import date

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import Category, InventoryDaily, Product, PurchaseOrder, Sale, Supplier


def _to_float(v, default=None):
    try:
        return float(v)
    except (TypeError, ValueError):
        return default


def _to_int(v, default=None):
    try:
        return int(float(v))
    except (TypeError, ValueError):
        return default


def import_products(db: Session, file) -> dict:
    text = io.StringIO(file.file.read().decode("utf-8-sig", errors="replace"))
    reader = csv.DictReader(text)
    if not reader.fieldnames or "sku" not in [f.strip().lower() for f in reader.fieldnames]:
        return {"imported": 0, "failed": 0, "errors": [{"row": 0, "error": "CSV must include a 'sku' column"}], "total": 0}
    cats = dict(db.execute(select(Category.id, Category.name)).all())  # {id: name}
    cat_by_name = {name.lower(): cid for cid, name in cats.items()}
    sups = {s.name.lower(): s.id for s in db.query(Supplier).all()}
    imported, errors = 0, []
    for i, row in enumerate(reader, start=2):
        try:
            sku = (row.get("sku") or "").strip()
            name = (row.get("name") or "").strip()
            if not sku or not name:
                raise ValueError("sku and name are required")
            unit_cost = _to_float(row.get("unit_cost"))
            if unit_cost is None or unit_cost <= 0:
                raise ValueError("unit_cost must be a positive number")
            selling = _to_float(row.get("selling_price"), unit_cost)
            lead = _to_int(row.get("lead_time_days"), 10)
            cat_name = (row.get("category") or "").strip().lower()
            cat_id = cat_by_name.get(cat_name)
            if cat_id is None:
                cat = Category(name=(row.get("category") or "Uncategorized").strip())
                db.add(cat)
                db.flush()
                cat_id, cat_by_name[cat_name] = cat.id, cat_name
            sup_id = sups.get((row.get("supplier") or "").strip().lower())
            existing = db.query(Product).filter(Product.sku == sku).first()
            if existing:
                existing.name, existing.unit_cost = name, unit_cost
                existing.selling_price, existing.lead_time_days = selling, lead
                existing.category_id, existing.supplier_id = cat_id, sup_id
            else:
                db.add(Product(sku=sku, name=name, category_id=cat_id, supplier_id=sup_id,
                               unit_cost=unit_cost, selling_price=selling, lead_time_days=lead))
            imported += 1
        except Exception as exc:
            errors.append({"row": i, "error": str(exc)[:200]})
    db.commit()
    return {"imported": imported, "failed": len(errors), "errors": errors[:50], "total": imported + len(errors)}


def import_sales(db: Session, file) -> dict:
    text = io.StringIO(file.file.read().decode("utf-8-sig", errors="replace"))
    reader = csv.DictReader(text)
    skus = {p.sku.lower(): p.id for p in db.query(Product).all()}
    prices = {p.id: p.selling_price for p in db.query(Product).all()}
    imported, errors = 0, []
    batch = []
    for i, row in enumerate(reader, start=2):
        try:
            sku = (row.get("sku") or "").strip().lower()
            pid = skus.get(sku)
            if pid is None:
                raise ValueError(f"unknown sku '{row.get('sku')}'")
            d = (row.get("sale_date") or "").strip()
            date.fromisoformat(d)
            q = _to_int(row.get("quantity"))
            if q is None or q < 0:
                raise ValueError("quantity must be a non-negative integer")
            price = _to_float(row.get("revenue"), None)
            revenue = price if price is not None else q * prices.get(pid, 0.0)
            batch.append(Sale(product_id=pid, sale_date=d, quantity=q, revenue=revenue,
                              region=(row.get("region") or "North").strip()))
            imported += 1
        except Exception as exc:
            errors.append({"row": i, "error": str(exc)[:200]})
    if batch:
        db.bulk_save_objects(batch)
        db.commit()
    return {"imported": imported, "failed": len(errors), "errors": errors[:50], "total": imported + len(errors)}


def import_inventory(db: Session, file) -> dict:
    text = io.StringIO(file.file.read().decode("utf-8-sig", errors="replace"))
    reader = csv.DictReader(text)
    skus = {p.sku.lower(): p.id for p in db.query(Product).all()}
    imported, errors, batch = 0, [], []
    for i, row in enumerate(reader, start=2):
        try:
            sku = (row.get("sku") or "").strip().lower()
            pid = skus.get(sku)
            if pid is None:
                raise ValueError(f"unknown sku '{row.get('sku')}'")
            d = (row.get("date") or "").strip()
            date.fromisoformat(d)
            opening = _to_int(row.get("opening_stock"), 0) or 0
            received = _to_int(row.get("received_quantity"), 0) or 0
            sold = _to_int(row.get("sold_quantity"), 0) or 0
            closing = row.get("closing_stock")
            closing = _to_int(closing) if closing not in (None, "") else opening + received - sold
            batch.append(InventoryDaily(product_id=pid, date=d, opening_stock=opening,
                                        received_quantity=received, sold_quantity=sold,
                                        closing_stock=closing))
            imported += 1
        except Exception as exc:
            errors.append({"row": i, "error": str(exc)[:200]})
    if batch:
        db.bulk_save_objects(batch)
        db.commit()
    return {"imported": imported, "failed": len(errors), "errors": errors[:50], "total": imported + len(errors)}


def import_suppliers(db: Session, file) -> dict:
    text = io.StringIO(file.file.read().decode("utf-8-sig", errors="replace"))
    reader = csv.DictReader(text)
    imported, errors = 0, []
    for i, row in enumerate(reader, start=2):
        try:
            name = (row.get("name") or "").strip()
            if not name:
                raise ValueError("name is required")
            existing = db.query(Supplier).filter(Supplier.name == name).first()
            lead = _to_int(row.get("lead_time_days"), 10) or 10
            unit_cost = _to_float(row.get("unit_cost"), 1.0) or 1.0
            ontime = _to_float(row.get("on_time_rate"), 0.9) or 0.9
            defect = _to_float(row.get("defect_rate"), 0.02) or 0.02
            rel = _to_float(row.get("reliability_score"), 0.85) or 0.85
            if existing:
                existing.lead_time_days, existing.unit_cost = lead, unit_cost
                existing.on_time_rate, existing.defect_rate = ontime, defect
                existing.reliability_score = rel
            else:
                db.add(Supplier(name=name, lead_time_days=lead, unit_cost=unit_cost,
                                on_time_rate=ontime, defect_rate=defect, reliability_score=rel))
            imported += 1
        except Exception as exc:
            errors.append({"row": i, "error": str(exc)[:200]})
    db.commit()
    return {"imported": imported, "failed": len(errors), "errors": errors[:50], "total": imported + len(errors)}


IMPORTERS = {"products": import_products, "sales": import_sales,
             "inventory": import_inventory, "suppliers": import_suppliers}


def preview_import(db: Session, entity: str, file) -> dict:
    """Dry-run an import: report which rows would create, update, or fail.

    Never writes. For products and suppliers — the upsert entities — updates
    include a field-level old → new diff so the UI can warn before overwrites.
    """
    text = io.StringIO(file.file.read().decode("utf-8-sig", errors="replace"))
    reader = csv.DictReader(text)
    headers = [f.strip().lower() for f in (reader.fieldnames or [])]

    def row_errors_for(row: dict) -> list[str]:
        errs: list[str] = []
        if entity == "products":
            if not (row.get("sku") or "").strip() or not (row.get("name") or "").strip():
                errs.append("sku and name are required")
            if _to_float(row.get("unit_cost")) is None or (_to_float(row.get("unit_cost")) or 0) <= 0:
                errs.append("unit_cost must be a positive number")
        elif entity == "suppliers":
            if not (row.get("name") or "").strip():
                errs.append("name is required")
        elif entity in ("sales", "inventory"):
            if not (row.get("sku") or "").strip():
                errs.append("sku is required")
            d = (row.get("sale_date" if entity == "sales" else "date") or "").strip()
            try:
                date.fromisoformat(d)
            except (TypeError, ValueError):
                errs.append("date must be YYYY-MM-DD")
            q = _to_int(row.get("quantity"))
            if entity == "sales" and (q is None or q < 0):
                errs.append("quantity must be a non-negative integer")
        return errs

    changes: list[dict] = []
    creates, invalid = 0, []

    if entity == "products":
        cats = {name.lower(): cid for cid, name in db.execute(select(Category.id, Category.name)).all()}
        cat_names = {cid: name for cid, name in db.execute(select(Category.id, Category.name)).all()}
        sups = {s.name.lower(): s.id for s in db.query(Supplier).all()}
        sup_names = {s.id: s.name for s in db.query(Supplier).all()}
        by_sku = {p.sku.lower(): p for p in db.query(Product).all()}
        for i, row in enumerate(reader, start=2):
            errs = row_errors_for(row)
            if errs:
                invalid.append({"row": i, "error": "; ".join(errs)})
                continue
            sku = (row.get("sku") or "").strip()
            unit_cost = _to_float(row.get("unit_cost"))
            existing = by_sku.get(sku.lower())
            if existing is None:
                creates += 1
                continue
            fields: list[dict] = []
            # Normalize to what the importer will actually store: an omitted
            # supplier column leaves the product unlinked (None), and an empty
            # category lands in "Uncategorized".
            new_supplier = (row.get("supplier") or "").strip()
            new_category = (row.get("category") or "").strip() or "Uncategorized"
            new_vals = {
                "name": (row.get("name") or "").strip(),
                "unit_cost": unit_cost,
                "selling_price": _to_float(row.get("selling_price"), existing.selling_price),
                "lead_time_days": _to_int(row.get("lead_time_days"), existing.lead_time_days),
                "category": new_category,
                "supplier": new_supplier or None,
            }
            for field, new in new_vals.items():
                old = {
                    "name": existing.name, "unit_cost": existing.unit_cost,
                    "selling_price": existing.selling_price, "lead_time_days": existing.lead_time_days,
                    "category": cat_names.get(existing.category_id),
                    "supplier": sup_names.get(existing.supplier_id),
                }[field]
                if new is not None and old != new:
                    fields.append({"field": field, "old": old, "new": new})
            if fields:
                changes.append({"row": i, "key": sku, "name": existing.name, "fields": fields})

    elif entity == "suppliers":
        by_name = {s.name.lower(): s for s in db.query(Supplier).all()}
        for i, row in enumerate(reader, start=2):
            errs = row_errors_for(row)
            if errs:
                invalid.append({"row": i, "error": "; ".join(errs)})
                continue
            name = (row.get("name") or "").strip()
            existing = by_name.get(name.lower())
            if existing is None:
                creates += 1
                continue
            fields: list[dict] = []
            new_vals = {
                "lead_time_days": _to_int(row.get("lead_time_days"), existing.lead_time_days),
                "unit_cost": _to_float(row.get("unit_cost"), existing.unit_cost),
                "on_time_rate": _to_float(row.get("on_time_rate"), existing.on_time_rate),
                "defect_rate": _to_float(row.get("defect_rate"), existing.defect_rate),
                "reliability_score": _to_float(row.get("reliability_score"), existing.reliability_score),
            }
            for field, new in new_vals.items():
                old = {
                    "lead_time_days": existing.lead_time_days, "unit_cost": existing.unit_cost,
                    "on_time_rate": existing.on_time_rate, "defect_rate": existing.defect_rate,
                    "reliability_score": existing.reliability_score,
                }[field]
                if new is not None and old != new:
                    fields.append({"field": field, "old": old, "new": new})
            if fields:
                changes.append({"row": i, "key": name, "name": name, "fields": fields})

    else:  # sales / inventory: append-only
        skus = {p.sku.lower(): p.id for p in db.query(Product).all()}
        for i, row in enumerate(reader, start=2):
            errs = row_errors_for(row)
            if errs:
                invalid.append({"row": i, "error": "; ".join(errs)})
                continue
            if (row.get("sku") or "").strip().lower() not in skus:
                invalid.append({"row": i, "error": f"unknown sku '{row.get('sku')}'"})
                continue
            creates += 1

    appends = creates if entity in ("sales", "inventory") else None
    return {
        "entity": entity,
        "mode": "append" if entity in ("sales", "inventory") else "upsert",
        "creates": creates if entity in ("products", "suppliers") else creates,
        "updates": len(changes),
        "invalid_count": len(invalid),
        "invalid": invalid[:20],
        "changes": changes[:20],
        "changes_truncated": max(0, len(changes) - 20) if len(changes) > 20 else 0,
        "appends": appends,
    }


def export_csv(db: Session, entity: str) -> tuple[str, str]:
    """Returns (filename, csv_text). Pure-Python CSV from live data."""
    if entity == "inventory":
        rows = db.execute(
            select(
                Product.sku, Product.name, InventoryDaily.date, InventoryDaily.opening_stock,
                InventoryDaily.received_quantity, InventoryDaily.sold_quantity,
                InventoryDaily.closing_stock)
            .join(InventoryDaily, InventoryDaily.product_id == Product.id)
            .order_by(InventoryDaily.date.desc(), Product.sku)).all()
        header = ["sku", "product", "date", "opening_stock", "received", "sold", "closing_stock"]
        data = [list(r) for r in rows]
    elif entity == "suppliers":
        sups = db.query(Supplier).all()
        header = ["id", "name", "contact_email", "lead_time_days", "unit_cost",
                  "on_time_rate", "defect_rate", "reliability_score"]
        data = [[s.id, s.name, s.contact_email, s.lead_time_days, s.unit_cost,
                 s.on_time_rate, s.defect_rate, s.reliability_score] for s in sups]
    elif entity == "purchase-orders":
        pos = db.query(PurchaseOrder).all()
        prod = dict(db.execute(select(Product.id, Product.name)).all())
        sups = dict(db.execute(select(Supplier.id, Supplier.name)).all())
        header = ["po_number", "product", "supplier", "quantity", "unit_cost", "total_cost",
                  "order_date", "expected_date", "actual_date", "status"]
        data = [[po.po_number, prod.get(po.product_id, "?"), sups.get(po.supplier_id, "?"),
                 po.quantity, po.unit_cost, round(po.quantity * po.unit_cost, 2),
                 po.order_date, po.expected_date, po.actual_date or "", po.status] for po in pos]
    elif entity == "recommendations":
        from app.services.recommendation_service import build_recommendations
        recs = build_recommendations(db)["items"]
        header = ["sku", "product", "category", "action", "risk_level", "current_stock",
                  "reorder_point", "recommended_quantity", "preferred_supplier", "estimated_cost", "reason"]
        data = [[r["sku"], r["product"], r["category"], r["action"], r["risk_level"],
                 r["current_stock"], r["reorder_point"], r["recommended_quantity"],
                 r["preferred_supplier"], r["estimated_cost"], r["reason"]] for r in recs]
    else:
        raise ValueError(f"Unknown export entity '{entity}'")

    buf = io.StringIO()
    writer = csv.writer(buf)
    writer.writerow(header)
    writer.writerows(data)
    return f"{entity}_{date.today().isoformat()}.csv", buf.getvalue()
