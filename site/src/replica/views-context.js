import { D } from "../data.js";
import { ic } from "./icons.js";
import { CTX, CTX_LAST, CTX_PEAK, esc, fmtTok } from "./shared.js";
import { stat } from "./views-session.js";

/* context chart (svg) */
export function contextSVG(uid) {
  const P = CTX.points;
  const W = 900,
    x0 = 74,
    x1 = 880,
    y0 = 300,
    yT = 26;
  const X = (t) => x0 + (t / 11) * (x1 - x0);
  const Y = (v) => y0 - (v / 200000) * (y0 - yT);
  const cum = P.map((p) => [
    X(p.turn),
    p.systemTokens,
    p.systemTokens + p.toolDefinitionTokens,
    p.totalTokens,
  ]);
  const line = (k) =>
    cum.map((c, i) => `${(i ? "L" : "M") + c[0].toFixed(1)} ${Y(c[k]).toFixed(1)}`).join(" ");
  const back = (k) =>
    cum
      .slice()
      .reverse()
      .map((c) => `L${c[0].toFixed(1)} ${(k === 0 ? y0 : Y(c[k])).toFixed(1)}`)
      .join(" ");
  const area = (top, bottom) => `${line(top)} ${back(bottom)} Z`;
  let grid = "";
  [0, 50000, 100000, 150000, 200000].forEach((v) => {
    grid +=
      '<line x1="' +
      x0 +
      '" x2="' +
      x1 +
      '" y1="' +
      Y(v) +
      '" y2="' +
      Y(v) +
      '" stroke="rgba(255,255,255,0.05)"/>';
    grid +=
      '<text x="' +
      (x0 - 12) +
      '" y="' +
      (Y(v) + 4) +
      '" text-anchor="end" font-size="11" fill="#a1a1aa">' +
      (v ? `${v / 1000}k` : "0") +
      "</text>";
  });
  for (let t = 0; t <= 11; t++)
    grid +=
      '<text x="' +
      X(t) +
      '" y="' +
      (y0 + 34) +
      '" text-anchor="middle" font-size="10" fill="#71717a">T' +
      t +
      "</text>";
  grid +=
    '<text transform="translate(16 ' +
    (y0 - 130) +
    ') rotate(-90)" text-anchor="middle" font-size="11" fill="#71717a">Context tokens</text>';
  const xc = X(8);
  const limits =
    '<line x1="' +
    x0 +
    '" x2="' +
    x1 +
    '" y1="' +
    Y(200000) +
    '" y2="' +
    Y(200000) +
    '" stroke="#fb7185" stroke-width="1.3" stroke-dasharray="2 4"/>' +
    '<text x="' +
    (x1 - 2) +
    '" y="' +
    (Y(200000) - 7) +
    '" text-anchor="end" font-size="11" fill="#d4d4d8">Reported truncation limit · 200k</text>' +
    '<line x1="' +
    x0 +
    '" x2="' +
    x1 +
    '" y1="' +
    Y(D.compaction.before) +
    '" y2="' +
    Y(D.compaction.before) +
    '" stroke="#fbbf24" stroke-width="1.3" stroke-dasharray="2 4"/>' +
    '<text x="' +
    (x1 - 2) +
    '" y="' +
    (Y(D.compaction.before) - 7) +
    '" text-anchor="end" font-size="11" fill="#d4d4d8">Observed compaction median · ' +
    fmtTok(D.compaction.before).toLowerCase() +
    "</text>";
  let dots = "";
  for (let t = 0; t <= 11; t++)
    dots +=
      '<circle cx="' +
      X(t) +
      '" cy="' +
      (y0 + 12) +
      '" r="5.5" fill="#0b0b0e" stroke="#818cf8" stroke-width="1.8"/>';
  return (
    '<svg class="dg" viewBox="0 0 ' +
    W +
    ' 350" role="img" aria-label="Context pressure by turn: grows to ' +
    fmtTok(D.compaction.before) +
    " at turn " +
    D.compaction.turn +
    ", compacts to " +
    fmtTok(D.compaction.after) +
    '">' +
    '<defs><clipPath id="' +
    uid +
    '-cxclip"><rect class="cx-clip" x="0" y="0" width="' +
    W +
    '" height="350"/></clipPath>' +
    '<linearGradient id="' +
    uid +
    '-cxg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#d9a521"/><stop offset="1" stop-color="#b8891a"/></linearGradient></defs>' +
    grid +
    limits +
    '<g clip-path="url(#' +
    uid +
    '-cxclip)">' +
    '<path d="' +
    area(3, 2) +
    '" fill="url(#' +
    uid +
    '-cxg)" opacity="0.92"/>' +
    '<path d="' +
    area(2, 1) +
    '" fill="#5b5bd6"/>' +
    '<path d="' +
    area(1, 0) +
    '" fill="#9d8cf2" opacity="0.85"/>' +
    '<path d="' +
    line(3) +
    '" fill="none" stroke="#f3c64a" stroke-width="1.4"/>' +
    dots +
    "</g>" +
    '<g class="cx-comp" opacity="0">' +
    '<line x1="' +
    xc +
    '" x2="' +
    xc +
    '" y1="' +
    Y(200000) +
    '" y2="' +
    y0 +
    '" stroke="#fb7185" stroke-width="1.4" stroke-dasharray="3 3"/>' +
    '<circle cx="' +
    xc +
    '" cy="' +
    Y(200000) +
    '" r="8" fill="none" stroke="#fb7185" stroke-width="2"/>' +
    '<circle cx="' +
    xc +
    '" cy="' +
    Y(CTX_PEAK) +
    '" r="4.5" fill="#0b0b0e" stroke="#fb7185" stroke-width="1.6"/>' +
    '<text x="' +
    (xc + 14) +
    '" y="' +
    (Y(CTX_PEAK) + 30) +
    '" text-anchor="start" font-size="11" font-weight="600" fill="#fb7185">Compaction · ' +
    fmtTok(D.compaction.before) +
    " → " +
    fmtTok(D.compaction.after) +
    "</text>" +
    "</g>" +
    '<circle class="cx-pulse" cx="' +
    xc +
    '" cy="' +
    Y(CTX_PEAK) +
    '" r="10" fill="none" stroke="#fb7185" stroke-width="2" opacity="0"/>' +
    "</svg>"
  );
}

export function panelContext(uid) {
  return (
    '<div class="cx-top"><span class="cx-how">' +
    ic("info", 13) +
    'How estimates work</span><span class="cx-pills"><span class="cx-pill">' +
    CTX.observedPointCount +
    ' observed</span><span class="cx-pill" style="border-color:rgba(245,158,11,.4)">' +
    CTX.estimatedPointCount +
    ' estimated</span><span class="cx-pill" style="border-color:rgba(16,185,129,.4)">' +
    CTX.pairedCompactionCount +
    "/" +
    CTX.compactionCompleteCount +
    " paired</span></span></div>" +
    '<div class="rp-stats rp-stats--3" style="margin-bottom:14px">' +
    stat(fmtTok(CTX_PEAK), "Peak Context", "c-accent", ` data-count="${CTX_PEAK}" data-fmt="tok"`) +
    stat(fmtTok(CTX_LAST), "Latest Context", "c-done", ` data-count="${CTX_LAST}" data-fmt="tok"`) +
    stat(String(D.compaction.count), "Compactions", "c-warning cx-ncomp", "") +
    "</div>" +
    '<div class="rp-card rp-panel"><div class="rp-panel-head"><span class="rp-section-title">Context pressure by turn</span></div><div class="rp-panel-body">' +
    '<div class="cx-legend"><span class="sw"><i style="background:#9d8cf2"></i>System prompt</span><span class="sw"><i style="background:#5b5bd6"></i>Tool definitions</span><span class="sw"><i style="background:#d9a521"></i>Conversation</span><span class="mini"><i style="width:6px;height:6px;border-radius:50%;background:#818cf8;display:inline-block"></i>User message</span><span class="mini"><i style="width:14px;border-top:2px dotted #fbbf24;display:inline-block"></i>Pressure level</span></div>' +
    '<div class="cx-chart">' +
    contextSVG(uid) +
    "</div></div></div>"
  );
}

export function panelExplorer() {
  const md = D.heroPlan.content
    .split("\n")
    .map((l) => {
      const inl = (s) => esc(s).replace(/`([^`]+)`/g, "<code>$1</code>");
      if (l.startsWith("# ")) return `<h4>${inl(l.slice(2))}</h4>`;
      if (l.startsWith("## ")) return `<h5>${inl(l.slice(3))}</h5>`;
      if (l.startsWith("- ")) return `<li>${inl(l.slice(2))}</li>`;
      return l.trim() ? `<p>${inl(l)}</p>` : "";
    })
    .join("")
    .replace(/(<li>.*?<\/li>)+/g, (m) => `<ul>${m}</ul>`);
  const files = D.heroFiles.map((f) => {
    const depth = f.path.split("/").length - 1;
    const name = f.path.split("/").pop();
    return (
      '<div class="ex-node' +
      (depth ? " indent" : "") +
      (f.path === "plan.md" ? " is-active" : "") +
      '">' +
      ic(f.isDirectory ? "folder" : name.endsWith(".db") ? "db" : "file", 14) +
      name +
      "</div>"
    );
  });
  return (
    '<div class="ex"><div class="rp-card ex-tree">' +
    files.join("") +
    '</div><div class="rp-card ex-doc">' +
    md +
    "</div></div>"
  );
}
