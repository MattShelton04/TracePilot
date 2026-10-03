// Layout and motion mode, decided once per page load (a change reloads the page).
// Desktop (>= 900px, motion allowed): pinned, scroll-scrubbed scenes.
// Phone: each scene gets a narrow replica frame that plays once.
// Reduced motion: final states, no scrub, no cursor, no tour.
export const html = document.documentElement;
export const mqReduce = matchMedia("(prefers-reduced-motion: reduce)");
export const mqDesk = matchMedia("(min-width: 900px)");
export const REDUCE = mqReduce.matches;
export const DESK = mqDesk.matches;
export const PIN = !REDUCE && DESK;
if (PIN) html.classList.add("pin");
if (!REDUCE) html.classList.add("motion");

export const $ = (s, r) => (r || document).querySelector(s);
export const $$ = (s, r) => Array.from((r || document).querySelectorAll(s));
export const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
