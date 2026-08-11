import os

from flask import Blueprint, current_app, request
from werkzeug.utils import secure_filename

from ..db import get_db
from ..utils.images import get_image_dimensions
from .helpers import error, row_to_dict, rows_to_list

bp = Blueprint("floorplans", __name__, url_prefix="/api/floorplans")

ALLOWED_EXT = {".jpg", ".jpeg", ".png", ".webp", ".tif", ".tiff", ".bmp"}


def _default_scale(db, width_px: int, height_px: int) -> float:
    """Pick an initial scale so a freshly uploaded floor plan layer fits
    comfortably inside the site plan canvas instead of defaulting to
    "as wide as the site plan" (scale=1.0), which for a floor plan with a
    different aspect ratio produces a layer far taller/wider than the
    visible canvas — pushing its layer-edit resize/rotate handles outside
    the clipped viewport where they can't be reached."""
    site = db.execute("SELECT width_px, height_px FROM floorplans WHERE is_site_plan = 1").fetchone()
    if not site:
        return 1.0
    aspect_fp = height_px / width_px
    aspect_site = site["width_px"] / site["height_px"]
    return min(0.9, 0.9 / (aspect_fp * aspect_site))


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
    scale = _default_scale(db, width, height) if not is_site_plan else 1.0

    cur = db.execute(
        """INSERT INTO floorplans (name, image_path, width_px, height_px, is_site_plan, scale)
           VALUES (?, ?, ?, ?, ?, ?)""",
        (name, dest_name, width, height, 1 if is_site_plan else 0, scale),
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


@bp.post("/<int:floorplan_id>/image")
def replace_floorplan_image(floorplan_id):
    """Swap the underlying image for an existing floorplan row (including
    the site plan) without disturbing its pins/photos or, for a regular
    layer, its offset/scale/rotation — those stay as a starting point the
    user can nudge afterward if the new image doesn't line up exactly."""
    db = get_db()
    row = db.execute("SELECT * FROM floorplans WHERE id = ?", (floorplan_id,)).fetchone()
    if not row:
        return error("floorplan not found", 404)

    image = request.files.get("image")
    if not image or not image.filename:
        return error("image file is required")
    ext = os.path.splitext(image.filename)[1].lower()
    if ext not in ALLOWED_EXT:
        return error(f"unsupported image type: {ext}")

    floorplans_dir = current_app.config["FLOORPLANS_DIR"]
    safe_name = secure_filename(image.filename) or "floorplan"
    dest_name = _unique_name(floorplans_dir, safe_name)
    dest_path = os.path.join(floorplans_dir, dest_name)
    image.save(dest_path)
    width, height = get_image_dimensions(dest_path)

    fields = {"image_path": dest_name, "width_px": width, "height_px": height}
    name = (request.form.get("name") or "").strip()
    if name:
        fields["name"] = name

    set_clause = ", ".join(f"{k} = ?" for k in fields)
    db.execute(f"UPDATE floorplans SET {set_clause} WHERE id = ?", (*fields.values(), floorplan_id))
    db.commit()

    old_path = os.path.join(floorplans_dir, row["image_path"])
    if os.path.abspath(old_path) != os.path.abspath(dest_path):
        try:
            os.remove(old_path)
        except OSError:
            pass

    updated = db.execute("SELECT * FROM floorplans WHERE id = ?", (floorplan_id,)).fetchone()
    return row_to_dict(updated)


@bp.delete("/<int:floorplan_id>")
def delete_floorplan(floorplan_id):
    db = get_db()
    row = db.execute("SELECT * FROM floorplans WHERE id = ?", (floorplan_id,)).fetchone()
    if not row:
        return error("floorplan not found", 404)
    db.execute("DELETE FROM floorplans WHERE id = ?", (floorplan_id,))
    db.commit()
    return "", 204
