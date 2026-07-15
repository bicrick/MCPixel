import { api } from "./js/api.js";
import {
  $,
  anyActive,
  bestUrl,
  cacheJobs,
  jobFingerprint,
  queueFingerprint,
  setMainMode,
  setMobileTab,
  setRailTab,
  sortedJobs,
  state,
  toast,
  upsertJob,
} from "./js/state.js";
import {
  clearFailedJobs,
  closeJobMenu,
  deleteJob,
  openJobMenu,
  openProjectMenu,
  renderQueue,
} from "./js/queue.js";
import {
  renderLibrary,
  renderLibraryFilters,
  showLibraryExplorer,
} from "./js/library.js";
import { clearSelection, renderJob, showCreate } from "./js/job-view.js";
import {
  bindEditorEvents,
  closeEditor,
  openEditor,
  saveEdit,
} from "./js/editor.js";
import {
  bindCreateDrop,
  bindCreateMenu,
  bindKChips,
  bindReferenceControls,
  bindSizeChips,
  closeChooseRefMenu,
  closeRefPicker,
  generateJob,
  openRefPicker,
  retryFromJob,
  setReferenceFile,
  setTargetFromJob,
} from "./js/generate.js";
import {
  addJobToProject,
  deleteProject,
  loadProjects,
  promptNewProject,
  removeJobFromProject,
  renameProject,
} from "./js/projects.js";
import { bindSettings, closeSettings } from "./js/settings.js";
import { bindInfoTips } from "./js/tooltips.js";

const queueHandlers = {
  onSelect: (id) => selectJob(id, { fromLibrary: false }),
  onMenuAction: (action, id, projectId) => handleMenuAction(action, id, projectId),
  onClearFailed: () => handleClearFailed(),
  onOpenMenu: (id, btn) => {
    if (state.menuJobId === id && !document.getElementById("jobMenu")?.hidden) {
      closeJobMenu();
      return;
    }
    closeJobMenu();
    openJobMenu(id, btn);
  },
  onProjectMenu: (projectId, btn) => {
    closeJobMenu();
    openProjectMenu(projectId, btn);
  },
};

const libraryHandlers = {
  ...queueHandlers,
  onSelect: (id) => selectJob(id, { fromLibrary: true }),
};

function refreshLibraryChrome() {
  renderLibraryFilters(libraryHandlers, { force: true });
  renderLibrary(libraryHandlers);
}

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

async function selectJob(id, { mobileSwitch = true, fromLibrary = false } = {}) {
  try {
    if (fromLibrary) state.libraryReturn = true;
    else state.libraryReturn = false;
    const job = await api(`/v1/jobs/${id}`);
    renderJob(job, queueHandlers, { force: true });
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
  const jobs = data.jobs || [];
  cacheJobs(jobs);
  updateActiveBadge();

  const listFp =
    queueFingerprint(sortedJobs()) + `|sel:${state.currentJobId || ""}|f:${state.queueFilter}`;

  if (state.mainMode === "job" && state.currentJobId && state.jobsById.has(state.currentJobId)) {
    const detail = await api(`/v1/jobs/${state.currentJobId}`);
    const detailFp = jobFingerprint(detail);
    if (detailFp !== state.lastJobFp || state.paintedJobId !== detail.id) {
      renderJob(detail, queueHandlers);
    } else if (listFp !== state.lastQueueFp) {
      renderQueue(queueHandlers);
      refreshLibraryChrome();
    }
  } else if (state.mainMode === "library") {
    renderQueue(queueHandlers);
    refreshLibraryChrome();
  } else if (listFp !== state.lastQueueFp) {
    renderQueue(queueHandlers);
    refreshLibraryChrome();
  } else if (state.railTab === "library") {
    refreshLibraryChrome();
  }

  ensurePolling();
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
  state.lastQueueFp = null;
  state.libraryReturn = false;
  renderJob(job, queueHandlers, { force: true });
  history.replaceState(null, "", `/?job=${job.id}`);
  setMobileTab("job");
  ensurePolling();
  updateActiveBadge();
}

async function handleMenuAction(action, jobId, projectId) {
  try {
    if (action === "rename-project" && projectId) {
      const current = state.projects.find((p) => p.id === projectId);
      const name = prompt("Rename project", current?.name || "");
      if (!name?.trim()) return;
      await renameProject(projectId, name.trim());
      refreshLibraryChrome();
      toast("Renamed.");
      return;
    }
    if (action === "delete-project" && projectId) {
      const current = state.projects.find((p) => p.id === projectId);
      if (!confirm(`Delete project “${current?.name || projectId}”? Jobs stay in the queue.`)) {
        return;
      }
      await deleteProject(projectId);
      if (state.libraryFilter === projectId) state.libraryFilter = "all";
      refreshLibraryChrome();
      toast("Project deleted.");
      return;
    }

    if (!jobId && !["create-then-add"].includes(action)) return;
    const job = jobId
      ? state.jobsById.get(jobId) || (await api(`/v1/jobs/${jobId}`))
      : null;

    if (action === "retry" || action === "duplicate") {
      const created = await retryFromJob(job);
      await afterNewJob(created);
      return;
    }
    if (action === "resnap") {
      await selectJob(jobId, { fromLibrary: state.libraryReturn });
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
    if (action === "pick-project" && projectId && jobId) {
      await addJobToProject(projectId, jobId);
      await loadProjects();
      renderQueue(queueHandlers);
      refreshLibraryChrome();
      toast("Added to project.");
      return;
    }
    if (action === "create-then-add" && jobId) {
      const project = await promptNewProject();
      if (!project) return;
      await addJobToProject(project.id, jobId);
      await loadProjects();
      renderQueue(queueHandlers);
      refreshLibraryChrome();
      toast("Added to project.");
      return;
    }
    if (action === "remove-project" && projectId && jobId) {
      await removeJobFromProject(projectId, jobId);
      await loadProjects();
      renderQueue(queueHandlers);
      refreshLibraryChrome();
      toast("Removed from project.");
      return;
    }
    if (action === "delete") {
      if (!confirm(`Delete job permanently?\n${job.prompt || jobId}`)) return;
      await deleteJob(jobId);
      if (state.currentJobId === jobId) {
        if (state.libraryReturn) {
          setRailTab("library");
          showLibraryExplorer(libraryHandlers);
        } else {
          clearSelection(queueHandlers);
          history.replaceState(null, "", "/");
        }
      } else {
        renderQueue(queueHandlers);
        refreshLibraryChrome();
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
      refreshLibraryChrome();
    }
    updateActiveBadge();
  } catch (e) {
    toast(e.message);
  }
}

async function resnap() {
  if (!state.currentJobId) return;
  const pixelRaw = $("resnapPx").value.trim();
  const kRaw = $("resnapK").value.trim();
  const body = {
    k_colors: kRaw === "" ? null : Number(kRaw) || 16,
    pixel_size: pixelRaw === "" ? null : Number(pixelRaw),
  };
  if (body.pixel_size != null && !(body.pixel_size > 0)) {
    toast("Pixel size must be a positive number, or empty for auto.");
    return;
  }
  toast("Resnapping…");
  $("resnapBtn").disabled = true;
  try {
    const job = await api(`/v1/jobs/${state.currentJobId}/resnap`, {
      method: "POST",
      body: JSON.stringify(body),
    });
    upsertJob(job);
    state.lastJobFp = null;
    renderJob(job, queueHandlers, { force: true });
    ensurePolling();
    updateActiveBadge();
  } catch (e) {
    toast(e.message);
    const job = state.jobsById.get(state.currentJobId);
    if (job) {
      $("resnapBtn").disabled = !job.urls?.cutout || isActiveStatus(job.status);
    }
  }
}

function isActiveStatus(status) {
  return ["queued", "generating", "removing_background", "snapping"].includes(status);
}

function openCreateWorkspace() {
  showCreate(queueHandlers);
  setMobileTab("create");
  $("prompt")?.focus();
}

function openLibraryWorkspace() {
  setRailTab("library");
  showLibraryExplorer(libraryHandlers);
  setMobileTab("queue");
}

function bindUi() {
  bindSizeChips();
  bindKChips();
  bindEditorEvents();
  bindSettings(() => loadHealth());
  bindInfoTips();
  bindCreateDrop((file) => {
    setReferenceFile(file);
    toast("Reference set from drop.");
  });
  bindCreateMenu({ onCreateSprite: openCreateWorkspace });
  bindReferenceControls({ onPickJob: openRefPicker });

  $("closeRefPickerBtn")?.addEventListener("click", closeRefPicker);
  $("refPickerOverlay")?.addEventListener("click", (e) => {
    if (e.target === $("refPickerOverlay")) closeRefPicker();
  });

  $("newProjectBtn")?.addEventListener("click", async () => {
    await promptNewProject();
    refreshLibraryChrome();
  });

  $("backToLibraryBtn")?.addEventListener("click", () => {
    openLibraryWorkspace();
  });

  document.querySelectorAll(".rail-tab").forEach((btn) => {
    btn.addEventListener("click", () => {
      const tab = btn.dataset.rail;
      setRailTab(tab);
      if (tab === "library") {
        showLibraryExplorer(libraryHandlers);
      } else {
        renderQueue(queueHandlers);
        if (state.mainMode === "library") setMainMode("empty");
      }
    });
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

  document.querySelectorAll(".filter-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      state.queueFilter = btn.dataset.filter;
      document
        .querySelectorAll(".filter-btn")
        .forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      state.lastQueueFp = null;
      renderQueue(queueHandlers, { force: true });
    });
  });

  document.querySelectorAll(".mobile-tab").forEach((btn) => {
    btn.addEventListener("click", () => {
      const tab = btn.dataset.tab;
      setMobileTab(tab);
      if (tab === "create") openCreateWorkspace();
      else if (tab === "queue") setRailTab("queue");
      else if (tab === "job" && state.currentJobId) {
        selectJob(state.currentJobId, { mobileSwitch: false, fromLibrary: state.libraryReturn });
      }
    });
  });

  $("editorOverlay").addEventListener("click", (e) => {
    if (e.target === $("editorOverlay")) closeEditor();
  });

  window.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      closeJobMenu();
      closeSettings();
      closeRefPicker();
      closeChooseRefMenu();
      if (!$("editorOverlay").hidden) closeEditor();
    }
    if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
      e.preventDefault();
      if (state.mainMode !== "create") openCreateWorkspace();
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

setMainMode("empty");
setRailTab("queue");
document.querySelector(".app").dataset.mobileTab = "queue";
bindUi();
loadHealth();
Promise.all([refreshQueue(), loadProjects()])
  .then(() => {
    refreshLibraryChrome();
    const params = new URLSearchParams(location.search);
    const jobParam = params.get("job");
    if (jobParam) return selectJob(jobParam, { mobileSwitch: true, fromLibrary: false });
    if (!state.jobsById.size) clearSelection(queueHandlers);
    else {
      renderQueue(queueHandlers);
      setMainMode("empty");
    }
  })
  .catch((e) => toast(e.message));
