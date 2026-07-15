import { api } from "./js/api.js";
import {
  batchIdOf,
  batchMaster,
  basePrompt,
  aggregateBatchStatus,
  isDirectionBatch,
  siblingsForBatch,
} from "./js/batch.js";
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
  cancelJob,
  deleteBatch,
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
import { clearSelection, renderJob, selectJobStage, showCreate } from "./js/job-view.js";
import {
  bindPreviewChrome,
  openResnapModal,
} from "./js/preview-chrome.js";
import {
  bindEditorEvents,
  closeEditor,
  openEditor,
  saveEdit,
} from "./js/editor.js";
import {
  bindCreateDrop,
  bindCreateMenu,
  bindAspectChips,
  bindKChips,
  bindPoseChips,
  bindReferenceControls,
  bindSizeChips,
  closeChooseRefMenu,
  closeRefPicker,
  generateJob,
  openRefPicker,
  retryBatchIncomplete,
  retryFromJob,
  retryJobInPlace,
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
import { bindSettings, closePrompts, openSettings } from "./js/settings.js";
import { bindInfoTips } from "./js/tooltips.js";
import { confirmDialog, promptDialog } from "./js/dialogs.js";

const queueHandlers = {
  onSelect: (id) => selectJob(id, { fromLibrary: false }),
  onMenuAction: (action, id, projectId) => handleMenuAction(action, id, projectId),
  onClearFailed: () => handleClearFailed(),
  onOpenMenu: (id, btn, opts = {}) => {
    if (state.menuJobId === id && !document.getElementById("jobMenu")?.hidden) {
      closeJobMenu();
      return;
    }
    closeJobMenu();
    openJobMenu(id, btn, opts);
  },
  onProjectMenu: (projectId, btn) => {
    closeJobMenu();
    openProjectMenu(projectId, btn);
  },
};

const libraryHandlers = {
  ...queueHandlers,
  onSelect: (id) => selectJob(id, { fromLibrary: true }),
  onDropJob: (projectId, jobId) => handleDropJobOnProject(projectId, jobId),
};

/** Last aggregate status for the open batch — used to toast on crash/partial. */
let lastKnownBatchAgg = null;

function maybeToastBatchFailure(siblings) {
  if (!siblings?.length) return;
  const agg = aggregateBatchStatus(siblings);
  if (
    lastKnownBatchAgg === "generating" &&
    (agg === "failed" || agg === "partial")
  ) {
    const err =
      siblings.find((j) => j.status === "failed" && j.error)?.error ||
      "One or more directions failed.";
    toast(err);
  }
  lastKnownBatchAgg = agg;
}

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
  if (tab) tab.textContent = n ? `Jobs (${n})` : "Jobs";
}

function masterIdForJob(job) {
  if (!isDirectionBatch(job)) return job.id;
  const siblings = siblingsForBatch(batchIdOf(job));
  return batchMaster(siblings)?.id || job.id;
}

async function selectJob(id, { mobileSwitch = true, fromLibrary = false } = {}) {
  try {
    if (fromLibrary) state.libraryReturn = true;
    else state.libraryReturn = false;
    const job = await api(`/v1/jobs/${id}`);
    if (isDirectionBatch(job)) {
      state.selectedDirection = job.extra?.direction || state.selectedDirection;
    }
    renderJob(job, queueHandlers, { force: true });
    setTargetFromJob(job);
    const urlId = isDirectionBatch(job) ? masterIdForJob(job) : id;
    history.replaceState(null, "", `/?job=${urlId}`);
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
    queueFingerprint(sortedJobs()) +
    `|sel:${state.currentJobId || ""}|batch:${state.currentBatchId || ""}|f:${state.queueFilter}`;

  if (state.mainMode === "job" && state.currentBatchId) {
    const siblings = siblingsForBatch(state.currentBatchId);
    maybeToastBatchFailure(siblings);
    const focus =
      siblings.find((j) => j.id === state.currentJobId) ||
      batchMaster(siblings) ||
      siblings[0];
    if (focus) {
      renderJob(focus, queueHandlers);
    } else if (listFp !== state.lastQueueFp) {
      renderQueue(queueHandlers);
      refreshLibraryChrome();
    }
  } else if (state.mainMode === "job" && state.currentJobId && state.jobsById.has(state.currentJobId)) {
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

async function afterNewJob(jobOrBatch) {
  // Directions batch returns { jobs: [...], master_job_id }
  const jobs = Array.isArray(jobOrBatch?.jobs) ? jobOrBatch.jobs : [jobOrBatch];
  const masterId = jobOrBatch?.master_job_id || jobs[0]?.id;
  for (const job of jobs) {
    if (job?.id) upsertJob(job);
  }
  await loadProjects();
  state.lastQueueFp = null;
  state.libraryReturn = false;
  const focus = jobs.find((j) => j.id === masterId) || jobs[0];
  if (focus) {
    if (isDirectionBatch(focus)) {
      state.selectedDirection = focus.extra?.direction || "S";
      lastKnownBatchAgg = null;
    }
    renderJob(focus, queueHandlers, { force: true });
    history.replaceState(null, "", `/?job=${masterIdForJob(focus)}`);
  }
  setMobileTab("job");
  setRailTab("queue");
  ensurePolling();
  updateActiveBadge();
  refreshLibraryChrome();
  if (jobOrBatch?.jobs?.length) {
    toast(`Queued ${jobOrBatch.jobs.length} direction jobs.`);
  }
}

async function handleDropJobOnProject(projectId, jobId) {
  try {
    await addJobToProject(projectId, jobId);
    await loadProjects();
    renderQueue(queueHandlers);
    refreshLibraryChrome();
    const project = state.projects.find((p) => p.id === projectId);
    toast(`Added to ${project?.name || "project"}.`);
  } catch (e) {
    toast(e.message);
  }
}

async function handleMenuAction(action, jobId, projectId) {
  try {
    if (action === "rename-project" && projectId) {
      const current = state.projects.find((p) => p.id === projectId);
      const name = await promptDialog("Enter a new name for this project.", current?.name || "", {
        title: "Rename project",
        confirmLabel: "Rename",
        fieldLabel: "Name",
      });
      if (!name?.trim()) return;
      await renameProject(projectId, name.trim());
      refreshLibraryChrome();
      toast("Renamed.");
      return;
    }
    if (action === "delete-project" && projectId) {
      const current = state.projects.find((p) => p.id === projectId);
      const ok = await confirmDialog(
        `Delete project “${current?.name || projectId}”? Jobs stay in the list.`,
        { title: "Delete project", confirmLabel: "Delete", danger: true }
      );
      if (!ok) return;
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

    if (action === "cancel-batch" && jobId) {
      const cancelled = await cancelJob(jobId);
      upsertJob(cancelled);
      state.lastJobFp = null;
      await refreshQueue();
      toast("Batch cancelled.");
      updateActiveBadge();
      return;
    }
    if (action === "retry-incomplete" && jobId) {
      const result = await retryBatchIncomplete(jobId);
      for (const j of result.jobs || []) upsertJob(j);
      state.lastJobFp = null;
      lastKnownBatchAgg = null;
      await refreshQueue();
      toast(`Retried ${result.retried || 0} direction(s).`);
      updateActiveBadge();
      return;
    }
    if (action === "retry-inplace" && jobId) {
      const updated = await retryJobInPlace(jobId);
      upsertJob(updated);
      state.lastJobFp = null;
      lastKnownBatchAgg = null;
      renderJob(updated, queueHandlers, { force: true });
      await refreshQueue();
      toast("Facing re-queued.");
      updateActiveBadge();
      return;
    }
    if (action === "copy-batch" && job) {
      await navigator.clipboard.writeText(basePrompt(job));
      toast("Prompt copied.");
      return;
    }
    if (action === "delete-batch" && job) {
      const bid = batchIdOf(job);
      const siblings = siblingsForBatch(bid);
      const ok = await confirmDialog(
        `Delete all ${siblings.length} direction jobs?\n${basePrompt(job)}`,
        { title: "Delete batch", confirmLabel: "Delete", danger: true }
      );
      if (!ok) return;
      await deleteBatch(bid);
      if (state.currentBatchId === bid || siblings.some((j) => j.id === state.currentJobId)) {
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
      toast("Batch deleted.");
      updateActiveBadge();
      return;
    }

    if (action === "retry" || action === "duplicate") {
      const created = await retryFromJob(job);
      await afterNewJob(created);
      return;
    }
    if (action === "resnap") {
      await selectJob(jobId, { fromLibrary: state.libraryReturn });
      openResnapModal();
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
    if (action === "cancel" && jobId) {
      const cancelled = await cancelJob(jobId);
      upsertJob(cancelled);
      if (state.currentJobId === jobId || state.currentBatchId === batchIdOf(job)) {
        state.lastJobFp = null;
        renderJob(cancelled, queueHandlers, { force: true });
      }
      await refreshQueue();
      toast("Cancelled.");
      updateActiveBadge();
      return;
    }
    if (action === "delete") {
      const ok = await confirmDialog(`Delete job permanently?\n${job.prompt || jobId}`, {
        title: "Delete job",
        confirmLabel: "Delete",
        danger: true,
      });
      if (!ok) return;
      const bid = batchIdOf(job);
      await deleteJob(jobId);
      if (state.currentJobId === jobId) {
        if (bid && siblingsForBatch(bid).length) {
          const next = batchMaster(siblingsForBatch(bid)) || siblingsForBatch(bid)[0];
          if (next) {
            await selectJob(next.id, { fromLibrary: state.libraryReturn });
          } else {
            clearSelection(queueHandlers);
            history.replaceState(null, "", "/");
          }
        } else if (state.libraryReturn) {
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
  const ok = await confirmDialog("Delete all failed jobs?", {
    title: "Clear failed",
    confirmLabel: "Clear",
    danger: true,
  });
  if (!ok) return;
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
  bindAspectChips();
  bindPoseChips();
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
        if (state.mainMode === "library" || state.mainMode === "settings") {
          setMainMode("empty");
        }
      }
    });
  });

  $("generateBtn").addEventListener("click", () =>
    generateJob()
      .then((job) => job && afterNewJob(job))
      .catch((e) => toast(e.message))
  );
  bindPreviewChrome({
    onResnapConfirm: () => resnap(),
    onStageSelect: (name) => selectJobStage(name),
  });
  $("retryFacingBtn")?.addEventListener("click", () => {
    if (!state.currentJobId) return;
    retryJobInPlace(state.currentJobId)
      .then(async (updated) => {
        upsertJob(updated);
        state.lastJobFp = null;
        lastKnownBatchAgg = null;
        renderJob(updated, queueHandlers, { force: true });
        await refreshQueue();
        toast("Facing re-queued.");
        updateActiveBadge();
      })
      .catch((e) => toast(e.message));
  });
  $("retryIncompleteBtn")?.addEventListener("click", () => {
    const id = state.currentJobId || batchMaster(siblingsForBatch(state.currentBatchId))?.id;
    if (!id) return;
    retryBatchIncomplete(id)
      .then(async (result) => {
        for (const j of result.jobs || []) upsertJob(j);
        state.lastJobFp = null;
        lastKnownBatchAgg = null;
        await refreshQueue();
        toast(`Retried ${result.retried || 0} direction(s).`);
        updateActiveBadge();
      })
      .catch((e) => toast(e.message));
  });
  $("cancelJobBtn")?.addEventListener("click", () => {
    if (!state.currentJobId && !state.currentBatchId) return;
    const targetId = state.currentBatchId
      ? batchMaster(siblingsForBatch(state.currentBatchId))?.id || state.currentJobId
      : state.currentJobId;
    if (!targetId) return;
    cancelJob(targetId)
      .then(async (cancelled) => {
        upsertJob(cancelled);
        state.lastJobFp = null;
        renderJob(cancelled, queueHandlers, { force: true });
        await refreshQueue();
        toast(state.currentBatchId ? "Batch cancelled." : "Cancelled.");
        updateActiveBadge();
      })
      .catch((e) => toast(e.message));
  });
  $("editBtn")?.addEventListener("click", () =>
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
      else if (tab === "queue") {
        setRailTab("queue");
        if (state.mainMode === "settings") setMainMode("empty");
      } else if (tab === "job" && state.currentJobId) {
        selectJob(state.currentJobId, { mobileSwitch: false, fromLibrary: state.libraryReturn });
      } else if (tab === "settings") {
        openSettings().catch((e) => toast(e.message));
      }
    });
  });

  $("editorOverlay").addEventListener("click", (e) => {
    if (e.target === $("editorOverlay")) closeEditor();
  });

  window.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      closeJobMenu();
      closeChooseRefMenu();
      if ($("promptsOverlay") && !$("promptsOverlay").hidden) {
        closePrompts();
      }
      closeRefPicker();
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
    if (
      !e.target.closest(".menu-popover") &&
      !e.target.closest(".menu-submenu") &&
      !e.target.closest(".menu-btn")
    ) {
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
    if (params.get("settings")) return openSettings();
    if (!state.jobsById.size) clearSelection(queueHandlers);
    else {
      renderQueue(queueHandlers);
      setMainMode("empty");
    }
  })
  .catch((e) => toast(e.message));
