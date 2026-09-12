from datetime import datetime

from sqlalchemy import Boolean, DateTime, Float, ForeignKey, Integer, String
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database.session import Base


class Product(Base):
    __tablename__ = "products"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    sku: Mapped[str] = mapped_column(String(32), unique=True, nullable=False, index=True)
    name: Mapped[str] = mapped_column(String(160), nullable=False, index=True)
    category_id: Mapped[int] = mapped_column(ForeignKey("categories.id"), nullable=False)
    supplier_id: Mapped[int | None] = mapped_column(ForeignKey("suppliers.id"), nullable=True)
    unit_cost: Mapped[float] = mapped_column(Float, nullable=False)
    selling_price: Mapped[float] = mapped_column(Float, nullable=False)
    lead_time_days: Mapped[int] = mapped_column(Integer, nullable=False, default=10)
    active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, default=datetime.utcnow)

    # Catalog completeness attributes (Inbound Intelligence · Catalog Quality).
    # NULL/empty means "missing" — the quality scan derives gaps from these.
    color: Mapped[str | None] = mapped_column(String(40), nullable=True)
    material: Mapped[str | None] = mapped_column(String(60), nullable=True)
    description: Mapped[str | None] = mapped_column(String(600), nullable=True)
    images_json: Mapped[str | None] = mapped_column(String(400), nullable=True)  # JSON list of URLs; null = no image
    size_chart_json: Mapped[str | None] = mapped_column(String(200), nullable=True)  # null = no size chart
    mrp: Mapped[float | None] = mapped_column(Float, nullable=True)                  # list price (strike-through)
    price_changed_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    price_prev: Mapped[float | None] = mapped_column(Float, nullable=True)

    category = relationship("Category", lazy="joined")
    supplier = relationship("Supplier", lazy="joined")
    sales = relationship("Sale", back_populates="product", viewonly=True)
    inventory_rows = relationship("InventoryDaily", back_populates="product", viewonly=True)
    purchase_orders = relationship("PurchaseOrder", back_populates="product", viewonly=True)
