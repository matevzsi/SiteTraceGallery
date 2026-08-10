from . import floorplans, main, media, photos, pins


def register_routes(app):
    app.register_blueprint(main.bp)
    app.register_blueprint(media.bp)
    app.register_blueprint(floorplans.bp)
    app.register_blueprint(pins.bp)
    app.register_blueprint(photos.bp)
