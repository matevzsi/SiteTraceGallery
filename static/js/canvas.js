import { api, floorplanUrl } from "./api.js";
import { state, toast } from "./state.js";
import { promptPinLabel, confirmDialog } from "./dialogs.js";
import { getTransform } from "./layerTransform.js";
import { xyToHeading } from "./compass.js";
import { openPinPanel, closePinPanel } from "./pinPanel.js";

const container = document.getElementById("planContainer");
const emptyState = document.getElementById("emptyState");
const floorplanTabs = document.getElementById("floorplanTabs");
const layerEditBtn = document.getElementById("layerEditBtn");
const replaceImageBtn = document.getElementById("replaceImageBtn");
const deleteFloorplanBtn = document.getElementById("deleteFloorplanBtn");
const layerEditControls = document.getElementById("layerEditControls");
const layerOpacity = document.getElementById("layerOpacity");
const assignBanner = document.getElementById("assignModeBanner");
const assignModeCount = document.getElementById("assignModeCount");

let viewportEl = null;
let sitePlanImgEl = null;
let wrapperEl = null;
let wrapperImgEl = null;
let resizeHandleEl = null;
let rotateHandleEl = null;
let pinsLayerEl = null;

// pan/zoom of the whole map (site plan + floor plan layer + pins), applied
// as a CSS transform on planViewport. Purely a view preference — not
// persisted, resets on reload.
const MIN_ZOOM = 0.4;
const MAX_ZOOM = 8;
let zoom = 1;
let panX = 0;
let panY = 0;

function applyViewportTransform() {
  if (viewportEl) viewportEl.style.transform = `translate(${panX}px, ${panY}px) scale(${zoom})`;
  updatePinCounterScale();
}

// Pin markers (and their label/arrow) live inside the zoomed viewport, so
// without this they'd visually grow/shrink with the map zoom like the
// floor plan image does. Counter-scaling each marker by 1/zoom keeps them
// a constant screen size — same trick map UIs use for POI pins.
function updatePinCounterScale() {
  if (!pinsLayerEl) return;
  const s = 1 / zoom;
  for (const el of pinsLayerEl.children) {
    el.style.transform = `scale(${s})`;
  }
}

function screenToContent(clientX, clientY) {
  const rect = container.getBoundingClientRect();
  return { x: (clientX - rect.left - panX) / zoom, y: (clientY - rect.top - panY) / zoom };
}

function resetView() {
  zoom = 1;
  panX = 0;
  panY = 0;
  applyViewportTransform();
}

/** Zoom by a step, anchored on the middle of the visible canvas (the
 *  button equivalent of a wheel tick under the cursor). */
function zoomByStep(factor) {
  if (!getSitePlan()) return;
  const mx = container.clientWidth / 2;
  const my = container.clientHeight / 2;
  const newZoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom * factor));
  const contentX = (mx - panX) / zoom;
  const contentY = (my - panY) / zoom;
  panX = mx - contentX * newZoom;
  panY = my - contentY * newZoom;
  zoom = newZoom;
  applyViewportTransform();
}

// CSS aspect-ratio doesn't reliably size a box within a flex row when that
// box has no in-flow content (every layer here is position:absolute for
// pan/zoom), so sizing is computed directly instead. Width always fills the
// full stage (so the map uses all available horizontal space); height
// follows from the site plan's own aspect ratio undistorted, which can run
// taller than the stage on a narrow/tall window — .plan-stage scrolls
// vertically for that case rather than shrinking width to compensate.
let lastSiteAspect = null;
function sizeContainerToStage(aspect) {
  lastSiteAspect = aspect;
  const stage = container.parentElement;
  // clientWidth includes the stage's padding; sizing to it would overflow
  // and get clamped by max-width, leaving the height (derived from the
  // unclamped width) slightly too large and the plan subtly stretched
  const cs = getComputedStyle(stage);
  const w = stage.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
  const h = w / aspect;
  container.style.width = w + "px";
  container.style.height = h + "px";
}
window.addEventListener("resize", () => {
  if (lastSiteAspect) sizeContainerToStage(lastSiteAspect);
});

export function getSitePlan() {
  return state.floorplans.find((f) => f.is_site_plan) || null;
}
export function getActiveFloorplan() {
  return state.floorplans.find((f) => f.id === state.activeFloorplanId) || null;
}

export function populateFloorplanSelect() {
  floorplanTabs.innerHTML = "";
  for (const fp of state.floorplans) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "btn tab-btn";
    btn.classList.toggle("active", fp.id === state.activeFloorplanId);
    btn.setAttribute("aria-pressed", String(fp.id === state.activeFloorplanId));
    btn.append(fp.name);
    if (fp.is_site_plan) {
      const tag = document.createElement("span");
      tag.className = "tab-tag";
      tag.textContent = "site";
      btn.appendChild(tag);
    }
    btn.addEventListener("click", () => selectFloorplan(fp.id));
    floorplanTabs.appendChild(btn);
  }
}

export async function setFloorplans(list) {
  state.floorplans = list;
  if (state.activeFloorplanId == null || !list.some((f) => f.id === state.activeFloorplanId)) {
    const site = getSitePlan();
    state.activeFloorplanId = site ? site.id : list[0]?.id ?? null;
  }
  populateFloorplanSelect();
  await selectFloorplan(state.activeFloorplanId, { skipPopulate: true });
}

export async function selectFloorplan(id, opts = {}) {
  state.activeFloorplanId = id != null ? Number(id) : null;
  state.selectedPinId = null;
  state.selectedPinIds = [];
  closePinPanel();
  const fp = getActiveFloorplan();
  layerEditBtn.disabled = !fp || fp.is_site_plan;
  replaceImageBtn.disabled = !fp;
  deleteFloorplanBtn.disabled = !fp;
  movablePinId = null;
  setLayerEditMode(false);
  if (!opts.skipPopulate) populateFloorplanSelect();
  await loadPinsAndRender();
}

export async function loadPinsAndRender() {
  const fp = getActiveFloorplan();
  state.pins = fp ? (await api.listPins(fp.id)).pins : [];
  render();
}

function ensureDom() {
  const site = getSitePlan();
  if (!site) {
    emptyState.classList.remove("hidden");
    sitePlanImgEl?.classList.add("hidden");
    wrapperEl?.classList.add("hidden");
    pinsLayerEl?.classList.add("hidden");
    return false;
  }
  emptyState.classList.add("hidden");

  if (!viewportEl) {
    viewportEl = document.createElement("div");
    viewportEl.className = "plan-viewport";
    container.appendChild(viewportEl);
    container.addEventListener("wheel", onContainerWheel, { passive: false });
    container.addEventListener("mousedown", onContainerMouseDown);
  }

  if (!sitePlanImgEl) {
    sitePlanImgEl = document.createElement("img");
    sitePlanImgEl.id = "sitePlanImg";
    viewportEl.appendChild(sitePlanImgEl);
  }
  sitePlanImgEl.classList.remove("hidden");

  if (!wrapperEl) {
    wrapperEl = document.createElement("div");
    wrapperEl.className = "floorplan-wrapper";
    wrapperImgEl = document.createElement("img");
    wrapperEl.appendChild(wrapperImgEl);
    resizeHandleEl = document.createElement("div");
    resizeHandleEl.className = "resize-handle";
    resizeHandleEl.title = "Drag to resize";
    wrapperEl.appendChild(resizeHandleEl);
    rotateHandleEl = document.createElement("div");
    rotateHandleEl.className = "rotate-handle";
    rotateHandleEl.title = "Drag to rotate";
    wrapperEl.appendChild(rotateHandleEl);
    viewportEl.appendChild(wrapperEl);
    wrapperEl.addEventListener("mousedown", onWrapperMouseDown);
    resizeHandleEl.addEventListener("mousedown", onResizeHandleMouseDown);
    rotateHandleEl.addEventListener("mousedown", onRotateHandleMouseDown);
  }
  if (!pinsLayerEl) {
    pinsLayerEl = document.createElement("div");
    pinsLayerEl.className = "pins-layer";
    viewportEl.appendChild(pinsLayerEl);
  }
  pinsLayerEl.classList.remove("hidden");
  return true;
}

function render() {
  if (!ensureDom()) return;
  const site = getSitePlan();
  const fp = getActiveFloorplan();

  sitePlanImgEl.src = floorplanUrl(site.image_path);
  sizeContainerToStage(site.width_px / site.height_px);

  if (!fp || fp.is_site_plan) {
    wrapperEl.classList.add("hidden");
    if (pinsLayerEl.parentElement !== viewportEl) viewportEl.appendChild(pinsLayerEl);
  } else {
    wrapperEl.classList.remove("hidden");
    wrapperImgEl.src = floorplanUrl(fp.image_path);
    const aspectFp = fp.height_px / fp.width_px;
    const aspectSite = site.width_px / site.height_px;
    const widthPct = fp.scale * 100;
    const heightPct = fp.scale * aspectFp * aspectSite * 100;
    wrapperEl.style.width = widthPct + "%";
    wrapperEl.style.height = heightPct + "%";
    wrapperEl.style.left = fp.offset_x * 100 - widthPct / 2 + "%";
    wrapperEl.style.top = fp.offset_y * 100 - heightPct / 2 + "%";
    wrapperEl.style.transform = `rotate(${fp.rotation_deg}deg)`;
    wrapperEl.style.opacity = state.layerEditMode ? layerOpacity.value : "1";
    wrapperEl.classList.toggle("edit-mode", state.layerEditMode);
    if (pinsLayerEl.parentElement !== wrapperEl) wrapperEl.appendChild(pinsLayerEl);
  }

  renderPins();
}

function renderPins() {
  pinsLayerEl.innerHTML = "";
  for (const pin of state.pins) {
    const el = document.createElement("div");
    el.className =
      "pin-marker" +
      (state.selectedPinIds.includes(pin.id) ? " selected" : "") +
      (pin.id === movablePinId ? " movable" : "");
    el.style.left = pin.x * 100 + "%";
    el.style.top = pin.y * 100 + "%";
    el.style.transform = `scale(${1 / zoom})`;
    el.title = pin.id === movablePinId ? "Drag to move this pin" : pin.label || "(unlabeled pin)";

    // One ray per direction anything at this pin was shot in, so the marker
    // reads as "we have photos facing these ways" at a glance. The fan lives
    // in its own box under the icon rather than radiating from the pin's
    // centre — rays through the middle crossed the photo count, and a
    // southward one ran straight through the label. The most recent heading
    // keeps a heavier ray so the latest look is still legible in the fan.
    const dirs = pin.direction_degs || [];
    if (dirs.length) {
      const fan = document.createElement("div");
      fan.className = "pin-dirs";
      const latest = pin.indicator_direction_deg;
      // while this pin's gallery has a direction filter on, its fan shows
      // which way that wedge is pointing
      const filter = state.selectedPinIds.includes(pin.id) ? overlayFilter : null;
      for (const deg of dirs) {
        const arrow = document.createElement("div");
        arrow.className = "pin-arrow";
        if (latest != null && Math.abs(((deg - latest + 540) % 360) - 180) < 8) {
          arrow.classList.add("latest");
        }
        if (filter && !isWithinArc(deg, filter.center, filter.width)) {
          arrow.classList.add("dimmed");
        }
        arrow.style.transform = `rotate(${deg}deg)`;
        fan.appendChild(arrow);
      }
      el.appendChild(fan);
      el.classList.add("has-dirs");
    }
    if (pin.photo_count) {
      const count = document.createElement("span");
      count.className = "pin-count";
      count.textContent = pin.photo_count > 99 ? "99+" : String(pin.photo_count);
      el.appendChild(count);
    }
    if (pin.label) {
      const label = document.createElement("div");
      label.className = "pin-label";
      label.textContent = pin.label;
      el.appendChild(label);
    }
    el.addEventListener("click", (e) => {
      e.stopPropagation();
      if (suppressNextPinClick) {
        suppressNextPinClick = false;
        return;
      }
      onPinClick(pin, e.ctrlKey || e.shiftKey || e.metaKey);
    });
    el.addEventListener("mousedown", (e) => onPinMarkerMouseDown(e, pin, el));
    attachPinDropTarget(el, pin);
    pinsLayerEl.appendChild(el);
  }
}

// --- moving a pin ------------------------------------------------------
// Deliberately behind an explicit unlock in the pin panel: pins are dropped
// by clicking the plan, so a freely draggable marker would make every
// slightly-off click a silent reposition.

let movablePinId = null;
let pinDragState = null;
let suppressNextPinClick = false;

/** Called from the pin panel's lock/unlock button (via the hooks in app.js). */
export function setPinMovable(pinId) {
  if (movablePinId === pinId) return;
  movablePinId = pinId;
  if (pinsLayerEl) renderPins();
}

function onPinMarkerMouseDown(e, pin, el) {
  if (!state.editMode || e.button !== 0 || pin.id !== movablePinId || state.assignMode || state.layerEditMode) return;
  e.preventDefault();
  e.stopPropagation(); // don't let the container start a pan
  pinDragState = { pin, el, start: screenToContent(e.clientX, e.clientY), origX: pin.x, origY: pin.y, moved: false };
  el.classList.add("dragging");
  window.addEventListener("mousemove", onPinDragMove);
  window.addEventListener("mouseup", onPinDragEnd);
}

function onPinDragMove(e) {
  if (!pinDragState) return;
  const fp = getActiveFloorplan();
  if (!fp) return;
  const cur = screenToContent(e.clientX, e.clientY);
  // convert both ends of the gesture into the layer's own normalized space
  // so the drag stays true under the layer's scale and rotation
  const t = getTransform(fp, container);
  const a = t.toLocal(pinDragState.start.x, pinDragState.start.y);
  const b = t.toLocal(cur.x, cur.y);
  const nx = clamp01(pinDragState.origX + (b.x - a.x));
  const ny = clamp01(pinDragState.origY + (b.y - a.y));
  if (!pinDragState.moved && (Math.abs(nx - pinDragState.origX) > 0.001 || Math.abs(ny - pinDragState.origY) > 0.001)) {
    pinDragState.moved = true;
  }
  pinDragState.pin.x = nx;
  pinDragState.pin.y = ny;
  // move just this marker rather than re-rendering the layer mid-drag
  pinDragState.el.style.left = nx * 100 + "%";
  pinDragState.el.style.top = ny * 100 + "%";
}

async function onPinDragEnd() {
  window.removeEventListener("mousemove", onPinDragMove);
  window.removeEventListener("mouseup", onPinDragEnd);
  const drag = pinDragState;
  pinDragState = null;
  if (!drag) return;
  drag.el.classList.remove("dragging");
  if (!drag.moved) return;
  // the marker's click fires right after this mouseup; without suppressing
  // it, finishing a drag would also re-open the panel
  suppressNextPinClick = true;
  try {
    await api.updatePin(drag.pin.id, { x: drag.pin.x, y: drag.pin.y });
    toast("Pin moved");
  } catch (err) {
    toast(err.message, true);
    await loadPinsAndRender(); // put it back where the server still has it
  }
}

function clamp01(v) {
  return Math.min(1, Math.max(0, v));
}

/** Move a pin to a different level, keeping it over the same physical spot.
 *
 *  Pin coordinates are normalized against their own layer's image, so
 *  carrying x/y across unchanged would land the pin wherever that fraction
 *  happens to fall on the new plan. Instead the position is projected out to
 *  the shared site-plan space through the old layer's transform and back in
 *  through the new one — "the first floor above this bit of ground" rather
 *  than "the same fraction of a different drawing". Called from the pin
 *  panel's floor selector via the hooks in app.js.
 */
export async function movePinToFloorplan(pinId, targetFpId) {
  if (!state.editMode) return;
  const pin = state.pins.find((p) => p.id === pinId);
  const fromFp = getActiveFloorplan();
  const toFp = state.floorplans.find((f) => f.id === Number(targetFpId));
  if (!pin || !fromFp || !toFp || fromFp.id === toFp.id) return;

  const world = getTransform(fromFp, container).toScreen(pin.x, pin.y);
  const local = getTransform(toFp, container).toLocal(world.x, world.y);
  const x = clamp01(local.x);
  const y = clamp01(local.y);
  const clamped = Math.abs(x - local.x) > 1e-9 || Math.abs(y - local.y) > 1e-9;

  try {
    await api.updatePin(pin.id, { floorplan_id: toFp.id, x, y });
    // follow the pin over so it's obvious where it ended up — especially
    // when the levels don't overlap and the position had to be clamped
    await selectFloorplan(toFp.id);
    const moved = state.pins.find((p) => p.id === pin.id);
    if (moved) {
      state.selectedPinId = moved.id;
      state.selectedPinIds = [moved.id];
      renderPins();
      await openPinPanel([moved]);
    }
    toast(
      clamped
        ? `Moved to "${toFp.name}" — that spot is outside this plan, so the pin sits at its edge`
        : `Moved to "${toFp.name}"`
    );
  } catch (err) {
    toast(err.message, true);
  }
}

// --- drag photos onto a pin to assign them ----------------------------
// The drag payload is carried in state.draggingPhotoIds (see state.js):
// dragenter/dragover can't read dataTransfer, and the marker needs to know
// it's a valid target before the drop happens.

function attachPinDropTarget(el, pin) {
  // both dragenter and dragover matter: dragover only fires while the
  // pointer keeps moving, so a cursor that comes to rest on the marker
  // would never light it up if the highlight hung off dragover alone.
  const markTarget = (e) => {
    if (!state.editMode || !state.draggingPhotoIds?.length) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    el.classList.add("drop-target");
  };
  el.addEventListener("dragenter", markTarget);
  el.addEventListener("dragover", markTarget);
  // dragleave also fires when the pointer crosses into a descendant of the
  // marker (its count/label), which would flicker the highlight off right
  // where the user is aiming — only drop it when the drag really left.
  el.addEventListener("dragleave", (e) => {
    if (e.relatedTarget && el.contains(e.relatedTarget)) return;
    el.classList.remove("drop-target");
  });
  el.addEventListener("drop", async (e) => {
    el.classList.remove("drop-target");
    const ids = readDraggedPhotoIds(e);
    if (!ids.length) return;
    e.preventDefault();
    e.stopPropagation();
    try {
      const res = await api.bulkAssign(ids, pin.id);
      toast(`Assigned ${res.updated} photo(s) to "${pin.label || "pin"}"`);
      document.dispatchEvent(new CustomEvent("photos-assigned", { detail: { removedIds: ids } }));
      await loadPinsAndRender();
    } catch (err) {
      toast(err.message, true);
    }
  });
}

function readDraggedPhotoIds(e) {
  const raw = e.dataTransfer?.getData("application/x-sitetrace-photos");
  if (raw) {
    try {
      const ids = JSON.parse(raw);
      if (Array.isArray(ids) && ids.length) return ids;
    } catch {
      /* fall through to the in-page state below */
    }
  }
  return state.draggingPhotoIds || [];
}

function isWithinArc(deg, center, width) {
  let diff = Math.abs(((deg - center + 540) % 360) - 180);
  return diff <= width / 2;
}

// The open pin's direction filter feeds straight into that pin's fan (rays
// outside the wedge dim) rather than a second set of arrows drawn from the
// pin's centre — those crossed the icon and its photo count, and painted on
// top of both.
let overlayFilter = null;
export function refreshSelectedPinOverlay(photos, filter) {
  const changed = JSON.stringify(overlayFilter) !== JSON.stringify(filter);
  overlayFilter = filter;
  if (changed && pinsLayerEl) renderPins();
}

function handlePlanClick(clientX, clientY) {
  const fp = getActiveFloorplan();
  if (!fp) return;
  const { x: px, y: py } = screenToContent(clientX, clientY);
  const t = getTransform(fp, container);
  const { x, y } = t.toLocal(px, py);
  if (x < 0 || x > 1 || y < 0 || y > 1) return;

  if (state.assignMode) {
    // in assign mode, only clicking an actual pin marker (onPinClick) does
    // anything; clicking empty plan space is a no-op.
    return;
  }
  if (state.editMode) createPinAt(fp.id, x, y);
}

// --- pan (left-drag) + zoom (wheel) ------------------------------------
// Left-drag both pans the map and places pins, so a movement threshold
// decides which gesture the user meant: a press-release with barely any
// movement is a click (place/open a pin); anything past the threshold is a
// pan and suppresses pin creation on release.

const PAN_THRESHOLD_PX = 4;
let panState = null;

function onContainerWheel(e) {
  if (!getSitePlan()) return;
  e.preventDefault();
  const rect = container.getBoundingClientRect();
  const mx = e.clientX - rect.left;
  const my = e.clientY - rect.top;
  const factor = Math.exp(-e.deltaY * 0.0015);
  const newZoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom * factor));
  const contentX = (mx - panX) / zoom;
  const contentY = (my - panY) / zoom;
  panX = mx - contentX * newZoom;
  panY = my - contentY * newZoom;
  zoom = newZoom;
  applyViewportTransform();
}

function onContainerMouseDown(e) {
  if (e.button !== 0) return;
  if (state.layerEditMode) return; // wrapperEl's own mousedown drags the layer instead
  if (!getSitePlan()) return;
  if (e.target.closest(".pin-marker")) return; // let the marker's own click handler run
  panState = { startClientX: e.clientX, startClientY: e.clientY, startPanX: panX, startPanY: panY, moved: false };
  window.addEventListener("mousemove", onContainerMouseMove);
  window.addEventListener("mouseup", onContainerMouseUp);
}

function onContainerMouseMove(e) {
  if (!panState) return;
  const dx = e.clientX - panState.startClientX;
  const dy = e.clientY - panState.startClientY;
  if (!panState.moved && Math.hypot(dx, dy) > PAN_THRESHOLD_PX) {
    panState.moved = true;
    container.classList.add("panning");
  }
  if (panState.moved) {
    panX = panState.startPanX + dx;
    panY = panState.startPanY + dy;
    applyViewportTransform();
  }
}

function onContainerMouseUp(e) {
  window.removeEventListener("mousemove", onContainerMouseMove);
  window.removeEventListener("mouseup", onContainerMouseUp);
  container.classList.remove("panning");
  if (panState && !panState.moved) handlePlanClick(e.clientX, e.clientY);
  panState = null;
}

document.getElementById("resetViewBtn").addEventListener("click", resetView);
document.getElementById("zoomInBtn").addEventListener("click", () => zoomByStep(1.35));
document.getElementById("zoomOutBtn").addEventListener("click", () => zoomByStep(1 / 1.35));

async function createPinAt(floorplanId, x, y) {
  if (!state.editMode) return;
  const label = await promptPinLabel();
  if (label === null) return;
  try {
    const pin = await api.createPin(floorplanId, { x, y, label: label.trim() });
    await loadPinsAndRender();
    onPinClick(pin);
  } catch (err) {
    toast(err.message, true);
  }
}

async function onPinClick(pin, additive = false) {
  if (state.assignMode) {
    try {
      const ids = state.assignMode.photoIds;
      const res = await api.bulkAssign(ids, pin.id);
      toast(`Assigned ${res.updated} photo(s) to "${pin.label || "pin"}"`);
      cancelAssignMode();
      document.dispatchEvent(new CustomEvent("photos-assigned", { detail: { removedIds: ids } }));
      await loadPinsAndRender();
    } catch (err) {
      toast(err.message, true);
    }
    return;
  }
  if (additive) {
    const selected = new Set(state.selectedPinIds);
    if (selected.has(pin.id)) selected.delete(pin.id);
    else selected.add(pin.id);
    state.selectedPinIds = Array.from(selected);
  } else {
    state.selectedPinIds = [pin.id];
  }
  if (state.selectedPinIds.length === 0) {
    closePinPanel();
    renderPins();
    return;
  }
  state.selectedPinId = state.selectedPinIds[0] ?? null;
  renderPins();
  await openPinPanel(state.pins.filter((candidate) => state.selectedPinIds.includes(candidate.id)));
}

export function enterAssignMode(photoIds) {
  if (!state.editMode) return;
  state.assignMode = { photoIds };
  assignModeCount.textContent = String(photoIds.length);
  assignBanner.classList.remove("hidden");
}
export function cancelAssignMode() {
  state.assignMode = null;
  assignBanner.classList.add("hidden");
}
document.getElementById("assignModeCancelBtn").addEventListener("click", cancelAssignMode);

// --- layer edit mode -------------------------------------------------

function setLayerEditMode(on) {
  state.layerEditMode = state.editMode && on;
  layerEditControls.classList.toggle("hidden", !state.layerEditMode);
  layerEditBtn.classList.toggle("active", state.layerEditMode);
  render();
}

layerEditBtn.addEventListener("click", () => setLayerEditMode(!state.layerEditMode));
document.getElementById("layerEditDoneBtn").addEventListener("click", () => setLayerEditMode(false));
layerOpacity.addEventListener("input", () => {
  if (wrapperEl) wrapperEl.style.opacity = layerOpacity.value;
});

async function persistTransform() {
  if (!state.editMode) return;
  const fp = getActiveFloorplan();
  if (!fp) return;
  try {
    await api.updateFloorplan(fp.id, {
      offset_x: fp.offset_x,
      offset_y: fp.offset_y,
      scale: fp.scale,
      rotation_deg: fp.rotation_deg,
    });
  } catch (err) {
    toast(err.message, true);
  }
}

// Direct-manipulation transform: drag the image body to move it, the
// corner handle to resize (uniform scale), the top handle to rotate.
// All three read the mouse position through screenToContent() so dragging
// stays correct at any pan/zoom level, and pivot around the layer's own
// center (in content-space pixels) so resize/rotate don't also drift the
// layer's position.
let dragState = null;

function onWrapperMouseDown(e) {
  if (!state.layerEditMode) return;
  e.preventDefault();
  e.stopPropagation();
  const fp = getActiveFloorplan();
  if (!fp) return;
  const start = screenToContent(e.clientX, e.clientY);
  dragState = { kind: "move", startX: start.x, startY: start.y, offsetX: fp.offset_x, offsetY: fp.offset_y };
  window.addEventListener("mousemove", onDragMove);
  window.addEventListener("mouseup", onDragEnd);
}

function onResizeHandleMouseDown(e) {
  if (!state.layerEditMode) return;
  e.preventDefault();
  e.stopPropagation();
  const fp = getActiveFloorplan();
  if (!fp) return;
  const CW = container.clientWidth;
  const CH = container.clientHeight;
  const cx = fp.offset_x * CW;
  const cy = fp.offset_y * CH;
  const start = screenToContent(e.clientX, e.clientY);
  const startRadius = Math.hypot(start.x - cx, start.y - cy) || 1;
  dragState = { kind: "resize", cx, cy, startRadius, startScale: fp.scale };
  window.addEventListener("mousemove", onDragMove);
  window.addEventListener("mouseup", onDragEnd);
}

function onRotateHandleMouseDown(e) {
  if (!state.layerEditMode) return;
  e.preventDefault();
  e.stopPropagation();
  const fp = getActiveFloorplan();
  if (!fp) return;
  const CW = container.clientWidth;
  const CH = container.clientHeight;
  const cx = fp.offset_x * CW;
  const cy = fp.offset_y * CH;
  const start = screenToContent(e.clientX, e.clientY);
  const startAngle = xyToHeading(start.x - cx, start.y - cy);
  dragState = { kind: "rotate", cx, cy, startAngle, startRotation: fp.rotation_deg };
  window.addEventListener("mousemove", onDragMove);
  window.addEventListener("mouseup", onDragEnd);
}

function onDragMove(e) {
  if (!dragState) return;
  const fp = getActiveFloorplan();
  if (!fp) return;
  const cur = screenToContent(e.clientX, e.clientY);

  if (dragState.kind === "move") {
    const CW = container.clientWidth;
    const CH = container.clientHeight;
    fp.offset_x = dragState.offsetX + (cur.x - dragState.startX) / CW;
    fp.offset_y = dragState.offsetY + (cur.y - dragState.startY) / CH;
  } else if (dragState.kind === "resize") {
    const radius = Math.hypot(cur.x - dragState.cx, cur.y - dragState.cy);
    fp.scale = Math.max(0.05, dragState.startScale * (radius / dragState.startRadius));
  } else if (dragState.kind === "rotate") {
    const angle = xyToHeading(cur.x - dragState.cx, cur.y - dragState.cy);
    fp.rotation_deg = dragState.startRotation + (angle - dragState.startAngle);
  }
  render();
}

function onDragEnd() {
  window.removeEventListener("mousemove", onDragMove);
  window.removeEventListener("mouseup", onDragEnd);
  dragState = null;
  persistTransform();
}

export async function refreshFloorplans() {
  const res = await api.listFloorplans();
  await setFloorplans(res.floorplans);
}

// a heading was set/cleared somewhere, so the fans need re-reading
document.addEventListener("pin-directions-changed", () => {
  if (state.activeFloorplanId != null) loadPinsAndRender();
});

// --- removing a layer --------------------------------------------------
// Pins on the layer go with it (ON DELETE CASCADE) and their photos fall
// back to the inbox (photos.pin_id is ON DELETE SET NULL) — no photo is
// ever destroyed here, which is what the confirmation promises.

deleteFloorplanBtn.addEventListener("click", async () => {
  if (!state.editMode) return;
  const fp = getActiveFloorplan();
  if (!fp) return;

  const pinCount = state.pins.length;
  const photoCount = state.pins.reduce((n, p) => n + (p.photo_count || 0), 0);
  const consequences = [];
  if (pinCount) consequences.push(`Its ${pinCount} pin${pinCount === 1 ? "" : "s"} will be removed`);
  if (photoCount) {
    consequences.push(
      `the ${photoCount} photo${photoCount === 1 ? "" : "s"} assigned to ${pinCount === 1 ? "it" : "them"} ` +
        `go back to unassigned (no photos are deleted)`
    );
  }

  const ok = await confirmDialog({
    title: `Remove "${fp.name}"?`,
    message: consequences.length
      ? consequences.join(", ") + ". The floor plan image is deleted."
      : "The floor plan image is deleted. It has no pins on it.",
    confirmLabel: "Remove floor plan",
  });
  if (!ok) return;

  try {
    await api.deleteFloorplan(fp.id);
    toast(`Removed "${fp.name}"`);
    await refreshFloorplans();
    // photos that were on its pins are back in the inbox
    document.dispatchEvent(new CustomEvent("photos-assigned"));
  } catch (err) {
    toast(err.message, true);
  }
});

document.addEventListener("mode-changed", (e) => {
  if (e.detail.editMode) return;
  cancelAssignMode();
  setLayerEditMode(false);
  setPinMovable(null);
});
