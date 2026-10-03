import { AG, AGI, esc, T8, T8_START, trunc } from "./shared.js";

/* timeline: message sequence */
export const SEQ_COLS = [
  { id: "main", name: "Main agent", type: "main", x: 150 },
  { id: "agent-review", x: 345 },
  { id: "agent-e2e", x: 545 },
  { id: "agent-safari", x: 745 },
].map((c) => (AGI[c.id] ? { ...c, name: trunc(AGI[c.id].name, 27), type: AGI[c.id].type } : c));
// launches, a message to a worker, a peer message, and read-backs, in timestamp order
export const SEQ_MSGS = (() => {
  const call = (id) => T8.toolCalls.find((c) => c.toolCallId === id);
  const rel = (iso) => {
    const s = Math.max(0, Math.round((new Date(iso).getTime() - T8_START) / 1000));
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
  };
  const launch = (id) => {
    const m = T8.agentMessages.find((x) => x.recipientToolCallId === id && x.isLaunch);
    return { from: "main", to: id, kind: "launch", t: rel(m.timestamp), text: m.content };
  };
  const read = (id) => ({
    from: id,
    to: "main",
    kind: "read",
    t: rel(call(id.replace("agent-", "read-")).completedAt),
    text: call(id).resultContent.replace(/`/g, ""),
  });
  return [
    launch("agent-review"),
    launch("agent-e2e"),
    launch("agent-safari"),
    read("agent-safari"),
    {
      from: "main",
      to: "agent-e2e",
      kind: "worker",
      t: rel(call("write-e2e").startedAt),
      text: call("write-e2e").arguments.message,
    },
    {
      from: call("write-peer").parentToolCallId,
      to: "agent-e2e",
      kind: "peer",
      t: rel(call("write-peer").startedAt),
      text: call("write-peer").arguments.message,
    },
    read("agent-review"),
    read("agent-e2e"),
  ];
})();
export const SEQ_STYLE = {
  launch: ["#d4d4d8", ""],
  worker: ["#818cf8", ""],
  peer: ["#fb923c", ""],
  read: ["#a78bfa", "5 4"],
};
export function seqSVG(uid) {
  const W = 900,
    top = 74,
    step = 41,
    H = top + SEQ_MSGS.length * step + 26;
  const col = Object.fromEntries(SEQ_COLS.map((c) => [c.id, c]));
  const rowY = (i) => top + 24 + i * step;
  let s =
    '<svg class="dg" viewBox="0 0 ' +
    W +
    " " +
    H +
    '" role="img" aria-label="Sequence diagram of messages between the main agent and three subagents">';
  s += "<defs>";
  SEQ_MSGS.forEach((_m, i) => {
    s +=
      '<clipPath id="' +
      uid +
      "-sq" +
      i +
      '"><rect class="sq-clip" x="0" y="' +
      (rowY(i) - 20) +
      '" width="' +
      W +
      '" height="30"/></clipPath>';
  });
  s += "</defs>";
  // headers
  SEQ_COLS.forEach((c) => {
    s +=
      '<g class="sq-head"><circle cx="' +
      (c.x - 62) +
      '" cy="20" r="4" fill="' +
      AG[c.type] +
      '"/><text x="' +
      (c.x - 52) +
      '" y="24" font-size="12.5" font-weight="600" fill="#fafafa">' +
      esc(c.name) +
      "</text>" +
      '<text x="' +
      c.x +
      '" y="42" font-size="10" text-anchor="middle" fill="#71717a">' +
      c.type +
      "</text></g>";
  });
  s += `<line x1="0" x2="${W}" y1="58" y2="58" stroke="rgba(255,255,255,0.08)"/>`;
  // lifelines
  SEQ_COLS.forEach((c) => {
    s +=
      '<line class="sq-life" x1="' +
      c.x +
      '" x2="' +
      c.x +
      '" y1="' +
      top +
      '" y2="' +
      (H - 6) +
      '" stroke="rgba(255,255,255,0.09)" stroke-dasharray="3 4"/>';
  });
  // activation bars
  const act = { "agent-review": [0, 6], "agent-e2e": [1, 7], "agent-safari": [2, 3] };
  s +=
    '<rect class="sq-act" x="' +
    (col.main.x - 4) +
    '" y="' +
    (top + 8) +
    '" width="8" height="' +
    (H - top - 22) +
    '" rx="2" fill="#6366f1" fill-opacity="0.32" stroke="#6366f1" stroke-opacity="0.5"/>';
  Object.keys(act).forEach((k) => {
    const c = col[k],
      a = act[k];
    s +=
      '<rect class="sq-act" x="' +
      (c.x - 4) +
      '" y="' +
      (rowY(a[0]) - 2) +
      '" width="8" height="' +
      (rowY(a[1]) - rowY(a[0]) + 4) +
      '" rx="2" fill="' +
      AG[c.type] +
      '" fill-opacity="0.26" stroke="' +
      AG[c.type] +
      '" stroke-opacity="0.55"/>';
  });
  // time axis
  let last = "";
  SEQ_MSGS.forEach((m, i) => {
    if (m.t !== last)
      s +=
        '<text x="44" y="' +
        (rowY(i) + 4) +
        '" text-anchor="end" font-size="10.5" fill="#71717a">' +
        m.t +
        "</text>";
    last = m.t;
  });
  s +=
    '<g class="sq-head-line"><line class="sq-play" x1="54" x2="' +
    (W - 10) +
    '" y1="0" y2="0" stroke="#818cf8" stroke-opacity="0.18"/><path class="sq-play-m" d="M50 -4 L56 0 L50 4 z" fill="#818cf8"/></g>';
  // arrows
  SEQ_MSGS.forEach((m, i) => {
    const a = col[m.from].x,
      b = col[m.to].x,
      y = rowY(i);
    const dir = b > a ? 1 : -1;
    const xa = a + dir * 5,
      xb = b - dir * 6;
    const st = SEQ_STYLE[m.kind];
    const mid = (xa + xb) / 2;
    const maxChars = Math.floor(Math.abs(xb - xa) / 5.9);
    s +=
      '<g class="sq-msg" data-i="' +
      i +
      '" data-dir="' +
      dir +
      '" data-a="' +
      Math.min(xa, xb) +
      '" data-b="' +
      Math.max(xa, xb) +
      '" clip-path="url(#' +
      uid +
      "-sq" +
      i +
      ')">' +
      '<line x1="' +
      xa +
      '" x2="' +
      xb +
      '" y1="' +
      y +
      '" y2="' +
      y +
      '" stroke="' +
      st[0] +
      '" stroke-width="1.5"' +
      (st[1] ? ` stroke-dasharray="${st[1]}"` : "") +
      "/>" +
      '<path d="M' +
      xb +
      " " +
      y +
      " l" +
      -dir * 7 +
      " -4 l0 8 z" +
      '" fill="' +
      st[0] +
      '"/>' +
      '<text x="' +
      mid +
      '" y="' +
      (y - 7) +
      '" text-anchor="middle" font-size="11" fill="#c4c4cc">' +
      esc(trunc(m.text, maxChars)) +
      "</text>" +
      "</g>";
  });
  return `${s}</svg>`;
}
