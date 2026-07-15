import { api, escapeHtml } from "./api.js";
import {
  aggregateBatchStatus,
  basePrompt,
  batchFingerprint,
  batchIdOf,
  batchMaster,
  batchProgressLabel,
  batchThumbJob,
  isBatchRowSelected,
  isDirectionBatch,
  queueEntriesFromJobs,
  siblingsForBatch,
} from "./batch.js";
import {
  $,
  STATUS_LABELS,
  bestUrl,
  cacheBust,
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
  const canInPlaceRetry =
    isDirectionBatch(job) &&
    (job?.status === "failed" || job?.status === "cancelled");
  menu.innerHTML = `
    ${isActive(job?.status) ? `<button type="button" data-action="cancel" class="danger">Cancel</button>` : ""}
    ${
      canInPlaceRetry
        ? `<button type="button" data-action="retry-inplace">Retry facing</button>`
        : `<button type="button" data-action="retry">Retry</button>`
    }
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
}

function fillBatchMenu(masterId) {
  const menu = ensureMenu();
  const siblings = siblingsForBatch(batchIdOf(state.jobsById.get(masterId)) || state.currentBatchId);
  const anyActive = siblings.some((j) => isActive(j.status));
  const hasIncomplete = siblings.some((j) => j.status !== "completed");
  const master = batchMaster(siblings) || state.jobsById.get(masterId);
  menu.innerHTML = `
    ${anyActive ? `<button type="button" data-action="cancel-batch" class="danger">Cancel batch</button>` : ""}
    ${
      !anyActive && hasIncomplete
        ? `<button type="button" data-action="retry-incomplete">Retry incomplete</button>`
        : ""
    }
    <button type="button" data-action="copy-batch">Copy prompt</button>
    <div class="menu-sub-wrap">
      <button type="button" data-action="add-project" aria-haspopup="true" aria-expanded="false">Add master to project…</button>
      <div class="menu-submenu" hidden role="menu">${projectPickButtons(master?.id || masterId)}</div>
    </div>
    <button type="button" data-action="delete-batch" class="danger">Delete batch</button>
  `;
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

function toggleProjectSubmenu(wrap) {
  const sub = wrap?.querySelector(".menu-submenu");
  if (!sub) return;
  if (sub.hidden) openProjectSubmenu(wrap);
  else closeProjectSubmenu(wrap);
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

export function openJobMenu(jobId, anchor, opts = {}) {
  const menu = ensureMenu();
  const rect = anchor.getBoundingClientRect();
  state.menuJobId = jobId;
  state.menuMode = opts.batch ? "batch" : "job";
  if (opts.batch) fillBatchMenu(jobId);
  else fillJobMenu(jobId);
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
  const selected = j.id === state.currentJobId && !state.currentBatchId;
  return `
    <div class="queue-item${selected ? " selected" : ""}" data-id="${j.id}" data-kind="job" data-fp="${escapeHtml(
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

function batchRowHtml(entry) {
  const { batchId, master, siblings } = entry;
  const agg = aggregateBatchStatus(siblings);
  const thumbJob = batchThumbJob(siblings);
  const prompt = basePrompt(master);
  const progress = batchProgressLabel(siblings);
  const newest = siblings.reduce(
    (a, b) => ((a.updated_at || a.created_at) > (b.updated_at || b.created_at) ? a : b),
    master
  );
  const selected = isBatchRowSelected(batchId, siblings);
  const fp = batchFingerprint(siblings);
  return `
    <div class="queue-item${selected ? " selected" : ""}" data-id="${master.id}" data-batch="${escapeHtml(
      batchId
    )}" data-kind="batch" data-fp="${escapeHtml(fp)}">
      <button class="queue-row" type="button" data-select="${master.id}" data-select-batch="${escapeHtml(batchId)}">
        <span class="queue-thumb">${thumbHtml(thumbJob || master)}</span>
        <span class="queue-meta">
          <span class="queue-prompt" title="${escapeHtml(prompt)}">${escapeHtml(prompt)}</span>
          <span class="queue-sub">
            <span class="chip" data-status="${escapeHtml(agg)}">${escapeHtml(STATUS_LABELS[agg] || agg)}</span>
            <span class="chip direction-chip">8 dir</span>
            <span class="queue-dims">${escapeHtml(progress)}</span>
            <span class="queue-time">${escapeHtml(relativeTime(newest.updated_at || newest.created_at))}</span>
          </span>
        </span>
      </button>
      <button class="menu-btn" type="button" data-menu="${master.id}" data-menu-batch="${escapeHtml(
        batchId
      )}" aria-label="Batch actions" aria-expanded="false" aria-haspopup="menu">⋯</button>
    </div>
  `;
}

function entryHtml(entry) {
  return entry.kind === "batch" ? batchRowHtml(entry) : jobRowHtml(entry.job);
}

function bindQueueEvents(el, handlers) {
  el.querySelectorAll("[data-select]").forEach((btn) => {
    btn.addEventListener("click", () => handlers?.onSelect?.(btn.dataset.select));
  });
  el.querySelectorAll("[data-menu]").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const isBatch = Boolean(btn.dataset.menuBatch);
      if (handlers?.onOpenMenu) {
        handlers.onOpenMenu(btn.dataset.menu, btn, { batch: isBatch });
        return;
      }
      if (state.menuJobId === btn.dataset.menu && !ensureMenu().hidden) {
        closeJobMenu();
        return;
      }
      closeJobMenu();
      openJobMenu(btn.dataset.menu, btn, { batch: isBatch });
    });
  });
}

function patchQueueItem(item, entry) {
  if (entry.kind === "batch") {
    const { batchId, master, siblings } = entry;
    const agg = aggregateBatchStatus(siblings);
    item.classList.toggle("selected", isBatchRowSelected(batchId, siblings));
    const chip = item.querySelector(".chip:not(.direction-chip)");
    if (chip) {
      chip.dataset.status = agg;
      chip.textContent = STATUS_LABELS[agg] || agg;
    }
    const dims = item.querySelector(".queue-dims");
    if (dims) dims.textContent = batchProgressLabel(siblings);
    const newest = siblings.reduce(
      (a, b) => ((a.updated_at || a.created_at) > (b.updated_at || b.created_at) ? a : b),
      master
    );
    const time = item.querySelector(".queue-time");
    if (time) time.textContent = relativeTime(newest.updated_at || newest.created_at);

    const thumbJob = batchThumbJob(siblings);
    const thumb = item.querySelector(".queue-thumb");
    const src = bestUrl(thumbJob || master);
    const bust = cacheBust(thumbJob || master);
    const img = thumb?.querySelector("img");
    if (src) {
      if (img && img.dataset.url === src && img.dataset.bust === String(bust)) {
        // keep
      } else if (img && img.dataset.url === src) {
        img.dataset.bust = String(bust);
        img.src = `${src}?t=${bust}`;
      } else if (thumb) {
        thumb.innerHTML = thumbHtml(thumbJob || master);
      }
    } else if (thumb) {
      thumb.innerHTML = thumbHtml(thumbJob || master);
    }
    item.dataset.fp = batchFingerprint(siblings);
    return;
  }

  const j = entry.job;
  item.classList.toggle("selected", j.id === state.currentJobId && !state.currentBatchId);
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

function visibleEntries() {
  const all = sortedJobs();
  return queueEntriesFromJobs(all).filter((entry) => {
    if (entry.kind === "job") return matchesFilter(entry.job);
    return entry.siblings.some(matchesFilter);
  });
}

function entriesFingerprint(entries) {
  return entries
    .map((e) =>
      e.kind === "batch"
        ? `b:${e.batchId}:${batchFingerprint(e.siblings)}`
        : `j:${e.job.id}:${e.job.status}:${bestUrl(e.job) || ""}`
    )
    .join("|");
}

function tryPatchQueue(el, entries) {
  const items = [...el.querySelectorAll(".queue-item")];
  if (items.length !== entries.length) return false;
  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];
    const id = entry.kind === "batch" ? entry.master.id : entry.job.id;
    const kind = entry.kind;
    if (items[i].dataset.id !== id || items[i].dataset.kind !== kind) return false;
  }
  entries.forEach((entry, i) => patchQueueItem(items[i], entry));
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

  const entries = visibleEntries();
  const fp =
    entriesFingerprint(entries) +
    `|sel:${state.currentJobId || ""}|batch:${state.currentBatchId || ""}|f:${state.queueFilter}`;
  if (!opts.force && fp === state.lastQueueFp && el.querySelector(".queue-item, .queue-empty")) {
    el.querySelectorAll(".queue-item").forEach((item) => {
      if (item.dataset.kind === "batch") {
        const siblings = siblingsForBatch(item.dataset.batch);
        item.classList.toggle("selected", isBatchRowSelected(item.dataset.batch, siblings));
      } else {
        item.classList.toggle("selected", item.dataset.id === state.currentJobId && !state.currentBatchId);
      }
    });
    return;
  }

  if (!opts.force && entries.length && tryPatchQueue(el, entries)) {
    state.lastQueueFp = fp;
    wireMenu(handlers);
    return;
  }

  if (!entries.length) {
    el.innerHTML = `<p class="queue-empty">No jobs in this filter.</p>`;
  } else {
    el.innerHTML = entries.map(entryHtml).join("");
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
      toggleProjectSubmenu(btn.closest(".menu-sub-wrap"));
      return;
    }
    e.stopPropagation();
    closeJobMenu();
    handlers?.onMenuAction?.(action, jobId, projectId);
  };
}

/** Keep the shared job menu wired (e.g. after Library-only refreshes). */
export function bindJobMenu(handlers) {
  wireMenu(handlers);
}

export async function deleteJob(jobId) {
  await api(`/v1/jobs/${jobId}`, { method: "DELETE" });
  state.jobsById.delete(jobId);
  state.lastQueueFp = null;
}

export async function deleteBatch(batchId) {
  const siblings = siblingsForBatch(batchId);
  for (const job of siblings) {
    await api(`/v1/jobs/${job.id}`, { method: "DELETE" });
    state.jobsById.delete(job.id);
  }
  state.lastQueueFp = null;
  return siblings.length;
}

export async function cancelJob(jobId) {
  const job = await api(`/v1/jobs/${jobId}/cancel`, { method: "POST" });
  state.jobsById.set(job.id, job);
  // Direction master cancel may cascade — refresh siblings from list when polling next.
  state.lastQueueFp = null;
  return job;
}

export async function clearFailedJobs() {
  const result = await api("/v1/jobs/clear-failed", { method: "POST" });
  for (const [id, job] of [...state.jobsById.entries()]) {
    if (job.status === "failed" || job.status === "cancelled") {
      state.jobsById.delete(id);
    }
  }
  state.lastQueueFp = null;
  toast(`Cleared ${result.removed || 0} failed job(s).`);
  return result;
}

export { isDirectionBatch };
