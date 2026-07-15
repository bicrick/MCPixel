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
export const K_PRESETS = [2, 4, 8, 16, 32, 64];

/** Discrete stage weights — no streaming % from providers. */
export const PROGRESS_BY_STATUS = {
  queued: 8,
  generating: 30,
  removing_background: 60,
  snapping: 85,
  completed: 100,
  failed: 0,
};

export const state = {
  currentJobId: null,
  mainMode: "empty", // empty | create | job
  railTab: "queue", // queue | library | projects
  lastLibraryFp: null,
  jobsById: new Map(),
  projects: [],
  activeProjectId: null, // null = list; "unfiled" | project id when drilled in
  queueFilter: "all",
  pollTimer: null,
  toastTimer: null,
  targetMode: "64",
  targetWidth: 64,
  targetHeight: 64,
  kMode: "16", // "none" | "2"|"4"|...
  referenceFile: null,
  referenceJobId: null,
  referenceObjectUrl: null,
  promptBeforeRefine: null,
  menuJobId: null,
  menuMode: "job", // job | project-pick
  lastQueueFp: null,
  lastJobFp: null,
  paintedJobId: null,
};

export function $(id) {
  return document.getElementById(id);
}

export function isActive(status) {
  return ACTIVE_STATUSES.has(status);
}

export function stageFlags(job) {
  const urls = job?.urls || {};
  const stages = job?.stages || {};
  return ["raw", "cutout", "snapped", "edited"]
    .map((k) => (urls[k] || stages[k] ? k[0] : "-"))
    .join("");
}

export function jobFingerprint(job) {
  if (!job) return "";
  return [
    job.id,
    job.status,
    job.updated_at || "",
    stageFlags(job),
    job.error || "",
    job.output_width || "",
    job.output_height || "",
  ].join("|");
}

export function queueFingerprint(jobs) {
  return jobs.map(jobFingerprint).join(";");
}

export function progressPercent(job) {
  if (!job) return 0;
  if (job.status === "failed") {
    const failedAt = job.stage_error || "generating";
    const idx = PIPELINE_STEPS.findIndex((s) => s.key === failedAt);
    if (idx <= 0) return 8;
    return PROGRESS_BY_STATUS[PIPELINE_STEPS[idx - 1]?.key] || 8;
  }
  return PROGRESS_BY_STATUS[job.status] ?? 0;
}

export function cacheBust(job) {
  return Date.parse(job?.updated_at || job?.created_at || "") || 0;
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

export function setMainMode(mode) {
  state.mainMode = mode;
  const app = document.querySelector(".app");
  if (app) app.dataset.main = mode;
  const empty = $("emptyState");
  const create = $("createView");
  const inspect = $("inspect");
  if (empty) empty.hidden = mode !== "empty";
  if (create) create.hidden = mode !== "create";
  if (inspect) inspect.hidden = mode !== "job";
  const newBtn = $("newBtn");
  if (newBtn) {
    const onCreate = mode === "create";
    newBtn.disabled = onCreate;
    newBtn.setAttribute("aria-disabled", onCreate ? "true" : "false");
  }
}

export function setRailTab(tab) {
  state.railTab = tab;
  const app = document.querySelector(".app");
  if (app) app.dataset.railTab = tab;
  document.querySelectorAll(".rail-tab").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.rail === tab);
  });
  const queuePane = document.querySelector(".queue-pane");
  const libraryPane = document.querySelector(".library-pane");
  const projectsPane = document.querySelector(".projects-pane");
  if (queuePane) queuePane.hidden = tab !== "queue";
  if (libraryPane) libraryPane.hidden = tab !== "library";
  if (projectsPane) projectsPane.hidden = tab !== "projects";
}

export function filedJobIds() {
  const ids = new Set();
  for (const p of state.projects) {
    for (const id of p.job_ids || []) ids.add(id);
  }
  return ids;
}

export function unfiledJobs() {
  const filed = filedJobIds();
  return sortedJobs().filter((j) => !filed.has(j.id));
}
