from sqlalchemy import Float, Integer, String
from sqlalchemy.orm import Mapped, mapped_column

from app.database.session import Base


class Setting(Base):
    """Key/value store for configurable business assumptions (marked as demo assumptions in UI)."""

    __tablename__ = "settings"

    key: Mapped[str] = mapped_column(String(60), primary_key=True)
    value: Mapped[str] = mapped_column(String(200), nullable=False)
    kind: Mapped[str] = mapped_column(String(10), nullable=False, default="float")  # float|int|str
    label: Mapped[str] = mapped_column(String(120), nullable=False, default="")
