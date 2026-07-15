/**
 * Shared hero chrome: stage selection, resnap modal, fullscreen lightbox.
 */

import { escapeHtml } from "./api.js";
import { $, STATUS_LABELS, cacheBust, isActive, state } from "./state.js";

export const STAGE_PRIORITY = ["edited", "snapped", "cutout", "raw"];

let bound = false;
let lightboxEscBound = false;
let resnapConfirmHandler = null;
let onStageSelectHandler = null;

export function bestStage(job) {
  const urls = job?.urls || {};
  for (const name of STAGE_PRIORITY) {
    if (urls[name]) return name;
  }
  return null;
}

export function stageUrl(job, stage) {
  if (!job || !stage) return null;
  return job.urls?.[stage] || null;
}

export function resolveSelectedStage(job, { prefer = null, reset = false } = {}) {
  const urls = job?.urls || {};
  if (reset || !prefer || !urls[prefer]) {
    return bestStage(job);
  }
  return prefer;
}

export function attachHeroChrome(frameEl) {
  const wrap = frameEl?.closest(".hero-frame-wrap");
  const chrome = $("heroChrome");
  if (!wrap || !chrome) return chrome;
  if (chrome.parentElement !== wrap) {
    wrap.appendChild(chrome);
  }
  return chrome;
}

/**
 * Sync Edit / Download / Expand visibility for the current image URL.
 * @param {{ url?: string|null, downloadName?: string, canEdit?: boolean, active?: boolean }} opts
 */
export function syncHeroChrome(opts = {}) {
  const chrome = $("heroChrome");
  const download = $("downloadBtn");
  const edit = $("editBtn");
  const expand = $("expandHeroBtn");
  const url = opts.url || null;

  if (chrome) chrome.hidden = !url;
  if (download) {
    download.hidden = !url;
    if (url) {
      download.href = url;
      if (opts.downloadName) download.download = opts.downloadName;
    }
  }
  if (expand) expand.hidden = !url;
  if (edit) edit.disabled = !opts.canEdit || Boolean(opts.active);
}

export function scaleHeroImage(img) {
  const frame = $("heroFrame");
  if (!frame || !img) return;
  const fit = Math.min(
    420,
    Math.max(Math.max(200, Math.min(frame.clientWidth, frame.clientHeight) - 32), 240)
  );
  const longest = Math.max(img.naturalWidth || 1, img.naturalHeight || 1);
  const scale = Math.max(2, Math.min(16, Math.floor(fit / longest)));
  img.style.width = `${(img.naturalWidth || 0) * scale}px`;
  img.style.height = `${(img.naturalHeight || 0) * scale}px`;
}

export function scaleDetailImage(img) {
  const frame = $("batchHeroFrame");
  if (!frame || !img) return;
  const fit = Math.min(360, Math.max(frame.clientWidth - 24, 180));
  const longest = Math.max(img.naturalWidth || 1, img.naturalHeight || 1);
  const scale = Math.max(2, Math.min(16, Math.floor(fit / longest)));
  img.style.width = `${(img.naturalWidth || 0) * scale}px`;
  img.style.height = `${(img.naturalHeight || 0) * scale}px`;
}

function chromeOpts(job, url) {
  const urls = job.urls || {};
  const dir = job.extra?.direction;
  const stage = state.selectedStage || "best";
  return {
    url,
    downloadName: `${job.id}_${dir || stage}.png`,
    canEdit: Boolean(urls.snapped || urls.cutout),
    active: isActive(job.status),
  };
}

/**
 * Mount image / placeholder into a hero frame and sync chrome.
 * @param {object} job
 * @param {HTMLElement} frame
 * @param {(img: HTMLImageElement) => void} scaleFn
 */
export function mountHeroForJob(job, frame, scaleFn) {
  if (!frame) return;
  attachHeroChrome(frame);

  if (isActive(job.status)) {
    frame.innerHTML = `<p class="meta hero-placeholder">Working — ${escapeHtml(
      STATUS_LABELS[job.status] || job.status
    )}…</p>`;
    syncHeroChrome({ url: null, canEdit: false, active: true });
    return;
  }

  let stage = state.selectedStage;
  let url = stageUrl(job, stage);
  if (!url) {
    stage = resolveSelectedStage(job, { reset: true });
    state.selectedStage = stage;
    url = stageUrl(job, stage);
  }
  const bust = cacheBust(job);
  if (url) {
    frame.innerHTML = `<img alt="Result preview" data-url="${url}" data-bust="${bust}" />`;
    const img = frame.querySelector("img");
    img.onload = () => scaleFn(img);
    img.src = `${url}?t=${bust}`;
    syncHeroChrome(chromeOpts(job, url));
  } else if (job.status === "failed" || job.status === "cancelled") {
    const label = job.status === "cancelled" ? "Cancelled" : "Failed";
    frame.innerHTML = `<p class="meta hero-placeholder">${label}${
      job.error && job.status === "failed" ? `: ${escapeHtml(job.error)}` : ""
    }</p>`;
    syncHeroChrome({ url: null, canEdit: false, active: false });
  } else {
    frame.innerHTML = `<p class="meta hero-placeholder">Waiting for output…</p>`;
    syncHeroChrome({ url: null, canEdit: false, active: false });
  }
}

export function markActiveStage(stripEl, selectedStage) {
  if (!stripEl) return;
  stripEl.querySelectorAll(".stage").forEach((el) => {
    const name = el.dataset.stage;
    const hasUrl = Boolean(el.querySelector("img"));
    el.classList.toggle("stage-active", Boolean(selectedStage) && name === selectedStage);
    el.classList.toggle("stage-clickable", hasUrl);
    el.classList.toggle("stage-empty-card", !hasUrl);
    if (hasUrl) {
      el.setAttribute("role", "button");
      el.tabIndex = 0;
      el.setAttribute("aria-pressed", name === selectedStage ? "true" : "false");
    } else {
      el.removeAttribute("role");
      el.removeAttribute("tabindex");
      el.removeAttribute("aria-pressed");
    }
  });
}

export function bindStageStrip(stripEl, onSelect) {
  if (!stripEl || stripEl.dataset.stageBound === "1") return;
  stripEl.dataset.stageBound = "1";
  stripEl.addEventListener("click", (e) => {
    const card = e.target.closest(".stage");
    if (!card || !stripEl.contains(card)) return;
    if (!card.querySelector("img")) return;
    const name = card.dataset.stage;
    if (name) onSelect?.(name);
  });
  stripEl.addEventListener("keydown", (e) => {
    if (e.key !== "Enter" && e.key !== " ") return;
    const card = e.target.closest(".stage");
    if (!card || !stripEl.contains(card) || !card.querySelector("img")) return;
    e.preventDefault();
    const name = card.dataset.stage;
    if (name) onSelect?.(name);
  });
}

export function openResnapModal() {
  const overlay = $("resnapOverlay");
  if (!overlay) return;
  overlay.hidden = false;
  $("resnapK")?.focus();
}

export function closeResnapModal() {
  const overlay = $("resnapOverlay");
  if (overlay) overlay.hidden = true;
}

export function openLightbox(url, bust) {
  const overlay = $("lightboxOverlay");
  const img = $("lightboxImg");
  if (!overlay || !img || !url) return;
  const t = bust != null ? bust : Date.now();
  img.onload = () => scaleLightboxImage(img);
  img.src = `${url}?t=${t}`;
  overlay.hidden = false;
  $("lightboxCloseBtn")?.focus();
}

function scaleLightboxImage(img) {
  if (!img?.naturalWidth || !img?.naturalHeight) return;
  const padding = Math.max(32, Math.min(window.innerWidth * 0.06, 64));
  const availableWidth = Math.max(1, window.innerWidth - padding);
  const availableHeight = Math.max(1, window.innerHeight - padding);
  const scale = Math.min(
    availableWidth / img.naturalWidth,
    availableHeight / img.naturalHeight
  );
  img.style.width = `${Math.round(img.naturalWidth * scale)}px`;
  img.style.height = `${Math.round(img.naturalHeight * scale)}px`;
}

export function closeLightbox() {
  const overlay = $("lightboxOverlay");
  const img = $("lightboxImg");
  if (overlay) overlay.hidden = true;
  if (img) img.removeAttribute("src");
}

export function currentHeroImageUrl() {
  const single = $("heroFrame")?.querySelector("img");
  const batch = $("batchHeroFrame")?.querySelector("img");
  const batchLayout = $("batchJobLayout");
  const img = batchLayout && !batchLayout.hidden ? batch || single : single || batch;
  return img?.dataset?.url || img?.getAttribute("src")?.split("?")[0] || null;
}

export function currentHeroBust() {
  const single = $("heroFrame")?.querySelector("img");
  const batch = $("batchHeroFrame")?.querySelector("img");
  const batchLayout = $("batchJobLayout");
  const img = batchLayout && !batchLayout.hidden ? batch || single : single || batch;
  return img?.dataset?.bust || Date.now();
}

/**
 * @param {{ onResnapConfirm: () => void|Promise<void>, onStageSelect?: (name: string) => void }} handlers
 */
export function bindPreviewChrome(handlers = {}) {
  resnapConfirmHandler = handlers.onResnapConfirm || null;
  onStageSelectHandler = handlers.onStageSelect || null;
  if (bound) return;
  bound = true;

  $("resnapBtn")?.addEventListener("click", () => openResnapModal());
  $("resnapCancelBtn")?.addEventListener("click", () => closeResnapModal());
  $("resnapConfirmBtn")?.addEventListener("click", async () => {
    closeResnapModal();
    await resnapConfirmHandler?.();
  });
  $("resnapOverlay")?.addEventListener("click", (e) => {
    if (e.target === $("resnapOverlay")) closeResnapModal();
  });

  $("expandHeroBtn")?.addEventListener("click", () => {
    const url = currentHeroImageUrl();
    if (url) openLightbox(url, currentHeroBust());
  });
  $("lightboxCloseBtn")?.addEventListener("click", () => closeLightbox());
  $("lightboxOverlay")?.addEventListener("click", (e) => {
    if (e.target === $("lightboxOverlay") || e.target === $("lightboxStage")) {
      closeLightbox();
    }
  });

  if (!lightboxEscBound) {
    lightboxEscBound = true;
    window.addEventListener("resize", () => {
      const lightbox = $("lightboxOverlay");
      const img = $("lightboxImg");
      if (lightbox && !lightbox.hidden && img) scaleLightboxImage(img);
    });
    document.addEventListener("keydown", (e) => {
      if (e.key !== "Escape") return;
      const lightbox = $("lightboxOverlay");
      const resnap = $("resnapOverlay");
      if (lightbox && !lightbox.hidden) {
        e.preventDefault();
        closeLightbox();
        return;
      }
      if (resnap && !resnap.hidden) {
        e.preventDefault();
        closeResnapModal();
      }
    });
  }

  bindStageStrip($("stages"), (name) => onStageSelectHandler?.(name));
  bindStageStrip($("batchStages"), (name) => onStageSelectHandler?.(name));
}
