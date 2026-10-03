import { D } from "../data.js";
import { gsap } from "../lib/gsap.js";
import { $, $$ } from "./env.js";
import { apps } from "./stage.js";
import { beats, click, glide, pos, typeInto } from "./util.js";

/* ----- 5. Launch ----- */
export function sceneLaunch() {
  const app = apps.launch,
    main = $(".main", app),
    scene = $("#launch"),
    L = app.__launch;
  const tl = gsap.timeline({ defaults: { ease: "power2.out" } });
  const q = (s) => $(s, app);
  const cursor = q(".cursor"),
    ripple = q(".ripple");
  const f = (k) => ({
    el: q(`[data-f="${k}"]`),
    val: q(`[data-f="${k}"] .val`),
    ph: q(`[data-f="${k}"] .ph`),
  });
  const repo = f("repo"),
    path = f("path"),
    model = f("model");
  const ta = q(".ta"),
    taVal = $(".val", ta),
    taPh = $(".ph", ta);
  const pv = (k) => q(`[data-p="${k}"]`);
  const toks = $$(".cmd .t", app),
    eff = q(".eff-ink"),
    btn = q(".launch-btn");
  const form = q(".ln-wrap"),
    lib = q(".lib2"),
    cards = $$(".lib2 .card", app);
  const crumbAlt = q(".crumb-lib2"),
    hl = q(".sb-hl");
  const sbL = q('.sb-item[data-nav="launcher"]'),
    sbS = q('.sb-item[data-nav="sessions"]');

  gsap.set(eff, { xPercent: 100 });
  gsap.set(form, { opacity: 0, y: 12 });
  gsap.set(cursor, { x: 520, y: 640, opacity: 0, "--hand": 0 });
  const slot = cards.map((c) => pos(c, lib));
  cards.forEach((c, i) => {
    if (i) gsap.set(c, { x: slot[i - 1].x - slot[i].x, y: slot[i - 1].y - slot[i].y });
  });
  gsap.set(cards[0], { opacity: 0, y: -28, scale: 0.96 });
  const swap = (el, a, b, at) => {
    el.textContent = a;
    const o = { p: 0 };
    tl.to(
      o,
      {
        p: 1,
        duration: 0.02,
        ease: "none",
        onUpdate: () => {
          el.textContent = o.p >= 1 ? b : a;
        },
      },
      at,
    );
  };

  tl.to(form, { opacity: 1, y: 0, duration: 0.6 }, 0.1);
  const at = (el, fx, fy) => {
    const p = pos(el, main);
    return { x: p.x + p.w * fx, y: p.y + p.h * fy };
  };
  const pRepo = at(repo.el, 0.3, 0.55),
    pModel = at(model.el, 0.3, 0.55),
    pHigh = at(q(".eff .hi"), 0.5, 0.55),
    pTa = at(ta, 0.22, 0.3),
    pBtn = at(btn, 0.5, 0.55);
  tl.to(cursor, { opacity: 1, duration: 0.25 }, 0.6);
  glide(tl, cursor, pRepo, 0.6, 0.6);
  tl.to(repo.ph, { opacity: 0, duration: 0.1 }, 1.2);
  typeInto(tl, repo.val, L.repo, 1.2, 0.7);
  typeInto(tl, path.val, L.path, 1.4, 0.6);
  tl.to(path.ph, { opacity: 0, duration: 0.1 }, 1.4);
  swap(pv("repo"), "—", L.path, 2.0);
  glide(tl, cursor, pModel, 2.1, 0.5);
  tl.to(model.ph, { opacity: 0, duration: 0.1 }, 2.6);
  typeInto(tl, model.val, L.model, 2.6, 0.4);
  swap(pv("model"), "Default", L.model, 3.0);
  swap(pv("tier"), "Standard", "Premium", 3.0);
  glide(tl, cursor, pHigh, 3.1, 0.5);
  click(tl, cursor, ripple, pHigh, 3.6);
  tl.to(eff, { xPercent: 200, duration: 0.4, ease: "power3.inOut" }, 3.65);
  tl.to(q(".eff .hi"), { color: "#a5b4fc", duration: 0.2 }, 3.8);
  swap(pv("eff"), "Medium", "High", 3.9);
  glide(tl, cursor, pTa, 4.0, 0.5);
  tl.to(cursor, { "--hand": 0, duration: 0.1 }, 4.5); // text field: back to the arrow
  tl.to(taPh, { opacity: 0, duration: 0.1 }, 4.5);
  typeInto(tl, taVal, L.prompt, 4.5, 2.6);
  swap(pv("prompt"), "—", L.prompt, 5.0);
  tl.to(
    toks,
    { opacity: 1, duration: 0.05, stagger: { each: 3.2 / toks.length, ease: "none" } },
    4.4,
  );
  glide(tl, cursor, pBtn, 7.8, 0.7);
  const C = 8.6;
  click(tl, cursor, ripple, pBtn, C);
  tl.to(btn, { scale: 0.97, duration: 0.1 }, C);
  tl.to(btn, { scale: 1, duration: 0.15 }, C + 0.1);
  swap(pv("active"), "0", "1", C + 0.2);
  tl.to(cursor, { opacity: 0, duration: 0.3 }, C + 0.5);
  const T = C + 0.8;
  tl.to(form, { opacity: 0, scale: 0.985, duration: 0.5, ease: "power2.in" }, T);
  tl.fromTo(
    lib,
    { opacity: 0, scale: 1.015 },
    { opacity: 1, scale: 1, duration: 0.6, immediateRender: false },
    T + 0.35,
  );
  tl.to(crumbAlt, { opacity: 1, duration: 0.3 }, T + 0.2);
  tl.to(hl, { y: sbS.offsetTop - sbL.offsetTop, duration: 0.6, ease: "power3.inOut" }, T + 0.1);
  tl.to(sbL, { color: "#a1a1aa", fontWeight: 400, duration: 0.3 }, T + 0.1);
  tl.to(sbS, { color: "#fafafa", fontWeight: 600, duration: 0.3 }, T + 0.3);
  tl.to($("svg", sbL), { color: "#71717a", duration: 0.3 }, T + 0.1);
  tl.to($("svg", sbS), { color: "#fafafa", duration: 0.3 }, T + 0.3);
  cards.slice(1).forEach((c, i) => {
    tl.to(c, { x: 0, y: 0, duration: 0.8, ease: "power3.inOut" }, T + 1.0 + i * 0.03);
  });
  tl.to(cards[0], { opacity: 1, y: 0, scale: 1, duration: 0.7, ease: "back.out(1.5)" }, T + 1.45);
  $$("[data-count]", app).forEach((e) => {
    swap(e, String(D.sessionCount), String(D.sessionCount + 1), T + 1.5);
  });
  tl.to({}, { duration: 1.6 });
  beats(tl, scene, [0, 7.4, T + 0.6]);
  return tl;
}
