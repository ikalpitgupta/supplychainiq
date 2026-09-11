from sqlalchemy import Float, ForeignKey, Integer, String
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database.session import Base


class InventoryDaily(Base):
    __tablename__ = "inventory"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    product_id: Mapped[int] = mapped_column(ForeignKey("products.id"), nullable=False, index=True)
    date: Mapped[object] = mapped_column(String(10), nullable=False, index=True)  # ISO date
    opening_stock: Mapped[int] = mapped_column(Integer, nullable=False)
    received_quantity: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    sold_quantity: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    closing_stock: Mapped[int] = mapped_column(Integer, nullable=False)

    product = relationship("Product", back_populates="inventory_rows", viewonly=True)
