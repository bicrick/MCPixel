import { api } from "./api.js";
import {
  $,
  ASPECT_TO_SIZE,
  K_PRESETS,
  SIZE_PRESETS,
  bestUrl,
  sortedJobs,
  state,
  toast,
} from "./state.js";

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

export function syncAspectChips() {
  document.querySelectorAll(".aspect-chip").forEach((btn) => {
    const on = btn.dataset.aspect === state.aspectRatio;
    btn.classList.toggle("active", on);
  });
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
  if (job?.image_size && Object.values(ASPECT_TO_SIZE).includes(job.image_size)) {
    const aspect = Object.entries(ASPECT_TO_SIZE).find(
      ([, size]) => size === job.image_size
    )?.[0];
    if (aspect) {
      state.aspectRatio = aspect;
      state.imageSize = job.image_size;
      syncAspectChips();
    }
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
  const isBackground = state.createMode === "background";
  const size = isBackground
    ? { target_width: null, target_height: null }
    : readTargetSize();
  const body = {
    prompt,
    k_colors: readKColors(),
    pixel_size: pixelRaw ? Number(pixelRaw) : null,
    bg_provider: isBackground ? "skip" : $("bgProvider").value,
    wrap_prompt: $("wrapPrompt").checked,
    kind: isBackground ? "background" : "sprite",
    image_size: isBackground ? state.imageSize : "1024x1024",
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

function emptyReferenceLabel() {
  return state.poseMode === "topdown8"
    ? "Add a reference from library, files, or clipboard"
    : "Optional — add a reference from library, files, or clipboard";
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
    labelEl.textContent = hasRef ? label : emptyReferenceLabel();
  }
}

export function clearReference() {
  clearReferencePreviewUrl();
  state.referenceFile = null;
  state.referenceJobId = null;
  const file = $("referenceFile");
  if (file) file.value = "";
  syncReferenceUi({ hasRef: false });
  syncGenerateEnabled();
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
  syncGenerateEnabled();
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
  syncGenerateEnabled();
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

export function syncFacingChips() {
  const selected = state.referenceFacing;
  const compass = $("facingChips");
  if (compass) compass.classList.toggle("facing-empty", !selected);
  document.querySelectorAll(".facing-chip").forEach((btn) => {
    const on = selected && btn.dataset.facing === selected;
    btn.classList.toggle("active", Boolean(on));
    btn.setAttribute("aria-pressed", on ? "true" : "false");
  });
  const row = $("facingRow");
  if (row) row.hidden = state.poseMode !== "topdown8";
  const hint = $("facingHint");
  if (hint) {
    hint.hidden = state.poseMode !== "topdown8";
    hint.textContent = selected
      ? `Reference faces ${selected}.`
      : "Select which way the reference faces.";
  }
  syncGenerateEnabled();
}

export function syncGenerateEnabled() {
  const gen = $("generateBtn");
  if (!gen) return;
  if (state.poseMode !== "topdown8") {
    gen.disabled = false;
    return;
  }
  const hasRef = Boolean(state.referenceFile || state.referenceJobId);
  const hasFacing = Boolean(state.referenceFacing);
  gen.disabled = !(hasRef && hasFacing);
}

export function syncRotationsFormChrome() {
  const rotations = state.poseMode === "topdown8";
  const background = state.createMode === "background";
  const promptField = $("promptField");
  const tip = $("promptInfoTip");
  const prompt = $("prompt");
  const refine = $("refinePromptBtn");
  const refOpt = $("referenceOptionalLabel");
  const refTip = $("referenceInfoTip");
  if (promptField) promptField.hidden = rotations;
  if (tip && !rotations) {
    tip.dataset.tip = background
      ? "Describe the scene or backdrop you want. Mention mood, time of day, and composition. Use ✦ to polish the wording with AI."
      : "Describe the sprite you want. Be concrete about view, palette, and shape. Use ✦ to polish the wording with AI.";
  }
  if (prompt && !rotations) {
    prompt.rows = 6;
    prompt.placeholder = background
      ? "Pixel-art lakeside at sunset, mountains, wooden dock, calm water"
      : "16-color side-view slime, green jelly, cute, game sprite";
  }
  if (refine) refine.hidden = rotations;
  if (refOpt) refOpt.textContent = rotations ? "Required" : "Optional";
  if (refTip) {
    refTip.dataset.tip = rotations
      ? "Required. This sprite becomes the parent facing (no regenerate). Pick which way it already faces on the compass."
      : background
        ? "Optional. Sends an image with your prompt so GPT Image can match style or layout (images.edit)."
        : "Optional. Sends an image with your prompt so GPT Image can match style or pose (images.edit). Pick from library, disk, or clipboard.";
  }
  if (!state.referenceFile && !state.referenceJobId) {
    const labelEl = $("referenceLabel");
    if (labelEl) labelEl.textContent = emptyReferenceLabel();
  }
  syncFacingChips();
}

function syncBgProviderChrome() {
  const bg = $("bgProvider");
  const label = $("bgProviderLabel");
  const tip = $("bgProviderTip");
  const background = state.createMode === "background";
  if (background) {
    if (bg && bg.value !== "skip") {
      state.spriteBgProvider = bg.value;
    }
    if (bg) {
      bg.value = "skip";
      bg.disabled = true;
    }
    if (tip) {
      tip.dataset.tip =
        "Backgrounds skip cutout so the full scene is kept, then pixel-snapped.";
    }
  } else {
    if (bg) {
      bg.disabled = false;
      if (state.spriteBgProvider) bg.value = state.spriteBgProvider;
    }
    if (tip) {
      tip.dataset.tip =
        "How to cut the subject from the background before snap. rembg is local (model via REMBG_MODEL, default u2net); remove.bg needs an API key; Skip keeps the raw plate.";
    }
  }
  if (label) label.classList.toggle("is-locked", background);
}

export function syncCreateChrome() {
  const background = state.createMode === "background";
  const targetRow = $("targetSizeRow");
  const aspectRow = $("aspectRatioRow");
  if (targetRow) targetRow.hidden = background;
  if (aspectRow) aspectRow.hidden = !background;
  syncBgProviderChrome();
  syncRotationsFormChrome();

  const gen = $("generateBtn");
  if (gen) {
    if (state.poseMode === "topdown8") gen.textContent = "Generate 8";
    else if (background) gen.textContent = "Generate background";
    else gen.textContent = "Generate";
  }

  const title = $("createModeTitle");
  const meta = $("createModeMeta");
  if (state.createMode === "background") {
    if (title) title.textContent = "Create background";
    if (meta) {
      meta.textContent =
        "Pick an aspect ratio for the image canvas. Cutout is skipped; snap still runs.";
    }
  } else if (state.poseMode === "topdown8") {
    if (title) title.textContent = "Create 8 rotations";
    if (meta) {
      meta.textContent =
        "Reference required (≤1024px). Pick which way it faces — that tile is kept; seven others rotate the same pose.";
    }
  } else {
    if (title) title.textContent = "Create sprite";
    if (meta) {
      meta.textContent =
        "Target size is a prompt hint — cutout and snap stay the same.";
    }
  }
}

export function syncCreateNav() {
  const spriteBar = $("spriteModeBar");
  const textureBar = $("textureModeBar");
  if (spriteBar) spriteBar.hidden = state.createCategory !== "sprite";
  if (textureBar) textureBar.hidden = state.createCategory !== "texture";

  document.querySelectorAll(".create-category-tab").forEach((tab) => {
    const on = tab.dataset.createCategory === state.createCategory;
    tab.classList.toggle("active", on);
    tab.setAttribute("aria-selected", on ? "true" : "false");
  });

  document.querySelectorAll(".create-mode-tab").forEach((tab) => {
    const mode = tab.dataset.createMode;
    if (mode === "animation") return;
    const on = mode === state.createMode;
    tab.classList.toggle("active", on);
    tab.setAttribute("aria-selected", on ? "true" : "false");
  });
}

export function setCreateCategory(category, { open = true, onOpen } = {}) {
  const next = category === "texture" ? "texture" : "sprite";
  state.createCategory = next;
  if (next === "texture") {
    setCreateMode("background", { open, onOpen });
  } else if (state.createMode === "background" || state.createMode === "animation") {
    setCreateMode("sprite", { open, onOpen });
  } else {
    setCreateMode(state.createMode, { open, onOpen });
  }
}

export function setCreateMode(mode, { open = true, onOpen } = {}) {
  let next = mode;
  if (next === "rotations") next = "rotations";
  else if (next === "background") next = "background";
  else if (next === "animation") return;
  else next = "sprite";

  state.createMode = next;
  if (next === "background") {
    state.createCategory = "texture";
    state.poseMode = "none";
    state.referenceFacing = null;
  } else if (next === "rotations") {
    state.createCategory = "sprite";
    state.poseMode = "topdown8";
    state.referenceFacing = null;
  } else {
    state.createCategory = "sprite";
    state.poseMode = "none";
  }

  syncCreateNav();
  syncCreateChrome();
  if (open) onOpen?.();
}

/** @deprecated prefer setCreateMode — kept for call sites that only toggle pose */
export function setPoseMode(pose) {
  setCreateMode(pose === "topdown8" ? "rotations" : "sprite");
}

export function syncPoseChips() {
  syncCreateNav();
  syncCreateChrome();
}

export function setReferenceFacing(code) {
  const allowed = new Set(["N", "NE", "E", "SE", "S", "SW", "W", "NW"]);
  const next = String(code || "").toUpperCase();
  if (!allowed.has(next)) return;
  state.referenceFacing = state.referenceFacing === next ? null : next;
  syncFacingChips();
}

export async function generateJob() {
  const body = buildGenerateBody();

  if (state.poseMode === "topdown8") {
    if (!state.referenceFile && !state.referenceJobId) {
      toast("8 directions needs a reference image (library or file, ≤1024px).");
      return null;
    }
    if (!state.referenceFacing) {
      toast("Select which way the reference faces.");
      return null;
    }
  } else if (!body.prompt) {
    toast("Enter a prompt.");
    return null;
  }

  $("generateBtn").disabled = true;
  const queueMsg =
    state.poseMode === "topdown8"
      ? "Queuing 8 directions…"
      : state.createMode === "background"
        ? "Queuing background…"
        : "Queued…";
  toast(queueMsg);
  try {
    if (state.poseMode === "topdown8") {
      return await generateDirectionsBatch(body);
    }
    if (state.referenceFile) {
      const fd = new FormData();
      fd.append("prompt", body.prompt);
      fd.append("reference", state.referenceFile);
      if (body.k_colors == null) fd.append("k_colors", "none");
      else fd.append("k_colors", String(body.k_colors));
      if (body.pixel_size != null) fd.append("pixel_size", String(body.pixel_size));
      fd.append("bg_provider", body.bg_provider);
      fd.append("wrap_prompt", String(body.wrap_prompt));
      fd.append("kind", body.kind);
      fd.append("image_size", body.image_size);
      if (body.target_width) fd.append("target_width", String(body.target_width));
      if (body.target_height) fd.append("target_height", String(body.target_height));
      const res = await fetch("/v1/generate/with-reference", { method: "POST", body: fd });
      const job = await res.json();
      if (!res.ok) throw new Error(formatApiError(job));
      return job;
    }
    return await api("/v1/generate", {
      method: "POST",
      body: JSON.stringify(body),
    });
  } finally {
    syncGenerateEnabled();
  }
}

function formatApiError(payload) {
  if (!payload) return "Request failed";
  if (typeof payload.detail === "string") return payload.detail;
  if (Array.isArray(payload.detail)) {
    return payload.detail.map((d) => d.msg || JSON.stringify(d)).join("; ");
  }
  return payload.detail || payload.message || "Request failed";
}

async function generateDirectionsBatch(body) {
  const facing = state.referenceFacing;
  if (!facing) throw new Error("Select which way the reference faces.");
  const projectName = `8-dir · ${facing}`;
  if (state.referenceFile) {
    const fd = new FormData();
    fd.append("prompt", "");
    fd.append("pose", "topdown8");
    fd.append("reference", state.referenceFile);
    fd.append("reference_facing", facing);
    fd.append("project_name", projectName);
    if (body.k_colors == null) fd.append("k_colors", "none");
    else fd.append("k_colors", String(body.k_colors));
    if (body.pixel_size != null) fd.append("pixel_size", String(body.pixel_size));
    fd.append("bg_provider", body.bg_provider);
    fd.append("wrap_prompt", "false");
    if (body.target_width) fd.append("target_width", String(body.target_width));
    if (body.target_height) fd.append("target_height", String(body.target_height));
    const res = await fetch("/v1/generate/directions", { method: "POST", body: fd });
    const data = await res.json();
    if (!res.ok) throw new Error(formatApiError(data));
    return data;
  }
  return api("/v1/generate/directions", {
    method: "POST",
    body: JSON.stringify({
      ...body,
      prompt: "",
      pose: "topdown8",
      project_name: projectName,
      reference_facing: facing,
      reference_job_id: state.referenceJobId,
      reference_stage: "snapped",
      wrap_prompt: false,
      kind: "sprite",
      image_size: "1024x1024",
    }),
  });
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
    kind: job.kind || "sprite",
    image_size: job.image_size || "1024x1024",
  };
  toast("Retrying…");
  return api("/v1/generate", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

/** Re-queue the same job id (direction facing or single sprite). */
export async function retryJobInPlace(jobId) {
  toast("Retrying facing…");
  return api(`/v1/jobs/${jobId}/retry`, { method: "POST" });
}

/** Re-queue only incomplete facings in a direction batch. */
export async function retryBatchIncomplete(jobId) {
  toast("Retrying incomplete directions…");
  return api(`/v1/jobs/${jobId}/batch/retry-incomplete`, { method: "POST" });
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

export function bindAspectChips() {
  document.querySelectorAll(".aspect-chip").forEach((btn) => {
    btn.addEventListener("click", () => {
      const aspect = btn.dataset.aspect;
      const size = btn.dataset.imageSize || ASPECT_TO_SIZE[aspect];
      if (!aspect || !size) return;
      state.aspectRatio = aspect;
      state.imageSize = size;
      syncAspectChips();
    });
  });
  syncAspectChips();
}

export function bindPoseChips() {
  document.querySelectorAll(".facing-chip").forEach((btn) => {
    btn.addEventListener("click", () => setReferenceFacing(btn.dataset.facing));
    btn.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        setReferenceFacing(btn.dataset.facing);
      }
    });
  });
  syncPoseChips();
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

  $("bgProvider")?.addEventListener("change", () => {
    if (state.createMode !== "background") {
      state.spriteBgProvider = $("bgProvider").value;
    }
  });

  document.querySelectorAll(".create-category-tab").forEach((tab) => {
    tab.addEventListener("click", () => {
      setCreateCategory(tab.dataset.createCategory, {
        open: true,
        onOpen: onCreateSprite,
      });
    });
  });

  document.querySelectorAll(".create-mode-tab").forEach((tab) => {
    tab.addEventListener("click", () => {
      if (tab.disabled) return;
      setCreateMode(tab.dataset.createMode, {
        open: true,
        onOpen: onCreateSprite,
      });
    });
  });
}
