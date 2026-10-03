import { gsap } from "../lib/gsap.js";
import { applyBranches, branchTo } from "./branches.js";
import { $, $$ } from "./env.js";
import { apps } from "./stage.js";
import { beats, typeInto } from "./util.js";

/* ----- 3. Agents: tree -> sequence ----- */
export function sceneAgents() {
  const app = apps.agents,
    scene = $("#agents"),
    g = app.__geo;
  const tl = gsap.timeline({ defaults: { ease: "power2.inOut" } });
  const tree = $(".tree-layer", app),
    seq = $(".seq-layer", app);
  const nodes = $$(".tnode", tree),
    conns = $$(".tree-svg path", tree),
    nav = $(".turnnav", tree);
  const heads = $$(".colhead", seq),
    lifelines = $$(".lifeline", seq),
    acts = $$(".act", seq),
    rows = $$(".msgrow", seq),
    tlabels = $$(".tlabel", seq),
    marker = $$(".marker, .scanline", seq);
  const tools = [$(".seq-tools", seq), $(".seq-sum", seq)],
    rule = $(".colhead-rule", seq);
  const segInk = $(".seg-views .seg-ink", app),
    segTree = $('.seg-views [data-v="tree"]', app),
    segMsg = $('.seg-views [data-v="msg"]', app);

  gsap.set(nodes, { opacity: 0, y: 16 });
  gsap.set(conns, { opacity: 0 });
  gsap.set([heads, tools, tlabels, marker], { opacity: 0 });
  gsap.set(heads, { y: 8 });
  gsap.set(rule, { scaleX: 0, transformOrigin: "0 50%" });
  gsap.set(lifelines, { scaleY: 0 });
  gsap.set(acts, { scaleY: 0 });
  const labels = rows.map((r) => {
    const l = $(".msglabel", r);
    const t = l.textContent;
    l.textContent = "";
    return { l, t };
  });
  rows.forEach((r) => {
    gsap.set($(".msgline", r), {
      scaleX: 0,
      transformOrigin: r.dataset.dir === "r" ? "0 50%" : "100% 50%",
    });
    gsap.set($(".msghead", r), { opacity: 0 });
  });

  // the rail wires into the tree as it builds: main from the side, subagents from below
  branchTo(tl, "agents", 0, 1, 0.05, 1.5);
  tl.to(nodes[0], { opacity: 1, y: 0, duration: 0.6, ease: "power3.out" }, 0.1);
  tl.to(conns, { opacity: 1, duration: 0.5, stagger: 0.1 }, 0.5);
  tl.to(
    nodes.slice(1),
    { opacity: 1, y: 0, duration: 0.6, ease: "power3.out", stagger: 0.12 },
    0.6,
  );
  tl.to({}, { duration: 1.8 }, 1.4);

  const S = 3.4;
  tl.to(
    segInk,
    { x: segMsg.offsetLeft, width: segMsg.offsetWidth, duration: 0.5, ease: "power3.inOut" },
    S,
  );
  tl.to(segTree, { color: "#fafafa", duration: 0.3 }, S);
  tl.to(segMsg, { color: "#a5b4fc", duration: 0.3 }, S + 0.2);
  tl.to([nav, conns], { opacity: 0, duration: 0.4 }, S + 0.3);
  const order = ["main", "review", "e2e", "safari"];
  nodes.forEach((n) => {
    const k = n.dataset.node,
      ci = order.indexOf(k);
    const cx = n.offsetLeft + n.offsetWidth / 2,
      cy = n.offsetTop + 43;
    tl.to(
      n,
      { x: g.colX[ci] - cx, y: 106 - cy, scale: 0.5, duration: 1.0, ease: "power3.inOut" },
      S + 0.45,
    );
    tl.to(n, { opacity: 0, duration: 0.35, ease: "power1.in" }, S + 1.05);
  });
  branchTo(tl, "agentsFade", 1, 0, S + 0.1, 0.45, "power1.in");
  tl.to(heads, { opacity: 1, y: 0, duration: 0.45, ease: "power2.out", stagger: 0.05 }, S + 1.15);
  tl.to(tools, { opacity: 1, duration: 0.5 }, S + 0.9);
  tl.to(rule, { scaleX: 1, duration: 0.6 }, S + 1.3);
  tl.to(lifelines, { scaleY: 1, duration: 0.8, ease: "power2.out", stagger: 0.06 }, S + 1.45);
  tl.to(marker, { opacity: 1, duration: 0.3 }, S + 1.9);

  const A0 = S + 2.2,
    step = 0.62;
  const rowAt = (i) => A0 + i * step;
  rows.forEach((r, i) => {
    const t = rowAt(i);
    tl.to(marker, { y: g.rowY(i) - g.rowY(0), duration: 0.3, ease: "power2.out" }, t - 0.05);
    tl.to($(".msgline", r), { scaleX: 1, duration: 0.42, ease: "power2.inOut" }, t);
    tl.to($(".msghead", r), { opacity: 1, duration: 0.12 }, t + 0.38);
    typeInto(tl, labels[i].l, labels[i].t, t + 0.1, 0.45);
    const lab = tlabels.find((x) => Math.abs(parseFloat(x.style.top) + 7 - g.rowY(i)) < 2);
    if (lab) tl.to(lab, { opacity: 1, duration: 0.25 }, t);
  });
  const actSpan = { main: [0, 7], review: [0, 6], e2e: [1, 7], safari: [2, 3] };
  acts.forEach((a) => {
    const [s, e] = actSpan[a.dataset.act];
    tl.to(a, { scaleY: 1, duration: rowAt(e) - rowAt(s) + 0.4, ease: "none" }, rowAt(s));
  });
  tl.to({}, { duration: 1.4 });
  beats(tl, scene, [0, S - 0.2, A0 + 1.4]);
  tl.eventCallback("onUpdate", applyBranches);
  return tl;
}
