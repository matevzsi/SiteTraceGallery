import { api, thumbUrl } from "./api.js";
import { toast, formatDate } from "./state.js";
import { enterAssignMode } from "./canvas.js";
import { openPhotoModal } from "./photoModal.js";
import { switchView } from "./app.js";

const grid = document.getElementById("unassignedGrid");
const selectAllBtn = document.getElementById("selectAllBtn");
const clearSelectionBtn = document.getElementById("clearSelectionBtn");
const assignSelectedBtn = document.getElementById("assignSelectedBtn");
const loadMoreBtn = document.getElementById("loadMoreBtn");
const countBadge = document.getElementById("unassignedCount");

const selected = new Set();
let page = 1;
let hasMore = false;
let loadedPhotos = [];

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

    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.className = "photo-select";
    checkbox.checked = selected.has(photo.id);
    checkbox.addEventListener("click", (e) => {
      e.stopPropagation();
      toggleSelect(photo.id, card, checkbox);
    });

    const img = document.createElement("img");
    img.src = thumbUrl(photo.thumbnail_path);
    img.alt = "";

    const meta = document.createElement("div");
    meta.className = "photo-meta";
    meta.textContent = formatDate(photo.taken_at);

    card.appendChild(checkbox);
    card.appendChild(img);
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
  switchView("home");
  toast("Click a pin on the floor plan to assign the selected photos.");
});

document.addEventListener("photos-assigned", () => loadUnassigned());
