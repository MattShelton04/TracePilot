import { ScrollTrigger } from "../lib/gsap.js";

/* Scroll position that shows the start of a section. Once scrolled past, a pinned scene sits at
   the end of its pin spacer, so its live position (which the browser's own anchor jump uses) is a
   whole scene too far down; use its pin start instead. A scene timeline can mark a later point
   with an "anchor" label (the hero scene marks where the library comes into view). */
export function anchorY(el, { label = true } = {}) {
  const pin = ScrollTrigger.getAll().find((t) => t.pin === el);
  if (!pin) return el.getBoundingClientRect().top + scrollY;
  const tl = pin.animation,
    at = label ? tl?.labels?.anchor : 0;
  return pin.start + (at ? ((pin.end - pin.start) * at) / tl.duration() : 0);
}
