import { gsap, ScrollTrigger } from "../lib/gsap.js";
import { heroField } from "../traces/hero-field.js";
import { $, $$, PIN, REDUCE } from "./env.js";

export let field = null;
export function initHero() {
  const scene = $("#open"),
    heroCopy = $("#heroCopy");
  field = heroField({
    host: scene,
    eye: $("#heroEye"),
    base: $("#heroField"),
    top: $("#heroPulses"),
    height: () => (PIN ? innerHeight : heroCopy.offsetTop + heroCopy.offsetHeight + 40),
    delay: REDUCE ? 0 : 0.15,
    onConverged: () => {
      if (REDUCE) return;
      const lid = $("#heroEye .lid");
      gsap
        .timeline()
        .to(lid, { scaleY: 0.08, duration: 0.11, ease: "power2.in" })
        .to(lid, { scaleY: 1, duration: 0.24, ease: "power3.out" })
        .fromTo(
          "#heroEye .callout",
          { opacity: 0, x: (i) => (i ? -8 : 8) },
          { opacity: 1, x: 0, duration: 0.7, stagger: 0.1, ease: "expo.out" },
          "-=0.05",
        );
    },
  });
  if (!PIN && !REDUCE) {
    // phone / no-pin: pause the pulses once the hero has scrolled away
    ScrollTrigger.create({
      trigger: heroCopy,
      start: "top bottom",
      end: "bottom top",
      onToggle: (st) => field.setActive(st.isActive),
    });
  }
}
export function intro() {
  const heroCopy = $("#heroCopy");
  const lines = $$(".hero-title .line > span", heroCopy);
  gsap.set("#heroEye .callout", { opacity: 0 });
  const tl = gsap.timeline({ defaults: { ease: "expo.out" } });
  tl.from(
    "#heroEye .eye-core",
    { opacity: 0, scale: 0.9, transformOrigin: "50% 50%", duration: 1.2 },
    0.1,
  );
  tl.from(
    "#heroEye .dial",
    { opacity: 0, rotate: -30, transformOrigin: "50% 50%", duration: 1.8 },
    0,
  );
  tl.from($(".hero-eyebrow", heroCopy), { opacity: 0, y: 12, duration: 0.8 }, 0.15);
  tl.from(lines, { yPercent: 105, duration: 1.0, stagger: 0.08 }, 0.2);
  tl.from(
    [$(".hero-sub", heroCopy), $(".hero-ctas", heroCopy), $(".hero-meta", heroCopy)],
    { opacity: 0, y: 14, duration: 0.9, stagger: 0.08 },
    0.45,
  );
  if (PIN) tl.from($("#open .stage"), { opacity: 0, y: 60, duration: 1.2 }, 0.5);
  return tl;
}

/* =========================================================
   Scene timelines (built in "units"; scrubbed when pinned)
   ========================================================= */
