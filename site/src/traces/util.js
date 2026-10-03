export const $ = (s, r) => (r || document).querySelector(s);
export const $$ = (s, r) => Array.from((r || document).querySelectorAll(s));
export const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
export const RM = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
export const NS = "http://www.w3.org/2000/svg";

/* Rail order, left to right (fixed for the whole page). */
export const RAIL = [
  { key: "task", c: "#fbbf24" },
  { key: "duck", c: "#fde047" },
  { key: "gp", c: "#a78bfa" },
  { key: "review", c: "#f472b6" },
  { key: "explore", c: "#22d3ee" },
  { key: "main", c: "#6366f1" },
];
export const RI = Object.fromEntries(RAIL.map((r, i) => [r.key, i]));
export const SPACING = 5;
export const off = (i) => (i - 2.5) * SPACING;

export function svgEl(tag, attrs, parent) {
  const e = document.createElementNS(NS, tag);
  for (const k in attrs) e.setAttribute(k, attrs[k]);
  if (parent) parent.appendChild(e);
  return e;
}
export const cubic = (p0, p1, p2, p3) => (t) => {
  const u = 1 - t;
  return {
    x: u * u * u * p0.x + 3 * u * u * t * p1.x + 3 * u * t * t * p2.x + t * t * t * p3.x,
    y: u * u * u * p0.y + 3 * u * u * t * p1.y + 3 * u * t * t * p2.y + t * t * t * p3.y,
  };
};
export function hexA(hex, a) {
  const v = parseInt(hex.slice(1), 16);
  return `rgba(${v >> 16},${(v >> 8) & 255},${v & 255},${a.toFixed(3)})`;
}
