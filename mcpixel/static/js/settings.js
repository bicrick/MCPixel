import { api } from "./api.js";
import { confirmDialog } from "./dialogs.js";
import { $, toast } from "./state.js";

let promptsSnapshot = null;

function applySettingsHints(view) {
  $("settingsOpenaiHint").textContent = view.openai_api_key?.configured
    ? `Configured (${view.openai_api_key.hint})`
    : "Not configured";
  $("settingsRemoveBgHint").textContent = view.remove_bg_api_key?.configured
    ? `Configured (${view.remove_bg_api_key.hint})`
    : "Not configured";
  const parallel = $("settingsMaxParallelJobs");
  if (parallel) {
    const min = view.max_parallel_jobs_min ?? 1;
    const max = view.max_parallel_jobs_max ?? 16;
    parallel.min = String(min);
    parallel.max = String(max);
    parallel.value = String(view.max_parallel_jobs ?? 4);
  }
}

export async function openSettings() {
  const overlay = $("settingsOverlay");
  if (!overlay) return;
  overlay.hidden = false;
  $("settingsStatus").textContent = "";
  $("settingsOpenaiKey").value = "";
  $("settingsRemoveBgKey").value = "";
  try {
    const view = await api("/v1/settings");
    applySettingsHints(view);
  } catch (e) {
    $("settingsStatus").textContent = e.message;
  }
}

export function closeSettings() {
  closePrompts();
  const overlay = $("settingsOverlay");
  if (overlay) overlay.hidden = true;
}

export async function saveSettings() {
  const openai = $("settingsOpenaiKey").value.trim();
  const removeBg = $("settingsRemoveBgKey").value.trim();
  const parallelEl = $("settingsMaxParallelJobs");
  const parallelRaw = parallelEl ? Number(parallelEl.value) : NaN;
  const body = {};
  if (openai) body.openai_api_key = openai;
  if (removeBg) body.remove_bg_api_key = removeBg;
  if (Number.isFinite(parallelRaw)) {
    body.max_parallel_jobs = Math.max(1, Math.min(16, Math.round(parallelRaw)));
  }
  if (!openai && !removeBg && body.max_parallel_jobs == null) {
    $("settingsStatus").textContent = "Enter a key or change Parallel jobs to save.";
    return null;
  }
  $("saveSettingsBtn").disabled = true;
  try {
    const view = await api("/v1/settings", {
      method: "PUT",
      body: JSON.stringify(body),
    });
    $("settingsOpenaiKey").value = "";
    $("settingsRemoveBgKey").value = "";
    applySettingsHints(view);
    $("settingsStatus").textContent = "Saved.";
    toast("Settings saved.");
    return view;
  } catch (e) {
    $("settingsStatus").textContent = e.message;
    throw e;
  } finally {
    $("saveSettingsBtn").disabled = false;
  }
}

export async function clearOpenaiKey() {
  const ok = await confirmDialog("Clear stored OpenAI API key?", {
    title: "Clear OpenAI key",
    confirmLabel: "Clear",
    danger: true,
  });
  if (!ok) return null;
  const view = await api("/v1/settings", {
    method: "PUT",
    body: JSON.stringify({ clear_openai_api_key: true }),
  });
  $("settingsOpenaiHint").textContent = "Not configured";
  $("settingsStatus").textContent = "OpenAI key cleared.";
  toast("OpenAI key cleared.");
  return view;
}

export async function factoryResetSettings() {
  const ok = await confirmDialog(
    "Reset all settings to factory defaults? This clears API keys stored in settings.json, parallel jobs, and all prompt overrides. Env keys in .env are kept.",
    {
      title: "Factory reset settings",
      confirmLabel: "Reset everything",
      danger: true,
    }
  );
  if (!ok) return null;
  const view = await api("/v1/settings", {
    method: "PUT",
    body: JSON.stringify({ factory_reset: true }),
  });
  applySettingsHints(view);
  $("settingsOpenaiKey").value = "";
  $("settingsRemoveBgKey").value = "";
  $("settingsStatus").textContent = "Settings reset to factory defaults.";
  toast("Settings factory-reset.");
  if (!$("promptsOverlay")?.hidden) {
    renderPromptsFields(view.prompts);
    $("promptsStatus").textContent = "Prompts restored to defaults.";
  }
  return view;
}

function renderPromptsFields(prompts) {
  const host = $("promptsFields");
  if (!host) return;
  const keys = prompts?.keys || [];
  const items = prompts?.items || {};
  host.innerHTML = keys
    .map((key) => {
      const item = items[key] || {};
      const label = item.label || key;
      const hint = item.hint || "";
      const placeholders = item.placeholders
        ? `<span class="prompts-ph">${escapeAttr(item.placeholders)}</span>`
        : "";
      const badge = item.modified
        ? `<span class="prompts-badge">modified</span>`
        : "";
      const value = item.value ?? item.default ?? "";
      return `
        <label class="prompts-field" data-prompt-key="${escapeAttr(key)}">
          <span class="prompts-field-head">
            <span class="field-label">${escapeAttr(label)} ${badge}</span>
            ${placeholders}
          </span>
          <textarea rows="5" data-prompt-textarea="${escapeAttr(key)}">${escapeHtml(
            value
          )}</textarea>
          <span class="meta">${escapeAttr(hint)}</span>
        </label>
      `;
    })
    .join("");
  promptsSnapshot = prompts;
}

function escapeHtml(str) {
  return String(str ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function escapeAttr(str) {
  return escapeHtml(str).replace(/'/g, "&#39;");
}

function readPromptsForm() {
  const out = {};
  document.querySelectorAll("[data-prompt-textarea]").forEach((el) => {
    const key = el.dataset.promptTextarea;
    if (!key) return;
    out[key] = el.value;
  });
  return out;
}

export async function openPrompts() {
  const overlay = $("promptsOverlay");
  if (!overlay) return;
  overlay.hidden = false;
  $("promptsStatus").textContent = "";
  try {
    const view = await api("/v1/settings");
    renderPromptsFields(view.prompts);
  } catch (e) {
    $("promptsStatus").textContent = e.message;
  }
}

export function closePrompts() {
  const overlay = $("promptsOverlay");
  if (overlay) overlay.hidden = true;
}

export async function savePrompts() {
  const form = readPromptsForm();
  const prompts = {};
  const items = promptsSnapshot?.items || {};
  for (const [key, value] of Object.entries(form)) {
    const defaultText = items[key]?.default ?? "";
    // Empty or exact factory default → clear override
    if (!value.trim() || value === defaultText) {
      prompts[key] = "";
    } else {
      prompts[key] = value;
    }
  }
  $("savePromptsBtn").disabled = true;
  try {
    const view = await api("/v1/settings", {
      method: "PUT",
      body: JSON.stringify({ prompts }),
    });
    renderPromptsFields(view.prompts);
    $("promptsStatus").textContent = "Prompts saved.";
    toast("Prompts saved.");
    return view;
  } catch (e) {
    $("promptsStatus").textContent = e.message;
    throw e;
  } finally {
    $("savePromptsBtn").disabled = false;
  }
}

export async function resetPrompts() {
  const ok = await confirmDialog(
    "Reset all prompts to factory defaults? API keys and parallel jobs are kept.",
    {
      title: "Reset prompts",
      confirmLabel: "Reset prompts",
      danger: true,
    }
  );
  if (!ok) return null;
  const view = await api("/v1/settings", {
    method: "PUT",
    body: JSON.stringify({ reset_prompts: true }),
  });
  renderPromptsFields(view.prompts);
  $("promptsStatus").textContent = "Prompts reset to defaults.";
  toast("Prompts reset.");
  return view;
}

export function bindSettings(onSaved) {
  $("settingsBtn")?.addEventListener("click", () => openSettings());
  $("closeSettingsBtn")?.addEventListener("click", closeSettings);
  $("settingsOverlay")?.addEventListener("click", (e) => {
    if (e.target === $("settingsOverlay")) closeSettings();
  });
  $("saveSettingsBtn")?.addEventListener("click", () =>
    saveSettings()
      .then((view) => view && onSaved?.(view))
      .catch(() => {})
  );
  $("clearOpenaiBtn")?.addEventListener("click", () =>
    clearOpenaiKey()
      .then((view) => view && onSaved?.(view))
      .catch((e) => {
        $("settingsStatus").textContent = e.message;
      })
  );
  $("factoryResetBtn")?.addEventListener("click", () =>
    factoryResetSettings()
      .then((view) => view && onSaved?.(view))
      .catch((e) => {
        $("settingsStatus").textContent = e.message;
      })
  );
  $("editPromptsBtn")?.addEventListener("click", () => openPrompts());
  $("closePromptsBtn")?.addEventListener("click", closePrompts);
  $("promptsOverlay")?.addEventListener("click", (e) => {
    if (e.target === $("promptsOverlay")) closePrompts();
  });
  $("savePromptsBtn")?.addEventListener("click", () =>
    savePrompts()
      .then((view) => view && onSaved?.(view))
      .catch(() => {})
  );
  $("resetPromptsBtn")?.addEventListener("click", () =>
    resetPrompts()
      .then((view) => view && onSaved?.(view))
      .catch((e) => {
        $("promptsStatus").textContent = e.message;
      })
  );
}
