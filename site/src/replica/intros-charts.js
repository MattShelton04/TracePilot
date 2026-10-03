import { D } from "../data.js";
import { gsap } from "../lib/gsap.js";
import { CACHE_PCT, RM } from "./shared.js";

export const chartIntroMethods = {
  introMetrics(p) {
    this.countUps(p, 1);
    const arc = p.querySelector(".mt-arc");
    const C = parseFloat(arc.getAttribute("stroke-dasharray"));
    const tl = gsap.timeline();
    tl.fromTo(
      arc,
      { strokeDashoffset: C },
      { strokeDashoffset: C * (1 - CACHE_PCT / 100), duration: 1.4, ease: "power3.out" },
      0.15,
    );
    tl.fromTo(
      p.querySelector(".mt-track span"),
      { scaleX: 0 },
      { scaleX: 1, duration: 1.2, ease: "expo.out" },
      0.3,
    );
    tl.fromTo(
      p.querySelectorAll(".mt-dist .bar span"),
      { scaleX: 0 },
      { scaleX: 1, duration: 0.9, ease: "expo.out", stagger: 0.08 },
      0.45,
    );
    tl.fromTo(
      p.querySelectorAll(".rp-panel"),
      { opacity: 0, y: 12 },
      {
        opacity: 1,
        y: 0,
        duration: 0.6,
        ease: "expo.out",
        stagger: 0.08,
        clearProps: "transform,opacity",
      },
      0,
    );
    this.track(tl);
  },

  introContext(p) {
    const svg = p.querySelector("svg.dg");
    const clip = svg.querySelector(".cx-clip");
    const comp = svg.querySelector(".cx-comp");
    const pulse = svg.querySelector(".cx-pulse");
    const ncomp = p.querySelector(".cx-ncomp");
    const xEnd = 900,
      xc = 74 + (D.compaction.turn / 11) * (880 - 74);
    const total = 2.6;
    const tAtCliff = total * (xc / xEnd);
    const tl = gsap.timeline();
    tl.set(clip, { attr: { width: 60 } })
      .set(comp, { opacity: 0 })
      .set(ncomp, { textContent: "0", transformOrigin: "0% 50%" });
    this.countUps(p.querySelector(".rp-stats"), total);
    tl.to(clip, { attr: { width: xEnd }, duration: total, ease: "power1.inOut" }, 0.1);
    tl.add(() => {
      ncomp.textContent = String(D.compaction.count);
    }, 0.1 + tAtCliff);
    tl.fromTo(
      ncomp,
      { scale: 1.5 },
      { scale: 1, duration: 0.5, ease: "back.out(2)", immediateRender: false },
      0.1 + tAtCliff,
    );
    tl.to(comp, { opacity: 1, duration: 0.35 }, 0.1 + tAtCliff);
    tl.fromTo(
      pulse,
      { opacity: 1, attr: { r: 6 } },
      { opacity: 0, attr: { r: 34 }, duration: 0.9, ease: "power2.out", immediateRender: false },
      0.1 + tAtCliff,
    );
    tl.fromTo(
      pulse,
      { opacity: 0.8, attr: { r: 6 } },
      { opacity: 0, attr: { r: 26 }, duration: 0.9, ease: "power2.out", immediateRender: false },
      0.35 + tAtCliff,
    );
    this.track(tl);
  },

  introTimeline(mode) {
    const det = this.views.session;
    if (!det || RM) return;
    if (mode === "tree") {
      const w = det.querySelector(".tm-tree");
      const tl = gsap.timeline();
      tl.fromTo(
        w.querySelector(".tr-main"),
        { opacity: 0, y: -10 },
        { opacity: 1, y: 0, duration: 0.5, ease: "expo.out" },
        0.05,
      );
      tl.fromTo(
        w.querySelectorAll(".tr-link"),
        { opacity: 0 },
        { opacity: 1, duration: 0.5, stagger: 0.08 },
        0.35,
      );
      w.querySelectorAll(".tr-link").forEach((l) => {
        l.classList.add("tm-flow");
      });
      tl.fromTo(
        w.querySelectorAll(".tr-kid"),
        { opacity: 0, y: -24, scale: 0.94, transformOrigin: "50% 0%" },
        { opacity: 1, y: 0, scale: 1, duration: 0.7, ease: "expo.out", stagger: 0.09 },
        0.5,
      );
      this.track(tl);
    } else if (mode === "messages") {
      const w = det.querySelector(".tm-seqwrap");
      const svg = w.querySelector("svg.dg");
      const msgs = Array.from(svg.querySelectorAll(".sq-msg"));
      const head = svg.querySelector(".sq-head-line");
      const tl = gsap.timeline();
      tl.fromTo(
        svg.querySelectorAll(".sq-head"),
        { opacity: 0, y: -6 },
        { opacity: 1, y: 0, duration: 0.45, ease: "expo.out", stagger: 0.06 },
        0,
      );
      tl.fromTo(
        svg.querySelectorAll(".sq-life"),
        { opacity: 0 },
        { opacity: 1, duration: 0.5, stagger: 0.05 },
        0.2,
      );
      tl.fromTo(
        svg.querySelectorAll(".sq-act"),
        { scaleY: 0, transformOrigin: "50% 0%" },
        { scaleY: 1, duration: 1.0, ease: "power2.out", stagger: 0.08 },
        0.4,
      );
      msgs.forEach((g) => {
        const r = g.querySelector("text").previousElementSibling; // arrowhead path
        const clipRect = svg.querySelector(`#${this.uid}-sq${g.dataset.i} rect`);
        const a = +g.dataset.a - 8,
          b = +g.dataset.b + 8,
          dir = +g.dataset.dir;
        if (dir > 0) gsap.set(clipRect, { attr: { x: a, width: 0 } });
        else gsap.set(clipRect, { attr: { x: b, width: 0 } });
        void r;
      });
      gsap.set(head, { y: 74 + 24, opacity: 0 });
      tl.to(head, { opacity: 1, duration: 0.3 }, 0.45);
      msgs.forEach((g, i) => {
        const clipRect = svg.querySelector(`#${this.uid}-sq${g.dataset.i} rect`);
        const a = +g.dataset.a - 8,
          b = +g.dataset.b + 8,
          dir = +g.dataset.dir;
        const at = 0.6 + i * 0.32;
        const y = 74 + 24 + i * 41;
        tl.to(head, { y: y, duration: 0.25, ease: "power2.inOut" }, at - 0.08);
        if (dir > 0)
          tl.to(clipRect, { attr: { width: b - a }, duration: 0.42, ease: "power2.inOut" }, at);
        else
          tl.to(
            clipRect,
            { attr: { x: a, width: b - a }, duration: 0.42, ease: "power2.inOut" },
            at,
          );
      });
      tl.to(head, { opacity: 0, duration: 0.4 }, ">+0.2");
      this.track(tl);
    } else {
      const w = det.querySelector(`.tm-mode[data-mode="${mode}"]`);
      this.track(
        gsap.from(w.querySelectorAll(".ln-bar"), {
          scaleX: 0,
          transformOrigin: "0% 50%",
          duration: 0.7,
          ease: "expo.out",
          stagger: 0.04,
        }),
      );
    }
  },
};
