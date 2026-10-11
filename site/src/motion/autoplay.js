import { gsap, ScrollTrigger } from "../lib/gsap.js";
import { anchorY } from "./anchors.js";
import { $ } from "./env.js";

/* =========================================================
   Section autoplay: following an in-page link to a pinned scene (the nav, a deep link, Back or
   Forward) plays that scene. The page jumps to the scene's start (see anchorY) and then
   scrolls through it at the tour's pace, stopping on its final frame.
   Wheel, touch, keys, a press anywhere, scrolling by other means (a scrollbar drag) and the
   tour all take over at once. Only pinned scenes autoplay, so phones and reduced motion keep
   the plain jump.
   ========================================================= */
const EVENTS = ["wheel", "touchstart", "keydown", "pointerdown"];
const speed = () => Math.max(300, innerHeight * 0.5); // px per second, as the tour
let tween = null,
  scene = null, // the scene playing
  set = 0; // the scroll position the glide last set

const pinOf = (el) => ScrollTrigger.getAll().find((t) => t.pin === el);
/** The element a "#id" hash names; a malformed escape is taken literally rather than thrown. */
export function hashTarget(hash) {
  if (!hash || hash.length < 2) return null;
  let id = hash.slice(1);
  try {
    id = decodeURIComponent(id);
  } catch {}
  return document.getElementById(id);
}
/** The scene element for a "#id" hash, when that scene is pinned. */
export function pinnedScene(hash) {
  const el = hashTarget(hash);
  return el && pinOf(el) ? el : null;
}

export function stopAutoplay() {
  tween?.kill();
  tween = null;
  EVENTS.forEach((t) => {
    removeEventListener(t, stopAutoplay, { capture: true });
  });
  removeEventListener("scroll", watch);
}
// a scroll the glide did not make (a scrollbar drag, find-in-page) hands control back
function watch() {
  if (tween && Math.abs(scrollY - set) > 4) stopAutoplay();
}

/** Jump to a pinned scene and play it through. `delay` holds on the first frame (ms). */
export function playScene(el, { delay = 250 } = {}) {
  stopAutoplay();
  // land where the scene settles into place (its pin start, or #open's anchor label), as the
  // plain jump did, rather than where its timeline begins while it is still rising into view
  const from = Math.max(0, anchorY(el));
  scrollTo(0, from);
  // settle every scrubbed timeline at once, so nothing visibly rewinds or races from the old spot
  ScrollTrigger.update();
  for (const t of ScrollTrigger.getAll()) {
    const scrubbing = t.getTween?.();
    if (scrubbing?.progress) scrubbing.progress(1);
  }
  focusHeading(el);
  scene = el;
  glide(from, delay);
  if (!tween) return;
  // capture, so a press on a control that stops propagation (the tour button) still takes over
  EVENTS.forEach((t) => {
    addEventListener(t, stopAutoplay, { capture: true, passive: true });
  });
  addEventListener("scroll", watch, { passive: true });
}
// scroll from `from` to the scene's last frame, at the tour's pace
function glide(from, delay) {
  tween?.kill();
  tween = null;
  const to = pinOf(scene).end - 2;
  if (to <= from) return;
  set = from;
  const y = { v: from };
  tween = gsap.to(y, {
    v: to,
    duration: (to - from) / speed(),
    delay: delay / 1000,
    ease: "sine.inOut",
    onUpdate: () => {
      set = Math.round(y.v);
      scrollTo(0, set);
    },
    onComplete: stopAutoplay,
  });
}
// a resize (or a late load) re-measures the pins: carry on from here to the scene's new end
ScrollTrigger.addEventListener("refresh", () => {
  if (!tween) return;
  glide(scrollY, 0);
  if (!tween) stopAutoplay(); // already past the new end
});

// move the reading position for keyboard and screen reader users, without scrolling
function focusHeading(el) {
  const h = $(".scene-head h2", el) ?? $("h2", el);
  if (!h) return;
  if (!h.hasAttribute("tabindex")) h.setAttribute("tabindex", "-1");
  h.focus({ preventScroll: true });
}
