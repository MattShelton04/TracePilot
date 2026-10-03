import { gsap, ScrollTrigger } from "../lib/gsap.js";
import { heroField } from "../traces/hero-field.js";
import { $, PIN, REDUCE } from "./env.js";

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
