import { api, thumbUrl } from "./api.js";
import { state, toast, showModal, hideModal, formatDay, formatDate } from "./state.js";
import { confirmDialog } from "./dialogs.js";
import { svgEl, headingToXY, xyToHeading, clientPointToSvg } from "./compass.js";
import { openPhotoModal } from "./photoModal.js";

const panel = document.getElementById("pinPanel");
const labelInput = document.getElementById("pinLabelInput");
const categoryInput = document.getElementById("pinCategoryInput");
const photoCountEl = document.getElementById("pinPhotoCount");
const deleteBtn = document.getElementById("pinDeleteBtn");
const closeBtn = document.getElementById("pinPanelCloseBtn");
const compass = document.getElementById("pinCompass");
const widthInput = document.getElementById("pinCompassWidth");
const clearFilterBtn = document.getElementById("pinCompassClearFilterBtn");
const timelineEl = document.getElementById("pinTimeline");

let currentPin = null;
let currentPhotos = [];
let directionFilter = null; // { center, width } in degrees
let pendingDeletePinId = null;
let onChangeCallback = null; // set by canvas.js consumers via setHooks

export function setHooks({ onPinsChanged, onOverlayUpdate }) {
  onChangeCallback = { onPinsChanged, onOverlayUpdate };
}

export async function openPinPanel(pin) {
  currentPin = pin;
  directionFilter = null;
  clearFilterBtn.classList.add("hidden");
  labelInput.value = pin.label || "";
  categoryInput.value = pin.category || "";
  panel.classList.remove("hidden");
  await refreshTimeline();
}

export function closePinPanel() {
  panel.classList.add("hidden");
  currentPin = null;
  currentPhotos = [];
  state.selectedPinId = null;
  onChangeCallback?.onOverlayUpdate?.(null, null);
  onChangeCallback?.onPinsChanged?.();
}

async function refreshTimeline() {
  if (!currentPin) return;
  const res = await api.pinPhotos(currentPin.id);
  currentPhotos = res.photos;
  renderCompass();
  renderTimeline();
  onChangeCallback?.onOverlayUpdate?.(currentPhotos, directionFilter);
}

// Gallery: large square tiles in chronological order (oldest first, so it
// reads like progress over time). Only the date rides along as an overlay
// caption — open a photo for its direction/caption detail.
function renderTimeline() {
  timelineEl.innerHTML = "";
  const visible = currentPhotos.filter(
    (p) => !directionFilter || (p.direction_deg != null && isWithinArc(p.direction_deg, directionFilter.center, directionFilter.width))
  );
  photoCountEl.textContent = directionFilter
    ? `${visible.length} of ${currentPhotos.length} photos`
    : `${currentPhotos.length} photo${currentPhotos.length === 1 ? "" : "s"}`;

  if (visible.length === 0) {
    const empty = document.createElement("p");
    empty.className = "grid-empty";
    empty.textContent = directionFilter ? "No photos in that direction." : "No photos assigned to this pin yet.";
    timelineEl.appendChild(empty);
    return;
  }
  const frag = document.createDocumentFragment();
  for (const photo of visible) {
    const item = document.createElement("div");
    item.className = "photo-card";
    item.title = formatDate(photo.taken_at);

    const img = document.createElement("img");
    img.className = "photo-thumb";
    img.src = thumbUrl(photo.thumbnail_path);
    img.alt = "";
    img.loading = "lazy";
    img.decoding = "async";
    item.appendChild(img);

    const caption = document.createElement("span");
    caption.className = "photo-caption";
    caption.textContent = formatDay(photo.taken_at);
    item.appendChild(caption);

    item.addEventListener("click", () => openPhotoModal(photo.id, { onSaved: refreshTimeline }));
    frag.appendChild(item);
  }
  timelineEl.appendChild(frag);
}

function isWithinArc(deg, center, width) {
  const diff = Math.abs(((deg - center + 540) % 360) - 180);
  return diff <= width / 2;
}

// --- compass: direction ticks + draggable angle-filter wedge ---------

function renderCompass() {
  compass.innerHTML = "";
  const R = 90;
  compass.appendChild(svgEl("circle", { cx: 0, cy: 0, r: R, fill: "#faf9f6", stroke: "#c9c9c3" }));

  if (directionFilter) {
    compass.appendChild(wedgePath(directionFilter.center, directionFilter.width, R));
    clearFilterBtn.classList.remove("hidden");
  } else {
    clearFilterBtn.classList.add("hidden");
  }

  for (const photo of currentPhotos) {
    if (photo.direction_deg == null) continue;
    const inFilter = !directionFilter || isWithinArc(photo.direction_deg, directionFilter.center, directionFilter.width);
    const { dx: x1, dy: y1 } = headingToXY(photo.direction_deg, R * 0.55);
    const { dx: x2, dy: y2 } = headingToXY(photo.direction_deg, R * 0.92);
    compass.appendChild(
      svgEl("line", {
        x1,
        y1,
        x2,
        y2,
        stroke: inFilter ? "#1e6fb5" : "#c9c9c3",
        "stroke-width": 2,
        "stroke-linecap": "round",
      })
    );
  }

  const labels = [
    { t: "N", deg: 0 },
    { t: "E", deg: 90 },
    { t: "S", deg: 180 },
    { t: "W", deg: 270 },
  ];
  for (const l of labels) {
    const { dx, dy } = headingToXY(l.deg, R + 12);
    const txt = svgEl("text", { x: dx, y: dy + 4, "text-anchor": "middle", "font-size": 11, fill: "#8a8a85" });
    txt.textContent = l.t;
    compass.appendChild(txt);
  }
}

function wedgePath(center, width, r) {
  const a1 = center - width / 2;
  const a2 = center + width / 2;
  const p1 = headingToXY(a1, r);
  const p2 = headingToXY(a2, r);
  const largeArc = width > 180 ? 1 : 0;
  const d = `M 0 0 L ${p1.dx} ${p1.dy} A ${r} ${r} 0 ${largeArc} 1 ${p2.dx} ${p2.dy} Z`;
  return svgEl("path", { d, fill: "rgba(30,111,181,0.18)", stroke: "#1e6fb5", "stroke-width": 1 });
}

function setFilterFromEvent(e) {
  const pt = clientPointToSvg(compass, e.clientX, e.clientY);
  const width = parseFloat(widthInput.value);
  directionFilter = { center: xyToHeading(pt.x, pt.y), width };
  renderCompass();
  renderTimeline();
  onChangeCallback?.onOverlayUpdate?.(currentPhotos, directionFilter);
}

let dragging = false;
compass.addEventListener("mousedown", (e) => {
  if (currentPhotos.length === 0) return;
  dragging = true;
  setFilterFromEvent(e);
});
window.addEventListener("mousemove", (e) => {
  if (dragging) setFilterFromEvent(e);
});
window.addEventListener("mouseup", () => {
  dragging = false;
});
widthInput.addEventListener("input", () => {
  if (!directionFilter) return;
  directionFilter.width = parseFloat(widthInput.value);
  renderCompass();
  renderTimeline();
  onChangeCallback?.onOverlayUpdate?.(currentPhotos, directionFilter);
});
clearFilterBtn.addEventListener("click", () => {
  directionFilter = null;
  renderCompass();
  renderTimeline();
  onChangeCallback?.onOverlayUpdate?.(currentPhotos, directionFilter);
});

// --- label / category editing ----------------------------------------

async function saveLabelCategory() {
  if (!currentPin) return;
  try {
    const updated = await api.updatePin(currentPin.id, {
      label: labelInput.value.trim(),
      category: categoryInput.value.trim() || null,
    });
    currentPin.label = updated.label;
    currentPin.category = updated.category;
    onChangeCallback?.onPinsChanged?.();
  } catch (err) {
    toast(err.message, true);
  }
}
labelInput.addEventListener("change", saveLabelCategory);
categoryInput.addEventListener("change", saveLabelCategory);

// --- delete pin --------------------------------------------------------

deleteBtn.addEventListener("click", async () => {
  if (!currentPin) return;
  const ok = await confirmDialog({
    title: "Delete pin",
    message: `Delete "${currentPin.label || "(unlabeled pin)"}"? This cannot be undone.`,
    confirmLabel: "Delete pin",
  });
  if (!ok) return;
  try {
    await api.deletePin(currentPin.id);
    await afterPinDeleted();
  } catch (err) {
    if (err.status === 409) {
      pendingDeletePinId = currentPin.id;
      document.getElementById("pinDeleteMessage").textContent =
        `This pin has ${err.body.photo_count} photo(s) assigned. What should happen to them?`;
      showModal("pinDeleteModal");
    } else {
      toast(err.message, true);
    }
  }
});

document.getElementById("pinDeleteUnassignBtn").addEventListener("click", async () => {
  try {
    await api.deletePin(pendingDeletePinId, "unassign");
    hideModal("pinDeleteModal");
    await afterPinDeleted();
  } catch (err) {
    toast(err.message, true);
  }
});
document.getElementById("pinDeleteAlsoPhotosBtn").addEventListener("click", async () => {
  try {
    await api.deletePin(pendingDeletePinId, "delete");
    hideModal("pinDeleteModal");
    await afterPinDeleted();
  } catch (err) {
    toast(err.message, true);
  }
});
document.getElementById("pinDeleteCancelBtn").addEventListener("click", () => hideModal("pinDeleteModal"));

async function afterPinDeleted() {
  toast("Pin deleted");
  closePinPanel();
  // photos that were on this pin are back in (or gone from) the inbox, so
  // the unassigned panel and its topbar count need to catch up
  document.dispatchEvent(new CustomEvent("photos-assigned"));
}

closeBtn.addEventListener("click", closePinPanel);
document.addEventListener("escape-pressed", () => {
  if (!panel.classList.contains("hidden")) closePinPanel();
});
