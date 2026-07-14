const $ = (id) => document.getElementById(id);

const ACTIVE_STATUSES = new Set([
  "queued",
  "generating",
  "removing_background",
  "snapping",
]);

const PIPELINE_STEPS = [
  { key: "queued", label: "Queued" },
  { key: "generating", label: "Generate" },
  { key: "removing_background", label: "Cutout" },
  { key: "snapping", label: "Snap" },
  { key: "completed", label: "Done" },
];

const STATUS_LABELS = {
  queued: "queued",
  generating: "generating",
  removing_background: "cutout",
  snapping: "snapping",
  completed: "done",
  failed: "failed",
};

let currentJobId = null;
let jobsById = new Map();
let queueFilter = "all";
let pollTimer = null;
let toastTimer = null;

let editor = {
  tool: "pencil",
  color: [31, 111, 74, 255],
  scale: 12,
  width: 0,
  height: 0,
  pixels: null,
  undo: [],
  redo: [],
};

function setStatus(msg) {
  $("status").textContent = msg || "";
}

function toast(msg) {
  setStatus(msg);
  clearTimeout(toastTimer);
  if (msg) {
    toastTimer = setTimeout(() => {
      if ($("status").textContent === msg) setStatus("");
    }, 4000);
  }
}

async function api(path, options = {}) {
  const headers = { ...(options.headers || {}) };
  if (options.body && !(options.body instanceof FormData)) {
    headers["Content-Type"] = "application/json";
  }
  const res = await fetch(path, { ...options, headers });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.detail || data.message || res.statusText);
  return data;
}

function escapeHtml(str) {
  return String(str ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function bestUrl(job) {
  const urls = job?.urls || {};
  return urls.edited || urls.snapped || urls.cutout || urls.raw || null;
}

function isActive(status) {
  return ACTIVE_STATUSES.has(status);
}

function matchesFilter(job) {
  if (queueFilter === "all") return true;
  if (queueFilter === "active") return isActive(job.status);
  if (queueFilter === "done") return job.status === "completed";
  if (queueFilter === "failed") return job.status === "failed";
  return true;
}

function relativeTime(iso) {
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

function cacheJobs(jobs) {
  for (const job of jobs) {
    jobsById.set(job.id, job);
  }
}

function upsertJob(job) {
  jobsById.set(job.id, job);
}

function sortedJobs() {
  return [...jobsById.values()].sort((a, b) => {
    const ta = Date.parse(a.updated_at || a.created_at || 0) || 0;
    const tb = Date.parse(b.updated_at || b.created_at || 0) || 0;
    return tb - ta;
  });
}

function anyActive() {
  return sortedJobs().some((j) => isActive(j.status));
}

function ensurePolling() {
  if (anyActive()) {
    if (!pollTimer) {
      pollTimer = setInterval(() => {
        refreshQueue().catch((e) => toast(e.message));
      }, 1500);
    }
  } else if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
}

function renderQueue() {
  const el = $("queue");
  const jobs = sortedJobs().filter(matchesFilter);
  if (!jobs.length) {
    el.innerHTML = `<p class="queue-empty">No jobs in this filter.</p>`;
    return;
  }
  el.innerHTML = jobs
    .map((j) => {
      const src = bestUrl(j);
      const thumb = src
        ? `<img src="${src}?t=${Date.parse(j.updated_at || j.created_at) || Date.now()}" alt="" />`
        : isActive(j.status)
          ? `<span class="spinner" aria-hidden="true"></span>`
          : `<span class="meta">${escapeHtml(STATUS_LABELS[j.status] || j.status)}</span>`;
      const err =
        j.status === "failed" && j.error
          ? `<span class="queue-error" title="${escapeHtml(j.error)}">${escapeHtml(j.error)}</span>`
          : "";
      return `
        <button class="queue-row${j.id === currentJobId ? " selected" : ""}" data-id="${j.id}" type="button">
          <span class="queue-thumb">${thumb}</span>
          <span class="queue-meta">
            <span class="queue-prompt" title="${escapeHtml(j.prompt)}">${escapeHtml(j.prompt)}</span>
            <span class="queue-sub">
              <span class="chip" data-status="${escapeHtml(j.status)}">${escapeHtml(STATUS_LABELS[j.status] || j.status)}</span>
              <span class="queue-time">${escapeHtml(relativeTime(j.updated_at || j.created_at))}</span>
            </span>
            ${err}
          </span>
        </button>
      `;
    })
    .join("");

  el.querySelectorAll(".queue-row").forEach((btn) => {
    btn.addEventListener("click", () => selectJob(btn.dataset.id));
  });
}

function stepStates(job) {
  const status = job.status;
  if (status === "failed") {
    const failedAt = job.stage_error || "generating";
    return PIPELINE_STEPS.map((step) => {
      if (step.key === "completed") return "todo";
      const order = PIPELINE_STEPS.findIndex((s) => s.key === step.key);
      const failOrder = PIPELINE_STEPS.findIndex((s) => s.key === failedAt);
      if (failOrder < 0) {
        return step.key === "generating" ? "failed" : order < 1 ? "done" : "todo";
      }
      if (order < failOrder) return "done";
      if (order === failOrder) return "failed";
      return "todo";
    });
  }

  const currentIdx = PIPELINE_STEPS.findIndex((s) => s.key === status);
  return PIPELINE_STEPS.map((step, idx) => {
    if (status === "completed") return "done";
    if (currentIdx < 0) return "todo";
    if (idx < currentIdx) return "done";
    if (idx === currentIdx) return "current";
    return "todo";
  });
}

function renderStepper(job) {
  const states = stepStates(job);
  $("stepper").innerHTML = PIPELINE_STEPS.map((step, i) => {
    return `
      <li class="step" data-state="${states[i]}">
        <span class="step-dot" aria-hidden="true"></span>
        ${escapeHtml(step.label)}
      </li>
    `;
  }).join("");
}

function stageCard(name, url, optional) {
  const emptyLabel = optional ? "No edit yet" : "Waiting…";
  return `
    <article class="stage">
      <h3>${escapeHtml(name)}${optional ? `<span class="opt">optional</span>` : ""}</h3>
      ${
        url
          ? `<img src="${url}?t=${Date.now()}" alt="${escapeHtml(name)}" />`
          : `<div class="stage-empty">${emptyLabel}</div>`
      }
    </article>
  `;
}

function scaleHeroImage(img) {
  const fit = Math.min(420, Math.max(frameInnerSize(), 240));
  const longest = Math.max(img.naturalWidth || 1, img.naturalHeight || 1);
  const scale = Math.max(2, Math.min(16, Math.floor(fit / longest)));
  img.style.width = `${(img.naturalWidth || 0) * scale}px`;
  img.style.height = `${(img.naturalHeight || 0) * scale}px`;
}

function frameInnerSize() {
  const frame = $("heroFrame");
  return Math.max(200, Math.min(frame.clientWidth, frame.clientHeight) - 32);
}

function renderHero(job) {
  const url = bestUrl(job);
  const frame = $("heroFrame");
  const download = $("downloadBtn");
  if (url) {
    frame.innerHTML = `<img alt="Result preview" />`;
    const img = frame.querySelector("img");
    img.onload = () => scaleHeroImage(img);
    img.src = `${url}?t=${Date.now()}`;
    download.hidden = false;
    download.href = url;
    download.download = `${job.id}_best.png`;
  } else if (job.status === "failed") {
    frame.innerHTML = `<p class="meta hero-placeholder">Failed${job.error ? `: ${escapeHtml(job.error)}` : ""}</p>`;
    download.hidden = true;
  } else {
    frame.innerHTML = `<p class="meta hero-placeholder">Working — ${escapeHtml(STATUS_LABELS[job.status] || job.status)}…</p>`;
    download.hidden = true;
  }
}

function renderJob(job) {
  upsertJob(job);
  currentJobId = job.id;
  $("emptyState").hidden = true;
  $("inspect").hidden = false;
  $("jobId").textContent = job.id;
  $("jobStatus").textContent = STATUS_LABELS[job.status] || job.status;
  $("jobStatus").dataset.status = job.status;
  $("jobPrompt").textContent = job.prompt;
  $("resnapK").value = job.k_colors || 16;
  if (job.pixel_size != null) {
    $("resnapPx").value = job.pixel_size;
  } else {
    $("resnapPx").value = "";
  }

  renderStepper(job);
  renderHero(job);

  const urls = job.urls || {};
  $("stages").innerHTML = [
    stageCard("raw", urls.raw, false),
    stageCard("cutout", urls.cutout, false),
    stageCard("snapped", urls.snapped, false),
    stageCard("edited", urls.edited, true),
  ].join("");

  const bits = [];
  if (job.detected_pixel_size) bits.push(`detected ${job.detected_pixel_size}px`);
  if (job.output_width && job.output_height) {
    bits.push(`${job.output_width}×${job.output_height}`);
  }
  if (job.error) bits.push(`error: ${job.error}`);
  $("metaLine").textContent = bits.join(" · ");

  const canEdit = Boolean(urls.snapped || urls.cutout);
  $("editBtn").disabled = !canEdit || isActive(job.status);
  $("resnapBtn").disabled = !urls.cutout || isActive(job.status);

  renderQueue();
  ensurePolling();
}

function clearSelection() {
  currentJobId = null;
  $("inspect").hidden = true;
  $("emptyState").hidden = false;
  renderQueue();
}

async function selectJob(id, { mobileSwitch = true } = {}) {
  try {
    const job = await api(`/v1/jobs/${id}`);
    renderJob(job);
    history.replaceState(null, "", `/?job=${id}`);
    if (mobileSwitch) setMobileTab("job");
  } catch (e) {
    toast(e.message);
  }
}

async function refreshQueue() {
  const data = await api("/v1/jobs?limit=50");
  cacheJobs(data.jobs || []);
  renderQueue();
  if (currentJobId && jobsById.has(currentJobId)) {
    // Refresh selected job detail for live stage URLs
    const detail = await api(`/v1/jobs/${currentJobId}`);
    renderJob(detail);
  } else {
    ensurePolling();
  }
}

async function loadHealth() {
  try {
    const h = await api("/v1/health");
    const dot = $("healthDot");
    const label = $("healthLabel");
    if (!h.openai_configured) {
      dot.dataset.state = "warn";
      label.textContent = "OpenAI key missing";
    } else if (!h.snapper_exists) {
      dot.dataset.state = "warn";
      label.textContent = "Snapper binary missing";
    } else {
      dot.dataset.state = "ok";
      label.textContent = "Ready";
    }
  } catch {
    $("healthDot").dataset.state = "bad";
    $("healthLabel").textContent = "API unreachable";
  }
}

async function generate() {
  const prompt = $("prompt").value.trim();
  if (!prompt) return toast("Enter a prompt.");
  const pixelRaw = $("pixelSize").value;
  const body = {
    prompt,
    k_colors: Number($("kColors").value) || 16,
    pixel_size: pixelRaw ? Number(pixelRaw) : null,
    bg_provider: $("bgProvider").value,
    wrap_prompt: $("wrapPrompt").checked,
  };
  $("generateBtn").disabled = true;
  toast("Queued…");
  try {
    const job = await api("/v1/generate", {
      method: "POST",
      body: JSON.stringify(body),
    });
    upsertJob(job);
    renderJob(job);
    history.replaceState(null, "", `/?job=${job.id}`);
    setMobileTab("job");
    ensurePolling();
  } catch (e) {
    toast(e.message);
  } finally {
    $("generateBtn").disabled = false;
  }
}

async function upload(file) {
  const fd = new FormData();
  fd.append("file", file);
  const k = Number($("kColors").value) || 16;
  const px = $("pixelSize").value;
  const bg = $("bgProvider").value;
  let url = `/v1/process?k_colors=${k}&bg_provider=${bg}`;
  if (px) url += `&pixel_size=${px}`;
  toast("Processing upload…");
  const res = await fetch(url, { method: "POST", body: fd });
  const job = await res.json();
  if (!res.ok) throw new Error(job.detail || "Upload failed");
  upsertJob(job);
  renderJob(job);
  history.replaceState(null, "", `/?job=${job.id}`);
  setMobileTab("job");
  await refreshQueue();
}

async function resnap() {
  if (!currentJobId) return;
  const pixelRaw = $("resnapPx").value;
  const body = {
    k_colors: Number($("resnapK").value) || 16,
    pixel_size: pixelRaw ? Number(pixelRaw) : null,
  };
  toast("Resnapping…");
  $("resnapBtn").disabled = true;
  try {
    const job = await api(`/v1/jobs/${currentJobId}/resnap`, {
      method: "POST",
      body: JSON.stringify(body),
    });
    renderJob(job);
    toast("Resnap done.");
  } catch (e) {
    toast(e.message);
  } finally {
    const job = jobsById.get(currentJobId);
    if (job) {
      $("resnapBtn").disabled = !job.urls?.cutout || isActive(job.status);
    }
  }
}

function rgbaToHex(r, g, b) {
  return (
    "#" +
    [r, g, b]
      .map((v) => v.toString(16).padStart(2, "0"))
      .join("")
  );
}

function hexToRgba(hex) {
  const h = hex.replace("#", "");
  return [
    parseInt(h.slice(0, 2), 16),
    parseInt(h.slice(2, 4), 16),
    parseInt(h.slice(4, 6), 16),
    255,
  ];
}

function pushUndo() {
  editor.undo.push(new Uint8ClampedArray(editor.pixels));
  if (editor.undo.length > 40) editor.undo.shift();
  editor.redo = [];
}

function drawCanvas() {
  const canvas = $("pixelCanvas");
  const ctx = canvas.getContext("2d");
  const { width, height, scale, pixels } = editor;
  canvas.width = width * scale;
  canvas.height = height * scale;
  ctx.imageSmoothingEnabled = false;
  const img = ctx.createImageData(width, height);
  img.data.set(pixels);
  const off = document.createElement("canvas");
  off.width = width;
  off.height = height;
  off.getContext("2d").putImageData(img, 0, 0);
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(off, 0, 0, canvas.width, canvas.height);
}

function buildPalette() {
  const counts = new Map();
  for (let i = 0; i < editor.pixels.length; i += 4) {
    const a = editor.pixels[i + 3];
    if (a === 0) continue;
    const key = `${editor.pixels[i]},${editor.pixels[i + 1]},${editor.pixels[i + 2]}`;
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  const colors = [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 24)
    .map(([k]) => k.split(",").map(Number));
  $("palette").innerHTML =
    `<button class="swatch" title="transparent" data-c="0,0,0,0" style="background:transparent"></button>` +
    colors
      .map(
        ([r, g, b]) =>
          `<button class="swatch" data-c="${r},${g},${b},255" style="background:${rgbaToHex(r, g, b)}"></button>`
      )
      .join("");
  $("palette").querySelectorAll(".swatch").forEach((s) => {
    s.addEventListener("click", () => {
      editor.color = s.dataset.c.split(",").map(Number);
      if (editor.color[3] > 0) {
        $("color").value = rgbaToHex(editor.color[0], editor.color[1], editor.color[2]);
      }
    });
  });
}

function closeEditor() {
  $("editorOverlay").hidden = true;
}

async function openEditor() {
  if (!currentJobId) return;
  const job = await api(`/v1/jobs/${currentJobId}`);
  renderJob(job);
  const url = job.urls?.snapped || job.urls?.cutout;
  if (!url) return toast("No snapped image to edit yet.");
  const img = new Image();
  img.crossOrigin = "anonymous";
  await new Promise((resolve, reject) => {
    img.onload = resolve;
    img.onerror = reject;
    img.src = `${url}?t=${Date.now()}`;
  });
  const c = document.createElement("canvas");
  c.width = img.width;
  c.height = img.height;
  const ctx = c.getContext("2d");
  ctx.drawImage(img, 0, 0);
  const data = ctx.getImageData(0, 0, c.width, c.height);
  editor.width = c.width;
  editor.height = c.height;
  editor.pixels = new Uint8ClampedArray(data.data);
  editor.undo = [];
  editor.redo = [];
  editor.scale = Math.max(4, Math.min(20, Math.floor(480 / Math.max(c.width, c.height))));
  $("editorOverlay").hidden = false;
  buildPalette();
  drawCanvas();
}

function paintAt(clientX, clientY) {
  const canvas = $("pixelCanvas");
  const rect = canvas.getBoundingClientRect();
  const x = Math.floor((clientX - rect.left) / editor.scale);
  const y = Math.floor((clientY - rect.top) / editor.scale);
  if (x < 0 || y < 0 || x >= editor.width || y >= editor.height) return;
  const i = (y * editor.width + x) * 4;
  if (editor.tool === "eyedropper") {
    editor.color = [
      editor.pixels[i],
      editor.pixels[i + 1],
      editor.pixels[i + 2],
      editor.pixels[i + 3],
    ];
    if (editor.color[3] > 0) {
      $("color").value = rgbaToHex(editor.color[0], editor.color[1], editor.color[2]);
    }
    return;
  }
  const col = editor.tool === "eraser" ? [0, 0, 0, 0] : editor.color;
  editor.pixels[i] = col[0];
  editor.pixels[i + 1] = col[1];
  editor.pixels[i + 2] = col[2];
  editor.pixels[i + 3] = col[3];
  drawCanvas();
}

async function saveEdit() {
  if (!currentJobId || !editor.pixels) return;
  const c = document.createElement("canvas");
  c.width = editor.width;
  c.height = editor.height;
  const ctx = c.getContext("2d");
  const img = new ImageData(
    new Uint8ClampedArray(editor.pixels),
    editor.width,
    editor.height
  );
  ctx.putImageData(img, 0, 0);
  const dataUrl = c.toDataURL("image/png");
  const job = await api(`/v1/jobs/${currentJobId}/edit`, {
    method: "POST",
    body: JSON.stringify({ png_base64: dataUrl }),
  });
  renderJob(job);
  toast("Edit saved.");
  await refreshQueue();
}

function setMobileTab(tab) {
  document.querySelector(".app").dataset.mobileTab = tab;
  document.querySelectorAll(".mobile-tab").forEach((btn) => {
    const active = btn.dataset.tab === tab;
    btn.classList.toggle("active", active);
    btn.setAttribute("aria-selected", active ? "true" : "false");
  });
}

// —— Events ——
$("generateBtn").addEventListener("click", generate);
$("resnapBtn").addEventListener("click", resnap);
$("editBtn").addEventListener("click", () => openEditor().catch((e) => toast(e.message)));
$("saveEditBtn").addEventListener("click", () => saveEdit().catch((e) => toast(e.message)));
$("closeEditorBtn").addEventListener("click", closeEditor);
$("upload").addEventListener("change", (e) => {
  const file = e.target.files?.[0];
  if (file) upload(file).catch((err) => toast(err.message));
});
$("color").addEventListener("input", (e) => {
  editor.color = hexToRgba(e.target.value);
});

document.querySelectorAll(".tool").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".tool").forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");
    editor.tool = btn.dataset.tool;
  });
});

document.querySelectorAll(".filter-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    queueFilter = btn.dataset.filter;
    document.querySelectorAll(".filter-btn").forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");
    renderQueue();
  });
});

document.querySelectorAll(".mobile-tab").forEach((btn) => {
  btn.addEventListener("click", () => setMobileTab(btn.dataset.tab));
});

$("editorOverlay").addEventListener("click", (e) => {
  if (e.target === $("editorOverlay")) closeEditor();
});

window.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && !$("editorOverlay").hidden) {
    closeEditor();
  }
});

let painting = false;
$("pixelCanvas").addEventListener("mousedown", (e) => {
  painting = true;
  pushUndo();
  paintAt(e.clientX, e.clientY);
});
window.addEventListener("mouseup", () => {
  painting = false;
});
$("pixelCanvas").addEventListener("mousemove", (e) => {
  if (painting) paintAt(e.clientX, e.clientY);
});

$("undoBtn").addEventListener("click", () => {
  if (!editor.undo.length) return;
  editor.redo.push(new Uint8ClampedArray(editor.pixels));
  editor.pixels = editor.undo.pop();
  drawCanvas();
});
$("redoBtn").addEventListener("click", () => {
  if (!editor.redo.length) return;
  editor.undo.push(new Uint8ClampedArray(editor.pixels));
  editor.pixels = editor.redo.pop();
  drawCanvas();
});

// —— Boot ——
document.querySelector(".app").dataset.mobileTab = "create";
loadHealth();
refreshQueue()
  .then(() => {
    const params = new URLSearchParams(location.search);
    const jobParam = params.get("job");
    if (jobParam) {
      return selectJob(jobParam, { mobileSwitch: true });
    }
    if (!jobsById.size) clearSelection();
  })
  .catch((e) => toast(e.message));
