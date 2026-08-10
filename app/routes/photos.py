from flask import Blueprint, current_app, request

from .. import importer
from ..db import get_db
from .helpers import error, row_to_dict, rows_to_list

bp = Blueprint("photos", __name__, url_prefix="/api")


@bp.get("/photos/unassigned")
def unassigned_photos():
    db = get_db()
    page = max(1, request.args.get("page", 1, type=int))
    page_size = min(200, max(1, request.args.get("page_size", 60, type=int)))
    offset = (page - 1) * page_size

    total = db.execute("SELECT COUNT(*) AS c FROM photos WHERE pin_id IS NULL").fetchone()["c"]
    rows = db.execute(
        """SELECT * FROM photos WHERE pin_id IS NULL
           ORDER BY taken_at DESC LIMIT ? OFFSET ?""",
        (page_size, offset),
    ).fetchall()
    return {
        "photos": rows_to_list(rows),
        "page": page,
        "page_size": page_size,
        "total": total,
        "has_more": offset + len(rows) < total,
    }


@bp.get("/pins/<int:pin_id>/photos")
def pin_photos(pin_id):
    db = get_db()
    pin = db.execute("SELECT id FROM pins WHERE id = ?", (pin_id,)).fetchone()
    if not pin:
        return error("pin not found", 404)
    rows = db.execute(
        "SELECT * FROM photos WHERE pin_id = ? ORDER BY taken_at ASC", (pin_id,)
    ).fetchall()
    return {"photos": rows_to_list(rows)}


@bp.get("/photos/<int:photo_id>")
def get_photo(photo_id):
    db = get_db()
    row = db.execute("SELECT * FROM photos WHERE id = ?", (photo_id,)).fetchone()
    if not row:
        return error("photo not found", 404)
    return row_to_dict(row)


@bp.patch("/photos/<int:photo_id>")
def update_photo(photo_id):
    db = get_db()
    row = db.execute("SELECT * FROM photos WHERE id = ?", (photo_id,)).fetchone()
    if not row:
        return error("photo not found", 404)

    data = request.get_json(silent=True) or {}
    fields = {}

    if "pin_id" in data:
        pin_id = data["pin_id"]
        if pin_id is not None:
            pin = db.execute("SELECT id FROM pins WHERE id = ?", (pin_id,)).fetchone()
            if not pin:
                return error("target pin not found")
        fields["pin_id"] = pin_id

    if "direction_deg" in data:
        val = data["direction_deg"]
        if val is not None:
            try:
                val = float(val) % 360.0
            except (TypeError, ValueError):
                return error("direction_deg must be a number")
        fields["direction_deg"] = val
        fields["direction_source"] = "manual" if val is not None else None

    if "caption" in data:
        fields["caption"] = (data["caption"] or None)

    if not fields:
        return error("no valid fields to update")

    set_clause = ", ".join(f"{k} = ?" for k in fields)
    db.execute(f"UPDATE photos SET {set_clause} WHERE id = ?", (*fields.values(), photo_id))
    db.commit()
    row = db.execute("SELECT * FROM photos WHERE id = ?", (photo_id,)).fetchone()
    return row_to_dict(row)


@bp.post("/photos/bulk-assign")
def bulk_assign():
    db = get_db()
    data = request.get_json(silent=True) or {}
    photo_ids = data.get("photo_ids")
    pin_id = data.get("pin_id")

    if not isinstance(photo_ids, list) or not photo_ids:
        return error("photo_ids must be a non-empty list")
    if pin_id is not None:
        pin = db.execute("SELECT id FROM pins WHERE id = ?", (pin_id,)).fetchone()
        if not pin:
            return error("target pin not found")

    placeholders = ",".join("?" for _ in photo_ids)
    db.execute(
        f"UPDATE photos SET pin_id = ? WHERE id IN ({placeholders})",
        (pin_id, *photo_ids),
    )
    db.commit()
    return {"updated": len(photo_ids)}


@bp.post("/photos/import")
def start_import():
    data = request.get_json(silent=True) or {}
    source_dir = (data.get("source_dir") or "").strip()
    if not source_dir:
        return error("source_dir is required")

    job_id = importer.start_import_job(current_app._get_current_object(), source_dir)
    return {"job_id": job_id}, 202


@bp.get("/photos/import/<job_id>")
def import_status(job_id):
    job = importer.get_job(job_id)
    if not job:
        return error("job not found", 404)
    return job
