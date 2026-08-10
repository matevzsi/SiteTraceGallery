export const state = {
  floorplans: [],
  activeFloorplanId: null,
  pins: [],
  selectedPinId: null,
  layerEditMode: false,
  assignMode: null, // { photoIds: number[] } while "click a pin to assign" is active
};

let toastTimer = null;
export function toast(message, isError = false) {
  const el = document.getElementById("toast");
  el.textContent = message;
  el.className = "toast" + (isError ? " error" : "");
  el.classList.remove("hidden");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.add("hidden"), 3200);
}

export function showModal(id) {
  document.getElementById("modalBackdrop").classList.remove("hidden");
  document.getElementById(id).classList.remove("hidden");
}

export function hideModal(id) {
  document.getElementById(id).classList.add("hidden");
  document.getElementById("modalBackdrop").classList.add("hidden");
}

export function formatDate(isoStr) {
  if (!isoStr) return "";
  const d = new Date(isoStr);
  if (Number.isNaN(d.getTime())) return isoStr;
  return d.toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}
