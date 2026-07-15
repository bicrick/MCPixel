import { escapeHtml } from "./api.js";
import {
  DIRECTION_DISPLAY_ORDER,
  aggregateBatchStatus,
  basePrompt,
  batchFingerprint,
  batchIdOf,
  batchMaster,
  batchProgressLabel,
  batchProgressPercent,
  jobByDirection,
  siblingsForBatch,
} from "./batch.js";
import {
  attachHeroChrome,
  markActiveStage,
  mountHeroForJob,
  resolveSelectedStage,
  scaleDetailImage,
  syncHeroChrome,
} from "./preview-chrome.js";
import {
  $,
  PIPELINE_STEPS,
  STATUS_LABELS,
  bestUrl,
  cacheBust,
  isActive,
  state,
} from "./state.js";
import { renderQueue } from "./queue.js";

export function stepStates(job) {
  const status = job?.status || "queued";
  if (status === "failed" || status === "cancelled") {
    const failedAt = job.stage_error || "generating";
    return PIPELINE_STEPS.map((step) => {
      if (step.key === "completed") return "todo";
      const order = PIPELINE_STEPS.findIndex((s) => s.key === step.key);
      const failOrder = PIPELINE_STEPS.findIndex((s) => s.key === failedAt);
      if (failOrder < 0) {
        return step.key === "generating" ? "failed" : order < 1 ? "done" : "todo";
      }
      if (order < failOrder) return "done";
      if (order === failOrder) return "failed";
      return "todo";
    });
  }
  const currentIdx = PIPELINE_STEPS.findIndex((s) => s.key === status);
  return PIPELINE_STEPS.map((_step, idx) => {
    if (status === "completed") return "done";
    if (currentIdx < 0) return "todo";
    if (idx < currentIdx) return "done";
    if (idx === currentIdx) return "current";
    return "todo";
  });
}

function setLayoutMode(mode) {
  const single = $("singleJobLayout");
  const batch = $("batchJobLayout");
  if (single) single.hidden = mode !== "single";
  if (batch) batch.hidden = mode !== "batch";
}

function miniStepperHtml(job) {
  const states = stepStates(job || { status: "queued" });
  return `
    <ol class="direction-mini-stepper" aria-hidden="true">
      ${PIPELINE_STEPS.map(
        (step, i) =>
          `<li class="mini-step" data-step="${step.key}" data-state="${states[i]}" title="${escapeHtml(
            step.label
          )}"></li>`
      ).join("")}
    </ol>
  `;
}

function cellThumb(job) {
  if (!job) {
    return `<span class="direction-placeholder">—</span>`;
  }
  const src = bestUrl(job);
  if (src) {
    return `<img src="${src}?t=${cacheBust(job)}" alt="" data-url="${src}" data-bust="${cacheBust(job)}" />`;
  }
  if (isActive(job.status)) {
    return `<span class="spinner" aria-hidden="true"></span>`;
  }
  return `<span class="direction-placeholder meta">${escapeHtml(STATUS_LABELS[job.status] || job.status)}</span>`;
}

function directionCellHtml(code, job, selected) {
  const status = job?.status || "queued";
  const missing = !job;
  return `
    <button type="button" class="direction-cell${selected ? " selected" : ""}${
      missing ? " missing" : ""
    }" data-direction="${escapeHtml(code)}" ${missing ? "disabled" : ""}>
      <span class="direction-thumb">${cellThumb(job)}</span>
      <span class="direction-cell-meta">
        <span class="direction-label">${escapeHtml(code)}</span>
        <span class="chip" data-status="${escapeHtml(status)}">${escapeHtml(
          STATUS_LABELS[status] || status
        )}</span>
      </span>
      ${miniStepperHtml(job)}
    </button>
  `;
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
  const stages = $("batchStages");
  if (!stages) return;
  if (!job) {
    stages.innerHTML = "";
    return;
  }
  const urls = job.urls || {};
  const bust = cacheBust(job);
  const cards = [
    stageCard("raw", urls.raw, bust),
    stageCard("cutout", urls.cutout, bust),
    stageCard("snapped", urls.snapped, bust),
  ];
  if (urls.edited) cards.push(stageCard("edited", urls.edited, bust));
  stages.innerHTML = cards.join("");
  markActiveStage(stages, state.selectedStage);
}

function patchStages(job) {
  const stages = $("batchStages");
  if (!stages || !job) {
    mountStages(job);
    return;
  }
  const urls = job.urls || {};
  const bust = cacheBust(job);
  const needed = ["raw", "cutout", "snapped"].concat(urls.edited ? ["edited"] : []);
  const existing = [...stages.querySelectorAll(".stage")].map((el) => el.dataset.stage);
  if (existing.join(",") !== needed.join(",")) {
    mountStages(job);
    return;
  }
  for (const name of needed) {
    const article = stages.querySelector(`.stage[data-stage="${name}"]`);
    if (!article) continue;
    const url = urls[name];
    const img = article.querySelector("img");
    if (url) {
      if (!img) {
        article.querySelector(".stage-empty")?.remove();
        const next = document.createElement("img");
        next.alt = name;
        next.dataset.url = url;
        next.src = `${url}?t=${bust}`;
        article.appendChild(next);
      } else if (img.dataset.url !== url) {
        img.dataset.url = url;
        img.src = `${url}?t=${bust}`;
      }
    }
  }
  markActiveStage(stages, state.selectedStage);
}

function mountDetail(job) {
  const frame = $("batchHeroFrame");
  if (!frame) return;

  if (!job) {
    attachHeroChrome(frame);
    frame.innerHTML = `<p class="meta hero-placeholder">Select a direction</p>`;
    syncHeroChrome({ url: null });
    mountStages(null);
    return;
  }

  mountHeroForJob(job, frame, scaleDetailImage);
  mountStages(job);
}

function patchDetail(job) {
  const frame = $("batchHeroFrame");
  if (!frame || !job) {
    mountDetail(job);
    return;
  }

  attachHeroChrome(frame);

  if (isActive(job.status)) {
    const text = `Working — ${STATUS_LABELS[job.status] || job.status}…`;
    const placeholder = frame.querySelector(".hero-placeholder");
    if (!placeholder || placeholder.textContent !== text || frame.querySelector("img")) {
      frame.innerHTML = `<p class="meta hero-placeholder">${escapeHtml(text)}</p>`;
    }
    syncHeroChrome({ url: null, canEdit: false, active: true });
    patchStages(job);
    return;
  }

  const url = job.urls?.[state.selectedStage] || null;
  const bust = cacheBust(job);
  const img = frame.querySelector("img");
  if (url) {
    if (!img || img.dataset.url !== url || img.dataset.bust !== String(bust)) {
      mountDetail(job);
      return;
    }
    syncHeroChrome({
      url,
      downloadName: `${job.id}_${job.extra?.direction || state.selectedStage || "best"}.png`,
      canEdit: Boolean(job.urls?.snapped || job.urls?.cutout),
      active: false,
    });
  } else {
    mountDetail(job);
    return;
  }

  patchStages(job);
}

function bindGridClicks(handlers) {
  const grid = $("directionsGrid");
  if (!grid || grid.dataset.bound === "1") return;
  grid.dataset.bound = "1";
  grid.addEventListener("click", (e) => {
    const cell = e.target.closest("[data-direction]");
    if (!cell || cell.disabled) return;
    const code = cell.dataset.direction;
    state.selectedDirection = code;
    const siblings = siblingsForBatch(state.currentBatchId);
    const job = jobByDirection(siblings, code);
    if (job) {
      state.currentJobId = job.id;
      handlers?.onSelectDirection?.(job);
    }
  });
}

function updateBatchChrome(siblings, selected) {
  const master = batchMaster(siblings);
  const agg = aggregateBatchStatus(siblings);
  $("jobId").textContent = `batch · ${siblings.length} directions`;
  $("jobStatus").textContent = STATUS_LABELS[agg] || agg;
  $("jobStatus").dataset.status = agg;
  $("jobPrompt").textContent = basePrompt(master || selected);

  const bits = [];
  bits.push(batchProgressLabel(siblings));
  if (selected?.extra?.direction) bits.push(`facing ${selected.extra.direction}`);
  if (selected?.output_width && selected?.output_height) {
    bits.push(`${selected.output_width}×${selected.output_height}`);
  }
  if (selected?.error) bits.push(`error: ${selected.error}`);
  $("metaLine").textContent = bits.join(" · ");

  const bar = $("jobProgress");
  const fill = $("jobProgressFill");
  if (bar && fill) {
    const pct = batchProgressPercent(siblings);
    bar.hidden = false;
    bar.dataset.status = agg;
    bar.setAttribute("aria-valuenow", String(pct));
    fill.style.width = `${pct}%`;
  }

  const urls = selected?.urls || {};
  const canEdit = Boolean(urls.snapped || urls.cutout);
  const active = selected ? isActive(selected.status) : false;
  const anyActive = siblings.some((j) => isActive(j.status));
  const selectedFailed =
    selected && (selected.status === "failed" || selected.status === "cancelled");
  const hasIncomplete = siblings.some((j) => j.status !== "completed");
  const editBtn = $("editBtn");
  if (editBtn) editBtn.disabled = !canEdit || active;
  $("resnapBtn").disabled = !urls.cutout || active;
  const cancelBtn = $("cancelJobBtn");
  if (cancelBtn) {
    cancelBtn.hidden = !anyActive;
    cancelBtn.disabled = !anyActive;
  }
  const retryFacing = $("retryFacingBtn");
  if (retryFacing) {
    retryFacing.hidden = !selectedFailed || anyActive;
    retryFacing.disabled = !selectedFailed || anyActive;
  }
  const retryIncomplete = $("retryIncompleteBtn");
  if (retryIncomplete) {
    retryIncomplete.hidden = anyActive || !hasIncomplete;
    retryIncomplete.disabled = anyActive || !hasIncomplete;
  }
}

function syncResnapInputs(job, force) {
  if (!force || !job) return;
  const k = $("resnapK");
  const px = $("resnapPx");
  if (k) k.value = job.k_colors || 16;
  if (px) px.value = job.pixel_size != null ? job.pixel_size : "";
}

function resolveSelected(siblings, preferredJob, switching) {
  let code = state.selectedDirection;
  if (switching && preferredJob?.extra?.direction) {
    code = preferredJob.extra.direction;
  }
  if (!code || !jobByDirection(siblings, code)) {
    const master = batchMaster(siblings);
    code =
      master?.extra?.direction ||
      DIRECTION_DISPLAY_ORDER.find((d) => jobByDirection(siblings, d));
  }
  state.selectedDirection = code || null;
  const selected = jobByDirection(siblings, code) || batchMaster(siblings) || siblings[0] || null;
  if (selected) state.currentJobId = selected.id;
  return selected;
}

/**
 * Render the 8-direction batch job pane.
 * @param {object} job - any sibling (usually master); siblings come from state
 * @param {object} handlers
 * @param {{ force?: boolean }} [opts]
 */
export function renderDirectionsView(job, handlers = {}, opts = {}) {
  const batchId = batchIdOf(job);
  if (!batchId) return false;

  setLayoutMode("batch");
  state.currentBatchId = batchId;

  const siblings = siblingsForBatch(batchId);
  const switching = state.paintedJobId !== `batch:${batchId}` || Boolean(opts.force);
  const selected = resolveSelected(siblings, job, switching);
  const fp = batchFingerprint(siblings) + `|dir:${state.selectedDirection || ""}`;

  if (!switching && fp === state.lastJobFp) {
    return true;
  }

  if (switching) {
    state.selectedStage = resolveSelectedStage(selected, { reset: true });
  } else if (selected) {
    state.selectedStage = resolveSelectedStage(selected, { prefer: state.selectedStage });
  }

  bindGridClicks({
    ...handlers,
    onSelectDirection: (sib) => {
      state.selectedStage = resolveSelectedStage(sib, { reset: true });
      syncResnapInputs(sib, true);
      mountDetail(sib);
      updateBatchChrome(siblingsForBatch(batchId), sib);
      state.lastJobFp =
        batchFingerprint(siblingsForBatch(batchId)) + `|dir:${state.selectedDirection || ""}`;
      renderQueue(handlers, { force: true });
      handlers?.onSelectDirection?.(sib);
    },
  });

  const grid = $("directionsGrid");
  if (grid) {
    if (switching || !grid.querySelector(".direction-cell")) {
      grid.innerHTML = DIRECTION_DISPLAY_ORDER.map((code) =>
        directionCellHtml(code, jobByDirection(siblings, code), code === state.selectedDirection)
      ).join("");
    } else {
      DIRECTION_DISPLAY_ORDER.forEach((code) => {
        const cell = grid.querySelector(`[data-direction="${code}"]`);
        const sib = jobByDirection(siblings, code);
        if (!cell) return;
        cell.classList.toggle("selected", code === state.selectedDirection);
        const chip = cell.querySelector(".chip");
        if (chip && sib) {
          chip.dataset.status = sib.status;
          chip.textContent = STATUS_LABELS[sib.status] || sib.status;
        }
        const thumb = cell.querySelector(".direction-thumb");
        if (thumb) thumb.innerHTML = cellThumb(sib);
        const stepper = cell.querySelector(".direction-mini-stepper");
        if (stepper) {
          const states = stepStates(sib || { status: "queued" });
          stepper.querySelectorAll(".mini-step").forEach((node, i) => {
            node.dataset.state = states[i];
          });
        }
      });
    }
  }

  updateBatchChrome(siblings, selected);
  if (switching) {
    syncResnapInputs(selected, true);
    mountDetail(selected);
  } else {
    patchDetail(selected);
  }

  state.paintedJobId = `batch:${batchId}`;
  state.lastJobFp = fp;
  return true;
}

export function hideDirectionsView() {
  setLayoutMode("single");
  state.currentBatchId = null;
  state.selectedDirection = null;
  const retryFacing = $("retryFacingBtn");
  if (retryFacing) retryFacing.hidden = true;
  const retryIncomplete = $("retryIncompleteBtn");
  if (retryIncomplete) retryIncomplete.hidden = true;
  // Reattach chrome to single hero when leaving batch
  const hero = $("heroFrame");
  if (hero) attachHeroChrome(hero);
}

export { setLayoutMode };
