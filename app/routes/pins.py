from flask import Blueprint, request

from ..db import get_db
from .helpers import error, remove_photo_files, row_to_dict, rows_to_list

bp = Blueprint("pins", __name__, url_prefix="/api")

# Pin markers show a fan of every direction photographed from that spot.
# Headings are rounded into buckets this wide so the payload (and the fan)
# stay small no matter how many photos the pin holds.
DIRECTION_BUCKET_DEG = 15
DIRECTION_BUCKETS = 360 // DIRECTION_BUCKET_DEG


@bp.get("/pins")
def list_all_pins():
    db = get_db()
    rows = db.execute(
        """
        SELECT p.*, f.name AS floorplan_name, f.is_site_plan AS floorplan_is_site_plan
        FROM pins p
        JOIN floorplans f ON f.id = p.floorplan_id
        ORDER BY f.is_site_plan DESC, f.created_at ASC, p.created_at ASC
        """
    ).fetchall()
    return {"pins": rows_to_list(rows)}


@bp.get("/floorplans/<int:floorplan_id>/pins")
def list_pins(floorplan_id):
    db = get_db()
    fp = db.execute("SELECT id FROM floorplans WHERE id = ?", (floorplan_id,)).fetchone()
    if not fp:
        return error("floorplan not found", 404)

    rows = db.execute(
        """
        SELECT p.*,
               (SELECT ph.direction_deg FROM photos ph
                 WHERE ph.pin_id = p.id AND ph.direction_deg IS NOT NULL
                 ORDER BY ph.taken_at DESC LIMIT 1) AS indicator_direction_deg,
               -- every heading photographed from this pin, bucketed to 15°
               -- so a pin with 200 photos still ships a handful of numbers
               -- and draws a readable fan rather than 200 stacked arrows
               (SELECT GROUP_CONCAT(DISTINCT CAST(ROUND(ph.direction_deg / ?) AS INTEGER) % ?)
                  FROM photos ph
                 WHERE ph.pin_id = p.id AND ph.direction_deg IS NOT NULL) AS direction_buckets,
               (SELECT COUNT(*) FROM photos ph WHERE ph.pin_id = p.id) AS photo_count
        FROM pins p
        WHERE p.floorplan_id = ?
        ORDER BY p.created_at ASC
        """,
        (DIRECTION_BUCKET_DEG, DIRECTION_BUCKETS, floorplan_id),
    ).fetchall()

    pins = rows_to_list(rows)
    for pin in pins:
        raw = pin.pop("direction_buckets", None)
        pin["direction_degs"] = (
            sorted({int(b) * DIRECTION_BUCKET_DEG for b in raw.split(",") if b != ""}) if raw else []
        )
    return {"pins": pins}


@bp.post("/floorplans/<int:floorplan_id>/pins")
def create_pin(floorplan_id):
    db = get_db()
    fp = db.execute("SELECT id FROM floorplans WHERE id = ?", (floorplan_id,)).fetchone()
    if not fp:
        return error("floorplan not found", 404)

    data = request.get_json(silent=True) or {}
    try:
        x = float(data["x"])
        y = float(data["y"])
    except (KeyError, TypeError, ValueError):
        return error("x and y are required numbers")
    if not (0.0 <= x <= 1.0 and 0.0 <= y <= 1.0):
        return error("x and y must be normalized 0..1")

    label = (data.get("label") or "").strip()
    category = (data.get("category") or None)

    cur = db.execute(
        "INSERT INTO pins (floorplan_id, x, y, label, category) VALUES (?, ?, ?, ?, ?)",
        (floorplan_id, x, y, label, category),
    )
    db.commit()
    row = db.execute("SELECT * FROM pins WHERE id = ?", (cur.lastrowid,)).fetchone()
    return row_to_dict(row), 201


@bp.patch("/pins/<int:pin_id>")
def update_pin(pin_id):
    db = get_db()
    row = db.execute("SELECT * FROM pins WHERE id = ?", (pin_id,)).fetchone()
    if not row:
        return error("pin not found", 404)

    data = request.get_json(silent=True) or {}
    fields = {}
    if "label" in data:
        fields["label"] = (data["label"] or "").strip()
    if "category" in data:
        fields["category"] = data["category"] or None
    if "floorplan_id" in data:
        # moving a pin to another level; x/y are relative to the layer image,
        # so the caller is expected to send the re-projected pair alongside
        target = db.execute("SELECT id FROM floorplans WHERE id = ?", (data["floorplan_id"],)).fetchone()
        if not target:
            return error("target floorplan not found")
        fields["floorplan_id"] = target["id"]
    for key in ("x", "y"):
        if key in data:
            try:
                val = float(data[key])
            except (TypeError, ValueError):
                return error(f"{key} must be a number")
            if not (0.0 <= val <= 1.0):
                return error(f"{key} must be normalized 0..1")
            fields[key] = val

    if not fields:
        return error("no valid fields to update")

    set_clause = ", ".join(f"{k} = ?" for k in fields)
    db.execute(f"UPDATE pins SET {set_clause} WHERE id = ?", (*fields.values(), pin_id))
    db.commit()
    row = db.execute("SELECT * FROM pins WHERE id = ?", (pin_id,)).fetchone()
    return row_to_dict(row)


@bp.delete("/pins/<int:pin_id>")
def delete_pin(pin_id):
    db = get_db()
    row = db.execute("SELECT * FROM pins WHERE id = ?", (pin_id,)).fetchone()
    if not row:
        return error("pin not found", 404)

    photo_count = db.execute("SELECT COUNT(*) AS c FROM photos WHERE pin_id = ?", (pin_id,)).fetchone()["c"]

    decision = request.args.get("photos")  # "unassign" | "delete"
    if photo_count > 0 and decision not in ("unassign", "delete"):
        return {
            "error": "pin has assigned photos; specify ?photos=unassign or ?photos=delete",
            "photo_count": photo_count,
        }, 409

    if photo_count > 0 and decision == "delete":
        photos = db.execute("SELECT * FROM photos WHERE pin_id = ?", (pin_id,)).fetchall()
        for p in photos:
            remove_photo_files(p)
        db.execute("DELETE FROM photos WHERE pin_id = ?", (pin_id,))
    # decision == "unassign" needs no action: ON DELETE SET NULL handles it

    db.execute("DELETE FROM pins WHERE id = ?", (pin_id,))
    db.commit()
    return "", 204
