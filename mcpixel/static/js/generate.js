import { api } from "./api.js";
import { $, K_PRESETS, SIZE_PRESETS, bestUrl, sortedJobs, state, toast } from "./state.js";

export function syncSizeChips() {
  document.querySelectorAll(".size-chip").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.size === state.targetMode);
  });
  const custom = $("customSize");
  if (!custom) return;
  custom.hidden = state.targetMode !== "custom";
  if (state.targetMode === "custom") {
    $("customW").value = state.targetWidth || "";
    $("customH").value = state.targetHeight || "";
  }
}

export function syncKChips() {
  document.querySelectorAll(".k-chip").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.k === state.kMode);
  });
  const hidden = $("kColors");
  if (hidden) hidden.value = state.kMode === "none" ? "" : state.kMode;
}

export function readKColors() {
  if (state.kMode === "none") return null;
  const n = Number(state.kMode);
  return Number.isFinite(n) ? n : 16;
}

export function readTargetSize() {
  if (state.targetMode === "none") {
    return { target_width: null, target_height: null };
  }
  if (state.targetMode === "custom") {
    const w = Number($("customW").value);
    const h = Number($("customH").value);
    if (!w || !h) return { target_width: null, target_height: null };
    state.targetWidth = w;
    state.targetHeight = h;
    return { target_width: w, target_height: h };
  }
  const n = Number(state.targetMode);
  state.targetWidth = n;
  state.targetHeight = n;
  return { target_width: n, target_height: n };
}

export function setTargetFromJob(job) {
  if (job?.target_width && job?.target_height) {
    if (
      job.target_width === job.target_height &&
      SIZE_PRESETS.includes(job.target_width)
    ) {
      state.targetMode = String(job.target_width);
    } else {
      state.targetMode = "custom";
    }
    state.targetWidth = job.target_width;
    state.targetHeight = job.target_height;
    syncSizeChips();
  }
  if (job?.k_colors == null) {
    state.kMode = "none";
  } else if (K_PRESETS.includes(job.k_colors)) {
    state.kMode = String(job.k_colors);
  } else {
    state.kMode = "16";
  }
  syncKChips();
}

export function buildGenerateBody() {
  const prompt = $("prompt").value.trim();
  const pixelRaw = $("pixelSize").value;
  const size = readTargetSize();
  const body = {
    prompt,
    k_colors: readKColors(),
    pixel_size: pixelRaw ? Number(pixelRaw) : null,
    bg_provider: $("bgProvider").value,
    wrap_prompt: $("wrapPrompt").checked,
    ...size,
  };
  if (state.referenceJobId && !state.referenceFile) {
    body.reference_job_id = state.referenceJobId;
    body.reference_stage = "snapped";
  }
  return body;
}

function clearReferencePreviewUrl() {
  if (state.referenceObjectUrl) {
    URL.revokeObjectURL(state.referenceObjectUrl);
    state.referenceObjectUrl = null;
  }
}

function syncReferenceUi({ src = null, label = "", hasRef = false } = {}) {
  const card = $("referenceCard");
  const thumb = $("referenceThumb");
  const placeholder = $("referencePlaceholder");
  const labelEl = $("referenceLabel");
  const clearBtn = $("clearRefBtn");

  if (card) card.classList.toggle("has-ref", hasRef);
  if (clearBtn) clearBtn.hidden = !hasRef;

  if (thumb) {
    if (src) {
      thumb.src = src;
      thumb.hidden = false;
      thumb.alt = label || "Reference";
    } else {
      thumb.removeAttribute("src");
      thumb.alt = "";
      thumb.hidden = true;
    }
  }
  if (placeholder) placeholder.hidden = hasRef;
  if (labelEl) {
    labelEl.textContent = hasRef
      ? label
      : "Optional — add a reference from library, files, or clipboard";
  }
}

export function clearReference() {
  clearReferencePreviewUrl();
  state.referenceFile = null;
  state.referenceJobId = null;
  const file = $("referenceFile");
  if (file) file.value = "";
  syncReferenceUi({ hasRef: false });
}

export function setReferenceFile(file) {
  clearReferencePreviewUrl();
  state.referenceFile = file;
  state.referenceJobId = null;
  state.referenceObjectUrl = URL.createObjectURL(file);
  syncReferenceUi({
    src: state.referenceObjectUrl,
    label: file.name || "Reference file",
    hasRef: true,
  });
}

export function setReferenceJob(job) {
  clearReferencePreviewUrl();
  state.referenceFile = null;
  state.referenceJobId = job.id;
  const url = bestUrl(job);
  const prompt = (job.prompt || "").trim();
  const label = prompt
    ? `${prompt.slice(0, 56)}${prompt.length > 56 ? "…" : ""}`
    : `Job ${job.id}`;
  syncReferenceUi({
    src: url ? `${url}?t=${Date.parse(job.updated_at || "") || 0}` : null,
    label,
    hasRef: true,
  });
}

export async function refinePrompt() {
  const el = $("prompt");
  const prompt = el.value.trim();
  if (!prompt) {
    toast("Enter a prompt first.");
    return;
  }
  const btn = $("refinePromptBtn");
  btn.classList.add("busy");
  btn.disabled = true;
  toast("Refining prompt…");
  try {
    const data = await api("/v1/prompt/refine", {
      method: "POST",
      body: JSON.stringify({ prompt }),
    });
    state.promptBeforeRefine = prompt;
    el.value = data.refined;
    toast("Prompt refined.");
  } catch (e) {
    toast(e.message);
  } finally {
    btn.classList.remove("busy");
    btn.disabled = false;
  }
}

export async function generateJob() {
  const body = buildGenerateBody();
  if (!body.prompt) {
    toast("Enter a prompt.");
    return null;
  }
  $("generateBtn").disabled = true;
  toast("Queued…");
  try {
    if (state.referenceFile) {
      const fd = new FormData();
      fd.append("prompt", body.prompt);
      fd.append("reference", state.referenceFile);
      if (body.k_colors == null) fd.append("k_colors", "none");
      else fd.append("k_colors", String(body.k_colors));
      if (body.pixel_size != null) fd.append("pixel_size", String(body.pixel_size));
      fd.append("bg_provider", body.bg_provider);
      fd.append("wrap_prompt", String(body.wrap_prompt));
      if (body.target_width) fd.append("target_width", String(body.target_width));
      if (body.target_height) fd.append("target_height", String(body.target_height));
      const res = await fetch("/v1/generate/with-reference", { method: "POST", body: fd });
      const job = await res.json();
      if (!res.ok) throw new Error(job.detail || "Generate failed");
      return job;
    }
    return await api("/v1/generate", {
      method: "POST",
      body: JSON.stringify(body),
    });
  } finally {
    $("generateBtn").disabled = false;
  }
}

export async function retryFromJob(job) {
  const body = {
    prompt: job.prompt,
    k_colors: job.k_colors ?? null,
    pixel_size: job.pixel_size ?? null,
    bg_provider: job.bg_provider || "rembg_birefnet",
    wrap_prompt: true,
    target_width: job.target_width ?? null,
    target_height: job.target_height ?? null,
  };
  toast("Retrying…");
  return api("/v1/generate", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export async function uploadFile(file) {
  const fd = new FormData();
  fd.append("file", file);
  const k = readKColors();
  const px = $("pixelSize").value;
  const bg = $("bgProvider").value;
  let url = `/v1/process?bg_provider=${bg}`;
  if (k != null) url += `&k_colors=${k}`;
  else url += `&k_colors=16`;
  if (px) url += `&pixel_size=${px}`;
  toast("Processing upload…");
  const res = await fetch(url, { method: "POST", body: fd });
  const job = await res.json();
  if (!res.ok) throw new Error(job.detail || "Upload failed");
  return job;
}

export function bindSizeChips() {
  document.querySelectorAll(".size-chip").forEach((btn) => {
    btn.addEventListener("click", () => {
      state.targetMode = btn.dataset.size;
      if (SIZE_PRESETS.includes(Number(btn.dataset.size))) {
        const n = Number(btn.dataset.size);
        state.targetWidth = n;
        state.targetHeight = n;
      }
      syncSizeChips();
    });
  });
  $("customW")?.addEventListener("change", () => {
    state.targetWidth = Number($("customW").value) || state.targetWidth;
  });
  $("customH")?.addEventListener("change", () => {
    state.targetHeight = Number($("customH").value) || state.targetHeight;
  });
  syncSizeChips();
}

export function bindKChips() {
  document.querySelectorAll(".k-chip").forEach((btn) => {
    btn.addEventListener("click", () => {
      state.kMode = btn.dataset.k;
      syncKChips();
    });
  });
  syncKChips();
}

export function closeChooseRefMenu() {
  const menu = $("chooseRefMenu");
  const btn = $("chooseRefBtn");
  if (menu) menu.hidden = true;
  if (btn) btn.setAttribute("aria-expanded", "false");
}

export function toggleChooseRefMenu() {
  const menu = $("chooseRefMenu");
  const btn = $("chooseRefBtn");
  if (!menu || !btn) return;
  const open = menu.hidden;
  menu.hidden = !open;
  btn.setAttribute("aria-expanded", open ? "true" : "false");
}

export async function setReferenceFromClipboard() {
  try {
    if (!navigator.clipboard?.read) {
      toast("Clipboard image read is not available in this browser.");
      return;
    }
    const items = await navigator.clipboard.read();
    for (const item of items) {
      const type = item.types.find((t) => t.startsWith("image/"));
      if (!type) continue;
      const blob = await item.getType(type);
      const ext = type.split("/")[1] || "png";
      const file = new File([blob], `clipboard.${ext}`, { type });
      setReferenceFile(file);
      toast("Reference set from clipboard.");
      return;
    }
    toast("No image on the clipboard.");
  } catch (e) {
    toast(e.message || "Could not read clipboard.");
  }
}

export function bindReferenceControls({ onPickJob } = {}) {
  $("referenceFile")?.addEventListener("change", (e) => {
    const file = e.target.files?.[0];
    if (file) setReferenceFile(file);
  });
  $("clearRefBtn")?.addEventListener("click", clearReference);
  $("refinePromptBtn")?.addEventListener("click", () => refinePrompt());

  $("chooseRefBtn")?.addEventListener("click", (e) => {
    e.stopPropagation();
    toggleChooseRefMenu();
  });

  $("chooseRefMenu")?.addEventListener("click", (e) => {
    const item = e.target.closest("[data-ref-source]");
    if (!item) return;
    const source = item.dataset.refSource;
    closeChooseRefMenu();
    if (source === "library") onPickJob?.();
    else if (source === "filesystem") $("referenceFile")?.click();
    else if (source === "clipboard") setReferenceFromClipboard();
  });

  document.addEventListener("click", (e) => {
    if (!e.target.closest("#chooseRefWrap")) closeChooseRefMenu();
  });
}

export function openRefPicker() {
  const overlay = $("refPickerOverlay");
  const list = $("refPickerList");
  if (!overlay || !list) return;
  const jobs = sortedJobs().filter((j) => j.status === "completed" && bestUrl(j));
  if (!jobs.length) {
    list.innerHTML = `<p class="queue-empty">No completed sprites in the library yet.</p>`;
  } else {
    list.innerHTML = jobs
      .map((j) => {
        const src = bestUrl(j);
        const caption = (j.prompt || j.id || "").slice(0, 22).replace(/</g, "&lt;");
        return `
          <button type="button" class="library-item" data-ref-job="${j.id}" title="${(j.prompt || j.id || "").replace(/"/g, "&quot;")}">
            <img src="${src}?t=1" alt="" />
            <span class="library-caption">${caption}</span>
          </button>
        `;
      })
      .join("");
    list.querySelectorAll("[data-ref-job]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const job = state.jobsById.get(btn.dataset.refJob);
        if (job) setReferenceJob(job);
        closeRefPicker();
      });
    });
  }
  overlay.hidden = false;
}

export function closeRefPicker() {
  const overlay = $("refPickerOverlay");
  if (overlay) overlay.hidden = true;
}

export function bindCreateDrop(onFile) {
  const pane = document.querySelector(".create-view");
  if (!pane) return;
  pane.addEventListener("dragover", (e) => {
    e.preventDefault();
    pane.classList.add("drag-over");
  });
  pane.addEventListener("dragleave", () => pane.classList.remove("drag-over"));
  pane.addEventListener("drop", (e) => {
    e.preventDefault();
    pane.classList.remove("drag-over");
    const file = e.dataTransfer?.files?.[0];
    if (file && file.type.startsWith("image/")) onFile(file);
  });
}

export function bindCreateMenu({ onCreateSprite } = {}) {
  const btn = $("newBtn");
  if (!btn) return;
  btn.addEventListener("click", () => {
    if (btn.disabled || state.mainMode === "create") return;
    onCreateSprite?.();
  });

  document.querySelectorAll(".create-mode-tab").forEach((tab) => {
    tab.addEventListener("click", () => {
      if (tab.disabled) return;
      document.querySelectorAll(".create-mode-tab").forEach((t) => {
        const on = t === tab;
        t.classList.toggle("active", on);
        t.setAttribute("aria-selected", on ? "true" : "false");
      });
      const title = $("createModeTitle");
      const meta = $("createModeMeta");
      if (tab.dataset.createMode === "sprite") {
        if (title) title.textContent = "Create sprite";
        if (meta) {
          meta.textContent = "Target size is a prompt hint — cutout and snap stay the same.";
        }
      }
    });
  });
}
