import { $$, PIN } from "./env.js";

/* ---------- small utilities ---------- */
export const pos = (el, root) => {
  let x = 0,
    y = 0,
    n = el;
  while (n && n !== root) {
    x += n.offsetLeft;
    y += n.offsetTop;
    n = n.offsetParent;
  }
  return { x, y, w: el.offsetWidth, h: el.offsetHeight };
};

export const fmtDur = (sec) => {
  sec = Math.round(sec);
  const m = Math.floor(sec / 60);
  return m ? `${m}m ${sec % 60}s` : `${sec}s`;
};
export function typeInto(tl, el, text, at, d) {
  const o = { n: 0 };
  tl.to(
    o,
    {
      n: text.length,
      duration: d,
      ease: "none",
      onUpdate: () => {
        el.textContent = text.slice(0, Math.round(o.n));
      },
    },
    at,
  );
}
export function beats(tl, scene, times) {
  if (!PIN) return;
  const bs = $$(".beat", scene);
  times.forEach((t, i) => {
    if (!i) return;
    tl.to(bs[i - 1], { opacity: 0, y: -10, duration: 0.4, ease: "power1.in" }, t);
    tl.fromTo(
      bs[i],
      { opacity: 0, y: 12 },
      { opacity: 1, y: 0, duration: 0.5, ease: "power2.out" },
      t + 0.3,
    );
  });
}
// cursor travel: arrow while moving, pointing hand once it is over the target
export function glide(tl, cursor, p, at, d) {
  tl.to(cursor, { "--hand": 0, duration: 0.12, ease: "none" }, at);
  tl.to(cursor, { x: p.x, y: p.y, duration: d, ease: "power2.inOut" }, at);
  tl.to(cursor, { "--hand": 1, duration: 0.14, ease: "none" }, at + d - 0.14);
}
// click at the hotspot: the press and the ripple both come from the fingertip
export function click(tl, cursor, ripple, p, at) {
  tl.to(cursor, { scale: 0.86, duration: 0.1, ease: "power1.in" }, at);
  tl.to(cursor, { scale: 1, duration: 0.14, ease: "power1.out" }, at + 0.1);
  tl.set(ripple, { x: p.x, y: p.y }, at);
  tl.fromTo(
    ripple,
    { scale: 0.25, opacity: 0.95 },
    { scale: 1.6, opacity: 0, duration: 0.55, ease: "power2.out", immediateRender: false },
    at,
  );
}
