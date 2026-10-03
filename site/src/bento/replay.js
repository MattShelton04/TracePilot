import { gsap } from "../lib/gsap.js";

/* Entrance choreography for a tile body (shared by the wall and the dialog). */
export function replay(tileEl, delay) {
  const tl = gsap.timeline({ delay: delay || 0 });
  const draws = tileEl.querySelectorAll("[data-draw]");
  if (draws.length)
    tl.fromTo(
      draws,
      { attr: { "stroke-dashoffset": 1 } },
      { attr: { "stroke-dashoffset": 0 }, duration: 1.3, ease: "power2.out", stagger: 0.08 },
      0.15,
    );
  const fills = tileEl.querySelectorAll("[data-fill]");
  if (fills.length) tl.fromTo(fills, { opacity: 0 }, { opacity: 1, duration: 0.8 }, 0.7);
  const bars = tileEl.querySelectorAll(".f");
  if (bars.length)
    tl.fromTo(
      bars,
      { scaleX: 0 },
      { scaleX: 1, duration: 0.9, ease: "expo.out", stagger: 0.05 },
      0.15,
    );
  tileEl.querySelectorAll("[data-count]").forEach((el) => {
    const target = +el.dataset.count,
      suf = el.dataset.suffix || "";
    const tail = el.querySelector("span") ? el.querySelector("span").outerHTML : "";
    const o = { v: 0 };
    tl.fromTo(
      o,
      { v: 0 },
      {
        v: target,
        duration: 1.1,
        ease: "power2.out",
        onUpdate: () => {
          el.innerHTML = Math.round(o.v).toLocaleString("en-US") + suf + tail;
        },
      },
      0.1,
    );
  });
  if (tileEl.classList.contains("t-todos")) {
    for (let lv = 0; lv <= 4; lv++) {
      const nodes = Array.from(tileEl.querySelectorAll(`[data-node="${lv}"]`)).filter(
        (n) => n.dataset.st !== "blocked",
      );
      if (nodes.length)
        tl.fromTo(
          nodes,
          { opacity: 0, y: -6 },
          { opacity: 1, y: 0, duration: 0.35, ease: "power2.out", stagger: 0.06 },
          0.2 + lv * 0.32,
        );
      const edges = tileEl.querySelectorAll(`[data-edge="${lv}"]`);
      if (edges.length)
        tl.fromTo(
          edges,
          { attr: { "stroke-dashoffset": 1 } },
          { attr: { "stroke-dashoffset": 0 }, duration: 0.3 },
          0.42 + lv * 0.32,
        );
    }
    tl.fromTo(
      tileEl.querySelectorAll('[data-st="blocked"]'),
      { opacity: 0, x: 8 },
      { opacity: 1, x: 0, duration: 0.4, ease: "back.out(2)" },
      1.9,
    );
    tl.fromTo(
      tileEl.querySelectorAll(".prog .pb i"),
      { scaleX: 0 },
      { scaleX: 1, duration: 0.9, ease: "expo.out", stagger: 0.1 },
      0.2,
    );
  }
  if (tileEl.classList.contains("t-search")) {
    const q = tileEl.querySelector("[data-type]");
    const full = q.dataset.type;
    const o = { n: 0 };
    tl.fromTo(
      o,
      { n: 0 },
      {
        n: full.length,
        duration: 0.7,
        ease: "none",
        onUpdate: () => (q.textContent = full.slice(0, Math.round(o.n))),
      },
      0.1,
    );
    const syn = tileEl.querySelector(".syn");
    tl.call(
      () => {
        syn.classList.remove("shimmer");
        void syn.offsetWidth;
        syn.classList.add("shimmer");
      },
      null,
      0.85,
    );
    tl.fromTo(
      tileEl.querySelectorAll(".sres"),
      { opacity: 0, y: 10 },
      { opacity: 1, y: 0, duration: 0.45, ease: "power2.out", stagger: 0.12 },
      0.85,
    );
    tl.fromTo(
      tileEl.querySelectorAll(".sres mark"),
      { "--hl": 0 },
      { "--hl": 1, duration: 0.35, ease: "power2.out", stagger: 0.12 },
      1.05,
    );
    tl.fromTo(
      tileEl.querySelector("[data-found]"),
      { opacity: 0 },
      { opacity: 1, duration: 0.3 },
      1.4,
    );
  }
  if (tileEl.classList.contains("t-explorer"))
    tl.fromTo(
      tileEl.querySelectorAll(".tree div"),
      { opacity: 0, x: -6 },
      { opacity: 1, x: 0, duration: 0.3, stagger: 0.04 },
      0.1,
    );
  if (tileEl.classList.contains("t-agents") || tileEl.classList.contains("t-skills"))
    tl.fromTo(
      tileEl.querySelectorAll(".arow, .skrow"),
      { opacity: 0, y: 8 },
      { opacity: 1, y: 0, duration: 0.4, stagger: 0.06 },
      0,
    );
  return tl;
}
