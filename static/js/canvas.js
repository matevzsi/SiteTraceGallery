import { api, floorplanUrl } from "./api.js";
import { state, toast } from "./state.js";
import { promptPinLabel } from "./dialogs.js";
import { getTransform } from "./layerTransform.js";
import { svgEl, headingToXY, xyToHeading } from "./compass.js";
import { openPinPanel, closePinPanel } from "./pinPanel.js";

const container = document.getElementById("planContainer");
const emptyState = document.getElementById("emptyState");
const floorplanTabs = document.getElementById("floorplanTabs");
const layerEditBtn = document.getElementById("layerEditBtn");
const replaceImageBtn = document.getElementById("replaceImageBtn");
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
let overlaySvg = null;

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
  // the direction arrows are drawn in content pixels, so their on-screen
  // length has to be recomputed against the new zoom to stay constant
  renderDirectionOverlay(overlayPhotos, overlayFilter);
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
  closePinPanel();
  const fp = getActiveFloorplan();
  layerEditBtn.disabled = !fp || fp.is_site_plan;
  replaceImageBtn.disabled = !fp;
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
    overlaySvg?.classList.add("hidden");
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
  if (!overlaySvg) {
    overlaySvg = svgEl("svg", { class: "direction-overlay" });
    viewportEl.appendChild(overlaySvg);
  }
  pinsLayerEl.classList.remove("hidden");
  overlaySvg.classList.remove("hidden");
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
  renderDirectionOverlay(overlayPhotos, overlayFilter);
}

function renderPins() {
  pinsLayerEl.innerHTML = "";
  for (const pin of state.pins) {
    const el = document.createElement("div");
    el.className = "pin-marker" + (pin.id === state.selectedPinId ? " selected" : "");
    el.style.left = pin.x * 100 + "%";
    el.style.top = pin.y * 100 + "%";
    el.style.transform = `scale(${1 / zoom})`;
    el.title = pin.label || "(unlabeled pin)";

    if (pin.indicator_direction_deg !== null && pin.indicator_direction_deg !== undefined) {
      const arrow = document.createElement("div");
      arrow.className = "pin-arrow";
      arrow.style.transform = `rotate(${pin.indicator_direction_deg}deg)`;
      el.appendChild(arrow);
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
      onPinClick(pin);
    });
    attachPinDropTarget(el, pin);
    pinsLayerEl.appendChild(el);
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
    if (!state.draggingPhotoIds?.length) return;
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
      document.dispatchEvent(new CustomEvent("photos-assigned"));
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

function renderDirectionOverlay(photos = null, filter = null) {
  if (!overlaySvg) return;
  overlaySvg.innerHTML = "";
  const pin = state.pins.find((p) => p.id === state.selectedPinId);
  if (!pin || !photos) return;

  const fp = getActiveFloorplan();
  const t = getTransform(fp, container);
  const { x: cx, y: cy } = t.toScreen(pin.x, pin.y);
  overlaySvg.setAttribute("width", container.clientWidth);
  overlaySvg.setAttribute("height", container.clientHeight);
  overlaySvg.setAttribute("viewBox", `0 0 ${container.clientWidth} ${container.clientHeight}`);

  // drawn in content pixels inside the zoomed viewport, so divide by zoom
  // to keep the arrows the same on-screen size as the (counter-scaled) pins
  const len = 30 / zoom;
  for (const photo of photos) {
    if (photo.direction_deg === null || photo.direction_deg === undefined) continue;
    const inFilter = !filter || isWithinArc(photo.direction_deg, filter.center, filter.width);
    const { dx, dy } = headingToXY(photo.direction_deg, len);
    const line = svgEl("line", {
      x1: cx,
      y1: cy,
      x2: cx + dx,
      y2: cy + dy,
      stroke: inFilter ? "var(--pin-selected)" : "var(--ink-3)",
      "stroke-width": (inFilter ? 2.5 : 1.5) / zoom,
      "stroke-linecap": "round",
      opacity: inFilter ? 0.95 : 0.5,
    });
    overlaySvg.appendChild(line);
  }
}

function isWithinArc(deg, center, width) {
  let diff = Math.abs(((deg - center + 540) % 360) - 180);
  return diff <= width / 2;
}

let overlayPhotos = null;
let overlayFilter = null;
export function refreshSelectedPinOverlay(photos, filter) {
  overlayPhotos = photos;
  overlayFilter = filter;
  renderDirectionOverlay(photos, filter);
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
  createPinAt(fp.id, x, y);
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

async function onPinClick(pin) {
  if (state.assignMode) {
    try {
      const res = await api.bulkAssign(state.assignMode.photoIds, pin.id);
      toast(`Assigned ${res.updated} photo(s) to "${pin.label || "pin"}"`);
      cancelAssignMode();
      document.dispatchEvent(new CustomEvent("photos-assigned"));
      await loadPinsAndRender();
    } catch (err) {
      toast(err.message, true);
    }
    return;
  }
  state.selectedPinId = pin.id;
  renderPins();
  await openPinPanel(pin);
}

export function enterAssignMode(photoIds) {
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
  state.layerEditMode = on;
  layerEditControls.classList.toggle("hidden", !on);
  layerEditBtn.classList.toggle("active", on);
  render();
}

layerEditBtn.addEventListener("click", () => setLayerEditMode(!state.layerEditMode));
document.getElementById("layerEditDoneBtn").addEventListener("click", () => setLayerEditMode(false));
layerOpacity.addEventListener("input", () => {
  if (wrapperEl) wrapperEl.style.opacity = layerOpacity.value;
});

async function persistTransform() {
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
