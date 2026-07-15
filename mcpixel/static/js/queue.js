import { api, escapeHtml } from "./api.js";
import {
  $,
  STATUS_LABELS,
  bestUrl,
  failedCount,
  isActive,
  matchesFilter,
  relativeTime,
  sortedJobs,
  state,
  toast,
} from "./state.js";

let menuEl = null;

function ensureMenu() {
  if (menuEl) return menuEl;
  menuEl = document.createElement("div");
  menuEl.id = "jobMenu";
  menuEl.className = "menu-popover";
  menuEl.hidden = true;
  document.body.appendChild(menuEl);
  return menuEl;
}

export function closeJobMenu() {
  const menu = ensureMenu();
  menu.hidden = true;
  state.menuJobId = null;
  state.menuMode = "job";
  document.querySelectorAll(".menu-btn[aria-expanded='true']").forEach((b) => {
    b.setAttribute("aria-expanded", "false");
  });
}

function fillJobMenu(jobId) {
  const menu = ensureMenu();
  const job = state.jobsById.get(jobId);
  const projectIds = job?.project_ids || [];
  const membership = projectIds.length
    ? projectIds
        .map((pid) => {
          const p = state.projects.find((x) => x.id === pid);
          return `<button type="button" data-action="remove-project" data-project-id="${pid}">Remove from ${escapeHtml(p?.name || pid)}</button>`;
        })
        .join("")
    : "";
  menu.innerHTML = `
    <button type="button" data-action="retry">Retry</button>
    <button type="button" data-action="duplicate">Duplicate</button>
    <button type="button" data-action="resnap">Resnap</button>
    <button type="button" data-action="copy">Copy prompt</button>
    <button type="button" data-action="download">Download</button>
    <button type="button" data-action="add-project">Add to project…</button>
    ${membership}
    <button type="button" data-action="delete" class="danger">Delete</button>
  `;
}

function fillProjectPickMenu() {
  const menu = ensureMenu();
  if (!state.projects.length) {
    menu.innerHTML = `<button type="button" data-action="create-then-add">New project…</button>`;
    return;
  }
  menu.innerHTML = [
    ...state.projects.map(
      (p) =>
        `<button type="button" data-action="pick-project" data-project-id="${p.id}">${escapeHtml(p.name)}</button>`
    ),
    `<button type="button" data-action="create-then-add">New project…</button>`,
  ].join("");
}

function fillProjectActionsMenu(projectId) {
  const menu = ensureMenu();
  menu.innerHTML = `
    <button type="button" data-action="rename-project" data-project-id="${projectId}">Rename</button>
    <button type="button" data-action="delete-project" data-project-id="${projectId}" class="danger">Delete project</button>
  `;
}

export function openJobMenu(jobId, anchor) {
  const menu = ensureMenu();
  const rect = anchor.getBoundingClientRect();
  state.menuJobId = jobId;
  state.menuMode = "job";
  fillJobMenu(jobId);
  menu.hidden = false;
  menu.style.top = `${Math.min(window.innerHeight - 260, rect.bottom + 4)}px`;
  menu.style.left = `${Math.max(8, Math.min(window.innerWidth - 180, rect.right - 160))}px`;
  anchor.setAttribute("aria-expanded", "true");
}

export function openProjectPickMenu(jobId, anchor) {
  const menu = ensureMenu();
  const rect = anchor.getBoundingClientRect();
  state.menuJobId = jobId;
  state.menuMode = "project-pick";
  fillProjectPickMenu();
  menu.hidden = false;
  menu.style.top = `${Math.min(window.innerHeight - 220, rect.bottom + 4)}px`;
  menu.style.left = `${Math.max(8, Math.min(window.innerWidth - 180, rect.right - 160))}px`;
}

export function openProjectMenu(projectId, anchor) {
  const menu = ensureMenu();
  const rect = anchor.getBoundingClientRect();
  state.menuJobId = null;
  state.menuMode = "project-actions";
  fillProjectActionsMenu(projectId);
  menu.hidden = false;
  menu.style.top = `${Math.min(window.innerHeight - 120, rect.bottom + 4)}px`;
  menu.style.left = `${Math.max(8, Math.min(window.innerWidth - 180, rect.right - 160))}px`;
  anchor.setAttribute("aria-expanded", "true");
}

export function renderQueue({ onSelect, onMenuAction, onClearFailed, onOpenMenu } = {}) {
  const el = $("queue");
  const clearBtn = $("clearFailedBtn");
  const failed = failedCount();
  if (clearBtn) {
    clearBtn.hidden = failed === 0;
    clearBtn.textContent = `Clear failed (${failed})`;
  }

  const jobs = sortedJobs().filter(matchesFilter);
  if (!jobs.length) {
    el.innerHTML = `<p class="queue-empty">No jobs in this filter.</p>`;
  } else {
    el.innerHTML = jobs
      .map((j) => {
        const src = bestUrl(j);
        const thumb = src
          ? `<img src="${src}?t=${Date.parse(j.updated_at || j.created_at) || Date.now()}" alt="" />`
          : isActive(j.status)
            ? `<span class="spinner" aria-hidden="true"></span>`
            : `<span class="meta">${escapeHtml(STATUS_LABELS[j.status] || j.status)}</span>`;
        const dims =
          j.output_width && j.output_height
            ? `<span class="queue-dims">${j.output_width}×${j.output_height}</span>`
            : "";
        const err =
          j.status === "failed" && j.error
            ? `<span class="queue-error" title="${escapeHtml(j.error)}">${escapeHtml(j.error)}</span>`
            : "";
        return `
          <div class="queue-item${j.id === state.currentJobId ? " selected" : ""}" data-id="${j.id}">
            <button class="queue-row" type="button" data-select="${j.id}">
              <span class="queue-thumb">${thumb}</span>
              <span class="queue-meta">
                <span class="queue-prompt" title="${escapeHtml(j.prompt)}">${escapeHtml(j.prompt)}</span>
                <span class="queue-sub">
                  <span class="chip" data-status="${escapeHtml(j.status)}">${escapeHtml(STATUS_LABELS[j.status] || j.status)}</span>
                  ${dims}
                  <span class="queue-time">${escapeHtml(relativeTime(j.updated_at || j.created_at))}</span>
                </span>
                ${err}
              </span>
            </button>
            <button class="menu-btn" type="button" data-menu="${j.id}" aria-label="Job actions" aria-expanded="false" aria-haspopup="menu">⋯</button>
          </div>
        `;
      })
      .join("");
  }

  el.querySelectorAll("[data-select]").forEach((btn) => {
    btn.addEventListener("click", () => onSelect?.(btn.dataset.select));
  });
  el.querySelectorAll("[data-menu]").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      if (onOpenMenu) {
        onOpenMenu(btn.dataset.menu, btn);
        return;
      }
      if (state.menuJobId === btn.dataset.menu && !ensureMenu().hidden) {
        closeJobMenu();
        return;
      }
      closeJobMenu();
      openJobMenu(btn.dataset.menu, btn);
    });
  });

  if (clearBtn && onClearFailed) {
    clearBtn.onclick = () => onClearFailed();
  }

  const menu = ensureMenu();
  menu.onclick = (e) => {
    const btn = e.target.closest("[data-action]");
    if (!btn) return;
    const action = btn.dataset.action;
    const projectId = btn.dataset.projectId || null;
    const jobId = state.menuJobId;
    if (action === "add-project" && jobId) {
      state.menuMode = "project-pick";
      fillProjectPickMenu();
      return;
    }
    closeJobMenu();
    onMenuAction?.(action, jobId, projectId);
  };
}

export async function deleteJob(jobId) {
  await api(`/v1/jobs/${jobId}`, { method: "DELETE" });
  state.jobsById.delete(jobId);
}

export async function clearFailedJobs() {
  const result = await api("/v1/jobs/clear-failed", { method: "POST" });
  for (const [id, job] of [...state.jobsById.entries()]) {
    if (job.status === "failed") state.jobsById.delete(id);
  }
  toast(`Cleared ${result.removed || 0} failed job(s).`);
  return result;
}
