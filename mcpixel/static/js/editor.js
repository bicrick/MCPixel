import { api } from "./api.js";
import { $, state, toast } from "./state.js";

export const editor = {
  tool: "pencil",
  color: [31, 111, 74, 255],
  scale: 12,
  width: 0,
  height: 0,
  pixels: null,
  undo: [],
  redo: [],
};

function rgbaToHex(r, g, b) {
  return (
    "#" +
    [r, g, b]
      .map((v) => v.toString(16).padStart(2, "0"))
      .join("")
  );
}

export function hexToRgba(hex) {
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

export function drawCanvas() {
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

function fitEditorScale() {
  const wrap = $("pixelCanvas")?.parentElement;
  if (!wrap || !editor.width || !editor.height) return;
  const styles = getComputedStyle(wrap);
  const availableWidth =
    wrap.clientWidth -
    parseFloat(styles.paddingLeft || "0") -
    parseFloat(styles.paddingRight || "0");
  const availableHeight =
    wrap.clientHeight -
    parseFloat(styles.paddingTop || "0") -
    parseFloat(styles.paddingBottom || "0");
  editor.scale = Math.max(
    1,
    Math.min(
      64,
      availableWidth / editor.width,
      availableHeight / editor.height
    )
  );
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

export function closeEditor() {
  $("editorOverlay").hidden = true;
}

export async function openEditor(refreshJob) {
  if (!state.currentJobId) return;
  const job = await api(`/v1/jobs/${state.currentJobId}`);
  refreshJob?.(job);
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
  $("editorOverlay").hidden = false;
  buildPalette();
  requestAnimationFrame(() => {
    fitEditorScale();
    drawCanvas();
  });
}

function paintAt(clientX, clientY) {
  const canvas = $("pixelCanvas");
  const rect = canvas.getBoundingClientRect();
  const x = Math.floor(((clientX - rect.left) / rect.width) * editor.width);
  const y = Math.floor(((clientY - rect.top) / rect.height) * editor.height);
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

export async function saveEdit(onSaved) {
  if (!state.currentJobId || !editor.pixels) return;
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
  const job = await api(`/v1/jobs/${state.currentJobId}/edit`, {
    method: "POST",
    body: JSON.stringify({ png_base64: dataUrl }),
  });
  toast("Edit saved.");
  onSaved?.(job);
  return job;
}

export function bindEditorEvents() {
  let painting = false;
  window.addEventListener("resize", () => {
    if ($("editorOverlay").hidden || !editor.pixels) return;
    fitEditorScale();
    drawCanvas();
  });
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
}
