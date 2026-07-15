import { escapeHtml } from "./api.js";
import {
  $,
  PIPELINE_STEPS,
  STATUS_LABELS,
  bestUrl,
  isActive,
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

function renderStepper(job) {
  const states = stepStates(job);
  $("stepper").innerHTML = PIPELINE_STEPS.map((step, i) => {
    return `
      <li class="step" data-state="${states[i]}">
        <span class="step-dot" aria-hidden="true"></span>
        ${escapeHtml(step.label)}
      </li>
    `;
  }).join("");
}

function stageCard(name, url) {
  return `
    <article class="stage">
      <h3>${escapeHtml(name)}</h3>
      ${
        url
          ? `<img src="${url}?t=${Date.now()}" alt="${escapeHtml(name)}" />`
          : `<div class="stage-empty">Waiting…</div>`
      }
    </article>
  `;
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

function renderHero(job) {
  const url = bestUrl(job);
  const frame = $("heroFrame");
  const download = $("downloadBtn");
  if (url) {
    frame.innerHTML = `<img alt="Result preview" />`;
    const img = frame.querySelector("img");
    img.onload = () => scaleHeroImage(img);
    img.src = `${url}?t=${Date.now()}`;
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

export function clearSelection(handlers) {
  state.currentJobId = null;
  setMainMode("empty");
  renderQueue(handlers);
  renderProjectsPane(handlers);
}

export function showCreate(handlers) {
  state.currentJobId = null;
  setMainMode("create");
  history.replaceState(null, "", "/");
  renderQueue(handlers);
  renderProjectsPane(handlers);
}

export function renderJob(job, handlers) {
  upsertJob(job);
  state.currentJobId = job.id;
  setMainMode("job");
  $("jobId").textContent = job.id;
  $("jobStatus").textContent = STATUS_LABELS[job.status] || job.status;
  $("jobStatus").dataset.status = job.status;
  $("jobPrompt").textContent = job.prompt;
  $("resnapK").value = job.k_colors || 16;
  $("resnapPx").value = job.pixel_size != null ? job.pixel_size : "";

  renderStepper(job);
  renderHero(job);

  const urls = job.urls || {};
  const cards = [
    stageCard("raw", urls.raw),
    stageCard("cutout", urls.cutout),
    stageCard("snapped", urls.snapped),
  ];
  if (urls.edited) {
    cards.push(stageCard("edited", urls.edited));
  }
  $("stages").innerHTML = cards.join("");

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

  const canEdit = Boolean(urls.snapped || urls.cutout);
  $("editBtn").disabled = !canEdit || isActive(job.status);
  $("resnapBtn").disabled = !urls.cutout || isActive(job.status);

  renderQueue(handlers);
  renderProjectsPane(handlers);
}
