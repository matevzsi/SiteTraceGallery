from flask import Blueprint, current_app, send_from_directory

bp = Blueprint("media", __name__, url_prefix="/media")


@bp.get("/floorplans/<path:filename>")
def floorplan_image(filename):
    return send_from_directory(current_app.config["FLOORPLANS_DIR"], filename)


@bp.get("/photos/<path:filename>")
def photo_image(filename):
    return send_from_directory(current_app.config["PHOTOS_DIR"], filename)


@bp.get("/thumbnails/<path:filename>")
def thumbnail_image(filename):
    return send_from_directory(current_app.config["THUMBNAILS_DIR"], filename)
