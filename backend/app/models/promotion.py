from sqlalchemy import Float, ForeignKey, Integer, String
from sqlalchemy.orm import Mapped, mapped_column


from app.database.session import Base


class Promotion(Base):
    """A merchandising campaign whose orders are attributed on outbound rows.

    Kept deliberately small: campaign → discount window is all the promotion
    ledger this module needs; conversion and margin impact are derived from
    the attributed orders, not stored.
    """
    __tablename__ = "promotions"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    name: Mapped[str] = mapped_column(String(80), unique=True, nullable=False)
    kind: Mapped[str] = mapped_column(String(40), nullable=False, default="Festive")
    # Festive | End of Season | Flash
    discount_pct: Mapped[float] = mapped_column(Float, nullable=False, default=0.0)   # 0-1
    start_date: Mapped[object] = mapped_column(String(10), nullable=False, index=True)
    end_date: Mapped[object] = mapped_column(String(10), nullable=False)
