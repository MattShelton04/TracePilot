import { gsap } from "../lib/gsap.js";
import { applyBranches, branchTo } from "./branches.js";
import { $, $$ } from "./env.js";
import { apps } from "./stage.js";
import { beats, fmtDur, pos } from "./util.js";

/* ----- 2. Conversation ----- */
export function sceneConvo() {
  const app = apps.convo,
    scene = $("#conversation");
  const scroll = $(".cv-scroll", app),
    view = $(".cv-viewport", app);
  const tl = gsap.timeline({ defaults: { ease: "power2.out" } });
  const q = (s) => $(s, app);
  const user = q('[data-b="user"]'),
    a1 = q('[data-b="a1"]'),
    intent = q('[data-b="intent"]'),
    par = q('[data-b="par"]');
  const acards = $$(".acard", app),
    rows = $$(".trow", app),
    pills = $$(".pill-done", app),
    a2 = q('[data-b="a2"]');
  const u9 = q('[data-b="user9"]'),
    a9 = q('[data-b="a9"]'),
    dls = $$(".dl", a9);

  gsap.set([user, a1, a2, u9, a9], { opacity: 0, y: 14 });
  gsap.set(intent, { opacity: 0, x: -12 });
  gsap.set(par, { opacity: 0 });
  const c0 = pos(acards[0], scroll);
  acards.forEach((c, i) => {
    const p = pos(c, scroll);
    c.style.zIndex = 10 - i;
    gsap.set(c, {
      opacity: 0,
      y: c0.y - p.y + i * 5 - 10,
      scale: 1 - i * 0.025,
      transformOrigin: "50% 0",
    });
  });
  const asstRail = $('[data-b="asst"] > .rail', app),
    parRail = $(".par-rail", app);
  gsap.set([asstRail, parRail], { scaleY: 0 });
  gsap.set($$(".acard-charge", app), { scaleX: 0 });
  gsap.set($$(".adot-done", app), { opacity: 0 });
  gsap.set(rows, { opacity: 0, x: -14 });
  gsap.set(pills, { opacity: 0, scale: 0.6, transformOrigin: "0 50%" });
  gsap.set(dls, { opacity: 0, x: -6 });

  tl.to(user, { opacity: 1, y: 0, duration: 0.7 }, 0.1);
  tl.to(a1, { opacity: 1, y: 0, duration: 0.7 }, 1.0);
  tl.to(intent, { opacity: 1, x: 0, duration: 0.5 }, 1.8);
  tl.to(par, { opacity: 1, duration: 0.4 }, 2.3);
  tl.to(asstRail, { scaleY: 0.25, duration: 1.2, ease: "power1.out" }, 1.0);
  // the rail peels off into the three agent cards as they deal out
  branchTo(tl, "convo", 0, 1, 1.7, 1.9);
  tl.to(acards, { opacity: 1, duration: 0.35, ease: "power1.out" }, 2.55);
  tl.to(
    acards.slice(1),
    { y: 0, scale: 1, duration: 0.9, ease: "power3.inOut", stagger: 0.14 },
    2.85,
  );
  tl.to(acards[0], { y: 0, duration: 0.6, ease: "power3.out" }, 2.6);
  tl.to(parRail, { scaleY: 1, duration: 1.0, ease: "power2.inOut" }, 2.6);
  tl.to(asstRail, { scaleY: 0.62, duration: 1.0, ease: "power2.inOut" }, 2.6);

  const CLK0 = 3.8,
    CLKD = 5.2,
    TMAX = 318;
  const at = (sec) => CLK0 + (sec / TMAX) * CLKD;
  const durEls = acards.map((c) => ({
    ms: +c.dataset.ms,
    dur: $(".dur", c),
    charge: $(".acard-charge", c),
    done: $(".adot-done", c),
  }));
  const clk = { t: 0 };
  const paintClock = () =>
    durEls.forEach((d) => {
      const s = Math.min(clk.t, d.ms / 1000);
      d.dur.textContent = fmtDur(s);
      gsap.set(d.charge, { scaleX: s / (d.ms / 1000) });
      gsap.set(d.done, { opacity: clk.t >= d.ms / 1000 ? 1 : 0 });
    });
  tl.to(clk, { t: TMAX, duration: CLKD, ease: "none", onUpdate: paintClock }, CLK0);
  paintClock();
  rows.forEach((r) => {
    tl.to(r, { opacity: 1, x: 0, duration: 0.45 }, at(+r.dataset.at));
  });
  const done = { safari: 64, review: 252, e2e: 318 };
  pills.forEach((p) => {
    tl.to(
      p,
      { opacity: 1, scale: 1, duration: 0.45, ease: "back.out(1.7)" },
      at(done[p.dataset.pill]) + 0.05,
    );
  });

  tl.to(asstRail, { scaleY: 1, duration: CLKD, ease: "none" }, CLK0);
  branchTo(tl, "convoFade", 1, 0, CLK0 + CLKD + 0.2, 0.6, "power1.in");
  tl.to(a2, { opacity: 1, y: 0, duration: 0.6 }, CLK0 + CLKD + 0.3);
  const endY = () => {
    const b = pos(a9, scroll);
    return -Math.max(0, b.y + b.h - view.clientHeight + 30);
  };
  tl.to(scroll, { y: endY, duration: 1.6, ease: "power2.inOut" }, CLK0 + CLKD + 1.0);
  tl.to(u9, { opacity: 1, y: 0, duration: 0.6 }, CLK0 + CLKD + 1.4);
  tl.to(a9, { opacity: 1, y: 0, duration: 0.6 }, CLK0 + CLKD + 1.8);
  tl.to(
    dls,
    { opacity: 1, x: 0, duration: 0.25, stagger: 0.12, ease: "power1.out" },
    CLK0 + CLKD + 2.2,
  );
  tl.to({}, { duration: 1.2 });
  beats(tl, scene, [0, 2.5, 5.2, CLK0 + CLKD + 1.3]);
  tl.eventCallback("onUpdate", applyBranches);
  return tl;
}
