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
- Floor plan selector is a row of toggle buttons in the top bar (only one
  active at a time); the site plan is always present underneath whichever
  level is selected.
- Click on a floor plan to drop a **pin** representing a physical location
  (e.g. "Kitchen", "Southeast corner", "Garage"). Pin is referenced to the floor plane image.
- The map (site plan + selected floor plan + pins) is pannable (left-drag)
  and zoomable (scroll wheel, zooming toward the cursor) so large or
  detailed plans stay usable. Pins and their labels hold a constant screen
  size at any zoom level, like map POI markers.
- Import photos in bulk; assign each photo to a pin.
- Each photo also gets an approximate **camera direction** (which way the
  camera was facing), shown as an arrow on the plan at the pin (when the photo is selected)
- Click a pin → see all photos assigned to it as a gallery, sorted
  chronologically.

---

## Tech stack

- **Backend**: Python, Flask (or FastAPI — pick whichever is cleaner for the
  scope), run with a single command (`python app.py` or `uvicorn ...`).
- **Database**: SQLite, single `.db` file. No external DB server.
- **Frontend**: Server-rendered pages or a lightweight JS frontend (vanilla JS
  or a small framework) — no build-heavy SPA tooling needed for a local
  single-user tool. Keep it simple and dependency-light.
- **Image handling**: Pillow for EXIF extraction and thumbnail generation.
  `DateTimeOriginal`/`DateTimeDigitized` live in the EXIF sub-IFD, not the
  top-level IFD0 — read via `exif.get_ifd(ExifTags.IFD.Exif)`, not just
  `exif.items()`, or the real shot date is silently missed and every photo
  falls back to file mtime.
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
├── thumbnails/               # generated thumbnails (for fast grid/list views)
└── static/, templates/      # frontend assets
```

The whole `project_root` folder should be self-contained and portable — easy
to back up, zip, move to another machine, or sync via any file-based method
(external drive, Syncthing, etc.).

A `SITETRACE_DATA_DIR` environment variable may redirect the db +
floorplans/photos/thumbnails directories elsewhere entirely, independent of
`project_root`. This exists so development/testing can run against a fully
isolated instance without any risk of touching the real database or photo
library. Default behavior (unset) is unaffected.

---

## Data model (SQLite)

### `floorplans`
| column | type | notes |
|---|---|---|
| id | integer PK | |
| name | text | e.g. "Ground floor", "Roof", "Site plan" |
| image_path | text | path under `floorplans/` |
| width_px | integer | image pixel dimensions, captured on upload |
| height_px | integer | image pixel dimensions, captured on upload |
| is_site_plan | boolean | exactly one row is the site plan; it always renders as the identity-transform background layer |
| offset_x | float | this layer's center, normalized 0–1 relative to the site plan's width. Default centers a freshly uploaded layer instead of corner-anchoring it (0,0), which for a mismatched aspect ratio could push the layer — and its edit handles — outside the visible canvas |
| offset_y | float | same, relative to site plan height |
| scale | float | layer width as a fraction of the site plan's width. Defaults on upload to an aspect-fit value (not always 1.0) so the layer starts inside the visible canvas |
| rotation_deg | float | rotation around the layer's own center |
| created_at | datetime | |

Site plan rows carry the same offset/scale/rotation columns but ignore them —
the site plan always renders at the identity transform.

The image behind any layer (including the site plan) can be swapped later
without touching its pins/photos or, for a regular layer, its existing
offset/scale/rotation — those stay as a starting point to nudge if the new
image doesn't line up exactly.

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
| orig_filename | text | source filename, used with file_size for import dedup |
| file_size | integer | source file size in bytes, used with orig_filename for import dedup |
| taken_at | datetime | from EXIF `DateTimeOriginal`/`DateTimeDigitized`, fallback to file mtime |
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
- Start with uploading the site plan.
- Its image can be replaced later without disturbing floor plans, pins, or
  photo assignments.

### 1. Floor plan management
- Upload a floor plan image, give it a name.
- Layer edit mode positions the floor plan relative to the site plan by
  direct manipulation of the image itself, not sliders: drag the image body
  to move it, a corner handle to resize (uniform scale), a handle on the
  layer to rotate. An opacity slider makes the site plan visible underneath
  while aligning. All manipulation is computed in content space so it stays
  correct at any pan/zoom level, and pivots around the layer's own center.
- Its image can be replaced later without disturbing that floor plan's pins
  or photo assignments (offset/scale/rotation are kept as-is, adjustable
  afterward if the new image doesn't line up).
- Support multiple floor plans (multiple levels + optionally a site/exterior
  plan).
- Switch between floor plans via toggle buttons in the top bar (only one
  active at a time).

### 2. Pin placement
- Click anywhere on the displayed floor plan to create a new pin at that
  point. A left-drag past a small movement threshold pans the map instead of
  placing a pin — only a press-release with little to no movement counts as
  a click.
- Store pin position normalized (0–1 relative to layer image width/height) so it
  stays correct regardless of display size and moves with the layer if layer is edited again
- Edit pin label/category; delete a pin (with confirmation). If the pin has
  photos assigned, the user is asked whether to unassign them (back to the
  inbox) or delete them too before the pin is removed.
- Render pins as markers on the floor plan; each pin shows a small direction
  indicator based on the most recent photo's heading that has one set (or an
  average — pick a sensible simple default). Pins and their labels hold a
  constant screen size regardless of map zoom.

### 3. Photo import
- Bulk import from a local folder: the user provides a folder path on the
  machine running the server (e.g. an extracted Google Takeout export or a
  manual folder of JPEGs); the app reads and copies files directly from
  disk rather than uploading them through the browser.
- For each photo:
  - Extract EXIF `DateTimeOriginal` (fallback: file modified time).
  - Extract EXIF GPS coordinates if present (`GPSLatitude`/`GPSLongitude`).
  - Generate a thumbnail (e.g. max 400px on the long edge) into
    `thumbnails/`.
  - Copy (not move) the original into `photos/` preserving filename, handling
    collisions.
  - Insert a `photos` row with `pin_id = NULL` (unassigned) — imported photos
    land in an "unassigned/inbox" view first.
- Re-importing the same or an updated folder skips files that match an
  already-imported photo by filename + file size, so pointing the app at a
  growing export folder repeatedly doesn't create duplicates.
- Show import progress (this may process hundreds of files).

### 4. Assigning photos to pins
- An "unassigned photos" panel (left side panel, toggled from the top bar)
  shows a grid of thumbnails where the user can select one or more photos
  and assign them to a pin by clicking a pin on the floor plan; the panel
  auto-closes while picking the pin and auto-reopens once the assignment
  completes. The map stays visible and interactive the whole time.
- Thumbnails are square regardless of grid column width, with a +/− control
  to resize them, and a generously-sized click target around the selection
  checkbox.
- Ability to reassign a photo to a different pin later, from a photo's
  detail view.

### 5. Direction arrow
- When viewing/editing a single photo's assignment, show a draggable arrow
  UI (a dial) to set `direction_deg`.
- Dial defaults to the direction of the pin's most recently set orientation
  and must be confirmed manually before it's saved — dragging alone doesn't
  persist anything, so a photo never silently ends up with a guessed
  heading.

### 6. Timeline view
- Click a pin → open a gallery of all photos assigned to that pin (right
  side panel), sorted by `taken_at` ascending (oldest first, so it reads
  like progress over time). Large square tiles, no date/direction text on
  the tiles themselves — open a photo to see its date, direction, and
  caption.
- Click through to full resolution from a photo's detail view.
- Around the pin's compass, show small arrows indicating the directions the
  assigned photos were taken from, and a draggable pie-wedge angle filter
  that narrows the gallery to photos taken within that direction range.

### 7. Basic navigation
- Top bar: app title, floor plan toggle buttons, "Show unassigned" (opens
  the left panel), "Import photos…".
- Main view (site plan + selected floor plan + pins) fills the available
  screen space below the top bar, preserving the site plan's aspect ratio.
- Pin click → gallery view opens as a right side panel (doesn't need a full
  page navigation); the map remains visible alongside it.
- Unassigned photos panel (left side) and pin gallery panel (right side) can
  be open at the same time without covering the top bar's controls.

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
- Development/testing should never run against the real database or photo
  library — use `SITETRACE_DATA_DIR` to point at an isolated instance.
