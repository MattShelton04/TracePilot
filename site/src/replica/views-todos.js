import { D } from "../data.js";
import { fmtAic, fmtUsd } from "../lib/format.js";
import { ic, svgIcon } from "./icons.js";
import {
  CACHE_PCT,
  CACHE_READ,
  esc,
  fmtDur,
  fmtTok,
  IN_TOTAL,
  MODEL_ROWS,
  TODO_COUNTS,
  TOK_TOTAL,
  trunc,
} from "./shared.js";
import { stat } from "./views-session.js";

/* todos DAG (svg) */
export const TODO_POS = {
  "map-flow": [320, 30],
  provider: [215, 112],
  device: [425, 112],
  unit: [110, 194],
  button: [320, 194],
  cert: [530, 194],
  review: [215, 276],
  e2e: [425, 276],
  pr: [215, 358],
  docs: [425, 358],
};
export const TODO_LEVEL = {
  "map-flow": 0,
  provider: 1,
  device: 1,
  unit: 2,
  button: 2,
  cert: 2,
  review: 3,
  e2e: 3,
  pr: 4,
  docs: 4,
};
export function todoSVG(uid) {
  const T = D.heroTodos;
  const byId = Object.fromEntries(T.todos.map((t) => [t.id, t]));
  const NW = 166,
    NH = 44;
  const colors = {
    done: "rgba(52,211,153,0.45)",
    blocked: "rgba(251,113,133,0.6)",
    in_progress: "rgba(129,140,248,0.75)",
    pending: "rgba(161,161,170,0.35)",
  };
  let defs = "<defs>";
  Object.keys(colors).forEach((k) => {
    defs +=
      '<marker id="' +
      uid +
      "-m-" +
      k +
      '" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0 1 L9 5 L0 9 z" fill="' +
      colors[k] +
      '"/></marker>';
  });
  defs += "</defs>";
  let edges = "";
  T.deps.forEach((d) => {
    const p = TODO_POS[d.dependsOn],
      c = TODO_POS[d.todoId];
    const st = byId[d.todoId].status;
    const x1 = p[0],
      y1 = p[1] + NH / 2,
      x2 = c[0],
      y2 = c[1] - NH / 2 - 2;
    const my = (y1 + y2) / 2;
    edges +=
      '<path class="td-edge" data-lv="' +
      TODO_LEVEL[d.todoId] +
      '" d="M' +
      x1 +
      " " +
      y1 +
      " C" +
      x1 +
      " " +
      my +
      " " +
      x2 +
      " " +
      my +
      " " +
      x2 +
      " " +
      y2 +
      '" fill="none" stroke="' +
      colors[st] +
      '" stroke-width="1.4" marker-end="url(#' +
      uid +
      "-m-" +
      st +
      ')"/>';
  });
  let nodes = "";
  T.todos.forEach((t) => {
    const c = TODO_POS[t.id];
    const x = c[0] - NW / 2,
      y = c[1] - NH / 2;
    const st = t.status;
    const stroke = {
      done: "rgba(52,211,153,0.6)",
      blocked: "#fb7185",
      in_progress: "#818cf8",
      pending: "rgba(161,161,170,0.45)",
    }[st];
    const fill = {
      done: "rgba(16,185,129,0.07)",
      blocked: "rgba(244,63,94,0.06)",
      in_progress: "rgba(99,102,241,0.1)",
      pending: "rgba(255,255,255,0.02)",
    }[st];
    const glyph =
      st === "done"
        ? '<path class="td-tick" d="M' +
          (x + 12) +
          " " +
          (y + 17) +
          " l3 3 l6 -7" +
          '" fill="none" stroke="#34d399" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>'
        : st === "blocked"
          ? svgIcon("slash", x + 10, y + 9, 12, "#fb7185")
          : st === "in_progress"
            ? `<circle cx="${x + 15}" cy="${y + 16}" r="3" fill="#818cf8"/>`
            : '<circle cx="' +
              (x + 15) +
              '" cy="' +
              (y + 16) +
              '" r="2.6" fill="none" stroke="#a1a1aa" stroke-width="1.2"/>';
    const ty = st === "blocked" ? y + 20 : y + 20;
    nodes +=
      '<g class="td-node" data-lv="' +
      TODO_LEVEL[t.id] +
      '" data-st="' +
      st +
      '">' +
      '<rect x="' +
      x +
      '" y="' +
      y +
      '" width="' +
      NW +
      '" height="' +
      NH +
      '" rx="6" fill="#0d0d10"/>' +
      '<rect x="' +
      x +
      '" y="' +
      y +
      '" width="' +
      NW +
      '" height="' +
      NH +
      '" rx="6" fill="' +
      fill +
      '" stroke="' +
      stroke +
      '" stroke-width="1.2"' +
      (st === "blocked" ? ' stroke-dasharray="4 3"' : "") +
      "/>" +
      glyph +
      '<text x="' +
      (x + 27) +
      '" y="' +
      ty +
      '" font-size="11" font-weight="600" fill="#fafafa">' +
      esc(trunc(t.title, 22)) +
      "</text>" +
      (st === "blocked"
        ? '<text x="' +
          (x + 12) +
          '" y="' +
          (y + 35) +
          '" font-size="9" fill="rgba(251,113,133,0.75)">' +
          esc(trunc(t.description, 30)) +
          "</text>"
        : "") +
      "</g>";
  });
  return (
    '<svg class="dg" viewBox="0 0 640 392" role="img" aria-label="Todo dependency graph">' +
    defs +
    edges +
    nodes +
    "</svg>"
  );
}

export function panelTodos(uid) {
  const n = TODO_COUNTS,
    pc = (k) => `${Math.round((n[k] / n.total) * 100)}%`;
  return (
    '<div class="rp-card td-sum"><div class="td-sum-top"><span><span class="td-done-n">' +
    n.done +
    "</span>/" +
    n.total +
    ' completed</span><span class="c-success td-pct">' +
    pc("done") +
    "</span></div>" +
    '<div class="td-bar"><span style="width:' +
    pc("done") +
    ';background:var(--success-emphasis)"></span><span style="width:' +
    pc("in_progress") +
    ';background:var(--accent-emphasis)"></span><span style="width:' +
    pc("blocked") +
    ';background:var(--danger-emphasis)"></span></div>' +
    '<div class="td-legend"><span class="c-success">✓ ' +
    n.done +
    ' done</span><span class="c-accent">● ' +
    n.in_progress +
    ' in progress</span><span class="c-muted">○ ' +
    n.pending +
    ' pending</span><span class="c-danger">⊘ ' +
    n.blocked +
    " blocked</span></div></div>" +
    '<div class="td-tools"><div class="rp-seg"><button type="button">' +
    ic("list", 14) +
    ' List</button><button type="button" class="is-active">' +
    ic("fork", 14) +
    " Graph</button></div></div>" +
    '<div class="td-tools" style="margin-top:0">' +
    '<span class="td-chip" style="color:var(--success-fg);border-color:rgba(52,211,153,.45)">✓ Done <span class="n">' +
    n.done +
    "</span></span>" +
    '<span class="td-chip" style="color:var(--accent-fg);border-color:rgba(129,140,248,.5)">● In progress <span class="n">' +
    n.in_progress +
    "</span></span>" +
    '<span class="td-chip" style="color:var(--text-secondary);border-color:var(--border-default)">○ Pending <span class="n">' +
    n.pending +
    "</span></span>" +
    '<span class="td-chip" style="color:var(--danger-fg);border-color:rgba(251,113,133,.5)">⊘ Blocked <span class="n">' +
    n.blocked +
    "</span></span>" +
    "</div>" +
    '<div class="rp-card td-canvas">' +
    todoSVG(uid) +
    "</div>"
  );
}

export function panelMetrics() {
  const rows = MODEL_ROWS.slice().sort((a, b) => b.tok - a.tok);
  const R = 46,
    C = 2 * Math.PI * R;
  return (
    '<div class="rp-stats">' +
    stat(
      fmtAic(D.costs.hero.aic),
      "AI Credits (estimate)",
      "c-accent",
      ` data-count="${D.costs.hero.aic}" data-dec="1" data-suffix=" AIC"`,
    ) +
    stat(
      fmtUsd(D.costs.hero.usd),
      "AIC USD equivalent",
      "c-accent",
      ` data-count="${D.costs.hero.usd}" data-dec="2" data-prefix="$"`,
    ) +
    stat(
      fmtTok(TOK_TOTAL),
      "Total Tokens",
      "c-accent",
      ` data-count="${TOK_TOTAL}" data-fmt="tok"`,
    ) +
    stat(
      fmtDur(D.heroMetrics.totalApiDurationMs),
      "API Duration",
      "c-accent",
      ` data-count="${D.heroMetrics.totalApiDurationMs / 1000}" data-fmt="dur"`,
    ) +
    "</div>" +
    '<p class="mt-note">Estimated from GitHub token rates</p>' +
    '<div class="rp-seg rp-seg--solid" style="margin-bottom:14px"><button type="button" class="is-active">By model</button><button type="button">By agent</button></div>' +
    '<div class="rp-card rp-panel" style="margin-bottom:14px"><div class="rp-panel-head"><span class="rp-section-title">Cache breakdown</span><span class="c-sec" style="font-size:12px;font-weight:600">All models</span></div>' +
    '<div class="mt-cache"><div class="mt-ring"><svg viewBox="0 0 108 108"><circle cx="54" cy="54" r="' +
    R +
    '" fill="none" stroke="rgba(255,255,255,0.07)" stroke-width="7"/><circle class="mt-arc" cx="54" cy="54" r="' +
    R +
    '" fill="none" stroke="#34d399" stroke-width="7" stroke-linecap="round" stroke-dasharray="' +
    C.toFixed(2) +
    '" stroke-dashoffset="' +
    (C * (1 - CACHE_PCT / 100)).toFixed(2) +
    '"/></svg>' +
    '<div class="lbl"><b class="mt-pct" data-count="' +
    CACHE_PCT.toFixed(1) +
    '" data-dec="1" data-suffix="%">' +
    CACHE_PCT.toFixed(1) +
    "%</b><span>cache read</span></div></div>" +
    '<div class="mt-cache-body"><div class="mt-cache-cols"><div><div class="k">Read from cache</div><div class="v c-success">' +
    fmtTok(CACHE_READ) +
    '</div></div><div style="text-align:left;min-width:40%"><div class="k">Not served from cache</div><div class="v">' +
    fmtTok(IN_TOTAL - CACHE_READ) +
    "</div></div></div>" +
    '<div class="mt-track"><span style="width:' +
    CACHE_PCT.toFixed(1) +
    '%"></span></div><div class="c-sec" style="font-size:12px">' +
    fmtTok(IN_TOTAL) +
    " input tokens</div></div></div></div>" +
    '<div class="rp-card rp-panel"><div class="rp-panel-head"><span class="rp-section-title">Token distribution</span></div><div class="rp-panel-body"><div class="mt-dist">' +
    rows
      .map((r) => {
        const p = (r.tok / TOK_TOTAL) * 100;
        return (
          "<span>" +
          r.model +
          '</span><div class="bar"><span style="width:' +
          p.toFixed(1) +
          '%"></span></div><span class="n">' +
          fmtTok(r.tok) +
          '</span><span class="p">' +
          p.toFixed(1) +
          "%</span>"
        );
      })
      .join("") +
    "</div></div></div>"
  );
}
