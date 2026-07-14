export const ACTIVE_STATUSES = new Set([
  "queued",
  "generating",
  "removing_background",
  "snapping",
]);

export const PIPELINE_STEPS = [
  { key: "queued", label: "Queued" },
  { key: "generating", label: "Generate" },
  { key: "removing_background", label: "Cutout" },
  { key: "snapping", label: "Snap" },
  { key: "completed", label: "Done" },
];

export const STATUS_LABELS = {
  queued: "queued",
  generating: "generating",
  removing_background: "cutout",
  snapping: "snapping",
  completed: "done",
  failed: "failed",
};

export const SIZE_PRESETS = [16, 32, 48, 64];

export const state = {
  currentJobId: null,
  jobsById: new Map(),
  queueFilter: "all",
  pollTimer: null,
  toastTimer: null,
  targetMode: "64",
  targetWidth: 64,
  targetHeight: 64,
  menuJobId: null,
};

export function $(id) {
  return document.getElementById(id);
}

export function isActive(status) {
  return ACTIVE_STATUSES.has(status);
}

export function bestUrl(job) {
  const urls = job?.urls || {};
  return urls.edited || urls.snapped || urls.cutout || urls.raw || null;
}

export function matchesFilter(job) {
  if (state.queueFilter === "all") return true;
  if (state.queueFilter === "active") return isActive(job.status);
  if (state.queueFilter === "done") return job.status === "completed";
  if (state.queueFilter === "failed") return job.status === "failed";
  return true;
}

export function relativeTime(iso) {
  if (!iso) return "";
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return "";
  const sec = Math.max(0, Math.floor((Date.now() - t) / 1000));
  if (sec < 60) return `${sec}s ago`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 48) return `${hr}h ago`;
  return `${Math.floor(hr / 24)}d ago`;
}

export function upsertJob(job) {
  state.jobsById.set(job.id, job);
}

export function cacheJobs(jobs) {
  for (const job of jobs) upsertJob(job);
}

export function sortedJobs() {
  return [...state.jobsById.values()].sort((a, b) => {
    const ta = Date.parse(a.updated_at || a.created_at || 0) || 0;
    const tb = Date.parse(b.updated_at || b.created_at || 0) || 0;
    return tb - ta;
  });
}

export function anyActive() {
  return sortedJobs().some((j) => isActive(j.status));
}

export function failedCount() {
  return sortedJobs().filter((j) => j.status === "failed").length;
}

export function setStatus(msg) {
  const el = $("status");
  if (el) el.textContent = msg || "";
}

export function toast(msg) {
  setStatus(msg);
  clearTimeout(state.toastTimer);
  if (msg) {
    state.toastTimer = setTimeout(() => {
      if ($("status")?.textContent === msg) setStatus("");
    }, 4000);
  }
}

export function setMobileTab(tab) {
  document.querySelector(".app").dataset.mobileTab = tab;
  document.querySelectorAll(".mobile-tab").forEach((btn) => {
    const active = btn.dataset.tab === tab;
    btn.classList.toggle("active", active);
    btn.setAttribute("aria-selected", active ? "true" : "false");
  });
}

export function applyTheme(theme) {
  const next = theme === "ink" ? "ink" : "forest";
  document.documentElement.dataset.theme = next;
  localStorage.setItem("mcpixel-theme", next);
  document.querySelectorAll(".theme-switch button").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.theme === next);
  });
}

export function initTheme() {
  applyTheme(localStorage.getItem("mcpixel-theme") || "forest");
}
