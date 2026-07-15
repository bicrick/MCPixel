import { api } from "./api.js";
import { confirmDialog } from "./dialogs.js";
import { $, toast } from "./state.js";

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
}
