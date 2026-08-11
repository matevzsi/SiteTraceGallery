import { api, thumbUrl } from "./api.js";
import { state, toast, formatDay, formatDate } from "./state.js";
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
const GRID_COL_STEP = 25;

const selected = new Set();
const cardsByPhotoId = new Map();
let page = 1;
let hasMore = false;
let loadedPhotos = [];
let awaitingAssignResult = false;
let gridColPx = 120;

function applyGridZoom() {
  grid.style.setProperty("--grid-col", gridColPx + "px");
  zoomInBtn.disabled = gridColPx >= GRID_COL_MAX;
  zoomOutBtn.disabled = gridColPx <= GRID_COL_MIN;
}
zoomInBtn.addEventListener("click", () => {
  gridColPx = Math.min(GRID_COL_MAX, gridColPx + GRID_COL_STEP);
  applyGridZoom();
});
zoomOutBtn.addEventListener("click", () => {
  gridColPx = Math.max(GRID_COL_MIN, gridColPx - GRID_COL_STEP);
  applyGridZoom();
});
applyGridZoom();

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
document.addEventListener("escape-pressed", () => {
  if (!panel.classList.contains("hidden")) closeUnassignedPanel();
});

export async function loadUnassigned(reset = true) {
  if (reset) {
    page = 1;
    loadedPhotos = [];
    selected.clear();
    cardsByPhotoId.clear();
    grid.innerHTML = "";
  }
  const res = await api.unassignedPhotos(page, 60);
  loadedPhotos = loadedPhotos.concat(res.photos);
  hasMore = res.has_more;
  countBadge.textContent = String(res.total);
  // append only the new page — re-rendering every previously loaded card on
  // each "load more" gets expensive once a few hundred are on screen
  appendCards(res.photos);
  renderEmptyState();
  loadMoreBtn.classList.toggle("hidden", !hasMore);
  updateAssignButton();
}

function renderEmptyState() {
  const existing = grid.querySelector(".grid-empty");
  if (loadedPhotos.length === 0) {
    if (!existing) {
      const empty = document.createElement("p");
      empty.className = "grid-empty";
      empty.textContent = "No unassigned photos — import a folder to get started.";
      grid.appendChild(empty);
    }
  } else {
    existing?.remove();
  }
}

function appendCards(photos) {
  const frag = document.createDocumentFragment();
  for (const photo of photos) frag.appendChild(buildCard(photo));
  grid.appendChild(frag);
}

function buildCard(photo) {
  const card = document.createElement("div");
  card.className = "photo-card" + (selected.has(photo.id) ? " selected" : "");
  card.draggable = true;
  card.dataset.photoId = String(photo.id);
  card.title = formatDate(photo.taken_at);

  const img = document.createElement("img");
  img.className = "photo-thumb";
  img.src = thumbUrl(photo.thumbnail_path);
  img.alt = "";
  img.loading = "lazy";
  img.decoding = "async";
  card.appendChild(img);

  const caption = document.createElement("span");
  caption.className = "photo-caption";
  caption.textContent = formatDay(photo.taken_at);
  card.appendChild(caption);

  if (photo.direction_deg == null) {
    const dot = document.createElement("span");
    dot.className = "photo-nodir";
    dot.title = "No direction set";
    card.appendChild(dot);
  }

  // selectWrap goes last: later siblings paint (and hit-test) above the
  // absolutely-positioned image, so putting it first would let the image
  // silently swallow clicks meant for the checkbox.
  const selectWrap = document.createElement("label");
  selectWrap.className = "photo-select-wrap";
  const checkbox = document.createElement("input");
  checkbox.type = "checkbox";
  checkbox.className = "photo-select";
  checkbox.checked = selected.has(photo.id);
  selectWrap.appendChild(checkbox);
  // stopPropagation catches both the wrap's own click and the synthetic
  // click the browser forwards to the checkbox, before either reaches the
  // card's "open photo modal" handler.
  selectWrap.addEventListener("click", (e) => {
    e.stopPropagation();
    toggleSelect(photo.id);
  });
  card.appendChild(selectWrap);

  card.addEventListener("click", () => openPhotoModal(photo.id, { onSaved: () => loadUnassigned() }));
  card.addEventListener("dragstart", (e) => onCardDragStart(e, photo));
  card.addEventListener("dragend", onCardDragEnd);

  cardsByPhotoId.set(photo.id, card);
  return card;
}

// --- drag photos onto a pin -------------------------------------------
// Dragging a selected photo drags the whole selection; dragging an
// unselected one drags just that photo (and leaves the selection alone).

function onCardDragStart(e, photo) {
  const ids = selected.has(photo.id) ? Array.from(selected) : [photo.id];
  state.draggingPhotoIds = ids;
  e.dataTransfer.effectAllowed = "move";
  e.dataTransfer.setData("application/x-sitetrace-photos", JSON.stringify(ids));
  document.body.classList.add("dragging-photos");
  if (ids.length > 1) {
    const ghost = document.createElement("div");
    ghost.className = "drag-ghost";
    ghost.textContent = `${ids.length} photos`;
    document.body.appendChild(ghost);
    e.dataTransfer.setDragImage(ghost, 10, 10);
    setTimeout(() => ghost.remove(), 0);
  }
  toast(`Drop on a pin to assign ${ids.length} photo(s)`);
}

function onCardDragEnd() {
  state.draggingPhotoIds = null;
  document.body.classList.remove("dragging-photos");
}

function toggleSelect(photoId) {
  if (selected.has(photoId)) selected.delete(photoId);
  else selected.add(photoId);
  syncCard(photoId);
  updateAssignButton();
}

function syncCard(photoId) {
  const card = cardsByPhotoId.get(photoId);
  if (!card) return;
  const on = selected.has(photoId);
  card.classList.toggle("selected", on);
  const box = card.querySelector(".photo-select");
  if (box) box.checked = on;
}

function updateAssignButton() {
  assignSelectedBtn.disabled = selected.size === 0;
  assignSelectedBtn.textContent = selected.size
    ? `Assign ${selected.size} to pin…`
    : "Assign selected to pin…";
}

selectAllBtn.addEventListener("click", () => {
  for (const photo of loadedPhotos) selected.add(photo.id);
  for (const id of cardsByPhotoId.keys()) syncCard(id);
  updateAssignButton();
});
clearSelectionBtn.addEventListener("click", () => {
  const wasSelected = Array.from(selected);
  selected.clear();
  for (const id of wasSelected) syncCard(id);
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
