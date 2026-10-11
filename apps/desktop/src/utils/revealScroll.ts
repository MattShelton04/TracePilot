/**
 * Long conversations render off-screen turns in `content-visibility: auto`
 * chunks sized by an estimate until they are first painted. A smooth scroll
 * fixes its destination up front, so on a conversation not yet scrolled
 * through, the chunks it passes render at their real heights mid-flight and
 * it can land thousands of pixels from the target (past it, near the bottom,
 * auto-scroll then locks on). An instant scroll lays out the target first and
 * lands on it, so only short hops are animated.
 */

/** Hops up to this many viewport heights away are animated. */
const SMOOTH_REVEAL_MAX_VIEWPORTS = 1.5;

/** The `scrollIntoView` behavior for centering `el`. */
export function revealScrollBehavior(el: Element): ScrollBehavior {
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return "auto";
  const rect = el.getBoundingClientRect();
  const viewport = window.innerHeight;
  const distance = Math.abs(rect.top + rect.height / 2 - viewport / 2);
  return distance <= viewport * SMOOTH_REVEAL_MAX_VIEWPORTS ? "smooth" : "auto";
}
