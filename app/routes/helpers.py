import os
import sqlite3

from flask import current_app, jsonify


def row_to_dict(row: sqlite3.Row | None) -> dict | None:
    return dict(row) if row is not None else None


def rows_to_list(rows) -> list:
    return [dict(r) for r in rows]


def error(message: str, status: int = 400):
    return jsonify({"error": message}), status


def remove_photo_files(photo_row) -> None:
    """Delete a photo's copy and thumbnail from disk, best effort.

    Only ever removes files under the app's own PHOTOS_DIR/THUMBNAILS_DIR —
    the import copies originals rather than moving them, so whatever folder
    the photo came from is left alone.
    """
    for cfg_key, filename in (
        ("PHOTOS_DIR", photo_row["file_path"]),
        ("THUMBNAILS_DIR", photo_row["thumbnail_path"]),
    ):
        if not filename:
            continue
        path = os.path.join(current_app.config[cfg_key], filename)
        try:
            os.remove(path)
        except OSError:
            pass
