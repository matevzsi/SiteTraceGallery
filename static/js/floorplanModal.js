import { api } from "./api.js";
import { toast, showModal, hideModal } from "./state.js";
import { refreshFloorplans, getActiveFloorplan } from "./canvas.js";

const modal = document.getElementById("floorplanModal");
const title = document.getElementById("floorplanModalTitle");
const form = document.getElementById("floorplanForm");
const nameInput = document.getElementById("floorplanNameInput");
const imageInput = document.getElementById("floorplanImageInput");
const isSitePlanInput = document.getElementById("floorplanIsSitePlanInput");

let mode = "add"; // "add" | "site" | "replace"
let replaceTargetId = null;

function open(kind, targetFp) {
  form.reset();
  mode = kind;
  if (kind === "site") {
    isSitePlanInput.value = "1";
    title.textContent = "Upload site plan";
    nameInput.value = "Site plan";
  } else if (kind === "replace") {
    isSitePlanInput.value = "0";
    title.textContent = `Replace image — ${targetFp.name}`;
    nameInput.value = targetFp.name;
    replaceTargetId = targetFp.id;
  } else {
    isSitePlanInput.value = "0";
    title.textContent = "Add floor plan";
    nameInput.value = "";
  }
  showModal("floorplanModal");
}

document.getElementById("addFloorplanBtn").addEventListener("click", () => open("add"));
document.getElementById("addSitePlanBtn").addEventListener("click", () => open("site"));
document.getElementById("replaceImageBtn").addEventListener("click", () => {
  const fp = getActiveFloorplan();
  if (!fp) return;
  open("replace", fp);
});
document.getElementById("floorplanCancelBtn").addEventListener("click", () => hideModal("floorplanModal"));

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  const fd = new FormData();
  fd.append("name", nameInput.value.trim());
  fd.append("image", imageInput.files[0]);
  try {
    if (mode === "replace") {
      await api.replaceFloorplanImage(replaceTargetId, fd);
      toast("Image replaced");
    } else {
      fd.append("is_site_plan", isSitePlanInput.value);
      await api.createFloorplan(fd);
      toast(mode === "site" ? "Site plan uploaded" : "Floor plan added");
    }
    hideModal("floorplanModal");
    await refreshFloorplans();
  } catch (err) {
    toast(err.message, true);
  }
});
