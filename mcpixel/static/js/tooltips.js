import { $ } from "./state.js";

let tipEl = null;
let activeBtn = null;

function ensureTip() {
  if (tipEl) return tipEl;
  tipEl = document.createElement("div");
  tipEl.id = "appTooltip";
  tipEl.className = "app-tooltip";
  tipEl.hidden = true;
  tipEl.setAttribute("role", "tooltip");
  document.body.appendChild(tipEl);
  return tipEl;
}

function placeTip(btn) {
  const tip = ensureTip();
  const rect = btn.getBoundingClientRect();
  const margin = 8;
  tip.hidden = false;
  // Measure after unhiding
  const tw = tip.offsetWidth;
  const th = tip.offsetHeight;
  let left = rect.left + rect.width / 2 - tw / 2;
  let top = rect.top - th - 8;
  if (top < margin) top = rect.bottom + 8;
  left = Math.max(margin, Math.min(left, window.innerWidth - tw - margin));
  tip.style.left = `${Math.round(left)}px`;
  tip.style.top = `${Math.round(top)}px`;
}

function showTip(btn) {
  const text = btn.getAttribute("data-tip");
  if (!text) return;
  const tip = ensureTip();
  if (activeBtn && activeBtn !== btn) {
    activeBtn.setAttribute("aria-expanded", "false");
  }
  activeBtn = btn;
  tip.textContent = text;
  tip.id = "appTooltip";
  btn.setAttribute("aria-describedby", "appTooltip");
  btn.setAttribute("aria-expanded", "true");
  placeTip(btn);
}

function hideTip(btn) {
  if (btn && activeBtn && btn !== activeBtn) return;
  const tip = ensureTip();
  tip.hidden = true;
  tip.textContent = "";
  if (activeBtn) {
    activeBtn.removeAttribute("aria-describedby");
    activeBtn.setAttribute("aria-expanded", "false");
    activeBtn = null;
  }
}

export function bindInfoTips(root = document) {
  ensureTip();
  root.querySelectorAll(".info-tip[data-tip]").forEach((btn) => {
    if (btn.dataset.tipBound) return;
    btn.dataset.tipBound = "1";
    btn.setAttribute("aria-expanded", "false");
    btn.addEventListener("mouseenter", () => showTip(btn));
    btn.addEventListener("mouseleave", () => hideTip(btn));
    btn.addEventListener("focus", () => showTip(btn));
    btn.addEventListener("blur", () => hideTip(btn));
    btn.addEventListener("click", (e) => {
      e.preventDefault();
      if (activeBtn === btn && !ensureTip().hidden) hideTip(btn);
      else showTip(btn);
    });
  });

  window.addEventListener(
    "scroll",
    () => {
      if (activeBtn) placeTip(activeBtn);
    },
    true
  );
  window.addEventListener("resize", () => {
    if (activeBtn) placeTip(activeBtn);
  });
}
