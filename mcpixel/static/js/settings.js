import { api } from "./api.js";
import { confirmDialog } from "./dialogs.js";
import { $, toast } from "./state.js";

export async function openSettings() {
  const overlay = $("settingsOverlay");
  if (!overlay) return;
  overlay.hidden = false;
  $("settingsStatus").textContent = "";
  $("settingsOpenaiKey").value = "";
  $("settingsRemoveBgKey").value = "";
  try {
    const view = await api("/v1/settings");
    $("settingsOpenaiHint").textContent = view.openai_api_key?.configured
      ? `Configured (${view.openai_api_key.hint})`
      : "Not configured";
    $("settingsRemoveBgHint").textContent = view.remove_bg_api_key?.configured
      ? `Configured (${view.remove_bg_api_key.hint})`
      : "Not configured";
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
  const body = {};
  if (openai) body.openai_api_key = openai;
  if (removeBg) body.remove_bg_api_key = removeBg;
  if (!openai && !removeBg) {
    $("settingsStatus").textContent = "Enter a key to save, or clear OpenAI below.";
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
    $("settingsOpenaiHint").textContent = view.openai_api_key?.configured
      ? `Configured (${view.openai_api_key.hint})`
      : "Not configured";
    $("settingsRemoveBgHint").textContent = view.remove_bg_api_key?.configured
      ? `Configured (${view.remove_bg_api_key.hint})`
      : "Not configured";
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
