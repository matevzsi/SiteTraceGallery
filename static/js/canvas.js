import { api, floorplanUrl } from "./api.js";
import { state, toast } from "./state.js";
import { getTransform } from "./layerTransform.js";
import { svgEl, headingToXY } from "./compass.js";
import { openPinPanel, closePinPanel } from "./pinPanel.js";

const container = document.getElementById("planContainer");
const emptyState = document.getElementById("emptyState");
const floorplanSelect = document.getElementById("floorplanSelect");
const layerEditBtn = document.getElementById("layerEditBtn");
const layerEditControls = document.getElementById("layerEditControls");
const layerOpacity = document.getElementById("layerOpacity");
const layerScale = document.getElementById("layerScale");
const layerRotation = document.getElementById("layerRotation");
const assignBanner = document.getElementById("assignModeBanner");
const assignModeCount = document.getElementById("assignModeCount");

let sitePlanImgEl = null;
let wrapperEl = null;
let wrapperImgEl = null;
let pinsLayerEl = null;
let overlaySvg = null;

export function getSitePlan() {
  return state.floorplans.find((f) => f.is_site_plan) || null;
}
export function getActiveFloorplan() {
  return state.floorplans.find((f) => f.id === state.activeFloorplanId) || null;
}

export function populateFloorplanSelect() {
  floorplanSelect.innerHTML = "";
  for (const fp of state.floorplans) {
    const opt = document.createElement("option");
    opt.value = fp.id;
    opt.textContent = fp.is_site_plan ? `${fp.name} (site plan)` : fp.name;
    floorplanSelect.appendChild(opt);
  }
  if (state.activeFloorplanId != null) floorplanSelect.value = state.activeFloorplanId;
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

  if (!sitePlanImgEl) {
    sitePlanImgEl = document.createElement("img");
    sitePlanImgEl.id = "sitePlanImg";
    container.appendChild(sitePlanImgEl);
  }
  sitePlanImgEl.classList.remove("hidden");

  if (!wrapperEl) {
    wrapperEl = document.createElement("div");
    wrapperEl.className = "floorplan-wrapper";
    wrapperImgEl = document.createElement("img");
    wrapperEl.appendChild(wrapperImgEl);
    container.appendChild(wrapperEl);
    wrapperEl.addEventListener("mousedown", onWrapperMouseDown);
  }
  if (!pinsLayerEl) {
    pinsLayerEl = document.createElement("div");
    pinsLayerEl.className = "pins-layer";
    container.appendChild(pinsLayerEl);
    pinsLayerEl.addEventListener("click", onPlanClick);
  }
  if (!overlaySvg) {
    overlaySvg = svgEl("svg", { class: "direction-overlay" });
    container.appendChild(overlaySvg);
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
  container.style.aspectRatio = `${site.width_px} / ${site.height_px}`;

  if (!fp || fp.is_site_plan) {
    wrapperEl.classList.add("hidden");
    if (pinsLayerEl.parentElement !== container) container.appendChild(pinsLayerEl);
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
    el.title = pin.label || "(unlabeled pin)";

    if (pin.indicator_direction_deg !== null && pin.indicator_direction_deg !== undefined) {
      const arrow = document.createElement("div");
      arrow.className = "pin-arrow";
      arrow.style.transform = `rotate(${pin.indicator_direction_deg}deg)`;
      el.appendChild(arrow);
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
    pinsLayerEl.appendChild(el);
  }
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

  for (const photo of photos) {
    if (photo.direction_deg === null || photo.direction_deg === undefined) continue;
    const inFilter = !filter || isWithinArc(photo.direction_deg, filter.center, filter.width);
    const { dx, dy } = headingToXY(photo.direction_deg, 26);
    const line = svgEl("line", {
      x1: cx,
      y1: cy,
      x2: cx + dx,
      y2: cy + dy,
      stroke: inFilter ? "#1e6fb5" : "#b8b8b3",
      "stroke-width": inFilter ? 2 : 1.5,
      "stroke-linecap": "round",
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

function onPlanClick(e) {
  if (state.layerEditMode) return;
  const rect = container.getBoundingClientRect();
  const px = e.clientX - rect.left;
  const py = e.clientY - rect.top;
  const fp = getActiveFloorplan();
  if (!fp) return;
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

async function createPinAt(floorplanId, x, y) {
  const label = prompt("Pin label (e.g. Kitchen, Southeast corner):", "");
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
  const fp = getActiveFloorplan();
  if (on && fp) {
    layerScale.value = fp.scale;
    layerRotation.value = fp.rotation_deg;
  }
  render();
}

layerEditBtn.addEventListener("click", () => setLayerEditMode(!state.layerEditMode));
document.getElementById("layerEditDoneBtn").addEventListener("click", () => setLayerEditMode(false));
layerOpacity.addEventListener("input", () => {
  if (wrapperEl) wrapperEl.style.opacity = layerOpacity.value;
});
layerScale.addEventListener("input", () => {
  const fp = getActiveFloorplan();
  if (!fp) return;
  fp.scale = parseFloat(layerScale.value);
  render();
});
layerScale.addEventListener("change", () => persistTransform());
layerRotation.addEventListener("input", () => {
  const fp = getActiveFloorplan();
  if (!fp) return;
  fp.rotation_deg = parseFloat(layerRotation.value);
  render();
});
layerRotation.addEventListener("change", () => persistTransform());

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

let dragState = null;
function onWrapperMouseDown(e) {
  if (!state.layerEditMode) return;
  e.preventDefault();
  const fp = getActiveFloorplan();
  if (!fp) return;
  dragState = { startX: e.clientX, startY: e.clientY, offsetX: fp.offset_x, offsetY: fp.offset_y };
  window.addEventListener("mousemove", onWrapperMouseMove);
  window.addEventListener("mouseup", onWrapperMouseUp);
}
function onWrapperMouseMove(e) {
  if (!dragState) return;
  const fp = getActiveFloorplan();
  if (!fp) return;
  const rect = container.getBoundingClientRect();
  const dx = (e.clientX - dragState.startX) / rect.width;
  const dy = (e.clientY - dragState.startY) / rect.height;
  fp.offset_x = dragState.offsetX + dx;
  fp.offset_y = dragState.offsetY + dy;
  render();
}
function onWrapperMouseUp() {
  window.removeEventListener("mousemove", onWrapperMouseMove);
  window.removeEventListener("mouseup", onWrapperMouseUp);
  dragState = null;
  persistTransform();
}

export async function refreshFloorplans() {
  const res = await api.listFloorplans();
  await setFloorplans(res.floorplans);
}

floorplanSelect.addEventListener("change", () => selectFloorplan(floorplanSelect.value));
