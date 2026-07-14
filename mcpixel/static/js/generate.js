import { api } from "./api.js";
import { $, SIZE_PRESETS, state, toast } from "./state.js";

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
}

export function buildGenerateBody() {
  const prompt = $("prompt").value.trim();
  const pixelRaw = $("pixelSize").value;
  const size = readTargetSize();
  return {
    prompt,
    k_colors: Number($("kColors").value) || 16,
    pixel_size: pixelRaw ? Number(pixelRaw) : null,
    bg_provider: $("bgProvider").value,
    wrap_prompt: $("wrapPrompt").checked,
    ...size,
  };
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
    k_colors: job.k_colors || 16,
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
  const k = Number($("kColors").value) || 16;
  const px = $("pixelSize").value;
  const bg = $("bgProvider").value;
  let url = `/v1/process?k_colors=${k}&bg_provider=${bg}`;
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

export function bindCreateDrop(onFile) {
  const pane = document.querySelector(".create-pane");
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
    if (file) onFile(file);
  });
}
