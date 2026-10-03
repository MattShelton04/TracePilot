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
  // Entrances use IntersectionObservers rather than a ScrollTrigger per tile, and each tile's
  // timeline is only set up a viewport ahead of it: both forced layouts of the new tiles on load.
  const tls = new Map();
  const play = new IntersectionObserver(
    (entries) => {
      for (const e of entries) {
        if (!e.isIntersecting) continue;
        tls.get(e.target).play();
        play.unobserve(e.target);
      }
    },
    { rootMargin: "0px 0px -12% 0px" }, // the tile's top has passed 88% of the viewport
  );
  const prep = new IntersectionObserver(
    (entries) => {
      for (const e of entries) {
        if (!e.isIntersecting) continue;
        tls.set(e.target, replay(e.target).pause(0));
        prep.unobserve(e.target);
        play.observe(e.target);
      }
    },
    { rootMargin: "0px 0px 100% 0px" },
  );
  el.querySelectorAll(".tile").forEach((t) => {
    prep.observe(t);
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
