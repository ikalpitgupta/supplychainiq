"""Settings service: typed read/write of business parameters stored in the settings table."""
from __future__ import annotations

from sqlalchemy.orm import Session

from app.models import Setting

_SETTING_TYPES = {"float": float, "int": int, "str": str}


def get_all_settings(db: Session) -> dict:
    rows = db.query(Setting).all()
    out = {}
    for r in rows:
        cast = _SETTING_TYPES.get(r.kind, str)
        out[r.key] = {"value": cast(r.value), "kind": r.kind, "label": r.label}
    return out


def get_values(db: Session) -> dict:
    return {k: v["value"] for k, v in get_all_settings(db).items()}


def get_value(db: Session, key: str, default):
    all_v = get_values(db)
    return all_v.get(key, default)


def update_settings(db: Session, payload: dict) -> dict:
    for k, v in (payload or {}).items():
        row = db.get(Setting, k)
        if row is None:
            continue
        cast = _SETTING_TYPES.get(row.kind, str)
        try:
            row.value = str(cast(v))
        except (ValueError, TypeError):
            raise ValueError(f"Invalid value for '{k}': {v!r}")
    db.commit()
    return get_all_settings(db)
