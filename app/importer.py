import os
import shutil
import threading
import time
import uuid
from datetime import datetime
from pathlib import Path

from .utils import exif as exif_utils
from .utils import images as image_utils

IMAGE_EXTENSIONS = {".jpg", ".jpeg", ".png", ".tif", ".tiff", ".bmp", ".webp"}

_jobs: dict[str, dict] = {}
_jobs_lock = threading.Lock()


def start_import_job(app, source_dir: str) -> str:
    job_id = uuid.uuid4().hex
    job = {
        "id": job_id,
        "source_dir": source_dir,
        "status": "scanning",
        "total": 0,
        "processed": 0,
        "imported": 0,
        "skipped_duplicate": 0,
        "errors": [],
        "started_at": time.time(),
        "finished_at": None,
    }
    with _jobs_lock:
        _jobs[job_id] = job

    thread = threading.Thread(target=_run_import, args=(app, job_id, source_dir), daemon=True)
    thread.start()
    return job_id


def get_job(job_id: str):
    with _jobs_lock:
        job = _jobs.get(job_id)
        return dict(job) if job else None


def _unique_dest_name(dest_dir: Path, filename: str) -> str:
    candidate = filename
    stem, ext = os.path.splitext(filename)
    n = 1
    while (dest_dir / candidate).exists():
        candidate = f"{stem}_{n}{ext}"
        n += 1
    return candidate


def _run_import(app, job_id: str, source_dir: str) -> None:
    with app.app_context():
        from .db import get_db

        job = _jobs[job_id]

        src_root = Path(source_dir)
        if not src_root.is_dir():
            job["status"] = "error"
            job["errors"].append(f"Not a folder: {source_dir}")
            job["finished_at"] = time.time()
            return

        files = sorted(
            p for p in src_root.rglob("*")
            if p.is_file() and p.suffix.lower() in IMAGE_EXTENSIONS
        )
        job["total"] = len(files)
        job["status"] = "importing"

        db = get_db()
        photos_dir = Path(app.config["PHOTOS_DIR"])
        thumbs_dir = Path(app.config["THUMBNAILS_DIR"])
        photos_dir.mkdir(parents=True, exist_ok=True)
        thumbs_dir.mkdir(parents=True, exist_ok=True)
        max_px = app.config["THUMBNAIL_MAX_PX"]

        for src in files:
            try:
                size = src.stat().st_size

                existing = db.execute(
                    "SELECT id FROM photos WHERE orig_filename = ? AND file_size = ?",
                    (src.name, size),
                ).fetchone()
                if existing:
                    job["skipped_duplicate"] += 1
                    continue

                dest_name = _unique_dest_name(photos_dir, src.name)
                dest_path = photos_dir / dest_name
                shutil.copy2(src, dest_path)

                thumb_name = os.path.splitext(dest_name)[0] + ".jpg"
                thumb_path = thumbs_dir / thumb_name
                image_utils.make_thumbnail(dest_path, thumb_path, max_px)

                exif_data = exif_utils.extract_exif(dest_path)
                taken_at = exif_data["taken_at"] or datetime.fromtimestamp(src.stat().st_mtime)

                db.execute(
                    """INSERT INTO photos
                       (pin_id, file_path, thumbnail_path, orig_filename, file_size,
                        taken_at, direction_deg, direction_source, gps_lat, gps_lon)
                       VALUES (NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                    (
                        dest_name,
                        thumb_name,
                        src.name,
                        size,
                        taken_at.isoformat(),
                        exif_data["direction_deg"],
                        exif_data["direction_source"],
                        exif_data["gps_lat"],
                        exif_data["gps_lon"],
                    ),
                )
                db.commit()
                job["imported"] += 1
            except Exception as e:  # keep going on a per-file failure
                job["errors"].append(f"{src.name}: {e}")
            finally:
                job["processed"] += 1

        job["status"] = "done"
        job["finished_at"] = time.time()
