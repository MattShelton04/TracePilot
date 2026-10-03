import { DOWNLOAD_URL } from "../data.js";
import { gsap } from "../lib/gsap.js";
import { Demo } from "../motion/demo-section.js";
import { esc, ic } from "./helpers.js";
import { INFO } from "./info.js";
import { replay } from "./replay.js";

export const DL = DOWNLOAD_URL;

export const RM = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
export let dlg = null,
  openTile = null,
  lastFocus = null,
  busy = false;

export function ensureDialog() {
  if (dlg) return dlg;
  dlg = document.createElement("div");
  dlg.className = "tile-dialog";
  dlg.hidden = true;
  dlg.innerHTML =
    '<div class="td-scrim"></div><div class="td-panel" role="dialog" aria-modal="true" aria-labelledby="tdTitle"><div class="td-surface"></div>' +
    '<div class="td-content"><div class="td-text"><p class="td-kicker"><span class="td-ic"></span><span class="td-sub"></span></p><h3 id="tdTitle" class="td-title"></h3><p class="td-lede"></p><ul class="td-points"></ul>' +
    '<div class="td-actions"><button type="button" class="btn btn-primary td-demo">Try it in the live demo' +
    ic("arrowR") +
    '</button><a class="btn btn-ghost td-dl" href="' +
    DL +
    '" target="_blank" rel="noopener">' +
    ic("download") +
    "Download TracePilot</a></div></div>" +
    '<div class="td-view bento"><div class="tile td-tile"><div class="tile-body"></div></div></div></div>' +
    '<button type="button" class="td-close" aria-label="Close">' +
    ic("x") +
    "</button></div>";
  document.body.appendChild(dlg);
  dlg.querySelector(".td-scrim").addEventListener("click", close);
  dlg.querySelector(".td-close").addEventListener("click", close);
  dlg.querySelector(".td-demo").addEventListener("click", () => {
    const step = INFO[openTile.dataset.key].demo;
    close().then(() => Demo.go(step));
  });
  dlg.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      e.preventDefault();
      close();
    }
    if (e.key === "Tab") {
      const f = Array.from(dlg.querySelectorAll("button, a")).filter((b) => b.offsetParent);
      const i = f.indexOf(document.activeElement);
      if (e.shiftKey && i <= 0) {
        e.preventDefault();
        f[f.length - 1].focus();
      } else if (!e.shiftKey && i === f.length - 1) {
        e.preventDefault();
        f[0].focus();
      }
    }
  });
  return dlg;
}

export function open(tileEl) {
  if (busy) return;
  const key = tileEl.dataset.key,
    info = INFO[key];
  if (!info) return;
  ensureDialog();
  busy = true;
  openTile = tileEl;
  lastFocus = document.activeElement;
  dlg.querySelector(".td-ic").innerHTML = ic(info.icon);
  dlg.querySelector(".td-sub").textContent = tileEl.querySelector(".sub").textContent;
  dlg.querySelector(".td-title").textContent = info.title;
  dlg.querySelector(".td-lede").textContent = info.lede;
  dlg.querySelector(".td-points").innerHTML = info.points.map((p) => `<li>${esc(p)}</li>`).join("");
  const hasDemo = !!info.demo;
  dlg.querySelector(".td-demo").hidden = !hasDemo;
  dlg.querySelector(".td-dl").className = `btn ${hasDemo ? "btn-ghost" : "btn-primary"} td-dl`;
  const view = dlg.querySelector(".td-tile");
  view.className = `tile td-tile t-${key}`;
  view.querySelector(".tile-body").innerHTML = tileEl.querySelector(".tile-body").innerHTML;
  view.querySelectorAll("[style]").forEach((n) => {
    n.style.opacity = "";
    n.style.transform = "";
  });
  dlg.hidden = false;
  document.documentElement.classList.add("has-dialog");
  const panel = dlg.querySelector(".td-panel"),
    surf = dlg.querySelector(".td-surface"),
    content = dlg.querySelector(".td-content"),
    closeBtn = dlg.querySelector(".td-close");
  const a = tileEl.getBoundingClientRect(),
    b = panel.getBoundingClientRect();
  tileEl.classList.add("is-source");
  const focusFirst = () => {
    busy = false;
    (hasDemo ? dlg.querySelector(".td-demo") : dlg.querySelector(".td-dl")).focus({
      preventScroll: true,
    });
  };
  if (RM) {
    gsap.fromTo(dlg, { opacity: 0 }, { opacity: 1, duration: 0.15, onComplete: focusFirst });
    return;
  }
  gsap.set(dlg, { opacity: 1 });
  gsap
    .timeline({ onComplete: focusFirst })
    .fromTo(
      dlg.querySelector(".td-scrim"),
      { opacity: 0 },
      { opacity: 1, duration: 0.4, ease: "power2.out" },
      0,
    )
    .fromTo(
      surf,
      {
        x: a.left - b.left,
        y: a.top - b.top,
        scaleX: a.width / b.width,
        scaleY: a.height / b.height,
        opacity: 1,
      },
      { x: 0, y: 0, scaleX: 1, scaleY: 1, duration: 0.62, ease: "expo.inOut" },
      0,
    )
    .fromTo(
      content.querySelectorAll(".td-kicker, .td-title, .td-lede, .td-points li, .td-actions"),
      { opacity: 0, y: 14 },
      { opacity: 1, y: 0, duration: 0.55, ease: "expo.out", stagger: 0.045 },
      0.36,
    )
    .fromTo(
      dlg.querySelector(".td-view"),
      { opacity: 0, y: 20, scale: 0.98 },
      { opacity: 1, y: 0, scale: 1, duration: 0.7, ease: "expo.out" },
      0.42,
    )
    .fromTo(
      closeBtn,
      { opacity: 0, rotate: -45 },
      { opacity: 1, rotate: 0, duration: 0.4, ease: "power2.out" },
      0.5,
    );
  replay(view, 0.55);
}

export function close() {
  return new Promise((res) => {
    if (!dlg || dlg.hidden || busy) return res();
    busy = true;
    const tileEl = openTile,
      panel = dlg.querySelector(".td-panel"),
      surf = dlg.querySelector(".td-surface");
    const fade = dlg.querySelectorAll(".td-content, .td-close");
    const done = () => {
      dlg.hidden = true;
      busy = false;
      tileEl.classList.remove("is-source");
      document.documentElement.classList.remove("has-dialog");
      gsap.set([surf, dlg, fade, dlg.querySelector(".td-scrim"), dlg.querySelector(".td-view")], {
        clearProps: "all",
      });
      if (lastFocus?.focus) lastFocus.focus({ preventScroll: true });
      res();
    };
    if (RM) return gsap.to(dlg, { opacity: 0, duration: 0.15, onComplete: done });
    const r = tileEl.getBoundingClientRect(),
      b = panel.getBoundingClientRect();
    gsap
      .timeline({ onComplete: done })
      .to(fade, { opacity: 0, duration: 0.18, ease: "power1.in" }, 0)
      .to(
        surf,
        {
          x: r.left - b.left,
          y: r.top - b.top,
          scaleX: r.width / b.width,
          scaleY: r.height / b.height,
          duration: 0.5,
          ease: "expo.inOut",
        },
        0.05,
      )
      .to(dlg.querySelector(".td-scrim"), { opacity: 0, duration: 0.4 }, 0.12)
      .to(surf, { opacity: 0, duration: 0.12 }, 0.45);
  });
}
