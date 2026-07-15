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
  cancelled: "cancelled",
  partial: "partial",
};

export const SIZE_PRESETS = [16, 32, 48, 64];
export const K_PRESETS = [2, 4, 8, 16, 32, 64];
export const ASPECT_TO_SIZE = {
  "1:1": "1024x1024",
  "16:9": "1536x1024",
  "9:16": "1024x1536",
};

/** Discrete stage weights — no streaming % from providers. */
export const PROGRESS_BY_STATUS = {
  queued: 8,
  generating: 30,
  removing_background: 60,
  snapping: 85,
  completed: 100,
  failed: 0,
  cancelled: 0,
};

export const state = {
  currentJobId: null,
  currentBatchId: null,
  selectedDirection: null, // N|NE|... when viewing a batch
  selectedStage: null, // raw|cutout|snapped|edited — drives hero preview
  mainMode: "empty", // empty | create | job | library | settings
  railTab: "queue", // queue | library
  libraryFilter: "all", // all | unfiled | project id
  libraryReturn: false,
  lastLibraryFp: null,
  jobsById: new Map(),
  projects: [],
  activeProjectId: null, // null = list; "unfiled" | project id when drilled in
  queueFilter: "queued",
  pollTimer: null,
  toastTimer: null,
  targetMode: "64",
  targetWidth: 64,
  targetHeight: 64,
  createCategory: "sprite", // sprite | texture
  createMode: "sprite", // sprite | rotations | animation | background
  poseMode: "none", // none | topdown8
  aspectRatio: "16:9", // 1:1 | 16:9 | 9:16
  imageSize: "1536x1024",
  referenceFacing: null, // N|NE|... required before Generate 8
  kMode: "16", // "none" | "2"|"4"|...
  spriteBgProvider: "rembg_birefnet",
  referenceFile: null,
  referenceJobId: null,
  referenceObjectUrl: null,
  promptBeforeRefine: null,
  refineUndoPending: false,
  refineStatusTimer: null,
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
  if (job.status === "failed" || job.status === "cancelled") {
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
  // "queued" = in-flight (queued + generating + cutout + snapping).
  // Legacy "active" / "all" keys still resolve for safety.
  if (state.queueFilter === "queued" || state.queueFilter === "active") {
    return isActive(job.status);
  }
  if (state.queueFilter === "done") return job.status === "completed";
  if (state.queueFilter === "failed") {
    return job.status === "failed" || job.status === "cancelled";
  }
  if (state.queueFilter === "all") return true;
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
  return sortedJobs().filter(
    (j) => j.status === "failed" || j.status === "cancelled"
  ).length;
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
  const library = $("libraryView");
  const settings = $("settingsView");
  if (empty) empty.hidden = mode !== "empty";
  if (create) create.hidden = mode !== "create";
  if (inspect) inspect.hidden = mode !== "job";
  if (library) library.hidden = mode !== "library";
  if (settings) settings.hidden = mode !== "settings";
  const newBtn = $("newBtn");
  if (newBtn) {
    const onCreate = mode === "create";
    newBtn.disabled = onCreate;
    newBtn.setAttribute("aria-disabled", onCreate ? "true" : "false");
  }
  const backBtn = $("backToLibraryBtn");
  if (backBtn) backBtn.hidden = !(mode === "job" && state.libraryReturn);
  const settingsBtn = $("settingsBtn");
  if (settingsBtn) {
    const onSettings = mode === "settings";
    settingsBtn.classList.toggle("active", onSettings);
    if (onSettings) settingsBtn.setAttribute("aria-current", "page");
    else settingsBtn.removeAttribute("aria-current");
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
  if (queuePane) queuePane.hidden = tab !== "queue";
  if (libraryPane) libraryPane.hidden = tab !== "library";
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
