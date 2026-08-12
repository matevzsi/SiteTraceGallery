import os
from pathlib import Path

from flask import Flask

from . import db as db_module

PROJECT_ROOT = Path(__file__).resolve().parent.parent


def create_app(test_config: dict | None = None) -> Flask:
    app = Flask(
        __name__,
        instance_relative_config=False,
        template_folder=str(PROJECT_ROOT / "templates"),
        static_folder=str(PROJECT_ROOT / "static"),
    )

    # SITETRACE_DATA_DIR redirects the db + photos/floorplans/thumbnails to
    # a separate directory, entirely independent of the real project data.
    # Point it at a scratch folder when testing/developing so nothing ever
    # touches the real database or photo library by accident.
    data_dir = Path(os.environ["SITETRACE_DATA_DIR"]) if os.environ.get("SITETRACE_DATA_DIR") else PROJECT_ROOT

    app.config.from_mapping(
        SECRET_KEY="dev",  # single-user localhost tool — not security sensitive
        DATABASE_PATH=str(data_dir / "sitetrace.db"),
        FLOORPLANS_DIR=str(data_dir / "floorplans"),
        PHOTOS_DIR=str(data_dir / "photos"),
        THUMBNAILS_DIR=str(data_dir / "thumbnails"),
        THUMBNAIL_MAX_PX=400,
        MAX_CONTENT_LENGTH=64 * 1024 * 1024,  # floor plan image uploads only
        # Always revalidate static assets. This is a localhost tool, so the
        # bandwidth is free, and a browser holding a cached style.css or JS
        # module against freshly changed markup renders a half-updated UI
        # that looks exactly like a bug.
        SEND_FILE_MAX_AGE_DEFAULT=0,
        # Jinja caches templates in memory once loaded unless debug is on, so
        # without this an edited index.html needs a server restart to appear.
        TEMPLATES_AUTO_RELOAD=True,
    )

    if test_config:
        app.config.update(test_config)

    app.jinja_env.auto_reload = app.config["TEMPLATES_AUTO_RELOAD"]

    for key in ("FLOORPLANS_DIR", "PHOTOS_DIR", "THUMBNAILS_DIR"):
        Path(app.config[key]).mkdir(parents=True, exist_ok=True)

    db_module.init_app(app)

    from .routes import register_routes

    register_routes(app)

    return app
