from sqlalchemy import Float, ForeignKey, Integer, String
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database.session import Base


class PurchaseOrder(Base):
    __tablename__ = "purchase_orders"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    po_number: Mapped[str] = mapped_column(String(24), unique=True, nullable=False, index=True)
    product_id: Mapped[int] = mapped_column(ForeignKey("products.id"), nullable=False, index=True)
    supplier_id: Mapped[int] = mapped_column(ForeignKey("suppliers.id"), nullable=False, index=True)
    quantity: Mapped[int] = mapped_column(Integer, nullable=False)
    unit_cost: Mapped[float] = mapped_column(Float, nullable=False)
    order_date: Mapped[object] = mapped_column(String(10), nullable=False, index=True)  # ISO date
    expected_date: Mapped[object] = mapped_column(String(10), nullable=False)
    actual_date: Mapped[object] = mapped_column(String(10), nullable=True)
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="Pending", index=True)

    product = relationship("Product", back_populates="purchase_orders", viewonly=True)
    supplier = relationship("Supplier", back_populates="purchase_orders", viewonly=True)
