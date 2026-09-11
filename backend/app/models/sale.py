from sqlalchemy import Float, ForeignKey, Integer, String
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database.session import Base


class Sale(Base):
    __tablename__ = "sales"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    product_id: Mapped[int] = mapped_column(ForeignKey("products.id"), nullable=False, index=True)
    sale_date: Mapped[object] = mapped_column(String(10), nullable=False, index=True)  # ISO date
    quantity: Mapped[int] = mapped_column(Integer, nullable=False)
    revenue: Mapped[float] = mapped_column(Float, nullable=False)
    region: Mapped[str] = mapped_column(String(40), nullable=False, default="North")

    product = relationship("Product", back_populates="sales", viewonly=True)
