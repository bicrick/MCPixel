/**
 * Styled confirm / prompt dialogs (replaces window.confirm / window.prompt).
 */

let overlayEl = null;
let resolveFn = null;

function ensureOverlay() {
  if (overlayEl) return overlayEl;
  overlayEl = document.createElement("div");
  overlayEl.id = "appDialogOverlay";
  overlayEl.className = "app-dialog-overlay";
  overlayEl.hidden = true;
  overlayEl.innerHTML = `
    <div class="app-dialog" role="dialog" aria-modal="true" aria-labelledby="appDialogTitle">
      <h2 id="appDialogTitle" class="app-dialog-title"></h2>
      <p id="appDialogMessage" class="app-dialog-message"></p>
      <label id="appDialogField" class="app-dialog-field" hidden>
        <span id="appDialogFieldLabel" class="meta"></span>
        <input id="appDialogInput" type="text" autocomplete="off" />
      </label>
      <div class="app-dialog-actions">
        <button type="button" id="appDialogCancel" class="secondary">Cancel</button>
        <button type="button" id="appDialogConfirm">OK</button>
      </div>
    </div>
  `;
  document.body.appendChild(overlayEl);

  const cancel = () => closeDialog(null);
  overlayEl.querySelector("#appDialogCancel").addEventListener("click", cancel);
  overlayEl.addEventListener("click", (e) => {
    if (e.target === overlayEl) cancel();
  });
  overlayEl.querySelector("#appDialogConfirm").addEventListener("click", () => {
    const field = overlayEl.querySelector("#appDialogField");
    if (!field.hidden) {
      const input = overlayEl.querySelector("#appDialogInput");
      closeDialog(input.value);
      return;
    }
    closeDialog(true);
  });
  overlayEl.querySelector("#appDialogInput").addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      overlayEl.querySelector("#appDialogConfirm").click();
    }
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && overlayEl && !overlayEl.hidden) {
      e.preventDefault();
      cancel();
    }
  });
  return overlayEl;
}

function closeDialog(value) {
  if (!overlayEl || overlayEl.hidden) return;
  overlayEl.hidden = true;
  const fn = resolveFn;
  resolveFn = null;
  fn?.(value);
}

/**
 * @param {string} message
 * @param {{ title?: string, confirmLabel?: string, cancelLabel?: string, danger?: boolean }} [opts]
 * @returns {Promise<boolean>}
 */
export function confirmDialog(message, opts = {}) {
  const el = ensureOverlay();
  const title = opts.title || "Confirm";
  el.querySelector("#appDialogTitle").textContent = title;
  el.querySelector("#appDialogMessage").textContent = message;
  el.querySelector("#appDialogMessage").hidden = !message;
  el.querySelector("#appDialogField").hidden = true;

  const confirmBtn = el.querySelector("#appDialogConfirm");
  const cancelBtn = el.querySelector("#appDialogCancel");
  confirmBtn.textContent = opts.confirmLabel || "OK";
  cancelBtn.textContent = opts.cancelLabel || "Cancel";
  confirmBtn.classList.toggle("danger", !!opts.danger);

  el.hidden = false;
  confirmBtn.focus();

  return new Promise((resolve) => {
    resolveFn = (value) => resolve(value === true);
  });
}

/**
 * @param {string} message
 * @param {string} [defaultValue]
 * @param {{ title?: string, confirmLabel?: string, cancelLabel?: string, fieldLabel?: string }} [opts]
 * @returns {Promise<string|null>}
 */
export function promptDialog(message, defaultValue = "", opts = {}) {
  const el = ensureOverlay();
  el.querySelector("#appDialogTitle").textContent = opts.title || "Input";
  el.querySelector("#appDialogMessage").textContent = message || "";
  el.querySelector("#appDialogMessage").hidden = !message;

  const field = el.querySelector("#appDialogField");
  const input = el.querySelector("#appDialogInput");
  const fieldLabel = el.querySelector("#appDialogFieldLabel");
  field.hidden = false;
  fieldLabel.textContent = opts.fieldLabel || "";
  fieldLabel.hidden = !opts.fieldLabel;
  input.value = defaultValue ?? "";

  const confirmBtn = el.querySelector("#appDialogConfirm");
  const cancelBtn = el.querySelector("#appDialogCancel");
  confirmBtn.textContent = opts.confirmLabel || "OK";
  cancelBtn.textContent = opts.cancelLabel || "Cancel";
  confirmBtn.classList.remove("danger");

  el.hidden = false;
  input.focus();
  input.select();

  return new Promise((resolve) => {
    resolveFn = (value) => {
      if (value === null) resolve(null);
      else resolve(String(value));
    };
  });
}
