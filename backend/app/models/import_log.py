from datetime import datetime, timezone

from sqlalchemy import DateTime, Integer, LargeBinary, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.database.session import Base


class ImportLog(Base):
    """Audit trail for CSV/XLSX imports: who ran what, when, with what result.

    The raw uploaded file is kept (up to MAX_FILE_BYTES) so users can audit or
    re-run a past import byte-for-byte.
    """

    __tablename__ = "import_logs"

    MAX_FILE_BYTES = 5 * 1024 * 1024  # 5 MB cap for the stored file

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    ran_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, default=lambda: datetime.now(timezone.utc).replace(tzinfo=None))
    entity: Mapped[str] = mapped_column(String(40), nullable=False)
    filename: Mapped[str] = mapped_column(String(255), nullable=False)
    uploaded_by: Mapped[str] = mapped_column(String(160), nullable=False)  # user email
    uploaded_by_name: Mapped[str] = mapped_column(String(120), nullable=False, default="")
    imported: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    failed: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    total: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    file_bytes: Mapped[bytes | None] = mapped_column(LargeBinary, nullable=True)
    file_size: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    first_errors: Mapped[str | None] = mapped_column(Text, nullable=True)  # JSON, first 10 errors
    # JSON: [{key, name, fields: [{field, old, new}]}] — the field-level diff of
    # every upserted products/suppliers row, captured at import time.
    changes_json: Mapped[str | None] = mapped_column(Text, nullable=True)
