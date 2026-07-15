import { escapeHtml } from "./api.js";
import {
  $,
  bestUrl,
  cacheBust,
  filedJobIds,
  setMainMode,
  sortedJobs,
  state,
  unfiledJobs,
} from "./state.js";

const CAPTION_LEN = 22;

function libraryJobs() {
  const completed = sortedJobs().filter((j) => j.status === "completed" && bestUrl(j));
  const filter = state.libraryFilter || "all";
  if (filter === "all") return completed;
  if (filter === "unfiled") {
    const filed = filedJobIds();
    return completed.filter((j) => !filed.has(j.id));
  }
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
  if (filter === "unfiled") return "Unfiled sprites";
  const project = state.projects.find((p) => p.id === filter);
  return project ? `Project: ${project.name}` : "Completed sprites";
}

/**
 * @param {{ onSelect?: (id: string) => void, onProjectMenu?: (id: string, btn: HTMLElement) => void }} [handlers]
 * @param {{ force?: boolean }} [opts]
 */
export function renderLibraryFilters(handlers = {}, opts = {}) {
  const el = $("libraryFilters");
  if (!el) return;

  const completed = sortedJobs().filter((j) => j.status === "completed" && bestUrl(j));
  const unfiled = unfiledJobs().filter((j) => j.status === "completed" && bestUrl(j));
  const filter = state.libraryFilter || "all";

  const rows = [
    `<button type="button" class="library-filter${filter === "all" ? " active" : ""}" data-library-filter="all">
      <span>All</span><span class="filter-count">${completed.length}</span>
    </button>`,
    `<button type="button" class="library-filter${filter === "unfiled" ? " active" : ""}" data-library-filter="unfiled">
      <span>Unfiled</span><span class="filter-count">${unfiled.length}</span>
    </button>`,
    ...state.projects.map((p) => {
      const count = (p.job_ids || []).filter((id) => {
        const j = state.jobsById.get(id);
        return j && j.status === "completed" && bestUrl(j);
      }).length;
      return `
        <div class="library-filter-row">
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
}

/**
 * @param {{ onSelect?: (id: string) => void }} [handlers]
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
        <button type="button" class="library-item${selected}" data-id="${j.id}" title="${escapeHtml(j.prompt || j.id)}">
          <img src="${src}?t=${cacheBust(j)}" alt="" />
          <span class="library-caption">${caption}</span>
        </button>
      `;
    })
    .join("");

  el.querySelectorAll(".library-item").forEach((btn) => {
    btn.addEventListener("click", () => handlers?.onSelect?.(btn.dataset.id));
  });

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
