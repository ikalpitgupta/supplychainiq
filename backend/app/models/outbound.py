from sqlalchemy import Float, ForeignKey, Integer, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database.session import Base


class Warehouse(Base):
    """Outbound fulfillment node (fashion e-commerce DC)."""
    __tablename__ = "warehouses"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    code: Mapped[str] = mapped_column(String(8), unique=True, nullable=False)       # e.g. DEL, MUM
    name: Mapped[str] = mapped_column(String(80), nullable=False)
    region: Mapped[str] = mapped_column(String(20), nullable=False, index=True)     # North/South/East/West


class VariantInventory(Base):
    """SKU × size × warehouse on-hand stock.

    Fashion inventory is not "Black T-shirt = 100 units" — it is
    "Black T-shirt / M / Delhi DC = 12 units". Total on-hand per product in the
    legacy `inventory` ledger must stay consistent with the sum of variant rows.
    """
    __tablename__ = "variant_inventory"
    __table_args__ = (UniqueConstraint("product_id", "size", "warehouse_id", name="uq_variant_wh"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    product_id: Mapped[int] = mapped_column(ForeignKey("products.id"), nullable=False, index=True)
    size: Mapped[str] = mapped_column(String(8), nullable=False, index=True)        # XS S M L XL XXL
    warehouse_id: Mapped[int] = mapped_column(ForeignKey("warehouses.id"), nullable=False, index=True)
    units: Mapped[int] = mapped_column(Integer, nullable=False, default=0)


class OutboundOrder(Base):
    """One customer order line, with the outbound pipeline timestamps.

    Pipeline: order placed → picked → packed → dispatched → delivered.
    Stages (pick/pack/dispatch hours) are stored on the row so the bottleneck
    analysis is computed from data, not asserted.
    """
    __tablename__ = "outbound_orders"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    order_number: Mapped[str] = mapped_column(String(24), unique=True, nullable=False, index=True)
    product_id: Mapped[int] = mapped_column(ForeignKey("products.id"), nullable=False, index=True)
    size: Mapped[str] = mapped_column(String(8), nullable=False)
    warehouse_id: Mapped[int] = mapped_column(ForeignKey("warehouses.id"), nullable=False, index=True)
    region: Mapped[str] = mapped_column(String(20), nullable=False, index=True)     # customer region
    quantity: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    revenue: Mapped[float] = mapped_column(Float, nullable=False, default=0.0)

    order_date: Mapped[object] = mapped_column(String(10), nullable=False, index=True)  # ISO date
    promised_date: Mapped[object] = mapped_column(String(10), nullable=False)
    delivered_date: Mapped[object] = mapped_column(String(10), nullable=True)

    # Fulfillment stage durations, in hours (NULL when not reached).
    pick_hours: Mapped[float | None] = mapped_column(Float, nullable=True)
    pack_hours: Mapped[float | None] = mapped_column(Float, nullable=True)
    dispatch_hours: Mapped[float | None] = mapped_column(Float, nullable=True)

    carrier: Mapped[str] = mapped_column(String(40), nullable=False, default="BlueDart")
    delay_reason: Mapped[str | None] = mapped_column(String(80), nullable=True)     # NULL when on time
    status: Mapped[str] = mapped_column(String(16), nullable=False, default="Delivered", index=True)
    # Delivered | In Progress | Dispatched | Cancelled

    # Promotion attribution (Inbound Intelligence · Promotions). NULL = organic.
    campaign_id: Mapped[int | None] = mapped_column(ForeignKey("promotions.id"), nullable=True, index=True)
    paid_price: Mapped[float | None] = mapped_column(Float, nullable=True)          # after discount; NULL = full price


class ReturnLine(Base):
    """A returned customer order line with reason and disposition."""
    __tablename__ = "return_lines"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    order_id: Mapped[int] = mapped_column(ForeignKey("outbound_orders.id"), nullable=False, index=True)
    product_id: Mapped[int] = mapped_column(ForeignKey("products.id"), nullable=False, index=True)
    return_date: Mapped[object] = mapped_column(String(10), nullable=False, index=True)
    reason: Mapped[str] = mapped_column(String(40), nullable=False)                 # Size issue | Fit issue | ...
    disposition: Mapped[str] = mapped_column(String(20), nullable=False, default="Restock")
    # Restock | Refurbish | Write-off
