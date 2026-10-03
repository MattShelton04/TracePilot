import { gsap } from "../lib/gsap.js";
import { rail } from "../traces/rail.js";
import { cache } from "./cache.js";
import { $, $$, PIN } from "./env.js";
import { field } from "./hero.js";
import { apps, setHeroDY } from "./stage.js";
import { beats, click, glide, pos } from "./util.js";

/* ----- 1. Hero settles; open any session ----- */
export function sceneOpen() {
  const app = apps.open,
    main = $(".main", app);
  const scene = $("#open"),
    win = $("#winOpen");
  const tl = gsap.timeline({ defaults: { ease: "power2.inOut" } });
  const cards = $$(".lib .card", app),
    card = cards[0];
  const cursor = $(".cursor", main),
    ripple = $(".ripple", main);

  const flips = [];
  const pair = (src, dst, scale) => {
    const a = pos(src, app),
      b = pos(dst, app);
    flips.push({ src, dst, x: a.x - b.x, y: a.y - b.y, scale });
  };
  pair($(".card-title .t", card), $(".dv-title .t", app), 15 / 22);
  const sc = $$(".chips .chip", card),
    dc = $$(".dv-chips .chip", app);
  sc.forEach((c, i) => {
    pair(c, dc[i], 1);
  });
  pair($('.num[data-k="events"]', card), $('[data-fly="events"]', app), 12 / 23);
  pair($('.num[data-k="turns"]', card), $('[data-fly="turns"]', app), 12 / 23);
  flips.forEach((f) => {
    gsap.set(f.dst, { x: f.x, y: f.y, scale: f.scale, opacity: 0, transformOrigin: "0 0" });
  });

  const dv = $(".dv", app);
  const tbar = $(".toolbar", dv),
    tabs = $$(".tab", dv),
    ink = $(".tab-ink", dv),
    tiles = $$(".stile", dv),
    labels = $$(".stile .l", dv),
    panels = $$(".dv-panels, .dv-more", dv);
  const otherTileVals = $$(".stile .v:not([data-fly])", dv);
  gsap.set([tbar, panels], { opacity: 0, y: 14 });
  gsap.set(tabs, { opacity: 0, y: 8 });
  gsap.set(ink, { scaleX: 0 });
  gsap.set([tiles, $(".tabs", dv)], { "--o": 0 });
  gsap.set([labels, otherTileVals], { opacity: 0 });
  gsap.set($(".crumb-detail", app), { opacity: 0 });
  const cardGlow = document.createElement("i");
  cardGlow.className = "card-bg";
  card.appendChild(cardGlow);
  gsap.set(cardGlow, {
    opacity: 0,
    borderColor: "rgba(52,211,153,.85)",
    boxShadow: "0 0 0 3px rgba(52,211,153,.12), 0 0 32px rgba(52,211,153,.18)",
  });

  // the hotspot lands on the card title; ripple and press share that point
  const tt = pos($(".card-title .t", card), main);
  const hot = { x: tt.x + Math.min(120, tt.w * 0.45), y: tt.y + tt.h * 0.55 };
  gsap.set(cursor, { x: 860, y: 600, opacity: 0, "--hand": 0 });
  gsap.set(ripple, { x: hot.x, y: hot.y, scale: 0.3, opacity: 0 });

  // --- hero settle; the rail draws in from the top ---
  let T0 = 0;
  const heroCopy = $("#heroCopy"),
    copy = $(".scene-copy", scene);
  setHeroDY();
  const railP = { v: 0 };
  tl.fromTo(
    win,
    { "--settle": 1 },
    { "--settle": 0, duration: 2, ease: "power2.inOut", immediateRender: true },
    0,
  );
  // unpinned (reduced motion) the hero stays a normal block above the window
  if (PIN) {
    // autoAlpha: once faded, the hero is hidden so its buttons stop catching clicks over the window
    tl.to(heroCopy, { y: -170, autoAlpha: 0, duration: 1.3, ease: "power1.in" }, 0);
    tl.to(
      "#heroEye .dial",
      { rotate: 50, transformOrigin: "50% 50%", duration: 1.3, ease: "none" },
      0,
    );
    tl.to(["#heroField", "#heroPulses"], { opacity: 0, duration: 1.1, ease: "power1.in" }, 0);
  }
  tl.fromTo(
    railP,
    { v: 0 },
    { v: 1, duration: 1.2, ease: "power2.inOut", onUpdate: () => rail.setReveal(railP.v) },
    0.7,
  );
  tl.fromTo(
    copy,
    { opacity: 0, y: 24 },
    { opacity: 1, y: 0, duration: 0.7, ease: "power2.out", immediateRender: false },
    1.35,
  );
  T0 = 2.1;
  tl.addLabel("anchor", T0); // the "Sessions" link lands here: hero gone, library in view

  // --- cursor glides in, becomes a hand over the card, and clicks ---
  tl.to(cursor, { opacity: 1, duration: 0.25 }, T0);
  glide(tl, cursor, hot, T0 + 0.05, 1.1);
  tl.to(cardGlow, { opacity: 1, duration: 0.3 }, T0 + 0.85);
  const C = T0 + 1.3;
  click(tl, cursor, ripple, hot, C);
  tl.to(card, { scale: 0.985, duration: 0.1, ease: "power1.in" }, C);
  tl.to(cursor, { opacity: 0, duration: 0.3 }, C + 0.55);

  // --- shared-element transition ---
  const F = C + 0.3;
  flips.forEach((f) => {
    tl.set(f.src, { opacity: 0 }, F);
    tl.set(f.dst, { opacity: 1 }, F);
  });
  tl.to($$(".dot-live, .badge-active", card), { opacity: 0, duration: 0.2 }, F);
  flips.forEach((f, i) => {
    tl.to(
      f.dst,
      { x: 0, y: 0, scale: 1, duration: 1.25, ease: "power3.inOut" },
      F + 0.05 + i * 0.035,
    );
  });
  tl.to(card, { scale: 1.035, opacity: 0, duration: 0.7, ease: "power2.in" }, F + 0.05);
  cards.slice(1).forEach((c, i) => {
    const k = i + 1,
      d = (k % 3) + Math.floor(k / 3);
    tl.to(c, { opacity: 0, scale: 0.94, y: 26, duration: 0.7, ease: "power2.in" }, F + d * 0.07);
  });
  tl.to($(".lib .filterbar", app), { opacity: 0, y: -10, duration: 0.5, ease: "power2.in" }, F);
  tl.to($(".crumb-lib b", app), { opacity: 0, duration: 0.3 }, F + 0.3);
  tl.to($(".crumb-detail", app), { opacity: 1, duration: 0.4 }, F + 0.45);
  tl.to(tbar, { opacity: 1, y: 0, duration: 0.6, ease: "power3.out" }, F + 0.75);
  tl.to(tabs, { opacity: 1, y: 0, duration: 0.45, ease: "power3.out", stagger: 0.05 }, F + 0.95);
  tl.to(ink, { scaleX: 1, duration: 0.5, ease: "power3.out" }, F + 1.4);
  tl.to($(".tabs", dv), { "--o": 1, duration: 0.5 }, F + 1.0);
  tl.to(tiles, { "--o": 1, duration: 0.6, ease: "power1.out", stagger: 0.05 }, F + 1.1);
  tl.to([labels, otherTileVals], { opacity: 1, duration: 0.5, stagger: 0.03 }, F + 1.3);
  tl.to(panels, { opacity: 1, y: 0, duration: 0.7, ease: "power3.out", stagger: 0.12 }, F + 1.5);
  const CACHE_AT = F + 0.9;
  tl.to({}, { duration: 2.2 }, F + 2.0);
  beats(tl, scene, [0, F + 1.4]);
  tl.eventCallback("onUpdate", () => {
    const t = tl.time();
    if (t >= CACHE_AT) cache.start();
    else cache.reset();
    if (field) field.setActive(t < 1.15);
    rail.setReveal(railP.v);
  });
  return tl;
}
