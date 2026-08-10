from pathlib import Path

from flask import Flask

from . import db as db_module

PROJECT_ROOT = Path(__file__).resolve().parent.parent


def create_app(test_config: dict | None = None) -> Flask:
    app = Flask(__name__, instance_relative_config=False)

    app.config.from_mapping(
        SECRET_KEY="dev",  # single-user localhost tool — not security sensitive
        DATABASE_PATH=str(PROJECT_ROOT / "sitetrace.db"),
        FLOORPLANS_DIR=str(PROJECT_ROOT / "floorplans"),
        PHOTOS_DIR=str(PROJECT_ROOT / "photos"),
        THUMBNAILS_DIR=str(PROJECT_ROOT / "thumbnails"),
        THUMBNAIL_MAX_PX=400,
        MAX_CONTENT_LENGTH=64 * 1024 * 1024,  # floor plan image uploads only
    )

    if test_config:
        app.config.update(test_config)

    for key in ("FLOORPLANS_DIR", "PHOTOS_DIR", "THUMBNAILS_DIR"):
        Path(app.config[key]).mkdir(parents=True, exist_ok=True)

    db_module.init_app(app)

    from .routes import register_routes

    register_routes(app)

    return app
