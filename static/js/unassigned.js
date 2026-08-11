import { api, thumbUrl } from "./api.js";
import { state, toast, formatDay, formatDate } from "./state.js";
import { confirmDialog } from "./dialogs.js";
import { enterAssignMode } from "./canvas.js";
import { openPhotoModal } from "./photoModal.js";

const panel = document.getElementById("unassignedPanel");
const navBtn = document.getElementById("navUnassignedBtn");
const closeBtn = document.getElementById("unassignedPanelCloseBtn");
const grid = document.getElementById("unassignedGrid");
const selectAllBtn = document.getElementById("selectAllBtn");
const clearSelectionBtn = document.getElementById("clearSelectionBtn");
const assignSelectedBtn = document.getElementById("assignSelectedBtn");
const deleteSelectedBtn = document.getElementById("deleteSelectedBtn");
const loadMoreBtn = document.getElementById("loadMoreBtn");
const countBadge = document.getElementById("unassignedCount");
const zoomInBtn = document.getElementById("gridZoomInBtn");
const zoomOutBtn = document.getElementById("gridZoomOutBtn");

const GRID_COL_MIN = 70;
const GRID_COL_MAX = 260;
const GRID_COL_STEP = 25;
const PAGE_SIZE = 60;

const selected = new Set();
const cardsByPhotoId = new Map();
let hasMore = false;
let loadedPhotos = [];
let awaitingAssignResult = false;
let gridColPx = 120;
let savedScrollTop = 0;

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
  // display:none drops the scroll offset, and the panel hides itself while
  // the user picks a pin — put them back where they were reading
  if (savedScrollTop) grid.scrollTop = savedScrollTop;
}
export function closeUnassignedPanel() {
  savedScrollTop = grid.scrollTop;
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
    loadedPhotos = [];
    selected.clear();
    cardsByPhotoId.clear();
    grid.innerHTML = "";
    savedScrollTop = 0;
  }
  // paging is by offset, not page number: photos leave this list as they're
  // assigned or deleted, and "however many I already hold" is the only
  // anchor that keeps pointing at the next unseen row
  const res = await api.unassignedPhotos(loadedPhotos.length, PAGE_SIZE);
  loadedPhotos = loadedPhotos.concat(res.photos);
  hasMore = res.has_more;
  countBadge.textContent = String(res.total);
  // append only the new page — re-rendering every previously loaded card on
  // each "load more" gets expensive once a few hundred are on screen
  appendCards(res.photos);
  renderEmptyState();
  loadMoreBtn.classList.toggle("hidden", !hasMore);
  updateSelectionButtons();
}

/** Drop photos that are no longer unassigned without rebuilding the grid,
 *  so the list doesn't jump back to the top mid-triage. */
function removeFromList(ids) {
  const gone = new Set(ids);
  for (const id of gone) {
    cardsByPhotoId.get(id)?.remove();
    cardsByPhotoId.delete(id);
    selected.delete(id);
  }
  loadedPhotos = loadedPhotos.filter((p) => !gone.has(p.id));
  renderEmptyState();
  updateSelectionButtons();
}

/** Full re-read of everything currently on screen, for changes that can add
 *  rows back (a photo unassigned from a pin), keeping the scroll offset. */
let refreshing = false;
async function refreshKeepingScroll() {
  // saving in the photo modal fires both the onSaved callback and the
  // photos-assigned event; one re-read is enough
  if (refreshing) return;
  refreshing = true;
  const scroll = grid.scrollTop;
  const held = Math.max(PAGE_SIZE, loadedPhotos.length);
  const keepSelected = new Set(selected);

  loadedPhotos = [];
  selected.clear();
  cardsByPhotoId.clear();
  grid.innerHTML = "";

  try {
    while (loadedPhotos.length < held) {
      const res = await api.unassignedPhotos(loadedPhotos.length, PAGE_SIZE);
      loadedPhotos = loadedPhotos.concat(res.photos);
      hasMore = res.has_more;
      countBadge.textContent = String(res.total);
      appendCards(res.photos);
      if (!res.has_more || res.photos.length === 0) break;
    }
  } finally {
    refreshing = false;
  }

  for (const id of keepSelected) {
    if (!cardsByPhotoId.has(id)) continue;
    selected.add(id);
    syncCard(id);
  }
  renderEmptyState();
  loadMoreBtn.classList.toggle("hidden", !hasMore);
  updateSelectionButtons();
  grid.scrollTop = scroll;
  savedScrollTop = scroll;
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
  // The selection state follows the checkbox's own change event, not a click
  // handler on the label: clicking the label anywhere outside the checkbox
  // makes the browser forward a synthetic click to the checkbox, which
  // bubbles back through the label — a click handler there would fire twice
  // and cancel itself out, so only hits landing exactly on the small circle
  // would register.
  checkbox.addEventListener("change", () => setSelected(photo.id, checkbox.checked));
  // ...and swallow the click either way, so it never reaches the card's
  // "open photo modal" handler.
  selectWrap.addEventListener("click", (e) => e.stopPropagation());
  card.appendChild(selectWrap);

  card.addEventListener("click", () => openPhotoModal(photo.id, { onSaved: refreshKeepingScroll }));
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

function setSelected(photoId, on) {
  if (on) selected.add(photoId);
  else selected.delete(photoId);
  syncCard(photoId);
  updateSelectionButtons();
}

function syncCard(photoId) {
  const card = cardsByPhotoId.get(photoId);
  if (!card) return;
  const on = selected.has(photoId);
  card.classList.toggle("selected", on);
  const box = card.querySelector(".photo-select");
  if (box) box.checked = on;
}

function updateSelectionButtons() {
  const n = selected.size;
  assignSelectedBtn.disabled = n === 0;
  assignSelectedBtn.textContent = n ? `Assign ${n} to pin…` : "Assign selected to pin…";
  deleteSelectedBtn.disabled = n === 0;
  deleteSelectedBtn.title = n ? `Delete ${n} selected photo${n === 1 ? "" : "s"}` : "Delete selected photos";
}

selectAllBtn.addEventListener("click", () => {
  for (const photo of loadedPhotos) selected.add(photo.id);
  for (const id of cardsByPhotoId.keys()) syncCard(id);
  updateSelectionButtons();
});
clearSelectionBtn.addEventListener("click", () => {
  const wasSelected = Array.from(selected);
  selected.clear();
  for (const id of wasSelected) syncCard(id);
  updateSelectionButtons();
});
loadMoreBtn.addEventListener("click", () => loadUnassigned(false));
assignSelectedBtn.addEventListener("click", () => {
  if (selected.size === 0) return;
  enterAssignMode(Array.from(selected));
  awaitingAssignResult = true;
  closeUnassignedPanel();
  toast("Click a pin on the floor plan to assign the selected photos.");
});

deleteSelectedBtn.addEventListener("click", async () => {
  const ids = Array.from(selected);
  if (ids.length === 0) return;
  const n = ids.length;
  const ok = await confirmDialog({
    title: `Delete ${n} photo${n === 1 ? "" : "s"}?`,
    message:
      `SiteTrace's copy and thumbnail are removed. The original file${n === 1 ? "" : "s"} in the folder ` +
      `you imported from ${n === 1 ? "is" : "are"} untouched, so re-importing that folder brings ` +
      `${n === 1 ? "it" : "them"} back.`,
    confirmLabel: `Delete ${n} photo${n === 1 ? "" : "s"}`,
  });
  if (!ok) return;
  try {
    const res = await api.bulkDeletePhotos(ids);
    removeFromList(ids);
    countBadge.textContent = String(Math.max(0, Number(countBadge.textContent) - res.deleted));
    toast(`Deleted ${res.deleted} photo${res.deleted === 1 ? "" : "s"}`);
  } catch (err) {
    toast(err.message, true);
    await refreshKeepingScroll();
  }
});

// detail.removedIds means "these left the inbox" — drop just those cards and
// leave the scroll position alone. Without it (a photo unassigned back into
// the inbox, a pin deleted) the list has to be re-read, but still without
// throwing the user back to the top.
document.addEventListener("photos-assigned", async (e) => {
  const removedIds = e.detail?.removedIds;
  if (removedIds?.length) {
    removeFromList(removedIds);
    const res = await api.unassignedPhotos(0, 1);
    countBadge.textContent = String(res.total);
    hasMore = loadedPhotos.length < res.total;
    loadMoreBtn.classList.toggle("hidden", !hasMore);
  } else {
    await refreshKeepingScroll();
  }
  if (awaitingAssignResult) {
    awaitingAssignResult = false;
    openUnassignedPanel();
  }
});
