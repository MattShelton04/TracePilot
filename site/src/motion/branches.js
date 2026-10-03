import { branchLayer, elbow, rail } from "../traces/rail.js";
import { $, $$, PIN } from "./env.js";
import { apps } from "./stage.js";
import { pos } from "./util.js";

/* ---------- scene geometry for the rail branches ---------- */
// layout-space point inside a window's .app, in scene px
export function appPoint(app, scene, el, fx, fy) {
  const win = app.parentElement,
    s = win.__s || 1;
  const wr = win.getBoundingClientRect(),
    sr = scene.getBoundingClientRect();
  const p = pos(el, app);
  return {
    x: wr.left - sr.left + (p.x + p.w * (fx || 0)) * s,
    y: wr.top - sr.top + (p.y + p.h * (fy == null ? 0.5 : fy)) * s,
    s,
  };
}
export const BR = {}; // per-scene branch layers, rebuilt on layout
export const branchState = { convo: 0, convoFade: 1, agents: 0, agentsFade: 1, ctx: 0, ctxFade: 1 };
export function layoutBranches() {
  if (!PIN || !rail.on) {
    Object.keys(BR).forEach((k) => {
      delete BR[k];
    });
    $$(".sig-branch").forEach((s) => {
      s.innerHTML = "";
    });
    return;
  }

  // conversation: three lines leave the rail and wire into the three agent cards
  {
    const scene = $("#conversation"),
      app = apps.convo,
      L = branchLayer($(".sig-branch", scene));
    const map = { review: "review", e2e: "gp", safari: "explore" };
    $$(".acard", app).forEach((c, j) => {
      const k = c.dataset.agent,
        p = appPoint(app, scene, c, 0, 0.5);
      const x = rail.lineX(map[k]);
      L.add(
        elbow(x, p.y, p.x + 2, 28, 90 + j * 26),
        c.style.getPropertyValue("--ac") || "#818cf8",
        1.5,
      );
    });
    BR.convo = L;
  }
  // agents: the main agent is fed from the side; a bus under the tree rises into each subagent
  {
    const scene = $("#agents"),
      app = apps.agents,
      L = branchLayer($(".sig-branch", scene));
    const railKey = { main: "main", review: "review", e2e: "gp", safari: "explore" };
    const mainNode = $('.tnode[data-node="main"]', app);
    const m = appPoint(app, scene, mainNode, 0, 0.5);
    L.add(elbow(rail.lineX("main"), m.y, m.x + 1, 30, 120), "#6366f1", 1.5);
    const kids = ["review", "e2e", "safari"].map((k) => $(`.tnode[data-node="${k}"]`, app));
    const bottoms = kids.map((n) => appPoint(app, scene, n, 0.5, 1));
    const base = Math.max(...bottoms.map((p) => p.y)) + 30 * bottoms[0].s;
    kids.forEach((n, i) => {
      const p = bottoms[i],
        x = rail.lineX(railKey[n.dataset.node]);
      const y = base + i * 8,
        r = 14;
      const d =
        "M" +
        x +
        " " +
        (y - 150) +
        " L" +
        x +
        " " +
        (y - r) +
        " Q" +
        x +
        " " +
        y +
        " " +
        (x + r) +
        " " +
        y +
        " L" +
        (p.x - r) +
        " " +
        y +
        " Q" +
        p.x +
        " " +
        y +
        " " +
        p.x +
        " " +
        (y - r) +
        " L" +
        p.x +
        " " +
        (p.y + 1);
      L.add(d, n.style.getPropertyValue("--ac") || "#818cf8", 1.5);
    });
    BR.agents = L;
  }
  // context: system prompt, tool definitions and conversation feed the chart's first point
  {
    const scene = $("#context"),
      app = apps.context,
      g = app.__geo,
      L = branchLayer($(".sig-branch", scene));
    const wrap = $(".chart-wrap", app),
      p0 = g.pts[0];
    const o = appPoint(app, scene, wrap, 0, 0);
    const spec = [
      { key: "task", v: p0.totalTokens, c: "#fbbf24" },
      { key: "main", v: p0.systemTokens + p0.toolDefinitionTokens, c: "#818cf8" },
      { key: "gp", v: p0.systemTokens, c: "#c4b5fd" },
    ];
    spec.forEach((sp, i) => {
      // land just inside the top edge of each band (the svg sits 6px into the wrap)
      const y = o.y + (6 + g.Y(sp.v) + 3) * o.s;
      L.add(elbow(rail.lineX(sp.key), y, o.x + g.L * o.s, 34, 120 + i * 22), sp.c, 1.5);
    });
    BR.ctx = L;
  }
  applyBranches();
}
export function applyBranches() {
  if (BR.convo) {
    BR.convo.lines.forEach((l, i) => {
      l.set(branchState.convo * 1.12 - i * 0.06);
    });
    BR.convo.fade(branchState.convoFade);
  }
  if (BR.agents) {
    BR.agents.lines.forEach((l, i) => {
      l.set(branchState.agents * 1.15 - i * 0.05);
    });
    BR.agents.fade(branchState.agentsFade);
  }
  if (BR.ctx) {
    BR.ctx.lines.forEach((l, i) => {
      l.set(branchState.ctx * 1.12 - i * 0.06);
    });
    BR.ctx.fade(branchState.ctxFade);
  }
}
// a scrubbed tween that writes a branch state key
export function branchTo(tl, key, from, to, at, d, ease) {
  const o = { v: from };
  tl.fromTo(
    o,
    { v: from },
    {
      v: to,
      duration: d,
      ease: ease || "power1.inOut",
      onUpdate: () => {
        branchState[key] = o.v;
        applyBranches();
      },
    },
    at,
  );
}
