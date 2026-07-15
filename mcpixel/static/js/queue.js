import { api, escapeHtml } from "./api.js";
import {
  $,
  STATUS_LABELS,
  bestUrl,
  cacheBust,
  failedCount,
  isActive,
  matchesFilter,
  queueFingerprint,
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

function projectPickButtons(jobId) {
  const job = state.jobsById.get(jobId);
  const memberOf = new Set(job?.project_ids || []);
  const available = state.projects.filter((p) => !memberOf.has(p.id));
  const picks = available.length
    ? available
        .map(
          (p) =>
            `<button type="button" data-action="pick-project" data-project-id="${p.id}">${escapeHtml(p.name)}</button>`
        )
        .join("")
    : `<p class="menu-empty">${state.projects.length ? "Already in every project" : "No projects yet"}</p>`;
  return `${picks}<button type="button" data-action="create-then-add">New project…</button>`;
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
    <div class="menu-sub-wrap">
      <button type="button" data-action="add-project" aria-haspopup="true" aria-expanded="false">Add to project…</button>
      <div class="menu-submenu" hidden role="menu">${projectPickButtons(jobId)}</div>
    </div>
    ${membership}
    <button type="button" data-action="delete" class="danger">Delete</button>
  `;
  bindProjectSubmenu(menu);
}

function positionSubmenu(_wrap) {
  // Inline submenu — no positioning needed
}

function openProjectSubmenu(wrap) {
  const sub = wrap?.querySelector(".menu-submenu");
  const trigger = wrap?.querySelector("[data-action='add-project']");
  if (!sub) return;
  sub.hidden = false;
  trigger?.setAttribute("aria-expanded", "true");
}

function closeProjectSubmenu(wrap) {
  const sub = wrap?.querySelector(".menu-submenu");
  const trigger = wrap?.querySelector("[data-action='add-project']");
  if (sub) sub.hidden = true;
  trigger?.setAttribute("aria-expanded", "false");
}

function bindProjectSubmenu(menu) {
  const wrap = menu.querySelector(".menu-sub-wrap");
  if (!wrap) return;
  let leaveTimer = null;
  const clearLeave = () => {
    if (leaveTimer) {
      clearTimeout(leaveTimer);
      leaveTimer = null;
    }
  };
  wrap.addEventListener("mouseenter", () => {
    clearLeave();
    openProjectSubmenu(wrap);
  });
  wrap.addEventListener("mouseleave", () => {
    clearLeave();
    leaveTimer = setTimeout(() => closeProjectSubmenu(wrap), 180);
  });
}

function fillProjectPickMenu(jobId = state.menuJobId) {
  const menu = ensureMenu();
  menu.innerHTML = projectPickButtons(jobId);
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
  menu.style.top = `${Math.min(window.innerHeight - 320, rect.bottom + 4)}px`;
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

function thumbHtml(j) {
  const src = bestUrl(j);
  if (src) {
    return `<img src="${src}?t=${cacheBust(j)}" alt="" data-url="${src}" data-bust="${cacheBust(j)}" />`;
  }
  if (isActive(j.status)) {
    return `<span class="spinner" aria-hidden="true"></span>`;
  }
  return `<span class="meta">${escapeHtml(STATUS_LABELS[j.status] || j.status)}</span>`;
}

function jobRowHtml(j) {
  const dims =
    j.output_width && j.output_height
      ? `<span class="queue-dims">${j.output_width}×${j.output_height}</span>`
      : "";
  const err =
    j.status === "failed" && j.error
      ? `<span class="queue-error" title="${escapeHtml(j.error)}">${escapeHtml(j.error)}</span>`
      : "";
  return `
    <div class="queue-item${j.id === state.currentJobId ? " selected" : ""}" data-id="${j.id}" data-fp="${escapeHtml(
      [
        j.status,
        j.updated_at || "",
        bestUrl(j) || "",
        j.output_width || "",
        j.output_height || "",
      ].join("|")
    )}">
      <button class="queue-row" type="button" data-select="${j.id}">
        <span class="queue-thumb">${thumbHtml(j)}</span>
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
}

function bindQueueEvents(el, handlers) {
  el.querySelectorAll("[data-select]").forEach((btn) => {
    btn.addEventListener("click", () => handlers?.onSelect?.(btn.dataset.select));
  });
  el.querySelectorAll("[data-menu]").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      if (handlers?.onOpenMenu) {
        handlers.onOpenMenu(btn.dataset.menu, btn);
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
}

function patchQueueItem(item, j) {
  item.classList.toggle("selected", j.id === state.currentJobId);
  const chip = item.querySelector(".chip");
  if (chip) {
    chip.dataset.status = j.status;
    chip.textContent = STATUS_LABELS[j.status] || j.status;
  }
  const time = item.querySelector(".queue-time");
  if (time) time.textContent = relativeTime(j.updated_at || j.created_at);

  const thumb = item.querySelector(".queue-thumb");
  const src = bestUrl(j);
  const bust = cacheBust(j);
  const img = thumb?.querySelector("img");
  if (src) {
    if (img && img.dataset.url === src && img.dataset.bust === String(bust)) {
      // keep
    } else if (img && img.dataset.url === src) {
      img.dataset.bust = String(bust);
      img.src = `${src}?t=${bust}`;
    } else if (thumb) {
      thumb.innerHTML = thumbHtml(j);
    }
  } else if (thumb && !thumb.querySelector(".spinner") && isActive(j.status)) {
    thumb.innerHTML = thumbHtml(j);
  } else if (thumb && !src && !isActive(j.status)) {
    thumb.innerHTML = thumbHtml(j);
  }

  item.dataset.fp = [j.status, j.updated_at || "", src || "", j.output_width || "", j.output_height || ""].join(
    "|"
  );
}

function tryPatchQueue(el, jobs) {
  const items = [...el.querySelectorAll(".queue-item")];
  if (items.length !== jobs.length) return false;
  for (let i = 0; i < jobs.length; i++) {
    if (items[i].dataset.id !== jobs[i].id) return false;
  }
  jobs.forEach((j, i) => patchQueueItem(items[i], j));
  return true;
}

/**
 * @param {object} handlers
 * @param {{ force?: boolean }} [opts]
 */
export function renderQueue(handlers = {}, opts = {}) {
  const el = $("queue");
  if (!el) return;
  const clearBtn = $("clearFailedBtn");
  const failed = failedCount();
  if (clearBtn) {
    clearBtn.hidden = failed === 0;
    clearBtn.textContent = `Clear failed (${failed})`;
    if (handlers.onClearFailed) clearBtn.onclick = () => handlers.onClearFailed();
  }

  const jobs = sortedJobs().filter(matchesFilter);
  const fp = queueFingerprint(jobs) + `|sel:${state.currentJobId || ""}|f:${state.queueFilter}`;
  if (!opts.force && fp === state.lastQueueFp && el.querySelector(".queue-item, .queue-empty")) {
    // Selection highlight may still need a light touch
    el.querySelectorAll(".queue-item").forEach((item) => {
      item.classList.toggle("selected", item.dataset.id === state.currentJobId);
    });
    return;
  }

  if (!opts.force && jobs.length && tryPatchQueue(el, jobs)) {
    state.lastQueueFp = fp;
    wireMenu(handlers);
    return;
  }

  if (!jobs.length) {
    el.innerHTML = `<p class="queue-empty">No jobs in this filter.</p>`;
  } else {
    el.innerHTML = jobs.map(jobRowHtml).join("");
    bindQueueEvents(el, handlers);
  }

  state.lastQueueFp = fp;
  wireMenu(handlers);
}

function wireMenu(handlers) {
  const menu = ensureMenu();
  menu.onclick = (e) => {
    const btn = e.target.closest("[data-action]");
    if (!btn) return;
    const action = btn.dataset.action;
    const projectId = btn.dataset.projectId || null;
    const jobId = state.menuJobId;
    if (action === "add-project") {
      e.preventDefault();
      e.stopPropagation();
      openProjectSubmenu(btn.closest(".menu-sub-wrap"));
      return;
    }
    e.stopPropagation();
    closeJobMenu();
    handlers?.onMenuAction?.(action, jobId, projectId);
  };
}

export async function deleteJob(jobId) {
  await api(`/v1/jobs/${jobId}`, { method: "DELETE" });
  state.jobsById.delete(jobId);
  state.lastQueueFp = null;
}

export async function clearFailedJobs() {
  const result = await api("/v1/jobs/clear-failed", { method: "POST" });
  for (const [id, job] of [...state.jobsById.entries()]) {
    if (job.status === "failed") state.jobsById.delete(id);
  }
  state.lastQueueFp = null;
  toast(`Cleared ${result.removed || 0} failed job(s).`);
  return result;
}
