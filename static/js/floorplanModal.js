import { api } from "./api.js";
import { toast, showModal, hideModal } from "./state.js";
import { refreshFloorplans } from "./canvas.js";

const modal = document.getElementById("floorplanModal");
const title = document.getElementById("floorplanModalTitle");
const form = document.getElementById("floorplanForm");
const nameInput = document.getElementById("floorplanNameInput");
const imageInput = document.getElementById("floorplanImageInput");
const isSitePlanInput = document.getElementById("floorplanIsSitePlanInput");

function open(isSitePlan) {
  form.reset();
  isSitePlanInput.value = isSitePlan ? "1" : "0";
  title.textContent = isSitePlan ? "Upload site plan" : "Add floor plan";
  nameInput.value = isSitePlan ? "Site plan" : "";
  showModal("floorplanModal");
}

document.getElementById("addFloorplanBtn").addEventListener("click", () => open(false));
document.getElementById("addSitePlanBtn").addEventListener("click", () => open(true));
document.getElementById("floorplanCancelBtn").addEventListener("click", () => hideModal("floorplanModal"));

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  const fd = new FormData();
  fd.append("name", nameInput.value.trim());
  fd.append("image", imageInput.files[0]);
  fd.append("is_site_plan", isSitePlanInput.value);
  try {
    await api.createFloorplan(fd);
    hideModal("floorplanModal");
    toast("Floor plan added");
    await refreshFloorplans();
  } catch (err) {
    toast(err.message, true);
  }
});
