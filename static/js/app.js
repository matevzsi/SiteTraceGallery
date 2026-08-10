import { refreshFloorplans, loadPinsAndRender, refreshSelectedPinOverlay } from "./canvas.js";
import { setHooks } from "./pinPanel.js";
import { loadUnassigned } from "./unassigned.js";
import "./floorplanModal.js";
import "./importDialog.js";
import "./photoModal.js";

const homeView = document.getElementById("view-home");
const unassignedView = document.getElementById("view-unassigned");
const navHomeBtn = document.getElementById("navHomeBtn");
const navUnassignedBtn = document.getElementById("navUnassignedBtn");

export function switchView(name) {
  const isHome = name === "home";
  homeView.classList.toggle("hidden", !isHome);
  unassignedView.classList.toggle("hidden", isHome);
  navHomeBtn.classList.toggle("active", isHome);
  navUnassignedBtn.classList.toggle("active", !isHome);
}

navHomeBtn.addEventListener("click", () => switchView("home"));
navUnassignedBtn.addEventListener("click", () => switchView("unassigned"));

setHooks({
  onPinsChanged: loadPinsAndRender,
  onOverlayUpdate: refreshSelectedPinOverlay,
});

async function init() {
  await refreshFloorplans();
  await loadUnassigned();
}

init();
