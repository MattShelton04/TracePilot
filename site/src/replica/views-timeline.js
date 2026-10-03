import { D } from "../data.js";
import { fmtInt, shortId } from "../lib/format.js";
import { ic, svgIcon } from "./icons.js";
import {
  AG,
  AG_ICON,
  AGENTS,
  AGI,
  esc,
  fmtDur,
  fmtTok,
  HERO,
  LANE_SPAN,
  T8,
  trunc,
} from "./shared.js";
import { seqSVG } from "./views-sequence.js";

/* timeline: agent tree */
export function treeSVG(_uid) {
  const W = 880,
    NW = 236,
    NH = 84;
  const mx = W / 2,
    my = 18;
  const kids = ["agent-review", "agent-e2e", "agent-safari"].map((id, i) => ({
    a: AGI[id],
    x: 140 + i * 300,
    y: 196,
  }));
  let s =
    '<svg class="dg" viewBox="0 0 ' +
    W +
    ' 300" role="img" aria-label="Agent tree for turn ' +
    D.agentTurn +
    '">';
  kids.forEach((k, i) => {
    const x1 = mx,
      y1 = my + NH,
      x2 = k.x,
      y2 = k.y;
    s +=
      '<path class="tr-link" data-i="' +
      i +
      '" d="M' +
      x1 +
      " " +
      y1 +
      " C" +
      x1 +
      " " +
      (y1 + 60) +
      " " +
      x2 +
      " " +
      (y2 - 60) +
      " " +
      x2 +
      " " +
      y2 +
      '" fill="none" stroke="' +
      AG[k.a.type] +
      '" stroke-opacity="0.85" stroke-width="1.6"/>';
  });
  const node = (x, y, w, color, icon, title, model, stats, badge, cls) => {
    let g = `<g class="${cls}">`;
    g +=
      '<rect x="' +
      x +
      '" y="' +
      y +
      '" width="' +
      w +
      '" height="' +
      NH +
      '" rx="8" fill="#111114" stroke="rgba(255,255,255,0.12)"/>';
    g +=
      '<rect x="' +
      (x + 4) +
      '" y="' +
      y +
      '" width="' +
      (w - 8) +
      '" height="2" rx="1" fill="' +
      color +
      '"/>';
    g += svgIcon(icon, x + 14, y + 15, 15, color);
    g +=
      '<text x="' +
      (x + 36) +
      '" y="' +
      (y + 27) +
      '" font-size="13" font-weight="600" fill="#fafafa">' +
      esc(title) +
      "</text>";
    g +=
      '<text x="' +
      (x + 14) +
      '" y="' +
      (y + 48) +
      '" font-size="11" fill="#71717a">' +
      model +
      "</text>";
    g +=
      '<text x="' +
      (x + 14) +
      '" y="' +
      (y + 69) +
      '" font-size="12" fill="#d4d4d8">' +
      stats +
      "</text>";
    g +=
      '<rect x="' +
      (x + w - 26) +
      '" y="' +
      (y + 58) +
      '" width="13" height="13" rx="2.5" fill="#22c55e" opacity="0.85"/><path d="M' +
      (x + w - 23) +
      " " +
      (y + 64.5) +
      " l2.6 2.6 l4.6 -5" +
      '" stroke="#0b0b0e" stroke-width="1.8" fill="none" stroke-linecap="round" stroke-linejoin="round"/>';
    if (badge) {
      g +=
        '<rect x="' +
        (x + w - 108) +
        '" y="' +
        (y - 9) +
        '" width="100" height="18" rx="9" fill="#6366f1"/><text x="' +
        (x + w - 58) +
        '" y="' +
        (y + 4) +
        '" text-anchor="middle" font-size="10" font-weight="700" fill="#fff">Parallel Group A</text>';
    }
    return `${g}</g>`;
  };
  const mainTools = T8.toolCalls.filter((c) => !c.parentToolCallId).length;
  s += node(
    mx - 140,
    my,
    280,
    AG.main,
    "bot",
    "Main Agent",
    T8.model,
    `${fmtDur(T8.durationMs)}   ·   ${mainTools} tools`,
    false,
    "tr-main",
  );
  kids.forEach((k, i) => {
    s += node(
      k.x - NW / 2,
      k.y,
      NW,
      AG[k.a.type],
      AG_ICON[k.a.type],
      trunc(k.a.name, 25),
      k.a.model,
      `${fmtDur(k.a.ms)}  ·  ${k.a.tools} tools  ·  ${fmtTok(k.a.tokens)} tok`,
      true,
      `tr-kid tr-kid${i}`,
    );
  });
  return `${s}</svg>`;
}

/* timeline: swimlanes / waterfall (simple gantt) */
export function lanesSVG(rows, total) {
  const W = 880,
    x0 = 210,
    x1 = 860,
    rh = 30;
  const X = (sec) => x0 + (sec / total) * (x1 - x0);
  let s =
    '<svg class="dg" viewBox="0 0 ' +
    W +
    " " +
    (rows.length * rh + 40) +
    '" role="img" aria-label="Timeline">';
  for (let t = 0; t <= total; t += 60)
    s +=
      '<line x1="' +
      X(t) +
      '" x2="' +
      X(t) +
      '" y1="0" y2="' +
      rows.length * rh +
      '" stroke="rgba(255,255,255,0.05)"/><text x="' +
      X(t) +
      '" y="' +
      (rows.length * rh + 18) +
      '" font-size="10" text-anchor="middle" fill="#71717a">' +
      t / 60 +
      "m</text>";
  rows.forEach((r, i) => {
    const y = i * rh;
    s +=
      '<text x="0" y="' +
      (y + 19) +
      '" font-size="11.5" fill="#d4d4d8">' +
      esc(trunc(r.label, 30)) +
      "</text>";
    s +=
      '<rect class="ln-bar" x="' +
      X(r.a) +
      '" y="' +
      (y + 8) +
      '" width="' +
      Math.max(3, X(r.b) - X(r.a)) +
      '" height="14" rx="3" fill="' +
      r.color +
      '" fill-opacity="0.55" stroke="' +
      r.color +
      '"/>';
  });
  return `${s}</svg>`;
}
export function panelTimeline(uid) {
  const t0 = new Date(T8.timestamp).getTime();
  const lanes = [{ label: "Main agent", a: 0, b: T8.durationMs / 1000, color: AG.main }].concat(
    AGENTS.map((a) => ({
      label: a.name,
      a: (a.start - t0) / 1000,
      b: (a.end - t0) / 1000,
      color: AG[a.type],
    })),
  );
  const fall = T8.toolCalls.map((t) => {
    const a = (new Date(t.startedAt).getTime() - t0) / 1000;
    const b = (new Date(t.completedAt).getTime() - t0) / 1000;
    const parent = t.isSubagent
      ? t.arguments.agent_type
      : t.parentToolCallId
        ? AGI[t.parentToolCallId].type
        : "main";
    return {
      label: t.toolName + (t.isSubagent ? ` · ${t.agentDisplayName}` : ""),
      a: a,
      b: b,
      color: AG[parent],
    };
  });
  return (
    '<div class="tm-head"><div><h3>Session Timeline</h3><p>Visual timeline of session events and interactions</p></div>' +
    '<div class="rp-seg"><button type="button" data-tl="lanes">Swimlanes</button><button type="button" data-tl="fall">Waterfall</button><button type="button" data-tl="tree">Agent Tree</button><button type="button" data-tl="messages">Messages</button></div></div>' +
    '<div class="rp-card tm-info"><span class="k">ID</span><span class="id">' +
    shortId(HERO.id) +
    '</span><span class="rp-badge rp-badge--accent">' +
    HERO.currentModel +
    '</span><span class="k hide-sm">Turns</span><b class="hide-sm">' +
    HERO.turnCount +
    '</b><span class="k hide-sm">Events</span><b class="hide-sm">' +
    fmtInt(HERO.eventCount) +
    "</b></div>" +
    '<div class="tm-stage">' +
    '<div class="tm-mode tm-tree" data-mode="tree"><div class="rp-card tm-nav"><span class="dis">' +
    ic("chevsL", 13) +
    ' Earliest</span><span class="act">' +
    ic("chevL", 13) +
    " Prev</span><b>Turn " +
    D.agentTurn +
    " (" +
    D.agentTurnCount +
    " of " +
    D.agentTurnCount +
    ' with agents)</b><span class="dis">Next ' +
    ic("chevR", 13) +
    '</span><span class="dis">Latest ' +
    ic("chevsR", 13) +
    "</span></div>" +
    '<div style="padding:26px 0 8px">' +
    treeSVG(uid) +
    "</div></div>" +
    '<div class="tm-mode tm-seqwrap" data-mode="messages" hidden>' +
    '<div class="tm-seq-tools"><div class="rp-seg rp-seg--solid"><button type="button" class="is-active">Sequence</button><button type="button">Lanes</button><button type="button">Graph</button></div>' +
    '<span class="tm-pillc">Launches <span class="n">3</span></span><span class="tm-pillc">Messages <span class="n">2</span></span><span class="tm-pillc">Reads <span class="n">3</span></span><div class="rp-select" style="min-width:150px;margin-left:4px">All agents ' +
    ic("chevD", 14) +
    "</div></div>" +
    '<div class="tm-seq-sum"><span class="l"><b>2</b><span>messages</span><b>1</b><span>peer</span><b>2</b><span>queued</span><b>3</b><span>reads</span></span>' +
    '<span class="tm-legend"><span><i style="border-color:#d4d4d8"></i>Launch prompt</span><span><i style="border-color:#818cf8"></i>To worker</span><span><i style="border-color:#fb923c"></i>Peer</span><span><i style="border-color:#a78bfa;border-top-style:dashed"></i>Read back</span></span></div>' +
    '<div class="rp-card tm-seq">' +
    seqSVG(uid) +
    "</div></div>" +
    '<div class="tm-mode tm-lanes" data-mode="lanes" hidden><div class="rp-card" style="padding:18px 16px 8px">' +
    lanesSVG(lanes, LANE_SPAN) +
    "</div></div>" +
    '<div class="tm-mode tm-lanes" data-mode="fall" hidden><div class="rp-card" style="padding:18px 16px 8px">' +
    lanesSVG(fall, LANE_SPAN) +
    "</div></div>" +
    "</div>"
  );
}
