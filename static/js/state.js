export const state = {
  floorplans: [],
  activeFloorplanId: null,
  pins: [],
  selectedPinId: null,
  layerEditMode: false,
  assignMode: null, // { photoIds: number[] } while "click a pin to assign" is active
  // photo ids currently being dragged onto a pin. Kept here rather than
  // only in dataTransfer because dragenter/dragover can't read the payload
  // (browsers only expose it on drop), and the pin markers need to know
  // whether to light up as drop targets before that.
  draggingPhotoIds: null,
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

// Modals stack (a confirm can open on top of another dialog), and the
// topmost one is what Escape / a backdrop click dismisses.
const modalStack = [];
const backdrop = document.getElementById("modalBackdrop");

export function showModal(id) {
  const el = document.getElementById(id);
  if (!el || modalStack.includes(id)) return;
  modalStack.push(id);
  backdrop.classList.remove("hidden");
  el.classList.remove("hidden");
  const focusTarget = el.querySelector("input:not([type=hidden]), textarea, select, button");
  focusTarget?.focus();
}

export function hideModal(id) {
  const idx = modalStack.indexOf(id);
  if (idx !== -1) modalStack.splice(idx, 1);
  document.getElementById(id)?.classList.add("hidden");
  if (modalStack.length === 0) backdrop.classList.add("hidden");
}

export function topModal() {
  return modalStack[modalStack.length - 1] || null;
}

// Dismissing a modal must run the same cleanup its own Cancel button does
// (pending promises, reset forms), so each dialog registers a handler here
// instead of Escape/backdrop silently just hiding the element.
const dismissHandlers = new Map();
export function onModalDismiss(id, fn) {
  dismissHandlers.set(id, fn);
}

function dismissTop() {
  const id = topModal();
  if (!id) return false;
  const fn = dismissHandlers.get(id);
  if (fn) fn();
  else hideModal(id);
  return true;
}

backdrop.addEventListener("click", dismissTop);
document.addEventListener("keydown", (e) => {
  if (e.key !== "Escape") return;
  if (dismissTop()) return;
  // no modal open — close whichever side panel is showing
  document.dispatchEvent(new CustomEvent("escape-pressed"));
});

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

/** Compact form for photo tile captions — the year matters, the minute doesn't. */
export function formatDay(isoStr) {
  if (!isoStr) return "";
  const d = new Date(isoStr);
  if (Number.isNaN(d.getTime())) return isoStr;
  return d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}
