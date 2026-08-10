import { api } from "./api.js";
import { toast, showModal, hideModal } from "./state.js";
import { loadUnassigned } from "./unassigned.js";

const importBtn = document.getElementById("importBtn");
const form = document.getElementById("importForm");
const pathInput = document.getElementById("importPathInput");
const cancelBtn = document.getElementById("importCancelBtn");
const progressWrap = document.getElementById("importProgress");
const progressBar = document.getElementById("importProgressBar");
const progressText = document.getElementById("importProgressText");
const errorsList = document.getElementById("importErrors");
const doneBtn = document.getElementById("importDoneBtn");

let pollTimer = null;

importBtn.addEventListener("click", () => {
  form.reset();
  form.classList.remove("hidden");
  progressWrap.classList.add("hidden");
  doneBtn.classList.add("hidden");
  showModal("importModal");
});

cancelBtn.addEventListener("click", () => hideModal("importModal"));

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  const sourceDir = pathInput.value.trim();
  if (!sourceDir) return;
  try {
    const { job_id } = await api.startImport(sourceDir);
    form.classList.add("hidden");
    progressWrap.classList.remove("hidden");
    errorsList.innerHTML = "";
    pollTimer = setInterval(() => pollJob(job_id), 800);
    pollJob(job_id);
  } catch (err) {
    toast(err.message, true);
  }
});

async function pollJob(jobId) {
  let job;
  try {
    job = await api.importStatus(jobId);
  } catch (err) {
    clearInterval(pollTimer);
    toast(err.message, true);
    return;
  }

  const total = job.total || 0;
  const pct = total ? Math.round((job.processed / total) * 100) : 0;
  progressBar.value = pct;
  progressText.textContent =
    job.status === "scanning"
      ? "Scanning folder…"
      : `${job.processed}/${total} processed — ${job.imported} imported, ${job.skipped_duplicate} skipped as duplicates`;

  errorsList.innerHTML = "";
  for (const err of job.errors.slice(-20)) {
    const li = document.createElement("li");
    li.textContent = err;
    errorsList.appendChild(li);
  }

  if (job.status === "done" || job.status === "error") {
    clearInterval(pollTimer);
    doneBtn.classList.remove("hidden");
    if (job.status === "error") {
      progressText.textContent = "Import failed: " + (job.errors[0] || "unknown error");
    }
  }
}

doneBtn.addEventListener("click", async () => {
  hideModal("importModal");
  await loadUnassigned();
});
