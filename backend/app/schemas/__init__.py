"""Pydantic request/response schemas (validation layer for mutating endpoints)."""
from __future__ import annotations

from pydantic import BaseModel, EmailStr, Field, field_validator


class LoginRequest(BaseModel):
    email: EmailStr
    password: str = Field(min_length=4, max_length=128)


class LoginResponse(BaseModel):
    token: str
    user: dict


class POCreateRequest(BaseModel):
    product_id: int
    supplier_id: int
    quantity: int = Field(gt=0, le=100_000)
    expected_date: str | None = None
    order_date: str | None = None
    status: str | None = None
    note: str | None = Field(default=None, max_length=500)


class POStatusUpdate(BaseModel):
    status: str
    actual_date: str | None = None

    @field_validator("status")
    @classmethod
    def status_allowed(cls, v: str) -> str:
        allowed = {"Draft", "Pending", "Ordered", "In Transit", "Delivered", "Delayed", "Cancelled"}
        if v not in allowed:
            raise ValueError(f"status must be one of {sorted(allowed)}")
        return v


class SettingsUpdate(BaseModel):
    values: dict[str, float | int | str]
