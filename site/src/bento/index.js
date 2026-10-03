import { gsap, ScrollTrigger } from "../lib/gsap.js";
import { buildBento } from "./build.js";
import { open, RM } from "./dialog.js";
import { replay } from "./replay.js";

export function initBento(el, opts) {
  buildBento(el);
  el.querySelectorAll(".tile").forEach((t) => {
    t.querySelector(".tile-open").addEventListener("click", () => open(t));
  });
  if (RM) return;
  el.querySelectorAll(".tile").forEach((t) => {
    const tl = replay(t).pause(0);
    ScrollTrigger.create({ trigger: t, start: "top 88%", once: true, onEnter: () => tl.play() });
  });
  if (opts?.parallax) {
    ScrollTrigger.matchMedia({
      "(min-width: 900px)": () => {
        el.querySelectorAll(".tile").forEach((t) => {
          const Ly = +t.dataset.layer,
            A = 30;
          if (Ly === 1) return;
          gsap.fromTo(
            t,
            { y: (Ly - 1) * A },
            {
              y: -(Ly - 1) * A,
              ease: "none",
              scrollTrigger: { trigger: el, start: "top bottom", end: "bottom top", scrub: true },
            },
          );
        });
      },
    });
  }
}
