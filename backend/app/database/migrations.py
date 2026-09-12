"""Lightweight migrations for columns/tables added after the first release.

create_all only creates *missing* tables; it never amends existing ones. Both
the app lifespan and the seeder call `run_light_migrations` so a database
created by an older version keeps working without a manual wipe.
"""
from __future__ import annotations

from sqlalchemy import inspect, text
from sqlalchemy.engine import Engine

# table -> [(column, DDL type), ...]
_COLUMN_MIGRATIONS: dict[str, list[tuple[str, str]]] = {
    "import_logs": [("changes_json", "TEXT")],
    "products": [
        ("color", "VARCHAR(40)"),
        ("material", "VARCHAR(60)"),
        ("description", "VARCHAR(600)"),
        ("images_json", "VARCHAR(400)"),
        ("size_chart_json", "VARCHAR(200)"),
        ("mrp", "FLOAT"),
        ("price_changed_at", "TIMESTAMP"),
        ("price_prev", "FLOAT"),
    ],
    "outbound_orders": [
        ("campaign_id", "INTEGER"),
        ("paid_price", "FLOAT"),
    ],
}


def run_light_migrations(engine: Engine) -> None:
    insp = inspect(engine)
    tables = set(insp.get_table_names())
    with engine.begin() as conn:
        for table, cols in _COLUMN_MIGRATIONS.items():
            if table not in tables:
                continue
            existing = {c["name"] for c in insp.get_columns(table)}
            for col, ddl in cols:
                if col not in existing:
                    conn.execute(text(f"ALTER TABLE {table} ADD COLUMN {col} {ddl}"))
