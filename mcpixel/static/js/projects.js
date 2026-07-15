import { api, escapeHtml } from "./api.js";
import {
  $,
  STATUS_LABELS,
  bestUrl,
  cacheBust,
  isActive,
  relativeTime,
  sortedJobs,
  state,
  toast,
  unfiledJobs,
} from "./state.js";

export async function loadProjects() {
  const data = await api("/v1/projects");
  state.projects = data.projects || [];
  return state.projects;
}

export async function createProject(name) {
  const project = await api("/v1/projects", {
    method: "POST",
    body: JSON.stringify({ name }),
  });
  state.projects = [project, ...state.projects.filter((p) => p.id !== project.id)];
  return project;
}

export async function renameProject(projectId, name) {
  const project = await api(`/v1/projects/${projectId}`, {
    method: "PATCH",
    body: JSON.stringify({ name }),
  });
  state.projects = state.projects.map((p) => (p.id === project.id ? project : p));
  return project;
}

export async function deleteProject(projectId) {
  await api(`/v1/projects/${projectId}`, { method: "DELETE" });
  state.projects = state.projects.filter((p) => p.id !== projectId);
  if (state.activeProjectId === projectId) state.activeProjectId = null;
}

export async function addJobToProject(projectId, jobId) {
  const project = await api(`/v1/projects/${projectId}/jobs`, {
    method: "POST",
    body: JSON.stringify({ job_id: jobId }),
  });
  state.projects = state.projects.map((p) => (p.id === project.id ? project : p));
  const job = state.jobsById.get(jobId);
  if (job) {
    const ids = new Set(job.project_ids || []);
    ids.add(projectId);
    job.project_ids = [...ids];
  }
  return project;
}

export async function removeJobFromProject(projectId, jobId) {
  const project = await api(`/v1/projects/${projectId}/jobs/${jobId}`, {
    method: "DELETE",
  });
  state.projects = state.projects.map((p) => (p.id === project.id ? project : p));
  const job = state.jobsById.get(jobId);
  if (job) {
    job.project_ids = (job.project_ids || []).filter((id) => id !== projectId);
  }
  return project;
}

function jobCardHtml(j) {
  const src = bestUrl(j);
  const thumb = src
    ? `<img src="${src}?t=${cacheBust(j)}" alt="" data-url="${src}" />`
    : isActive(j.status)
      ? `<span class="spinner" aria-hidden="true"></span>`
      : `<span class="meta">${escapeHtml(STATUS_LABELS[j.status] || j.status)}</span>`;
  return `
    <div class="queue-item${j.id === state.currentJobId ? " selected" : ""}" data-id="${j.id}">
      <button class="queue-row" type="button" data-select="${j.id}">
        <span class="queue-thumb">${thumb}</span>
        <span class="queue-meta">
          <span class="queue-prompt" title="${escapeHtml(j.prompt)}">${escapeHtml(j.prompt)}</span>
          <span class="queue-sub">
            <span class="chip" data-status="${escapeHtml(j.status)}">${escapeHtml(STATUS_LABELS[j.status] || j.status)}</span>
            <span class="queue-time">${escapeHtml(relativeTime(j.updated_at || j.created_at))}</span>
          </span>
        </span>
      </button>
      <button class="menu-btn" type="button" data-menu="${j.id}" aria-label="Job actions" aria-expanded="false" aria-haspopup="menu">⋯</button>
    </div>
  `;
}

function bindJobList(el, handlers) {
  el.querySelectorAll("[data-select]").forEach((btn) => {
    btn.addEventListener("click", () => handlers?.onSelect?.(btn.dataset.select));
  });
  el.querySelectorAll("[data-menu]").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      handlers?.onOpenMenu?.(btn.dataset.menu, btn);
    });
  });
}

export function renderProjectsPane(handlers = {}) {
  const list = $("projectsList");
  const jobsEl = $("projectJobs");
  if (!list || !jobsEl) return;

  if (state.activeProjectId) {
    list.hidden = true;
    jobsEl.hidden = false;
    const isUnfiled = state.activeProjectId === "unfiled";
    const project = isUnfiled
      ? null
      : state.projects.find((p) => p.id === state.activeProjectId);
    const jobs = isUnfiled
      ? unfiledJobs()
      : sortedJobs().filter((j) => (project?.job_ids || []).includes(j.id));
    const title = isUnfiled ? "Unfiled" : project?.name || "Project";
    jobsEl.innerHTML = `
      <div class="queue-head-row">
        <button type="button" class="secondary topbar-btn" data-back>← Back</button>
        <span class="project-name">${escapeHtml(title)}</span>
      </div>
      ${
        jobs.length
          ? jobs.map(jobCardHtml).join("")
          : `<p class="queue-empty">No jobs in this project.</p>`
      }
    `;
    jobsEl.querySelector("[data-back]")?.addEventListener("click", () => {
      state.activeProjectId = null;
      renderProjectsPane(handlers);
    });
    bindJobList(jobsEl, handlers);
    return;
  }

  list.hidden = false;
  jobsEl.hidden = true;
  const unfiled = unfiledJobs();
  const rows = [
    `
    <div class="project-item">
      <button class="project-row" type="button" data-open="unfiled">
        <span class="project-name">Unfiled</span>
        <span class="project-count">${unfiled.length} job${unfiled.length === 1 ? "" : "s"}</span>
      </button>
    </div>
    `,
    ...state.projects.map(
      (p) => `
      <div class="project-item">
        <button class="project-row" type="button" data-open="${p.id}">
          <span class="project-name">${escapeHtml(p.name)}</span>
          <span class="project-count">${(p.job_ids || []).length} job${(p.job_ids || []).length === 1 ? "" : "s"}</span>
        </button>
        <button class="menu-btn" type="button" data-project-menu="${p.id}" aria-label="Project actions">⋯</button>
      </div>
    `
    ),
  ];
  list.innerHTML = rows.join("") || `<p class="queue-empty">No projects yet.</p>`;

  list.querySelectorAll("[data-open]").forEach((btn) => {
    btn.addEventListener("click", () => {
      state.activeProjectId = btn.dataset.open;
      renderProjectsPane(handlers);
    });
  });
  list.querySelectorAll("[data-project-menu]").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      handlers?.onProjectMenu?.(btn.dataset.projectMenu, btn);
    });
  });
}

export async function promptNewProject() {
  const name = prompt("Project name");
  if (!name?.trim()) return null;
  try {
    const project = await createProject(name.trim());
    toast(`Created “${project.name}”.`);
    return project;
  } catch (e) {
    toast(e.message);
    return null;
  }
}
