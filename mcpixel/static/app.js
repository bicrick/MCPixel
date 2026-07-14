import { api } from "./js/api.js";
import {
  $,
  anyActive,
  bestUrl,
  cacheJobs,
  initTheme,
  applyTheme,
  setMobileTab,
  state,
  toast,
  upsertJob,
} from "./js/state.js";
import {
  clearFailedJobs,
  closeJobMenu,
  deleteJob,
  renderQueue,
} from "./js/queue.js";
import { clearSelection, renderJob } from "./js/job-view.js";
import {
  bindEditorEvents,
  closeEditor,
  openEditor,
  saveEdit,
} from "./js/editor.js";
import {
  bindCreateDrop,
  bindSizeChips,
  generateJob,
  retryFromJob,
  setTargetFromJob,
  uploadFile,
} from "./js/generate.js";

const queueHandlers = {
  onSelect: (id) => selectJob(id),
  onMenuAction: (action, id) => handleMenuAction(action, id),
  onClearFailed: () => handleClearFailed(),
};

function ensurePolling() {
  if (anyActive()) {
    if (!state.pollTimer) {
      state.pollTimer = setInterval(() => {
        refreshQueue().catch((e) => toast(e.message));
      }, 1500);
    }
  } else if (state.pollTimer) {
    clearInterval(state.pollTimer);
    state.pollTimer = null;
  }
}

function updateActiveBadge() {
  const n = [...state.jobsById.values()].filter((j) =>
    ["queued", "generating", "removing_background", "snapping"].includes(j.status)
  ).length;
  const tab = document.querySelector('.mobile-tab[data-tab="queue"]');
  if (tab) tab.textContent = n ? `Queue (${n})` : "Queue";
}

async function selectJob(id, { mobileSwitch = true } = {}) {
  try {
    const job = await api(`/v1/jobs/${id}`);
    renderJob(job, queueHandlers);
    setTargetFromJob(job);
    history.replaceState(null, "", `/?job=${id}`);
    if (mobileSwitch) setMobileTab("job");
    ensurePolling();
    updateActiveBadge();
  } catch (e) {
    toast(e.message);
  }
}

async function refreshQueue() {
  const data = await api("/v1/jobs?limit=50");
  cacheJobs(data.jobs || []);
  updateActiveBadge();
  if (state.currentJobId && state.jobsById.has(state.currentJobId)) {
    const detail = await api(`/v1/jobs/${state.currentJobId}`);
    renderJob(detail, queueHandlers);
  } else {
    renderQueue(queueHandlers);
    ensurePolling();
  }
}

async function loadHealth() {
  try {
    const h = await api("/v1/health");
    const dot = $("healthDot");
    const label = $("healthLabel");
    if (!h.openai_configured) {
      dot.dataset.state = "warn";
      label.textContent = "OpenAI key missing";
    } else if (!h.snapper_exists) {
      dot.dataset.state = "warn";
      label.textContent = "Snapper binary missing";
    } else {
      dot.dataset.state = "ok";
      label.textContent = "Ready";
    }
  } catch {
    $("healthDot").dataset.state = "bad";
    $("healthLabel").textContent = "API unreachable";
  }
}

async function afterNewJob(job) {
  upsertJob(job);
  renderJob(job, queueHandlers);
  history.replaceState(null, "", `/?job=${job.id}`);
  setMobileTab("job");
  ensurePolling();
  updateActiveBadge();
}

async function handleMenuAction(action, jobId) {
  const job = state.jobsById.get(jobId) || (await api(`/v1/jobs/${jobId}`));
  try {
    if (action === "retry" || action === "duplicate") {
      const created = await retryFromJob(job);
      await afterNewJob(created);
      return;
    }
    if (action === "resnap") {
      await selectJob(jobId);
      $("resnapK")?.focus();
      return;
    }
    if (action === "copy") {
      await navigator.clipboard.writeText(job.prompt || "");
      toast("Prompt copied.");
      return;
    }
    if (action === "download") {
      const url = bestUrl(job);
      if (!url) return toast("No image to download.");
      const a = document.createElement("a");
      a.href = url;
      a.download = `${job.id}_best.png`;
      a.click();
      return;
    }
    if (action === "delete") {
      if (!confirm(`Delete job permanently?\n${job.prompt || jobId}`)) return;
      await deleteJob(jobId);
      if (state.currentJobId === jobId) {
        clearSelection(queueHandlers);
        history.replaceState(null, "", "/");
      } else {
        renderQueue(queueHandlers);
      }
      toast("Deleted.");
      updateActiveBadge();
    }
  } catch (e) {
    toast(e.message);
  }
}

async function handleClearFailed() {
  if (!confirm("Delete all failed jobs?")) return;
  try {
    await clearFailedJobs();
    if (state.currentJobId && !state.jobsById.has(state.currentJobId)) {
      clearSelection(queueHandlers);
      history.replaceState(null, "", "/");
    } else {
      renderQueue(queueHandlers);
    }
    updateActiveBadge();
  } catch (e) {
    toast(e.message);
  }
}

async function resnap() {
  if (!state.currentJobId) return;
  const pixelRaw = $("resnapPx").value;
  const body = {
    k_colors: Number($("resnapK").value) || 16,
    pixel_size: pixelRaw ? Number(pixelRaw) : null,
  };
  toast("Resnapping…");
  $("resnapBtn").disabled = true;
  try {
    const job = await api(`/v1/jobs/${state.currentJobId}/resnap`, {
      method: "POST",
      body: JSON.stringify(body),
    });
    renderJob(job, queueHandlers);
    toast("Resnap done.");
  } catch (e) {
    toast(e.message);
  } finally {
    const job = state.jobsById.get(state.currentJobId);
    if (job) {
      $("resnapBtn").disabled = !job.urls?.cutout;
    }
  }
}

function bindUi() {
  initTheme();
  bindSizeChips();
  bindEditorEvents();
  bindCreateDrop((file) =>
    uploadFile(file)
      .then(afterNewJob)
      .catch((e) => toast(e.message))
  );

  document.querySelectorAll(".theme-switch button").forEach((btn) => {
    btn.addEventListener("click", () => applyTheme(btn.dataset.theme));
  });

  $("generateBtn").addEventListener("click", () =>
    generateJob()
      .then((job) => job && afterNewJob(job))
      .catch((e) => toast(e.message))
  );
  $("resnapBtn").addEventListener("click", () => resnap());
  $("editBtn").addEventListener("click", () =>
    openEditor((job) => renderJob(job, queueHandlers)).catch((e) => toast(e.message))
  );
  $("saveEditBtn").addEventListener("click", () =>
    saveEdit((job) => {
      renderJob(job, queueHandlers);
      return refreshQueue();
    }).catch((e) => toast(e.message))
  );
  $("closeEditorBtn").addEventListener("click", closeEditor);
  $("upload").addEventListener("change", (e) => {
    const file = e.target.files?.[0];
    if (file) {
      uploadFile(file)
        .then(afterNewJob)
        .catch((err) => toast(err.message));
    }
  });

  document.querySelectorAll(".filter-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      state.queueFilter = btn.dataset.filter;
      document
        .querySelectorAll(".filter-btn")
        .forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      renderQueue(queueHandlers);
    });
  });

  document.querySelectorAll(".mobile-tab").forEach((btn) => {
    btn.addEventListener("click", () => setMobileTab(btn.dataset.tab));
  });

  $("editorOverlay").addEventListener("click", (e) => {
    if (e.target === $("editorOverlay")) closeEditor();
  });

  window.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      closeJobMenu();
      if (!$("editorOverlay").hidden) closeEditor();
    }
    if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
      e.preventDefault();
      generateJob()
        .then((job) => job && afterNewJob(job))
        .catch((err) => toast(err.message));
    }
  });

  document.addEventListener("click", (e) => {
    if (!e.target.closest(".menu-popover") && !e.target.closest(".menu-btn")) {
      closeJobMenu();
    }
  });
}

document.querySelector(".app").dataset.mobileTab = "create";
bindUi();
loadHealth();
refreshQueue()
  .then(() => {
    const params = new URLSearchParams(location.search);
    const jobParam = params.get("job");
    if (jobParam) return selectJob(jobParam, { mobileSwitch: true });
    if (!state.jobsById.size) clearSelection(queueHandlers);
    else renderQueue(queueHandlers);
  })
  .catch((e) => toast(e.message));
