import { escapeHtml } from "./api.js";
import { bindJobMenu } from "./queue.js";
import {
  $,
  bestUrl,
  cacheBust,
  setMainMode,
  sortedJobs,
  state,
} from "./state.js";

const CAPTION_LEN = 22;
const DRAG_TYPE = "text/plain";

/** @type {string | null} */
let draggingJobId = null;

function libraryJobs() {
  const completed = sortedJobs().filter((j) => j.status === "completed" && bestUrl(j));
  const filter = state.libraryFilter || "all";
  if (filter === "all") return completed;
  const project = state.projects.find((p) => p.id === filter);
  const ids = new Set(project?.job_ids || []);
  return completed.filter((j) => ids.has(j.id));
}

function libraryFingerprint(jobs) {
  return jobs
    .map((j) => `${j.id}:${j.updated_at || ""}:${bestUrl(j) || ""}`)
    .join("|");
}

function shortCaption(text) {
  const raw = (text || "").trim();
  if (!raw) return "";
  if (raw.length <= CAPTION_LEN) return raw;
  return `${raw.slice(0, CAPTION_LEN - 1)}…`;
}

function filterLabel() {
  const filter = state.libraryFilter || "all";
  if (filter === "all") return "All completed sprites";
  const project = state.projects.find((p) => p.id === filter);
  return project ? `Project: ${project.name}` : "Completed sprites";
}

function clearDropTargets() {
  document.querySelectorAll(".library-filter.drag-over, .library-filter-row.drag-over").forEach((el) => {
    el.classList.remove("drag-over");
  });
}

function bindProjectDropTarget(el, projectId, handlers) {
  el.addEventListener("dragover", (e) => {
    if (!draggingJobId) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "copy";
    el.classList.add("drag-over");
  });
  el.addEventListener("dragleave", (e) => {
    if (e.relatedTarget && el.contains(e.relatedTarget)) return;
    el.classList.remove("drag-over");
  });
  el.addEventListener("drop", (e) => {
    e.preventDefault();
    clearDropTargets();
    const jobId = draggingJobId || e.dataTransfer.getData(DRAG_TYPE);
    draggingJobId = null;
    if (jobId) handlers?.onDropJob?.(projectId, jobId);
  });
}

/**
 * @param {{
 *   onSelect?: (id: string) => void,
 *   onProjectMenu?: (id: string, btn: HTMLElement) => void,
 *   onDropJob?: (projectId: string, jobId: string) => void,
 * }} [handlers]
 * @param {{ force?: boolean }} [opts]
 */
export function renderLibraryFilters(handlers = {}, opts = {}) {
  const el = $("libraryFilters");
  if (!el) return;

  if (state.libraryFilter === "unfiled") {
    state.libraryFilter = "all";
  }

  const completed = sortedJobs().filter((j) => j.status === "completed" && bestUrl(j));
  const filter = state.libraryFilter || "all";

  const rows = [
    `<button type="button" class="library-filter${filter === "all" ? " active" : ""}" data-library-filter="all">
      <span>All</span><span class="filter-count">${completed.length}</span>
    </button>`,
    ...state.projects.map((p) => {
      const count = (p.job_ids || []).filter((id) => {
        const j = state.jobsById.get(id);
        return j && j.status === "completed" && bestUrl(j);
      }).length;
      return `
        <div class="library-filter-row" data-drop-project="${p.id}">
          <button type="button" class="library-filter${filter === p.id ? " active" : ""}" data-library-filter="${p.id}">
            <span>${escapeHtml(p.name)}</span><span class="filter-count">${count}</span>
          </button>
          <button type="button" class="menu-btn" data-project-menu="${p.id}" aria-label="Project actions">⋯</button>
        </div>
      `;
    }),
  ];

  el.innerHTML = rows.join("");

  el.querySelectorAll("[data-library-filter]").forEach((btn) => {
    btn.addEventListener("click", () => {
      state.libraryFilter = btn.dataset.libraryFilter;
      state.lastLibraryFp = null;
      renderLibraryFilters(handlers, { force: true });
      renderLibrary(handlers, { force: true });
    });
  });
  el.querySelectorAll("[data-project-menu]").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      handlers?.onProjectMenu?.(btn.dataset.projectMenu, btn);
    });
  });
  el.querySelectorAll("[data-drop-project]").forEach((row) => {
    bindProjectDropTarget(row, row.dataset.dropProject, handlers);
  });
}

/**
 * @param {{
 *   onSelect?: (id: string) => void,
 *   onOpenMenu?: (id: string, btn: HTMLElement, opts?: object) => void,
 *   onDropJob?: (projectId: string, jobId: string) => void,
 * }} [handlers]
 * @param {{ force?: boolean }} [opts]
 */
export function renderLibrary(handlers = {}, opts = {}) {
  const el = $("libraryGrid");
  if (!el) return;

  const jobs = libraryJobs();
  const fp = `${libraryFingerprint(jobs)}|sel:${state.currentJobId || ""}|f:${state.libraryFilter || "all"}`;
  if (!opts.force && fp === state.lastLibraryFp && el.children.length) {
    el.querySelectorAll(".library-item").forEach((item) => {
      item.classList.toggle("selected", item.dataset.id === state.currentJobId);
    });
    return;
  }

  const meta = $("libraryViewMeta");
  if (meta) meta.textContent = filterLabel();

  if (!jobs.length) {
    el.innerHTML = `<p class="queue-empty">No completed sprites in this view.</p>`;
    state.lastLibraryFp = fp;
    return;
  }

  el.innerHTML = jobs
    .map((j) => {
      const src = bestUrl(j);
      const caption = escapeHtml(shortCaption(j.prompt || j.id || ""));
      const selected = j.id === state.currentJobId ? " selected" : "";
      return `
        <div class="library-item${selected}" data-id="${j.id}" draggable="true" title="${escapeHtml(j.prompt || j.id)}">
          <button type="button" class="library-item-select" data-select="${j.id}">
            <img src="${src}?t=${cacheBust(j)}" alt="" draggable="false" />
            <span class="library-caption">${caption}</span>
          </button>
          <button type="button" class="menu-btn" data-menu="${j.id}" aria-label="Job actions" aria-expanded="false" aria-haspopup="menu">⋯</button>
        </div>
      `;
    })
    .join("");

  el.querySelectorAll(".library-item").forEach((card) => {
    let suppressClick = false;
    card.addEventListener("dragstart", (e) => {
      if (e.target.closest(".menu-btn")) {
        e.preventDefault();
        return;
      }
      suppressClick = true;
      draggingJobId = card.dataset.id;
      card.classList.add("dragging");
      e.dataTransfer.setData(DRAG_TYPE, card.dataset.id);
      e.dataTransfer.effectAllowed = "copy";
    });
    card.addEventListener("dragend", () => {
      card.classList.remove("dragging");
      draggingJobId = null;
      clearDropTargets();
      setTimeout(() => {
        suppressClick = false;
      }, 0);
    });
    card.querySelector("[data-select]")?.addEventListener("click", (e) => {
      if (suppressClick) {
        e.preventDefault();
        e.stopPropagation();
        return;
      }
      handlers?.onSelect?.(card.dataset.id);
    });
    card.querySelector("[data-menu]")?.addEventListener("click", (e) => {
      e.stopPropagation();
      const btn = e.currentTarget;
      handlers?.onOpenMenu?.(btn.dataset.menu, btn, {});
    });
  });

  bindJobMenu(handlers);
  state.lastLibraryFp = fp;
}

export function showLibraryExplorer(handlers = {}) {
  state.currentJobId = null;
  state.paintedJobId = null;
  state.lastJobFp = null;
  state.libraryReturn = false;
  setMainMode("library");
  history.replaceState(null, "", "/");
  const bar = $("jobProgress");
  if (bar) bar.hidden = true;
  renderLibraryFilters(handlers, { force: true });
  renderLibrary(handlers, { force: true });
}
