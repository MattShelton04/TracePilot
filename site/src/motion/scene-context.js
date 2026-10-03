import { CTX } from "../app-views/context.js";
import { fmtK } from "../app-views/shell.js";
import { D } from "../data.js";
import { gsap } from "../lib/gsap.js";
import { applyBranches, branchTo } from "./branches.js";
import { $, $$, clamp } from "./env.js";
import { apps } from "./stage.js";
import { beats, fmtDur } from "./util.js";

/* ----- 4. Context -> Metrics, with the bill running alongside ----- */
export const COST = D.costs.hero;
export function sceneContext() {
  const app = apps.context,
    scene = $("#context"),
    g = app.__geo;
  const tl = gsap.timeline({ defaults: { ease: "power2.out" } });
  const pane = $(".ctx-pane", app),
    met = $(".met-pane", app);
  const clip = $(".clip-r", app),
    play = $(".playhead", app),
    ro = $(".readout", app),
    roT = $(".ro-t", ro),
    roV = $(".ro-v", ro),
    roC = $(".ro-c", ro);
  const peak = $('[data-ctx="peak"]', app),
    latest = $('[data-ctx="latest"]', app),
    comp = $('[data-ctx="comp"]', app);
  const aicEl = $('[data-ctx="aic"]', app),
    usdEl = $('[data-ctx="usd"]', app),
    costBar = $('[data-ctx="costbar"]', app);
  const dots = $$(".tdot", app),
    cliff = $(".cliff", app),
    pulse = $(".pulse", app),
    note = $(".cliff-note", app);
  const tiles = $$(".ctx-tiles .stile", pane),
    chart = $(".ctx-chart", pane);

  const P = g.pts;
  const pre = P.findIndex((p) => p.phase === "preCompaction");
  const valAt = (u) => {
    if (u <= 8) {
      const i = Math.floor(u),
        f = u - i;
      const a = P[Math.min(i, pre)].totalTokens,
        b = P[Math.min(i + 1, pre)].totalTokens;
      return { turn: Math.min(Math.round(u), 8), x: g.X(u), v: a + (b - a) * f };
    }
    if (u <= 8.6) {
      const f = (u - 8) / 0.6;
      return {
        turn: 8,
        x: g.X(8),
        v: P[pre].totalTokens + (P[pre + 1].totalTokens - P[pre].totalTokens) * f,
      };
    }
    const w = u - 0.6,
      i = Math.floor(w),
      f = w - i;
    const idx = (t) => (t <= 8 ? pre + 1 : pre + 1 + (t - 8));
    const a = P[idx(i)].totalTokens,
      b = P[idx(Math.min(i + 1, 11))].totalTokens;
    return { turn: Math.round(w), x: g.X(w), v: a + (b - a) * f };
  };
  // credits accrue with the context that is re-sent each turn: integrate tokens over turns
  const UMAX = 11.6,
    STEP = 0.05,
    cum = [0];
  for (let u = STEP; u <= UMAX + 1e-6; u += STEP) cum.push(cum[cum.length - 1] + valAt(u).v * STEP);
  const cumMax = cum[cum.length - 1];
  const costAt = (u) => {
    const k = clamp(u / STEP, 0, cum.length - 1),
      i = Math.floor(k),
      f = k - i;
    const c = cum[i] + (cum[Math.min(i + 1, cum.length - 1)] - cum[i]) * f;
    return c / cumMax;
  };
  const peakAt = [];
  for (let k = 0, pk = 0; k < cum.length; k++) {
    pk = Math.max(pk, valAt(k * STEP).v);
    peakAt.push(pk);
  }

  const st = { u: 0 };
  const paint = () => {
    const r = valAt(st.u);
    clip.setAttribute("width", Math.max(0.01, r.x - g.L + 0.5).toFixed(1));
    play.setAttribute("transform", `translate(${r.x.toFixed(1)},0)`);
    gsap.set(ro, { x: r.x, y: g.Y(r.v) - 26, xPercent: -50 });
    roT.textContent = r.turn;
    roV.textContent = fmtK(r.v);
    const pk = Math.max(peakAt[clamp(Math.round(st.u / STEP), 0, peakAt.length - 1)], r.v);
    peak.textContent = fmtK(pk);
    latest.textContent = fmtK(r.v);
    comp.textContent = st.u >= 8.3 ? "1" : "0";
    const c = costAt(st.u),
      aic = COST.aic * c;
    aicEl.textContent = aic.toFixed(1);
    usdEl.textContent = `$${(COST.usd * c).toFixed(2)}`;
    roC.textContent = `${aic.toFixed(1)} AIC`;
    costBar.style.transform = `scaleX(${c.toFixed(4)})`;
    dots.forEach((d, i) => {
      const ui = i <= 8 ? i : i + 0.6;
      d.style.opacity = st.u + 0.02 >= ui ? 1 : 0;
    });
  };
  paint();
  gsap.set([tiles, chart, $(".ctx-top", pane)], { opacity: 0, y: 14 });
  gsap.set(note, { opacity: 0, x: -8 });

  tl.to($(".ctx-top", pane), { opacity: 1, y: 0, duration: 0.5 }, 0.1);
  tl.to(tiles, { opacity: 1, y: 0, duration: 0.6, stagger: 0.08 }, 0.2);
  tl.to(chart, { opacity: 1, y: 0, duration: 0.7 }, 0.45);
  // three rail lines feed the chart's first turn: system prompt, tools, conversation
  branchTo(tl, "ctx", 0, 1, 0.25, 1.1);
  const U0 = 1.1,
    UD = 7.2,
    uT = (u) => U0 + (u / UMAX) * UD;
  branchTo(tl, "ctxFade", 1, 0, U0 + 1.0, 0.7, "power1.in");
  tl.to(st, { u: UMAX, duration: UD, ease: "none", onUpdate: paint }, U0);
  tl.fromTo(
    $(".cost-tile", pane),
    { "--glow": 0 },
    { "--glow": 1, duration: 0.3, yoyo: true, repeat: 1 },
    uT(8),
  );
  tl.to(cliff, { opacity: 1, duration: 0.2 }, uT(8));
  tl.fromTo(
    pulse,
    { opacity: 0.95, scale: 1, transformOrigin: "50% 50%" },
    { opacity: 0, scale: 3.4, duration: 0.8, ease: "power2.out", immediateRender: false },
    uT(8.05),
  );
  tl.to(note, { opacity: 1, x: 0, duration: 0.4 }, uT(8.3));
  tl.to(
    comp,
    { scale: 1.25, duration: 0.15, ease: "power2.out", transformOrigin: "0 50%" },
    uT(8.3),
  );
  tl.to(comp, { scale: 1, duration: 0.3, ease: "power2.out" }, uT(8.3) + 0.15);
  tl.to(ro, { opacity: 0, duration: 0.3 }, U0 + UD + 0.3);
  tl.to(play, { opacity: 0, duration: 0.3 }, U0 + UD + 0.3);

  const S = U0 + UD + 1.0;
  const tabs = $(".tabs", app),
    ink = $(".tab-ink", tabs),
    tc = $('.tab[data-tab="context"]', tabs),
    tm = $('.tab[data-tab="metrics"]', tabs);
  tl.to(ink, { x: tm.offsetLeft, width: tm.offsetWidth, duration: 0.55, ease: "power3.inOut" }, S);
  tl.to(tc, { color: "#a1a1aa", duration: 0.3 }, S);
  tl.to(tm, { color: "#fafafa", duration: 0.3 }, S + 0.2);
  tl.to($(".crumb-met", app), { opacity: 1, duration: 0.3 }, S + 0.1);
  tl.to(pane, { opacity: 0, y: -12, duration: 0.45, ease: "power2.in" }, S);
  tl.fromTo(
    met,
    { opacity: 0, y: 16 },
    { opacity: 1, y: 0, duration: 0.6, immediateRender: false },
    S + 0.35,
  );
  const cnt = $$("[data-count-to]", met),
    mtiles = $$(".stile", met);
  gsap.set(mtiles, { opacity: 0, y: 10 });
  tl.to(mtiles, { opacity: 1, y: 0, duration: 0.5, stagger: 0.07 }, S + 0.45);
  // the metrics tab picks up where the running total left off
  const fm = {
    aic: (v) => `${v.toFixed(1)} AIC`,
    usd: (v) => `$${v.toFixed(2)}`,
    k: (v) => fmtK(v),
    dur: (v) => fmtDur(v),
    pct: (v) => `${v.toFixed(1)}%`,
  };
  const cc = { p: 0 };
  const paintCount = () =>
    cnt.forEach((e) => {
      const to = parseFloat(e.dataset.countTo);
      const keep = e.dataset.fmt === "aic" || e.dataset.fmt === "usd";
      e.textContent = fm[e.dataset.fmt](keep ? to : to * cc.p);
    });
  tl.to(cc, { p: 1, duration: 1.4, ease: "power2.out", onUpdate: paintCount }, S + 0.6);
  const ring = $(".ring .fg", met),
    rate = CTX.hitRate;
  tl.fromTo(
    ring,
    { attr: { "stroke-dashoffset": 100 } },
    {
      attr: { "stroke-dashoffset": 100 - rate },
      duration: 1.4,
      ease: "power2.out",
      immediateRender: false,
    },
    S + 0.7,
  );
  tl.fromTo(
    $(".cache-fill", met),
    { scaleX: 0 },
    { scaleX: rate / 100, duration: 1.3, ease: "power2.out", immediateRender: false },
    S + 0.8,
  );
  $$(".dist .track i", met).forEach((b, i) => {
    const sx = gsap.getProperty(b, "scaleX");
    tl.fromTo(
      b,
      { scaleX: 0 },
      { scaleX: sx, duration: 1.0, ease: "power2.out", immediateRender: false },
      S + 1.0 + i * 0.1,
    );
  });
  paintCount();
  tl.to({}, { duration: 1.4 });
  beats(tl, scene, [0, uT(7.2), S]);
  tl.eventCallback("onUpdate", () => {
    paint();
    applyBranches();
  });
  return tl;
}
