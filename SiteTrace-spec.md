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
- Floor plan selector is a segmented row of toggle buttons floating over
  the top of the map (only one active at a time); the site plan is always
  present underneath whichever level is selected.
- Click on a floor plan to drop a **pin** representing a physical location
  (e.g. "Kitchen", "Southeast corner", "Garage"). Pin is referenced to the floor plane image.
- The map (site plan + selected floor plan + pins) is pannable (left-drag)
  and zoomable (scroll wheel toward the cursor, or floating +/−/reset
  buttons) so large or detailed plans stay usable. Pins, their labels and
  the direction arrows hold a constant screen size at any zoom level, like
  map POI markers.
- Import photos in bulk; assign each photo to a pin — either by selecting
  photos and clicking a pin, or by dragging photos straight onto one.
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
- Switch between floor plans via a segmented row of toggle buttons floating
  over the top of the map (only one active at a time). Floor plan
  *management* actions (add, replace image, align layer) live in the top
  bar; the level *switcher* sits over the map, next to what it changes.

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
- Reposition a pin: open it, click "Unlock position" in its panel, then drag
  the marker on the plan; the new position saves on release. Pins are
  locked by default and re-lock whenever the panel closes or another pin is
  opened — since pins are *created* by clicking the plan, a permanently
  draggable marker would turn every slightly-off click into a silent
  reposition. The drag is computed in the layer's own normalized space, so
  it stays true under the layer's scale and rotation as well as map
  pan/zoom.
- Render pins as markers on the floor plan; each pin shows a small direction
  indicator based on the most recent photo's heading that has one set (or an
  average — pick a sensible simple default), and the number of photos
  assigned to it. Pins, their labels and the direction arrows hold a
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
  shows a grid of thumbnails. Two ways to assign from there:
  - **Select then click**: tick one or more photos, hit "Assign … to pin",
    then click a pin on the floor plan. The panel auto-closes while picking
    the pin and auto-reopens once the assignment completes.
  - **Drag and drop**: drag a thumbnail straight onto a pin. Dragging a
    selected photo carries the whole selection; dragging an unselected one
    carries just that photo and leaves the selection alone. While a drag is
    in flight every pin advertises itself as a target and grows extra hit
    area around its (deliberately small) marker, and the pin under the
    cursor highlights.
  - The map stays visible and interactive throughout either route.
- Thumbnails are square regardless of grid column width, with a +/− control
  to resize them, and a generously-sized click target around the selection
  checkbox. The shot date rides along as an overlay caption rather than a
  text row, so the tile stays exactly square at any thumbnail size.
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
  like progress over time). Large square tiles carrying only the shot date
  as an overlay caption — open a photo to see its direction and caption.
- Tiles with no `direction_deg` set carry the same small marker the inbox
  uses, in the gallery as well: without a heading a photo can never appear
  under the compass angle filter, so which ones still need one has to be
  visible at a glance.
- Click through to full resolution from a photo's detail view.
- Around the pin's compass, show small arrows indicating the directions the
  assigned photos were taken from, and a draggable pie-wedge angle filter
  that narrows the gallery to photos taken within that direction range. The
  compass block is collapsible so it doesn't eat gallery space when unused.

### 7. Basic navigation
- Top bar: app title, floor plan management actions (add / replace image /
  align layer), "Unassigned" (opens the left panel) with its count,
  "Import photos", and a light/dark theme toggle.
- Main view (site plan + selected floor plan + pins) fills the available
  screen space below the top bar, preserving the site plan's aspect ratio.
  Width always fills the stage; if the site plan's aspect ratio makes that
  run taller than the visible area, the map area scrolls rather than
  shrinking back to fit.
- Map controls float over the map rather than stacking above it and eating
  vertical space: level switcher top-centre, zoom in/out/reset bottom-right,
  layer-align and assign-mode bars appearing over the map only while those
  modes are active.
- Pin click → gallery view opens as a right side panel (doesn't need a full
  page navigation); the map remains visible alongside it.
- Unassigned photos panel (left side) and pin gallery panel (right side) can
  be open at the same time without covering the top bar's controls.

### 8. Interface conventions
- Light and dark themes, both driven by one set of CSS custom properties.
  Default follows the OS; the top-bar toggle stores an explicit override in
  `localStorage`, applied before first paint so a reload never flashes the
  wrong theme.
- No native `prompt()`/`confirm()`/`alert()` — naming a new pin and
  confirming a delete both use in-app dialogs, so they're themed, keyboard
  dismissible, and can't be suppressed by the browser.
- Escape and a backdrop click dismiss the topmost dialog (running the same
  cleanup as its Cancel button); with no dialog open, Escape closes an open
  side panel.
- Thumbnails load lazily and paging appends only the new page rather than
  re-rendering everything already on screen.

**A CSS trap worth remembering:** photo tiles get their height from
`aspect-ratio` against a `1fr` grid column, which contributes *nothing* to
an auto-sized grid row's intrinsic height. Rows then collapse to a few
pixels and every row of photos overlaps the one above it, while the tiles
themselves still measure correctly — so it looks like "the rows aren't tall
enough to show the photo". `grid-auto-rows: max-content` forces a real
content measurement against the resolved column width and is load-bearing
in `.photo-grid`; don't remove it. (`align-items: start` alone does *not*
fix this, and on its own is what triggers the overlap.)

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
  the UI becoming sluggish: thumbnails rather than originals in every grid,
  paged loading (60 at a time) that appends instead of re-rendering, and
  `loading="lazy"` so off-screen tiles cost nothing until scrolled to.
- Keep dependencies minimal and well-known (Flask/FastAPI, Pillow, SQLite via
  stdlib `sqlite3` or a lightweight ORM like SQLAlchemy — avoid heavy
  frameworks).
- Code should be reasonably organized (routes/views separated from
  DB/data-access logic) but this is a personal tool, not a production SaaS —
  don't over-engineer.
- Development/testing should never run against the real database or photo
  library — use `SITETRACE_DATA_DIR` to point at an isolated instance.
