# SiteTrace

A locally-hosted web application for organizing hundreds of construction progress
photos (interior and exterior) of a house build. Photos are pinned to a location
on a floor plan, tagged with an approximate camera direction, and browsable as a
per-location timeline instead of a flat photo dump.

This is a **personal, single-user, locally-run tool** — no cloud hosting, no
accounts, no multi-tenancy. Runs on `localhost` via a small local server.

---

## Core concept

- Upload the sorroundings image (site plan) first, which is persistently shown in the background.
- Upload one or more floor plan images (one per level: ground floor, first
  floor, roof, etc.).
- Selector allows the target level to be selected, site plan is always present
- Click on a floor plan to drop a **pin** representing a physical location
  (e.g. "Kitchen", "Southeast corner", "Garage"). Pin is referenced to the floor plane image.
- Import photos in bulk; assign each photo to a pin.
- Each photo also gets an approximate **camera direction** (which way the
  camera was facing), shown as an arrow on the plan at the pin (when the photo is selected)
- Click a pin → see all photos assigned to it, sorted chronologically, in a
  timeline/scroll view.

---

## Tech stack

- **Backend**: Python, Flask (or FastAPI — pick whichever is cleaner for the
  scope), run with a single command (`python app.py` or `uvicorn ...`).
- **Database**: SQLite, single `.db` file. No external DB server.
- **Frontend**: Server-rendered pages or a lightweight JS frontend (vanilla JS
  or a small framework) — no build-heavy SPA tooling needed for a local
  single-user tool. Keep it simple and dependency-light.
- **Image handling**: Pillow for EXIF extraction and thumbnail generation.
- **No cloud services, no external APIs required to function.**

---

## Storage layout

Large binary data (photos, floor plan images, thumbnails) is stored as files
on disk, not in the database. SQLite stores structure and relationships only.

```
project_root/
├── app.py                  # server entry point
├── sitetrace.db             # SQLite database
├── floorplans/              # uploaded floor plan images
├── photos/                  # original photo files, untouched
├── thumbnails/              # generated thumbnails (for fast grid/list views)
└── static/, templates/      # frontend assets
```

The whole `project_root` folder should be self-contained and portable — easy
to back up, zip, move to another machine, or sync via any file-based method
(external drive, Syncthing, etc.).

---

## Data model (SQLite)

### `floorplans`
| column | type | notes |
|---|---|---|
| id | integer PK | |
| name | text | e.g. "Ground floor", "Roof", "Site plan" |
| image_path | text | path under `floorplans/` |
| created_at | datetime | |

### `pins`
| column | type | notes |
|---|---|---|
| id | integer PK | |
| floorplan_id | integer FK → floorplans | |
| x | float | position on floor plan image, normalized 0–1 (resolution-independent) |
| y | float | same |
| label | text | e.g. "Kitchen" |
| category | text | optional, e.g. "interior" / "exterior" / "structural" |
| created_at | datetime | |

### `photos`
| column | type | notes |
|---|---|---|
| id | integer PK | |
| pin_id | integer FK → pins, nullable | nullable = unassigned/inbox photos |
| file_path | text | path under `photos/` |
| thumbnail_path | text | path under `thumbnails/` |
| taken_at | datetime | from EXIF `DateTimeOriginal`, fallback to file mtime |
| direction_deg | float, nullable | 0–359.99°, camera heading |
| direction_source | text | `"exif"` or `"manual"` |
| gps_lat | float, nullable | from EXIF GPS, if present |
| gps_lon | float, nullable | from EXIF GPS, if present |
| caption | text, nullable | optional user note |
| created_at | datetime | when imported into the app |

Keep the schema easy to extend — do not hardcode assumptions that would
block adding these later (no need to build them now, just don't paint into a
corner):
- `photo_embeddings` (photo_id, vector) — for future image-similarity /
  auto-tagging.
- `reconstructions` (id, pin_id, date_range, file_path, type) — for future
  photogrammetry/3D output (point cloud or mesh file), if added later.
- `camera_poses` (photo_id, reconstruction_id, x, y, z, rotation) — for future
  automatically-recovered camera positions from 3D reconstruction.

**Do not build photogrammetry or embeddings now.** Just avoid schema/API
decisions that would make adding them later painful.

---

## Features (v1 scope)

### 0. Site plan management
- Start with uploading the site plan

### 1. Floor plan management
- Upload a floor plan image, give it a name.
- Allow the floor plan to be positioned to a correct location in regards to the site plan (in layer edit mode)
- Support multiple floor plans (multiple levels + optionally a site/exterior
  plan).
- Switch between floor plans in the UI.

### 2. Pin placement
- Click anywhere on the displayed floor plan to create a new pin at that
  point.
- Store pin position normalized (0–1 relative to layer image width/height) so it
  stays correct regardless of display size and moves with the layer if layer is edited again
- Edit pin label/category; delete a pin (with confirmation, and handle/ask
  about orphaned photos).
- Render pins as markers on the floor plan; each pin shows a small direction
  indicator based on the most recent photo's heading (or an average — pick a
  sensible simple default).

### 3. Photo import
- Bulk import from a local folder (the user will point the app at a folder,
  e.g. an extracted Google Takeout export or a manual folder of JPEGs).
- For each photo:
  - Extract EXIF `DateTimeOriginal` (fallback: file modified time).
  - Extract EXIF GPS coordinates if present (`GPSLatitude`/`GPSLongitude`).
  - Generate a thumbnail (e.g. max 400px on the long edge) into
    `thumbnails/`.
  - Copy (not move) the original into `photos/` preserving filename, handling
    collisions.
  - Insert a `photos` row with `pin_id = NULL` (unassigned) — imported photos
    land in an "unassigned/inbox" view first.
- Show import progress (this may process hundreds of files).

### 4. Assigning photos to pins
- An "unassigned photos" view (grid of thumbnails) where the user can select
  one or more photos and assign them to a pin (e.g. click a photo, then click
  a pin on the floor plan; or drag-and-drop onto the plan).
- Ability to reassign a photo to a different pin later.

### 5. Direction arrow
- When viewing/editing a single photo's assignment, show a draggable arrow
  UI (e.g. a circular dial, or an arrow overlaid on/near the pin) to set
  `direction_deg`.
- arrow defaults to direction of the previously set orientation
  and must be set manually — don't leave it silently wrong.

### 6. Timeline view
- Click a pin → open a timeline/list of all photos assigned to that pin,
  sorted by `taken_at` ascending (oldest first, so it reads like progress
  over time).
- Show photo thumbnail, date, and let the user click through to full
  resolution.
- Simple scroll or slider-style timeline is fine — prioritize clarity over
  cleverness.
- around selected pin, show small arrows indicating the directions of where the photos were taken
- have a pie chart-like desired angle selection filter to show only photos that were taken
  into that direction

### 7. Basic navigation
- Home view: floor plan selector + the currently selected floor plan with
  pins overlaid.
- Pin click → timeline view (modal or side panel, doesn't need a full page
  navigation).
- Unassigned photos view accessible from the main nav.

---

## Explicitly out of scope for v1

- Photogrammetry / 3D reconstruction (COLMAP, Meshroom, etc.) — schema should
  allow for it later, but do not implement.
- Image similarity / embedding-based auto-tagging — same, schema-ready only.
- Multi-user accounts, authentication, cloud sync, mobile app.
- Editing/rotating/annotating photos beyond caption text.

---

## Non-functional requirements

- Must run entirely locally with a single command; no external services
  required for core functionality.
- Should comfortably handle a few hundred to low thousands of photos without
  the UI becoming sluggish (thumbnails + pagination/lazy-loading where
  needed).
- Keep dependencies minimal and well-known (Flask/FastAPI, Pillow, SQLite via
  stdlib `sqlite3` or a lightweight ORM like SQLAlchemy — avoid heavy
  frameworks).
- Code should be reasonably organized (routes/views separated from
  DB/data-access logic) but this is a personal tool, not a production SaaS —
  don't over-engineer.
