import { escapeHtml } from "./api.js";
import { $, bestUrl, cacheBust, sortedJobs, state } from "./state.js";

function libraryJobs() {
  return sortedJobs().filter((j) => j.status === "completed" && bestUrl(j));
}

function libraryFingerprint(jobs) {
  return jobs
    .map((j) => `${j.id}:${j.updated_at || ""}:${bestUrl(j) || ""}`)
    .join("|");
}

/**
 * @param {{ onSelect?: (id: string) => void }} [handlers]
 * @param {{ force?: boolean }} [opts]
 */
export function renderLibrary(handlers = {}, opts = {}) {
  const el = $("libraryGrid");
  if (!el) return;

  const jobs = libraryJobs();
  const fp = `${libraryFingerprint(jobs)}|sel:${state.currentJobId || ""}`;
  if (!opts.force && fp === state.lastLibraryFp && el.children.length) {
    el.querySelectorAll(".library-item").forEach((item) => {
      item.classList.toggle("selected", item.dataset.id === state.currentJobId);
    });
    return;
  }

  if (!jobs.length) {
    el.innerHTML = `<p class="queue-empty">No completed sprites yet.</p>`;
    state.lastLibraryFp = fp;
    return;
  }

  el.innerHTML = jobs
    .map((j) => {
      const src = bestUrl(j);
      const caption = escapeHtml((j.prompt || j.id || "").slice(0, 40));
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
