import { api, thumbUrl } from "./api.js";
import { toast, formatDate } from "./state.js";
import { enterAssignMode } from "./canvas.js";
import { openPhotoModal } from "./photoModal.js";

const panel = document.getElementById("unassignedPanel");
const navBtn = document.getElementById("navUnassignedBtn");
const closeBtn = document.getElementById("unassignedPanelCloseBtn");
const grid = document.getElementById("unassignedGrid");
const selectAllBtn = document.getElementById("selectAllBtn");
const clearSelectionBtn = document.getElementById("clearSelectionBtn");
const assignSelectedBtn = document.getElementById("assignSelectedBtn");
const loadMoreBtn = document.getElementById("loadMoreBtn");
const countBadge = document.getElementById("unassignedCount");
const zoomInBtn = document.getElementById("gridZoomInBtn");
const zoomOutBtn = document.getElementById("gridZoomOutBtn");

const GRID_COL_MIN = 70;
const GRID_COL_MAX = 260;
const GRID_COL_STEP = 20;

const selected = new Set();
let page = 1;
let hasMore = false;
let loadedPhotos = [];
let awaitingAssignResult = false;
let gridColPx = 110;

function applyGridZoom() {
  grid.style.setProperty("--grid-col", gridColPx + "px");
}
zoomInBtn.addEventListener("click", () => {
  gridColPx = Math.min(GRID_COL_MAX, gridColPx + GRID_COL_STEP);
  applyGridZoom();
});
zoomOutBtn.addEventListener("click", () => {
  gridColPx = Math.max(GRID_COL_MIN, gridColPx - GRID_COL_STEP);
  applyGridZoom();
});

export function openUnassignedPanel() {
  panel.classList.remove("hidden");
  navBtn.classList.add("active");
}
export function closeUnassignedPanel() {
  panel.classList.add("hidden");
  navBtn.classList.remove("active");
}
function toggleUnassignedPanel() {
  if (panel.classList.contains("hidden")) openUnassignedPanel();
  else closeUnassignedPanel();
}
navBtn.addEventListener("click", toggleUnassignedPanel);
closeBtn.addEventListener("click", closeUnassignedPanel);

export async function loadUnassigned(reset = true) {
  if (reset) {
    page = 1;
    loadedPhotos = [];
    selected.clear();
    grid.innerHTML = "";
  }
  const res = await api.unassignedPhotos(page, 60);
  loadedPhotos = loadedPhotos.concat(res.photos);
  hasMore = res.has_more;
  countBadge.textContent = String(res.total);
  renderGrid();
  loadMoreBtn.classList.toggle("hidden", !hasMore);
  updateAssignButton();
}

function renderGrid() {
  grid.innerHTML = "";
  for (const photo of loadedPhotos) {
    const card = document.createElement("div");
    card.className = "photo-card" + (selected.has(photo.id) ? " selected" : "");

    const selectWrap = document.createElement("label");
    selectWrap.className = "photo-select-wrap";
    // stopPropagation here catches both the wrap's own click and the
    // synthetic click the browser forwards to the checkbox, before either
    // reaches the card's "open photo modal" handler.
    selectWrap.addEventListener("click", (e) => {
      e.stopPropagation();
      toggleSelect(photo.id, card, checkbox);
    });
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.className = "photo-select";
    checkbox.checked = selected.has(photo.id);
    selectWrap.appendChild(checkbox);

    const img = document.createElement("img");
    img.src = thumbUrl(photo.thumbnail_path);
    img.alt = "";

    const meta = document.createElement("div");
    meta.className = "photo-meta";
    meta.textContent = formatDate(photo.taken_at);

    // img must come before selectWrap in DOM order — later siblings paint
    // (and hit-test) on top, and the absolutely-positioned selectWrap needs
    // to sit above the normal-flow image, not be silently covered by it.
    card.appendChild(img);
    card.appendChild(selectWrap);
    card.appendChild(meta);

    if (photo.direction_deg == null) {
      const badge = document.createElement("div");
      badge.className = "no-direction-badge";
      badge.textContent = "no direction";
      card.appendChild(badge);
    }

    card.addEventListener("click", () => openPhotoModal(photo.id, { onSaved: () => loadUnassigned() }));
    grid.appendChild(card);
  }
}

function toggleSelect(photoId, card, checkbox) {
  if (selected.has(photoId)) {
    selected.delete(photoId);
  } else {
    selected.add(photoId);
  }
  card.classList.toggle("selected", selected.has(photoId));
  checkbox.checked = selected.has(photoId);
  updateAssignButton();
}

function updateAssignButton() {
  assignSelectedBtn.disabled = selected.size === 0;
  assignSelectedBtn.textContent = selected.size
    ? `Assign selected to pin… (${selected.size})`
    : "Assign selected to pin…";
}

selectAllBtn.addEventListener("click", () => {
  for (const photo of loadedPhotos) selected.add(photo.id);
  renderGrid();
  updateAssignButton();
});
clearSelectionBtn.addEventListener("click", () => {
  selected.clear();
  renderGrid();
  updateAssignButton();
});
loadMoreBtn.addEventListener("click", () => {
  page += 1;
  loadUnassigned(false);
});
assignSelectedBtn.addEventListener("click", () => {
  if (selected.size === 0) return;
  enterAssignMode(Array.from(selected));
  awaitingAssignResult = true;
  closeUnassignedPanel();
  toast("Click a pin on the floor plan to assign the selected photos.");
});

document.addEventListener("photos-assigned", () => {
  loadUnassigned();
  if (awaitingAssignResult) {
    awaitingAssignResult = false;
    openUnassignedPanel();
  }
});
