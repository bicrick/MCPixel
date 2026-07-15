import { escapeHtml } from "./api.js";
import { isDirectionBatch } from "./batch.js";
import { hideDirectionsView, renderDirectionsView, stepStates } from "./directions-view.js";
import { syncCreateChrome, syncCreateNav } from "./generate.js";
import {
  attachHeroChrome,
  markActiveStage,
  mountHeroForJob,
  resolveSelectedStage,
  scaleDetailImage,
  scaleHeroImage,
  stageUrl,
  syncHeroChrome,
} from "./preview-chrome.js";
import {
  $,
  PIPELINE_STEPS,
  STATUS_LABELS,
  cacheBust,
  isActive,
  jobFingerprint,
  progressPercent,
  setMainMode,
  state,
  upsertJob,
} from "./state.js";
import { renderQueue } from "./queue.js";
import { renderLibrary, renderLibraryFilters } from "./library.js";

function syncLibraryBack() {
  const backBtn = $("backToLibraryBtn");
  if (backBtn) backBtn.hidden = !(state.mainMode === "job" && state.libraryReturn);
}

export function clearSelection(handlers) {
  state.currentJobId = null;
  state.currentBatchId = null;
  state.selectedDirection = null;
  state.selectedStage = null;
  state.paintedJobId = null;
  state.lastJobFp = null;
  state.libraryReturn = false;
  hideDirectionsView();
  setMainMode("empty");
  const bar = $("jobProgress");
  if (bar) bar.hidden = true;
  renderQueue(handlers, { force: true });
  renderLibraryFilters(handlers, { force: true });
  renderLibrary(handlers, { force: true });
}

export function showCreate(handlers) {
  state.currentJobId = null;
  state.currentBatchId = null;
  state.selectedDirection = null;
  state.selectedStage = null;
  state.paintedJobId = null;
  state.lastJobFp = null;
  state.libraryReturn = false;
  hideDirectionsView();
  setMainMode("create");
  history.replaceState(null, "", "/");
  const bar = $("jobProgress");
  if (bar) bar.hidden = true;
  syncCreateNav();
  syncCreateChrome();
  renderQueue(handlers, { force: true });
  renderLibraryFilters(handlers, { force: true });
  renderLibrary(handlers, { force: true });
}

/**
 * @param {object} job
 * @param {object} handlers
 * @param {{ force?: boolean }} [opts]
 */
export function renderJob(job, handlers, opts = {}) {
  upsertJob(job);

  if (isDirectionBatch(job)) {
    const switching =
      Boolean(opts.force) || state.paintedJobId !== `batch:${job.extra.direction_batch_id}`;
    setMainMode("job");
    syncLibraryBack();
    renderDirectionsView(job, handlers, opts);
    renderQueue(handlers, { force: switching });
    renderLibrary(handlers, { force: switching });
    if (switching) renderLibraryFilters(handlers, { force: true });
    return;
  }

  hideDirectionsView();

  const fp = jobFingerprint(job);
  const switching = state.paintedJobId !== job.id;
  const force = Boolean(opts.force) || switching;

  if (!force && fp === state.lastJobFp && state.currentJobId === job.id) {
    return;
  }

  state.currentJobId = job.id;
  state.currentBatchId = null;
  state.selectedDirection = null;
  setMainMode("job");
  syncLibraryBack();

  if (force || switching) {
    state.selectedStage = resolveSelectedStage(job, { reset: true });
  } else {
    state.selectedStage = resolveSelectedStage(job, { prefer: state.selectedStage });
  }

  if (force) {
    syncResnapInputs(job, true);
    mountStepper(job);
    mountHero(job);
    mountStages(job);
  } else {
    patchStepper(job);
    patchHero(job);
    patchStages(job);
  }

  patchJobChrome(job);
  updateProgressBar(job);

  state.paintedJobId = job.id;
  state.lastJobFp = fp;

  renderQueue(handlers, { force: switching });
  renderLibrary(handlers, { force: switching });
  if (switching) renderLibraryFilters(handlers, { force: true });
}

/**
 * Remount hero when the user picks a stage thumb.
 * @param {string} stageName
 */
export function selectJobStage(stageName) {
  const job = state.jobsById.get(state.currentJobId);
  if (!job || !stageUrl(job, stageName)) return;
  state.selectedStage = stageName;
  if (state.currentBatchId) {
    mountHeroForJob(job, $("batchHeroFrame"), scaleDetailImage);
    markActiveStage($("batchStages"), state.selectedStage);
    return;
  }
  mountHero(job);
  markActiveStage($("stages"), state.selectedStage);
}

function mountStepper(job) {
  const states = stepStates(job);
  $("stepper").innerHTML = PIPELINE_STEPS.map((step, i) => {
    return `
      <li class="step" data-step="${step.key}" data-state="${states[i]}">
        <span class="step-ring" aria-hidden="true"></span>
        ${escapeHtml(step.label)}
      </li>
    `;
  }).join("");
}

function patchStepper(job) {
  const states = stepStates(job);
  const nodes = $("stepper").querySelectorAll(".step");
  if (nodes.length !== PIPELINE_STEPS.length) {
    mountStepper(job);
    return;
  }
  nodes.forEach((node, i) => {
    node.dataset.state = states[i];
  });
}

function updateProgressBar(job) {
  const bar = $("jobProgress");
  const fill = $("jobProgressFill");
  if (!bar || !fill) return;
  const pct = progressPercent(job);
  bar.hidden = false;
  bar.dataset.status = job.status;
  bar.setAttribute("aria-valuenow", String(pct));
  fill.style.width = `${pct}%`;
}

function stageCard(name, url, bust) {
  return `
    <article class="stage" data-stage="${escapeHtml(name)}">
      <h3>${escapeHtml(name)}</h3>
      ${
        url
          ? `<img src="${url}?t=${bust}" alt="${escapeHtml(name)}" data-url="${url}" />`
          : `<div class="stage-empty">Waiting…</div>`
      }
    </article>
  `;
}

function mountStages(job) {
  const urls = job.urls || {};
  const bust = cacheBust(job);
  const cards = [
    stageCard("raw", urls.raw, bust),
    stageCard("cutout", urls.cutout, bust),
    stageCard("snapped", urls.snapped, bust),
  ];
  if (urls.edited) cards.push(stageCard("edited", urls.edited, bust));
  $("stages").innerHTML = cards.join("");
  markActiveStage($("stages"), state.selectedStage);
}

function patchStages(job) {
  const urls = job.urls || {};
  const bust = cacheBust(job);
  const root = $("stages");
  const needed = ["raw", "cutout", "snapped"].concat(urls.edited ? ["edited"] : []);
  const existing = [...root.querySelectorAll(".stage")].map((el) => el.dataset.stage);
  if (existing.join(",") !== needed.join(",")) {
    mountStages(job);
    return;
  }
  for (const name of needed) {
    const article = root.querySelector(`.stage[data-stage="${name}"]`);
    if (!article) continue;
    const url = urls[name];
    const img = article.querySelector("img");
    if (url) {
      if (!img) {
        article.querySelector(".stage-empty")?.remove();
        const next = document.createElement("img");
        next.alt = name;
        next.dataset.url = url;
        next.dataset.bust = String(bust);
        next.src = `${url}?t=${bust}`;
        article.appendChild(next);
      } else if (img.dataset.url !== url || img.dataset.bust !== String(bust)) {
        img.dataset.url = url;
        img.dataset.bust = String(bust);
        img.src = `${url}?t=${bust}`;
      }
    } else if (img) {
      img.remove();
      if (!article.querySelector(".stage-empty")) {
        const empty = document.createElement("div");
        empty.className = "stage-empty";
        empty.textContent = "Waiting…";
        article.appendChild(empty);
      }
    }
  }
  markActiveStage(root, state.selectedStage);
}

function chromeOpts(job, url) {
  const urls = job.urls || {};
  return {
    url,
    downloadName: `${job.id}_${state.selectedStage || "best"}.png`,
    canEdit: Boolean(urls.snapped || urls.cutout),
    active: isActive(job.status),
  };
}

function mountHero(job) {
  mountHeroForJob(job, $("heroFrame"), scaleHeroImage);
}

function patchHero(job) {
  const frame = $("heroFrame");
  attachHeroChrome(frame);
  if (isActive(job.status)) {
    const text = `Working — ${STATUS_LABELS[job.status] || job.status}…`;
    const placeholder = frame.querySelector(".hero-placeholder");
    const img = frame.querySelector("img");
    if (img || !placeholder || placeholder.textContent !== text) {
      frame.innerHTML = `<p class="meta hero-placeholder">${escapeHtml(text)}</p>`;
    }
    syncHeroChrome({ url: null, canEdit: false, active: true });
    return;
  }
  const url = stageUrl(job, state.selectedStage);
  const bust = cacheBust(job);
  const img = frame.querySelector("img");
  if (url) {
    if (img && img.dataset.url === url && img.dataset.bust === String(bust)) {
      syncHeroChrome(chromeOpts(job, url));
      return;
    }
    if (img && img.dataset.url === url) {
      img.dataset.bust = String(bust);
      img.onload = () => scaleHeroImage(img);
      img.src = `${url}?t=${bust}`;
      syncHeroChrome(chromeOpts(job, url));
      return;
    }
    mountHero(job);
    return;
  }
  if (img || job.status === "failed" || job.status === "cancelled" || !frame.querySelector(".hero-placeholder")) {
    mountHero(job);
    return;
  }
  syncHeroChrome({ url: null, canEdit: false, active: false });
}

function patchJobChrome(job) {
  $("jobId").textContent = job.id;
  $("jobStatus").textContent = STATUS_LABELS[job.status] || job.status;
  $("jobStatus").dataset.status = job.status;
  $("jobPrompt").textContent = job.prompt;

  const bits = [];
  if (job.target_width && job.target_height) {
    bits.push(`target ${job.target_width}×${job.target_height}`);
  }
  if (job.detected_pixel_size) bits.push(`detected ${job.detected_pixel_size}px`);
  if (job.output_width && job.output_height) {
    bits.push(`${job.output_width}×${job.output_height}`);
  }
  if (job.error) bits.push(`error: ${job.error}`);
  $("metaLine").textContent = bits.join(" · ");

  const urls = job.urls || {};
  const canEdit = Boolean(urls.snapped || urls.cutout);
  const active = isActive(job.status);
  const editBtn = $("editBtn");
  if (editBtn) editBtn.disabled = !canEdit || active;
  $("resnapBtn").disabled = !urls.cutout || active;
  const cancelBtn = $("cancelJobBtn");
  if (cancelBtn) {
    cancelBtn.hidden = !active;
    cancelBtn.disabled = !active;
  }
  const retryFacing = $("retryFacingBtn");
  if (retryFacing) retryFacing.hidden = true;
  const retryIncomplete = $("retryIncompleteBtn");
  if (retryIncomplete) retryIncomplete.hidden = true;
}

function syncResnapInputs(job, force) {
  if (!force) return;
  const k = $("resnapK");
  const px = $("resnapPx");
  if (k) k.value = job.k_colors || 16;
  if (px) px.value = job.pixel_size != null ? job.pixel_size : "";
}
