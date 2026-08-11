import { api, photoUrl } from "./api.js";
import { toast, showModal, hideModal, onModalDismiss, formatDate } from "./state.js";
import { svgEl, headingToXY, xyToHeading, clientPointToSvg } from "./compass.js";

const img = document.getElementById("photoModalImg");
const fullLink = document.getElementById("photoFullLink");
const dateEl = document.getElementById("photoModalDate");
const pinSelect = document.getElementById("photoModalPinSelect");
const captionEl = document.getElementById("photoModalCaption");
const directionLabel = document.getElementById("photoModalDirectionLabel");
const dial = document.getElementById("photoDial");
const setDirectionBtn = document.getElementById("photoDialSetBtn");
const saveBtn = document.getElementById("photoModalSaveBtn");
const closeBtn = document.getElementById("photoModalCloseBtn");

let currentPhoto = null;
let pendingDeg = 0;
let confirmed = false;
let onSavedCallback = null;

export async function openPhotoModal(photoId, { onSaved } = {}) {
  const photo = await api.getPhoto(photoId);
  currentPhoto = photo;
  onSavedCallback = onSaved || null;

  img.src = photoUrl(photo.file_path);
  fullLink.href = photoUrl(photo.file_path);
  dateEl.textContent = formatDate(photo.taken_at);
  captionEl.value = photo.caption || "";

  await populatePinSelect(photo.pin_id);

  pendingDeg = photo.direction_deg;
  if (pendingDeg == null) {
    pendingDeg = await guessDefaultDirection(photo);
  }
  confirmed = photo.direction_deg != null;
  renderDial();
  updateDirectionLabel();

  showModal("photoModal");
}

async function guessDefaultDirection(photo) {
  if (!photo.pin_id) return 0;
  try {
    const res = await api.pinPhotos(photo.pin_id);
    const withDir = res.photos
      .filter((p) => p.id !== photo.id && p.direction_deg != null)
      .sort((a, b) => new Date(b.taken_at) - new Date(a.taken_at));
    return withDir.length ? withDir[0].direction_deg : 0;
  } catch {
    return 0;
  }
}

async function populatePinSelect(selectedPinId) {
  pinSelect.innerHTML = "";
  const noneOpt = document.createElement("option");
  noneOpt.value = "";
  noneOpt.textContent = "(unassigned)";
  pinSelect.appendChild(noneOpt);

  const res = await api.listAllPins();
  const byFloorplan = new Map();
  for (const pin of res.pins) {
    const key = pin.floorplan_name;
    if (!byFloorplan.has(key)) byFloorplan.set(key, []);
    byFloorplan.get(key).push(pin);
  }
  for (const [floorplanName, pins] of byFloorplan) {
    const group = document.createElement("optgroup");
    group.label = floorplanName;
    for (const pin of pins) {
      const opt = document.createElement("option");
      opt.value = pin.id;
      opt.textContent = pin.label || `(unlabeled #${pin.id})`;
      group.appendChild(opt);
    }
    pinSelect.appendChild(group);
  }
  pinSelect.value = selectedPinId != null ? String(selectedPinId) : "";
}

function updateDirectionLabel() {
  if (!confirmed) {
    directionLabel.textContent = `${Math.round(pendingDeg)}° — not set, drag then click "Set direction"`;
  } else {
    const src = currentPhoto.direction_source === "exif" ? "from EXIF" : "manual";
    directionLabel.textContent = `${Math.round(pendingDeg)}° (${src})`;
  }
}

function renderDial() {
  dial.innerHTML = "";
  const R = 58;
  dial.appendChild(svgEl("circle", { cx: 0, cy: 0, r: R, fill: "#faf9f6", stroke: "#c9c9c3" }));
  const { dx, dy } = headingToXY(pendingDeg, R - 6);
  dial.appendChild(
    svgEl("line", { x1: 0, y1: 0, x2: dx, y2: dy, stroke: confirmed ? "#1e6fb5" : "#a02f2f", "stroke-width": 3, "stroke-linecap": "round" })
  );
  dial.appendChild(svgEl("circle", { cx: dx, cy: dy, r: 6, fill: confirmed ? "#1e6fb5" : "#a02f2f" }));
  const n = svgEl("text", { x: 0, y: -R - 6, "text-anchor": "middle", "font-size": 10, fill: "#8a8a85" });
  n.textContent = "N";
  dial.appendChild(n);
}

let dragging = false;
dial.addEventListener("mousedown", (e) => {
  dragging = true;
  updateFromEvent(e);
});
window.addEventListener("mousemove", (e) => {
  if (dragging) updateFromEvent(e);
});
window.addEventListener("mouseup", () => {
  dragging = false;
});
function updateFromEvent(e) {
  const pt = clientPointToSvg(dial, e.clientX, e.clientY);
  pendingDeg = xyToHeading(pt.x, pt.y);
  confirmed = false;
  renderDial();
  updateDirectionLabel();
}

setDirectionBtn.addEventListener("click", async () => {
  if (!currentPhoto) return;
  try {
    const updated = await api.updatePhoto(currentPhoto.id, { direction_deg: pendingDeg });
    currentPhoto = updated;
    confirmed = true;
    updateDirectionLabel();
    toast("Direction saved");
    onSavedCallback?.();
  } catch (err) {
    toast(err.message, true);
  }
});

saveBtn.addEventListener("click", async () => {
  if (!currentPhoto) return;
  try {
    const pinId = pinSelect.value === "" ? null : Number(pinSelect.value);
    await api.updatePhoto(currentPhoto.id, { pin_id: pinId, caption: captionEl.value.trim() || null });
    toast("Saved");
    closePhotoModal();
    onSavedCallback?.();
    document.dispatchEvent(new CustomEvent("photos-assigned"));
  } catch (err) {
    toast(err.message, true);
  }
});

function closePhotoModal() {
  hideModal("photoModal");
  currentPhoto = null;
}
closeBtn.addEventListener("click", closePhotoModal);
onModalDismiss("photoModal", closePhotoModal);
