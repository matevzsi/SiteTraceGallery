import os

from flask import Blueprint, current_app, request
from werkzeug.utils import secure_filename

from ..db import get_db
from ..utils.images import get_image_dimensions
from .helpers import error, row_to_dict, rows_to_list

bp = Blueprint("floorplans", __name__, url_prefix="/api/floorplans")

ALLOWED_EXT = {".jpg", ".jpeg", ".png", ".webp", ".tif", ".tiff", ".bmp"}


def _unique_name(directory: str, filename: str) -> str:
    stem, ext = os.path.splitext(filename)
    candidate = filename
    n = 1
    while os.path.exists(os.path.join(directory, candidate)):
        candidate = f"{stem}_{n}{ext}"
        n += 1
    return candidate


@bp.get("")
def list_floorplans():
    db = get_db()
    rows = db.execute("SELECT * FROM floorplans ORDER BY is_site_plan DESC, created_at ASC").fetchall()
    return {"floorplans": rows_to_list(rows)}


@bp.post("")
def create_floorplan():
    name = (request.form.get("name") or "").strip()
    is_site_plan = request.form.get("is_site_plan") in ("1", "true", "on")
    image = request.files.get("image")

    if not name:
        return error("name is required")
    if not image or not image.filename:
        return error("image file is required")

    ext = os.path.splitext(image.filename)[1].lower()
    if ext not in ALLOWED_EXT:
        return error(f"unsupported image type: {ext}")

    db = get_db()

    if is_site_plan:
        existing = db.execute("SELECT id FROM floorplans WHERE is_site_plan = 1").fetchone()
        if existing:
            return error("a site plan already exists; delete or edit it before uploading another", 409)

    floorplans_dir = current_app.config["FLOORPLANS_DIR"]
    safe_name = secure_filename(image.filename) or "floorplan"
    dest_name = _unique_name(floorplans_dir, safe_name)
    dest_path = os.path.join(floorplans_dir, dest_name)
    image.save(dest_path)

    width, height = get_image_dimensions(dest_path)

    cur = db.execute(
        """INSERT INTO floorplans (name, image_path, width_px, height_px, is_site_plan)
           VALUES (?, ?, ?, ?, ?)""",
        (name, dest_name, width, height, 1 if is_site_plan else 0),
    )
    db.commit()
    row = db.execute("SELECT * FROM floorplans WHERE id = ?", (cur.lastrowid,)).fetchone()
    return row_to_dict(row), 201


@bp.patch("/<int:floorplan_id>")
def update_floorplan(floorplan_id):
    db = get_db()
    row = db.execute("SELECT * FROM floorplans WHERE id = ?", (floorplan_id,)).fetchone()
    if not row:
        return error("floorplan not found", 404)

    data = request.get_json(silent=True) or {}
    fields = {}
    if "name" in data:
        name = (data["name"] or "").strip()
        if not name:
            return error("name cannot be empty")
        fields["name"] = name
    for key in ("offset_x", "offset_y", "scale", "rotation_deg"):
        if key in data:
            try:
                fields[key] = float(data[key])
            except (TypeError, ValueError):
                return error(f"{key} must be a number")

    if not fields:
        return error("no valid fields to update")

    set_clause = ", ".join(f"{k} = ?" for k in fields)
    db.execute(f"UPDATE floorplans SET {set_clause} WHERE id = ?", (*fields.values(), floorplan_id))
    db.commit()
    row = db.execute("SELECT * FROM floorplans WHERE id = ?", (floorplan_id,)).fetchone()
    return row_to_dict(row)


@bp.delete("/<int:floorplan_id>")
def delete_floorplan(floorplan_id):
    db = get_db()
    row = db.execute("SELECT * FROM floorplans WHERE id = ?", (floorplan_id,)).fetchone()
    if not row:
        return error("floorplan not found", 404)
    db.execute("DELETE FROM floorplans WHERE id = ?", (floorplan_id,))
    db.commit()
    return "", 204
