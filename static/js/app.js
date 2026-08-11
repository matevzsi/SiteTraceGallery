import { refreshFloorplans, loadPinsAndRender, refreshSelectedPinOverlay } from "./canvas.js";
import { setHooks } from "./pinPanel.js";
import { loadUnassigned } from "./unassigned.js";
import "./floorplanModal.js";
import "./importDialog.js";
import "./photoModal.js";

setHooks({
  onPinsChanged: loadPinsAndRender,
  onOverlayUpdate: refreshSelectedPinOverlay,
});

async function init() {
  await refreshFloorplans();
  await loadUnassigned();
}

init();
