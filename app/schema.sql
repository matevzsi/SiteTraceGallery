PRAGMA foreign_keys = ON;

-- A floorplan row also represents the site plan (is_site_plan = 1).
-- Exactly one site plan is expected; it is always drawn first, at identity
-- transform, as the persistent background. Regular floor plans are drawn as
-- layers on top of it, positioned via offset_x/offset_y/scale/rotation_deg
-- set in "layer edit mode".
CREATE TABLE IF NOT EXISTS floorplans (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    name            TEXT NOT NULL,
    image_path      TEXT NOT NULL,
    width_px        INTEGER NOT NULL,
    height_px       INTEGER NOT NULL,
    is_site_plan    INTEGER NOT NULL DEFAULT 0,
    -- transform placing this layer's image onto the site plan canvas,
    -- expressed in site-plan-normalized units (0..1 span of the site plan's
    -- longer edge) so it stays meaningful regardless of image resolution.
    -- default to centered-on-site-plan so a freshly uploaded layer starts
    -- inside the visible canvas instead of corner-anchored and potentially
    -- spilling far outside it (see layer edit mode for repositioning)
    offset_x        REAL NOT NULL DEFAULT 0.5,
    offset_y        REAL NOT NULL DEFAULT 0.5,
    scale           REAL NOT NULL DEFAULT 1.0,
    rotation_deg    REAL NOT NULL DEFAULT 0.0,
    created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE IF NOT EXISTS pins (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    floorplan_id    INTEGER NOT NULL REFERENCES floorplans(id) ON DELETE CASCADE,
    x               REAL NOT NULL,
    y               REAL NOT NULL,
    label           TEXT NOT NULL DEFAULT '',
    category        TEXT,
    created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX IF NOT EXISTS idx_pins_floorplan ON pins(floorplan_id);

CREATE TABLE IF NOT EXISTS photos (
    id                  INTEGER PRIMARY KEY AUTOINCREMENT,
    pin_id              INTEGER REFERENCES pins(id) ON DELETE SET NULL,
    file_path           TEXT NOT NULL,
    thumbnail_path      TEXT NOT NULL,
    orig_filename       TEXT NOT NULL,
    file_size           INTEGER NOT NULL,
    taken_at            TEXT NOT NULL,
    direction_deg       REAL,
    direction_source    TEXT CHECK (direction_source IN ('exif', 'manual') OR direction_source IS NULL),
    gps_lat             REAL,
    gps_lon             REAL,
    caption             TEXT,
    created_at          TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX IF NOT EXISTS idx_photos_pin ON photos(pin_id);
CREATE INDEX IF NOT EXISTS idx_photos_taken_at ON photos(taken_at);
-- dedup lookup on re-import: same source filename + size already seen
CREATE INDEX IF NOT EXISTS idx_photos_dedup ON photos(orig_filename, file_size);

-- Future extension points (not built in v1, see spec "Explicitly out of
-- scope"). Left undeclared on purpose: adding them later is just a new
-- CREATE TABLE plus a nullable FK column, nothing here needs to change to
-- accommodate photo_embeddings, reconstructions, or camera_poses.
