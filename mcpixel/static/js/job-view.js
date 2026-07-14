import { escapeHtml } from "./api.js";
import {
  $,
  PIPELINE_STEPS,
  STATUS_LABELS,
  bestUrl,
  isActive,
  state,
  upsertJob,
} from "./state.js";
import { renderQueue } from "./queue.js";

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

function stageCard(name, url, optional) {
  const emptyLabel = optional ? "No edit yet" : "Waiting…";
  return `
    <article class="stage">
      <h3>${escapeHtml(name)}${optional ? `<span class="opt">optional</span>` : ""}</h3>
      ${
        url
          ? `<img src="${url}?t=${Date.now()}" alt="${escapeHtml(name)}" />`
          : `<div class="stage-empty">${emptyLabel}</div>`
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
  $("inspect").hidden = true;
  $("emptyState").hidden = false;
  renderQueue(handlers);
}

export function renderJob(job, handlers) {
  upsertJob(job);
  state.currentJobId = job.id;
  $("emptyState").hidden = true;
  $("inspect").hidden = false;
  $("jobId").textContent = job.id;
  $("jobStatus").textContent = STATUS_LABELS[job.status] || job.status;
  $("jobStatus").dataset.status = job.status;
  $("jobPrompt").textContent = job.prompt;
  $("resnapK").value = job.k_colors || 16;
  $("resnapPx").value = job.pixel_size != null ? job.pixel_size : "";

  renderStepper(job);
  renderHero(job);

  const urls = job.urls || {};
  $("stages").innerHTML = [
    stageCard("raw", urls.raw, false),
    stageCard("cutout", urls.cutout, false),
    stageCard("snapped", urls.snapped, false),
    stageCard("edited", urls.edited, true),
  ].join("");

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
}
