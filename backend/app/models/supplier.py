from datetime import datetime

from sqlalchemy import DateTime, Float, Integer, String
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database.session import Base


class Supplier(Base):
    __tablename__ = "suppliers"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    name: Mapped[str] = mapped_column(String(160), nullable=False, index=True)
    contact_email: Mapped[str | None] = mapped_column(String(160), nullable=True)
    lead_time_days: Mapped[int] = mapped_column(Integer, nullable=False, default=10)
    unit_cost: Mapped[float] = mapped_column(Float, nullable=False)
    on_time_rate: Mapped[float] = mapped_column(Float, nullable=False, default=0.9)
    defect_rate: Mapped[float] = mapped_column(Float, nullable=False, default=0.02)
    reliability_score: Mapped[float] = mapped_column(Float, nullable=False, default=0.85)
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, default=datetime.utcnow)

    products = relationship("Product", back_populates="supplier", viewonly=True)
    purchase_orders = relationship("PurchaseOrder", back_populates="supplier", viewonly=True)
