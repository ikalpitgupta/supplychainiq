"""CSV import/export endpoints. XLSX uploads are converted to CSV in-memory
so the importer services stay format-agnostic. Every import is logged with the
uploaded file for audit and re-download."""
import csv
import io
import json
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, UploadFile
from fastapi.responses import Response
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.security import get_current_user
from app.database.session import get_db
from app.models import ImportLog
from app.services.import_export_service import IMPORTERS, export_csv, preview_import
from app.utils.cache import clear as clear_cache
from app.utils.errors import APIError

router = APIRouter(tags=["io"])

XLSX_EXTS = (".xlsx", ".xlsm", ".xls")


class _TextFile:
    """Duck-types the UploadFile interface over an in-memory CSV text."""

    def __init__(self, text: str):
        self._buffer = io.BytesIO(text.encode("utf-8-sig"))

    class _Handle:
        def __init__(self, buf: io.BytesIO):
            self._buf = buf

        def read(self) -> bytes:
            self._buf.seek(0)
            return self._buf.read()

    @property
    def file(self):
        return self._Handle(self._buffer)


def _as_csv_file(file: UploadFile) -> UploadFile:
    """Pass CSVs through; convert XLSX/XLS workbooks to CSV text (first data sheet)."""
    name = (file.filename or "").lower()
    if not name.endswith(XLSX_EXTS):
        return file
    try:
        import openpyxl

        wb = openpyxl.load_workbook(io.BytesIO(file.file.read()), data_only=True, read_only=True)
    except Exception:
        raise APIError("Could not read the Excel file — is it a valid .xlsx/.xls workbook?")
    sheet = next((ws for ws in wb.worksheets if ws.max_row and ws.max_row > 1), wb.worksheets[0])
    buf = io.StringIO()
    writer = csv.writer(buf)
    for row in sheet.iter_rows(values_only=True):
        if any(c is not None and str(c).strip() != "" for c in row):
            writer.writerow(["" if c is None else c for c in row])
    wb.close()
    return _TextFile(buf.getvalue())  # type: ignore[return-value]


def _original_bytes_and_name(file: UploadFile) -> tuple[bytes, str]:
    """The raw upload bytes + filename, for the audit log (before any conversion)."""
    data = file.file.read()
    file.file.seek(0)
    return data, file.filename or "upload.csv"


@router.post("/import/{entity}/preview")
async def import_preview(entity: str, file: UploadFile, db=Depends(get_db)):
    """Dry-run: what would this import create, update (with diff), or reject?"""
    if entity not in IMPORTERS:
        raise APIError(f"Unsupported import type '{entity}'. Supported: {', '.join(IMPORTERS)}")
    if file is None or not (file.filename or "").lower().endswith((".csv",) + XLSX_EXTS):
        raise APIError("Please upload a .csv or .xlsx file")
    try:
        return preview_import(db, entity, _as_csv_file(file))
    except UnicodeDecodeError:
        raise APIError("Could not read the file — please upload a UTF-8 CSV")
    except Exception as exc:
        raise APIError("Preview failed — the file may be malformed", detail=str(exc)[:200])


@router.post("/import/{entity}")
async def import_csv(
    entity: str,
    file: UploadFile,
    db=Depends(get_db),
    user: dict = Depends(get_current_user),
):
    if entity not in IMPORTERS:
        raise APIError(f"Unsupported import type '{entity}'. Supported: {', '.join(IMPORTERS)}")
    if file is None or not (file.filename or "").lower().endswith((".csv",) + XLSX_EXTS):
        raise APIError("Please upload a .csv or .xlsx file")
    raw_bytes, raw_name = _original_bytes_and_name(file)

    # Capture the field-level diff of rows the upsert is about to change, so the
    # per-product audit trail can say exactly who changed what, when, from what.
    changes_payload: list[dict] | None = None
    if entity in ("products", "suppliers"):
        try:
            file.file.seek(0)  # audit capture re-reads the upload; reset first
            pre = preview_import(db, entity, _as_csv_file(file))
            changes_payload = pre.get("changes") or []
        except Exception:
            changes_payload = None  # audit capture is best-effort

    try:
        file.file.seek(0)  # the audit preview above consumes the cursor
        report = IMPORTERS[entity](db, _as_csv_file(file))
    except UnicodeDecodeError:
        raise APIError("Could not read the file — please upload a UTF-8 CSV")
    except Exception as exc:
        raise APIError("Import failed — the file may be malformed", detail=str(exc)[:200])

    # Audit log: who ran what, when, with what result — plus the file itself.
    try:
        log = ImportLog(
            entity=entity,
            filename=raw_name,
            uploaded_by=user.get("sub", "unknown"),
            uploaded_by_name=user.get("name", ""),
            imported=report.get("imported", 0),
            failed=report.get("failed", 0),
            total=report.get("total", 0),
            file_bytes=raw_bytes if len(raw_bytes) <= ImportLog.MAX_FILE_BYTES else None,
            file_size=len(raw_bytes),
            first_errors=json.dumps(report.get("errors", [])[:10], default=str),
            changes_json=json.dumps(changes_payload, default=str) if changes_payload is not None else None,
        )
        db.add(log)
        db.commit()
    except Exception:  # logging must never break an import
        db.rollback()

    clear_cache()  # analytics caches must not outlive new data
    return report


@router.get("/import/history")
def import_history(limit: int = 50, db: Session = Depends(get_db), user: dict = Depends(get_current_user)):
    rows = db.execute(
        select(ImportLog).order_by(ImportLog.id.desc()).limit(min(limit, 200))
    ).scalars().all()
    return {
        "items": [
            {
                "id": r.id,
                "entity": r.entity,
                "filename": r.filename,
                "uploaded_by": r.uploaded_by,
                "uploaded_by_name": r.uploaded_by_name,
                "imported": r.imported,
                "failed": r.failed,
                "total": r.total,
                "file_size": r.file_size,
                "file_available": r.file_bytes is not None,
                "ran_at": r.ran_at.isoformat() if r.ran_at else None,
                "first_errors": json.loads(r.first_errors) if r.first_errors else [],
            }
            for r in rows
        ]
    }


@router.get("/import/history/{log_id}/file")
def import_history_file(log_id: int, db: Session = Depends(get_db), user: dict = Depends(get_current_user)):
    log = db.get(ImportLog, log_id)
    if log is None:
        raise APIError("Import record not found", status_code=404)
    if not log.file_bytes:
        raise APIError("The original file was too large to store", status_code=404)
    safe_name = log.filename.replace('"', "")
    return Response(
        content=log.file_bytes,
        media_type="application/octet-stream",
        headers={"Content-Disposition": f'attachment; filename="{safe_name}"'},
    )


@router.get("/export/{entity}")
def export(entity: str, db: Session = Depends(get_db)):
    try:
        filename, csv_text = export_csv(db, entity)
    except ValueError as exc:
        raise APIError(str(exc))
    return Response(
        content=csv_text,
        media_type="text/csv",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )
