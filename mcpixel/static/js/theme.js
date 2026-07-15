const STORAGE_KEY = "mcpixel-theme";
const THEMES = new Set(["ink", "light"]);

export function getStoredTheme() {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    if (THEMES.has(v)) return v;
  } catch {
    /* ignore */
  }
  return "ink";
}

export function applyTheme(theme) {
  const next = THEMES.has(theme) ? theme : "ink";
  document.documentElement.dataset.theme = next;
  try {
    localStorage.setItem(STORAGE_KEY, next);
  } catch {
    /* ignore */
  }
  syncToggle(next);
  return next;
}

function syncToggle(theme) {
  document.querySelectorAll("[data-theme-set]").forEach((btn) => {
    const active = btn.getAttribute("data-theme-set") === theme;
    btn.setAttribute("aria-pressed", active ? "true" : "false");
  });
}

export function initTheme() {
  const theme = applyTheme(getStoredTheme());
  const root = document.getElementById("themeToggle");
  if (!root) return theme;
  root.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-theme-set]");
    if (!btn) return;
    applyTheme(btn.getAttribute("data-theme-set"));
  });
  return theme;
}
