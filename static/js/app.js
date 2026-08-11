import { refreshFloorplans, loadPinsAndRender, refreshSelectedPinOverlay, setPinMovable } from "./canvas.js";
import { setHooks } from "./pinPanel.js";
import { loadUnassigned } from "./unassigned.js";
import "./dialogs.js";
import "./floorplanModal.js";
import "./importDialog.js";
import "./photoModal.js";

// canvas.js imports the pin panel, so the panel talks back through these
// hooks rather than importing canvas.js and closing the cycle
setHooks({
  onPinsChanged: loadPinsAndRender,
  onOverlayUpdate: refreshSelectedPinOverlay,
  onPinMovableChange: setPinMovable,
});

// --- theme ------------------------------------------------------------
// No stored preference means "follow the OS" (the CSS media query handles
// that); the toggle writes an explicit choice that wins in both directions.
const THEME_KEY = "sitetrace-theme";

function currentTheme() {
  const stored = localStorage.getItem(THEME_KEY);
  if (stored === "dark" || stored === "light") return stored;
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

document.getElementById("themeToggleBtn").addEventListener("click", () => {
  const next = currentTheme() === "dark" ? "light" : "dark";
  document.documentElement.setAttribute("data-theme", next);
  try {
    localStorage.setItem(THEME_KEY, next);
  } catch {
    /* private mode — the theme still applies for this session */
  }
});

async function init() {
  await refreshFloorplans();
  await loadUnassigned();
}

init();
