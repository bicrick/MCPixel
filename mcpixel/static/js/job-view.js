import { escapeHtml } from "./api.js";
import {
  $,
  PIPELINE_STEPS,
  STATUS_LABELS,
  bestUrl,
  cacheBust,
  isActive,
  jobFingerprint,
  progressPercent,
  setMainMode,
  state,
  upsertJob,
} from "./state.js";
import { renderQueue } from "./queue.js";
import { renderProjectsPane } from "./projects.js";

function stepStates(job) {
  const status = job.status;
  if (status === "failed") {
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
        next.src = `${url}?t=${bust}`;
        article.appendChild(next);
      } else if (img.dataset.url !== url) {
        img.dataset.url = url;
        img.src = `${url}?t=${bust}`;
      }
    }
  }
}

function frameInnerSize() {
  const frame = $("heroFrame");
  return Math.max(200, Math.min(frame.clientWidth, frame.clientHeight) - 32);
}

function scaleHeroImage(img) {
  const fit = Math.min(420, Math.max(frameInnerSize(), 240));
  const longest = Math.max(img.naturalWidth || 1, img.naturalHeight || 1);
  const scale = Math.max(2, Math.min(16, Math.floor(fit / longest)));
  img.style.width = `${(img.naturalWidth || 0) * scale}px`;
  img.style.height = `${(img.naturalHeight || 0) * scale}px`;
}

function mountHero(job) {
  const url = bestUrl(job);
  const frame = $("heroFrame");
  const download = $("downloadBtn");
  if (url) {
    frame.innerHTML = `<img alt="Result preview" data-url="${url}" />`;
    const img = frame.querySelector("img");
    img.onload = () => scaleHeroImage(img);
    img.src = `${url}?t=${cacheBust(job)}`;
    download.hidden = false;
    download.href = url;
    download.download = `${job.id}_best.png`;
  } else if (job.status === "failed") {
    frame.innerHTML = `<p class="meta hero-placeholder">Failed${job.error ? `: ${escapeHtml(job.error)}` : ""}</p>`;
    download.hidden = true;
  } else {
    frame.innerHTML = `<p class="meta hero-placeholder">Working — ${escapeHtml(STATUS_LABELS[job.status] || job.status)}…</p>`;
    download.hidden = true;
  }
}

function patchHero(job) {
  const url = bestUrl(job);
  const frame = $("heroFrame");
  const download = $("downloadBtn");
  const img = frame.querySelector("img");
  if (url) {
    if (img && img.dataset.url === url) {
      download.hidden = false;
      download.href = url;
      return;
    }
    mountHero(job);
    return;
  }
  if (img) {
    mountHero(job);
    return;
  }
  const placeholder = frame.querySelector(".hero-placeholder");
  if (job.status === "failed") {
    const text = `Failed${job.error ? `: ${job.error}` : ""}`;
    if (!placeholder || placeholder.textContent !== text) mountHero(job);
  } else {
    const text = `Working — ${STATUS_LABELS[job.status] || job.status}…`;
    if (!placeholder || placeholder.textContent !== text) {
      if (placeholder) placeholder.textContent = text;
      else mountHero(job);
    }
  }
  download.hidden = true;
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
  $("editBtn").disabled = !canEdit || isActive(job.status);
  $("resnapBtn").disabled = !urls.cutout || isActive(job.status);
}

function syncResnapInputs(job, force) {
  if (!force) return;
  $("resnapK").value = job.k_colors || 16;
  $("resnapPx").value = job.pixel_size != null ? job.pixel_size : "";
}

export function clearSelection(handlers) {
  state.currentJobId = null;
  state.paintedJobId = null;
  state.lastJobFp = null;
  setMainMode("empty");
  const bar = $("jobProgress");
  if (bar) bar.hidden = true;
  renderQueue(handlers, { force: true });
  renderProjectsPane(handlers);
}

export function showCreate(handlers) {
  state.currentJobId = null;
  state.paintedJobId = null;
  state.lastJobFp = null;
  setMainMode("create");
  history.replaceState(null, "", "/");
  const bar = $("jobProgress");
  if (bar) bar.hidden = true;
  renderQueue(handlers, { force: true });
  renderProjectsPane(handlers);
}

/**
 * @param {object} job
 * @param {object} handlers
 * @param {{ force?: boolean }} [opts]
 */
export function renderJob(job, handlers, opts = {}) {
  upsertJob(job);
  const fp = jobFingerprint(job);
  const switching = state.paintedJobId !== job.id;
  const force = Boolean(opts.force) || switching;

  if (!force && fp === state.lastJobFp && state.currentJobId === job.id) {
    return;
  }

  state.currentJobId = job.id;
  setMainMode("job");

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
  if (switching) renderProjectsPane(handlers);
}
