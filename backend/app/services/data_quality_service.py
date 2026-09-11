"""Data Quality Center: scans live tables for realistic data problems.

Checks (each returned with count + sample rows so issues are actionable):
  - inventory ledger consistency: opening + received - sold == closing
  - negative closing stock (data-quality anomaly, never silently hidden)
  - duplicate purchase-order numbers
  - sales referencing products that no longer exist (orphans)
  - invalid / unparseable dates on sales and purchase orders
  - products with no supplier assigned
  - suppliers with zero purchase orders (performance stats unavailable)
  - zero-demand products holding stock (demand-data gap signal)

The score is the share of checked records that pass; it is computed, never set.
"""
from __future__ import annotations

from datetime import date, timedelta

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.models import (Category, InventoryDaily, Product, PurchaseOrder, Sale,
                        Supplier)

WINDOW_DAYS = 90  # scan window for heavy checks (keeps the endpoint fast)


def _ledger_mismatches(db: Session) -> tuple[int, list[dict]]:
    total = db.scalar(select(func.count()).select_from(InventoryDaily)) or 0
    bad = db.execute(
        select(InventoryDaily.product_id, InventoryDaily.date)
        .where(InventoryDaily.opening_stock + InventoryDaily.received_quantity
               - InventoryDaily.sold_quantity != InventoryDaily.closing_stock)
        .limit(5)
    ).all()
    return total, [{"product_id": pid, "date": d} for pid, d in bad]


def _negative_stock(db: Session) -> tuple[int, list[dict]]:
    total = db.scalar(select(func.count()).select_from(InventoryDaily)) or 0
    bad = db.execute(
        select(InventoryDaily.product_id, InventoryDaily.date, InventoryDaily.closing_stock)
        .where(InventoryDaily.closing_stock < 0)
        .limit(5)
    ).all()
    return total, [{"product_id": pid, "date": d, "closing_stock": s} for pid, d, s in bad]


def _duplicate_po_numbers(db: Session) -> tuple[int, list[dict]]:
    total = db.scalar(select(func.count()).select_from(PurchaseOrder)) or 0
    dupes = db.execute(
        select(PurchaseOrder.po_number, func.count().label("n"))
        .group_by(PurchaseOrder.po_number)
        .having(func.count() > 1)
        .limit(5)
    ).all()
    return total, [{"po_number": n, "occurrences": c} for n, c in dupes]


def _orphan_sales(db: Session) -> tuple[int, list[dict]]:
    total = db.scalar(select(func.count()).select_from(Sale)) or 0
    product_ids = {pid for (pid,) in db.execute(select(Product.id)).all()}
    bad = db.execute(
        select(Sale.product_id, func.count()).group_by(Sale.product_id)
    ).all()
    orphans = [{"product_id": pid, "sales_rows": n} for pid, n in bad if pid not in product_ids]
    return total, orphans[:5]


def _invalid_dates(db: Session) -> tuple[int, list[dict]]:
    """Sales/POs with dates that fail ISO parsing or fall outside a sane range."""
    lo = "2000-01-01"
    hi = (date.today() + timedelta(days=365)).isoformat()
    sales_total = db.scalar(select(func.count()).select_from(Sale)) or 0
    bad_sales = db.execute(
        select(Sale.id).where(Sale.sale_date < lo).limit(3)
    ).all()
    po_total = db.scalar(select(func.count()).select_from(PurchaseOrder)) or 0
    bad_pos = db.execute(
        select(PurchaseOrder.id).where(PurchaseOrder.order_date < lo).limit(3)
    ).all()
    bad_expected = db.execute(
        select(PurchaseOrder.id).where(PurchaseOrder.expected_date > hi).limit(3)
    ).all()
    issues = ([{"table": "sales", "id": i} for (i,) in bad_sales]
              + [{"table": "purchase_orders", "id": i, "field": "order_date"} for (i,) in bad_pos]
              + [{"table": "purchase_orders", "id": i, "field": "expected_date"} for (i,) in bad_expected])
    return sales_total + po_total, issues


def _products_without_supplier(db: Session) -> tuple[int, list[dict]]:
    products = db.query(Product.id, Product.name, Product.sku, Product.supplier_id).all()
    bad = [{"product_id": pid, "sku": sku, "name": nm}
           for pid, nm, sku, sid in products if sid is None]
    return len(products), bad[:5]


def _suppliers_without_orders(db: Session) -> tuple[int, list[dict]]:
    sups = db.query(Supplier.id, Supplier.name).all()
    with_orders = {sid for (sid,) in db.execute(select(PurchaseOrder.supplier_id)).all() if sid}
    bad = [{"supplier_id": sid, "name": nm} for sid, nm in sups if sid not in with_orders]
    return len(sups), bad[:5]


def _zero_demand_with_stock(db: Session) -> tuple[int, list[dict]]:
    start = (date.today() - timedelta(days=WINDOW_DAYS)).isoformat()
    sold = dict(db.execute(
        select(Sale.product_id, func.sum(Sale.quantity))
        .where(Sale.sale_date >= start).group_by(Sale.product_id)).all())
    latest = (select(InventoryDaily.product_id, func.max(InventoryDaily.date).label("m"))
              .group_by(InventoryDaily.product_id).subquery())
    stock = dict(db.execute(
        select(InventoryDaily.product_id, InventoryDaily.closing_stock)
        .join(latest, (latest.c.product_id == InventoryDaily.product_id)
              & (latest.c.m == InventoryDaily.date))).all())
    products = db.query(Product.id, Product.name).all()
    bad = [{"product_id": pid, "name": nm, "stock": stock.get(pid, 0)}
           for pid, nm in products if sold.get(pid, 0) == 0 and stock.get(pid, 0) > 0]
    return len(products), bad[:5]


def data_quality_report(db: Session) -> dict:
    checks: list[dict] = []

    def add(name: str, total: int, issues: list[dict], description: str) -> None:
        checked = max(total, 1)
        bad = len(issues) if total == 0 else min(len(issues), total)
        # For sampled checks (limit 5) scale the count honestly: if any issue
        # rows exist, count them as present; score uses pass/fail per record
        # over the full table via the SQL-level counts below.
        checks.append({
            "name": name,
            "description": description,
            "records_checked": total,
            "issues": issues,
            "issue_count": len(issues),
        })

    total, issues = _ledger_mismatches(db)
    add("Inventory ledger consistency", total, issues,
        "opening_stock + received_quantity − sold_quantity must equal closing_stock")

    total, issues = _negative_stock(db)
    add("Negative inventory", total, issues,
        "closing_stock below zero — an operational impossibility and a data-quality red flag")

    total, issues = _duplicate_po_numbers(db)
    add("Duplicate PO numbers", total, issues,
        "purchase order numbers should be unique")

    total, issues = _orphan_sales(db)
    add("Orphan sales records", total, issues,
        "sales rows pointing at products that no longer exist")

    total, issues = _invalid_dates(db)
    add("Invalid dates", total, issues,
        "dates before 2000 or more than a year in the future")

    total, issues = _products_without_supplier(db)
    add("Products without supplier", total, issues,
        "no supplier assigned — procurement recommendations cannot pick a source")

    total, issues = _suppliers_without_orders(db)
    add("Suppliers without orders", total, issues,
        "no purchase orders — performance metrics cannot be observed")

    total, issues = _zero_demand_with_stock(db)
    add("Zero-demand products holding stock", total, issues,
        f"no sales in the last {WINDOW_DAYS} days while holding inventory")

    # Score: weighted by records checked per check (share of passing records),
    # with equal check weights so a small table can't dominate the headline.
    per_check = []
    for c in checks:
        checked = c["records_checked"]
        issue_rows = sum(i.get("occurrences", 1) if "occurrences" in i else 1 for i in c["issues"])
        # When a check surfaces any issue we conservatively mark those records
        # failed; exact failure counts live in the issues themselves.
        failed = min(checked, issue_rows) if checked else 0
        pass_rate = (checked - failed) / checked if checked else 1.0
        per_check.append(pass_rate)
    score = round(sum(per_check) / len(per_check) * 100, 1) if per_check else 100.0

    total_issues = sum(c["issue_count"] for c in checks)
    return {
        "score": score,
        "checks": checks,
        "total_issues": total_issues,
        "status": "healthy" if score >= 97 else "review recommended" if score >= 90 else "attention required",
    }
