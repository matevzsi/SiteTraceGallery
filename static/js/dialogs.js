// In-app replacements for window.prompt()/window.confirm(): styled, themed,
// dismissible with Escape or a backdrop click, and (unlike the native ones)
// they don't freeze the page or get suppressed by the browser.
import { showModal, hideModal, onModalDismiss } from "./state.js";

// --- pin label prompt --------------------------------------------------

const pinForm = document.getElementById("pinCreateForm");
const pinInput = document.getElementById("pinCreateLabelInput");
let pinResolve = null;

function settlePin(value) {
  hideModal("pinCreateModal");
  const resolve = pinResolve;
  pinResolve = null;
  resolve?.(value);
}

/** Resolves to the entered label (possibly ""), or null if cancelled. */
export function promptPinLabel() {
  return new Promise((resolve) => {
    settlePin(null); // never leave an earlier prompt hanging
    pinResolve = resolve;
    pinForm.reset();
    showModal("pinCreateModal");
    pinInput.focus();
  });
}

pinForm.addEventListener("submit", (e) => {
  e.preventDefault();
  settlePin(pinInput.value.trim());
});
document.getElementById("pinCreateCancelBtn").addEventListener("click", () => settlePin(null));
onModalDismiss("pinCreateModal", () => settlePin(null));

// --- confirm -----------------------------------------------------------

const confirmTitle = document.getElementById("confirmTitle");
const confirmMessage = document.getElementById("confirmMessage");
const confirmOkBtn = document.getElementById("confirmOkBtn");
let confirmResolve = null;

function settleConfirm(value) {
  hideModal("confirmModal");
  const resolve = confirmResolve;
  confirmResolve = null;
  resolve?.(value);
}

export function confirmDialog({ title = "Are you sure?", message = "", confirmLabel = "Delete", danger = true } = {}) {
  return new Promise((resolve) => {
    settleConfirm(false);
    confirmResolve = resolve;
    confirmTitle.textContent = title;
    confirmMessage.textContent = message;
    confirmOkBtn.textContent = confirmLabel;
    confirmOkBtn.className = "btn " + (danger ? "btn-danger" : "btn-primary");
    showModal("confirmModal");
    confirmOkBtn.focus();
  });
}

confirmOkBtn.addEventListener("click", () => settleConfirm(true));
document.getElementById("confirmCancelBtn").addEventListener("click", () => settleConfirm(false));
onModalDismiss("confirmModal", () => settleConfirm(false));
