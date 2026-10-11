import { D } from "../data.js";
import { sourceLogo, sourceSwitch } from "../lib/sources.js";
import { ic } from "./icons.js";
import { esc, fmtTok } from "./shared.js";

/*
 * Analytics, Tools, Code and Models: condensed replicas of the redesigned
 * pages (apps/desktop/src/views/AnalyticsDashboardView.vue, ToolAnalysisView,
 * CodeImpactView, ModelComparisonView and their panels). Same section order,
 * KPI strips and day charts, drawn from the showcase data.
 */

/* ---------- formatting (as @tracepilot/types and the analytics utils) ---------- */
const clean = (v, d) => String(+v.toFixed(d));
const num = (n) => {
  const a = Math.abs(n);
  if (a >= 1e9) return `${clean(n / 1e9, 1)}B`;
  if (a >= 1e6) return `${clean(n / 1e6, 1)}M`;
  if (a >= 1e3) return `${clean(n / 1e3, 1)}K`;
  return String(Math.round(n));
};
const full = (n) => Math.round(n).toLocaleString("en-US");
const pct = (v) => `${clean(v, 1)}%`;
const share = (p) =>
  p <= 0 ? "0%" : p < 0.1 ? "<0.1%" : p < 1 ? `${p.toFixed(1)}%` : `${Math.round(p)}%`;
const aic = (c) =>
  `${c.toLocaleString("en-US", { maximumFractionDigits: c < 100 ? 2 : c < 1000 ? 1 : 0 })} AIC`;
const usd = (v) =>
  `$${v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
function dur(ms) {
  const s = ms / 1000,
    h = Math.floor(s / 3600),
    m = Math.floor((s % 3600) / 60);
  if (h) return `${h}h ${m}m`;
  if (m) return `${m}m ${Math.floor(s % 60)}s`;
  return `${clean(s, 1)}s`;
}
const callTime = (ms) =>
  ms < 1000 ? `${Math.round(ms)}ms` : ms < 60000 ? `${(ms / 1000).toFixed(1)}s` : dur(ms);
function toolTime(ms) {
  if (ms < 1000) return callTime(ms);
  if (ms < 60000) return `${Math.round(ms / 1000)}s`;
  if (ms < 3.6e6) return `${Math.round(ms / 60000)}m`;
  const h = ms / 3.6e6;
  return h < 10 ? `${h.toFixed(1)}h` : `${full(h)}h`;
}
const day = (iso) =>
  new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
const sum = (a) => a.reduce((x, y) => x + y, 0);

/* ---------- colours (app tokens) ---------- */
const MODEL_COLORS = [
  "var(--chart-primary)",
  "var(--chart-success)",
  "var(--chart-warning)",
  "var(--chart-danger)",
  "var(--chart-cyan)",
  "var(--chart-orange)",
];
/** File types (app codeImpact TYPE_COLORS); later types share the grey. */
const TYPE_COLORS = [
  "var(--chart-primary)",
  "var(--chart-cyan)",
  "var(--chart-success)",
  "var(--chart-warning)",
  "var(--chart-pink)",
  "var(--chart-orange)",
];
const COPILOT = "var(--accent-fg)";
const COMPOSITION = [
  ["cacheRead", "Cache reads", "var(--chart-primary)"],
  ["cacheWrite", "Cache writes", "var(--chart-secondary)"],
  ["fresh", "Fresh input", "var(--chart-cyan)"],
  ["output", "Output", "var(--chart-success)"],
];

/* ---------- icons the shared set lacks (lucide) ---------- */
const LI = {
  layers:
    '<path d="m12.83 2.18a2 2 0 0 0-1.66 0L2.6 6.08a1 1 0 0 0 0 1.83l8.58 3.91a2 2 0 0 0 1.66 0l8.58-3.9a1 1 0 0 0 0-1.83Z"/><path d="m22 17.65-9.17 4.16a2 2 0 0 1-1.66 0L2 17.65"/><path d="m22 12.65-9.17 4.16a2 2 0 0 1-1.66 0L2 12.65"/>',
  coins:
    '<circle cx="8" cy="8" r="6"/><path d="M18.09 10.37A6 6 0 1 1 10.34 18"/><path d="M7 6h1v4"/><path d="m16.71 13.88.7.71-2.82 2.82"/>',
  octX: '<path d="M2.586 16.726A2 2 0 0 1 2 15.312V8.688a2 2 0 0 1 .586-1.414l4.688-4.688A2 2 0 0 1 8.688 2h6.624a2 2 0 0 1 1.414.586l4.688 4.688A2 2 0 0 1 22 8.688v6.624a2 2 0 0 1-.586 1.414l-4.688 4.688a2 2 0 0 1-1.414.586H8.688a2 2 0 0 1-1.414-.586z"/><path d="m15 9-6 6"/><path d="m9 9 6 6"/>',
  octA: '<path d="M12 16h.01"/><path d="M12 8v4"/><path d="M15.312 2a2 2 0 0 1 1.414.586l4.688 4.688A2 2 0 0 1 22 8.688v6.624a2 2 0 0 1-.586 1.414l-4.688 4.688a2 2 0 0 1-1.414.586H8.688a2 2 0 0 1-1.414-.586l-4.688-4.688A2 2 0 0 1 2 15.312V8.688a2 2 0 0 1 .586-1.414l4.688-4.688A2 2 0 0 1 8.688 2z"/>',
  tri: '<path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3"/><path d="M12 9v4"/><path d="M12 17h.01"/>',
  clock: '<circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>',
  diff: '<path d="M12 3v14"/><path d="M5 10h14"/><path d="M5 21h14"/>',
  fileCode:
    '<path d="M10 12.5 8 15l2 2.5"/><path d="m14 12.5 2 2.5-2 2.5"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/><path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7z"/>',
  cpu: '<rect width="16" height="16" x="4" y="4" rx="2"/><rect width="6" height="6" x="9" y="9" rx="1"/><path d="M15 2v2"/><path d="M15 20v2"/><path d="M2 15h2"/><path d="M2 9h2"/><path d="M20 15h2"/><path d="M20 9h2"/><path d="M9 2v2"/><path d="M9 20v2"/>',
  minimize:
    '<polyline points="4 14 10 14 10 20"/><polyline points="20 10 14 10 14 4"/><line x1="14" x2="21" y1="10" y2="3"/><line x1="3" x2="10" y1="21" y2="14"/>',
  scissors:
    '<circle cx="6" cy="6" r="3"/><path d="M8.12 8.12 12 12"/><path d="M20 4 8.12 15.88"/><circle cx="6" cy="18" r="3"/><path d="M14.8 14.8 20 20"/>',
  gauge: '<path d="m12 14 4-4"/><path d="M3.34 19a10 10 0 1 1 17.32 0"/>',
  arrowR: '<path d="M5 12h14"/><path d="m12 5 7 7-7 7"/>',
};
const li = (name, size) =>
  `<svg class="ic" width="${size || 13}" height="${size || 13}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${LI[name]}</svg>`;
const icon = (name, size) => (LI[name] ? li(name, size) : ic(name, size || 13));

/* ---------- shared pieces ---------- */
const RANGES = ["All Time", "7 Days", "30 Days", "90 Days", "This Month", "Custom"];
export function pageHead(title, sub) {
  return `<div class="rp-page-head an-head"><div class="an-head-l"><h3 class="rp-page-h">${title}</h3><p class="rp-page-sub">${sub}</p><div class="rp-seg rp-seg--solid an-range">${RANGES.map((r, i) => `<button type="button"${i ? "" : ' class="is-active"'}>${r}</button>`).join("")}</div></div><div class="an-head-r"><div class="rp-select an-repo">All Repositories ${ic("chevD", 14)}</div>${sourceSwitch("an-src")}</div></div>`;
}
/** A compact segmented control; the first option is selected. */
const seg = (opts, on = 0) =>
  `<span class="rp-seg rp-seg--solid an-seg">${opts.map((o, i) => `<button type="button"${i === on ? ' class="is-active"' : ""}>${o}</button>`).join("")}</span>`;
const panel = (title, aside, body, cls = "") =>
  `<section class="rp-card rp-panel an-panel ${cls}"><div class="an-ph"><h4>${title}</h4>${aside ? `<div class="an-aside">${aside}</div>` : ""}</div>${body}</section>`;
const kpi = (label, iconName, value, footer) =>
  `<div class="an-kpi"><div class="an-kpi-l">${icon(iconName)}${label}</div><div class="an-kpi-v">${value}</div><div class="an-kpi-f">${footer}</div></div>`;
const note = (html) => `<span class="an-note">${html}</span>`;
const meter = (parts, cls = "") =>
  `<div class="an-meter ${cls}">${parts.map(([w, c, t]) => `<i class="an-gx" style="width:${w}%;background:${c}"${t ? ` title="${esc(t)}"` : ""}></i>`).join("")}</div>`;
const track = (parts, cls = "") =>
  `<span class="an-track ${cls}">${parts.map(([w, c]) => `<i class="an-gx" style="width:${Math.max(0.6, w)}%;background:${c}"></i>`).join("")}</span>`;
const sw = (c) => `<i class="an-sw" style="background:${c}"></i>`;
/** Legend items are [colour, label, round?]; round swatches mark pins. */
const legend = (items) =>
  `<span class="an-legend">${items.map(([c, l, round]) => `<span><i class="an-sw${round ? " an-sw--pin" : ""}" style="background:${c}"></i>${l}</span>`).join("")}</span>`;

/** Merge consecutive values so at most `max` remain (app binRows). */
function bin(vals, max) {
  if (vals.length <= max) return vals.slice();
  const size = Math.ceil(vals.length / max),
    out = [];
  for (let i = 0; i < vals.length; i += size) out.push(sum(vals.slice(i, i + size)));
  return out;
}
/** The KPI's day strip: tall-enough bars, zero days as a hairline. */
function strip(vals, color) {
  const b = bin(vals, 46),
    max = Math.max(1, ...b);
  return `<div class="an-strip"${color ? ` style="--c:${color}"` : ""}>${b.map((v) => (v ? `<i class="an-bar" style="height:${Math.max(12, (v / max) * 100).toFixed(1)}%"></i>` : '<i class="z"></i>')).join("")}</div>`;
}

/** A round axis top and 2–4 ticks (app niceTicks). */
function niceTicks(max) {
  if (max <= 0) return { top: 1, ticks: [] };
  const mag = 10 ** Math.floor(Math.log10(max / 3));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => Math.ceil(max / s) <= 4);
  const top = Math.ceil(max / step) * step;
  const ticks = [];
  for (let t = step; t <= top + step / 1e6; t += step) ticks.push(t);
  return { top, ticks };
}

/**
 * The day chart every analytics page shares (AnalyticsDayChart): stacked bars
 * over days, dashed grid with y labels, sparse date ticks, optional pins.
 */
function dayChart({ dates, series, values, fmt, height = 160, pins }) {
  const totals = dates.map((_, i) => sum(values.map((v) => v[i])));
  const { top, ticks } = niceTicks(Math.max(...totals));
  const n = dates.length;
  const narrow = n < 12 ? " an-col--wide" : "";
  const cols = dates
    .map((_, i) =>
      totals[i]
        ? `<div class="an-col${narrow}"><div class="an-stack an-bar" style="height:max(2px,${((totals[i] / top) * 100).toFixed(2)}%)">${series.map((s, j) => (values[j][i] ? `<i style="flex-grow:${values[j][i]};background:${s.color}"></i>` : "")).join("")}</div></div>`
        : `<div class="an-col${narrow}"><div class="an-zero"></div></div>`,
    )
    .join("");
  const grid = ticks
    .map(
      (t) => `<div class="an-grid" style="bottom:${(t / top) * 100}%"><span>${fmt(t)}</span></div>`,
    )
    .join("");
  const LABELS = Math.min(7, n);
  const idx = [
    ...new Set(
      Array.from({ length: LABELS }, (_, k) => Math.round((k * (n - 1)) / (LABELS - 1 || 1))),
    ),
  ];
  const axis = idx
    .map((i, k) => {
      const al = k === 0 ? "s" : k === idx.length - 1 ? "e" : "m";
      const left = al === "s" ? 0 : al === "e" ? 100 : ((i + 0.5) / n) * 100;
      return `<span class="an-tick an-tick--${al}" style="left:${left}%">${day(dates[i])}</span>`;
    })
    .join("");
  let pinRow = "",
    guides = "";
  if (pins) {
    // Pins closer than about 26px merge into one, with a count (as the app).
    const merged = [];
    pins.forEach((p, i) => {
      if (!p) return;
      const at = ((i + 0.5) / n) * 100;
      const last = merged.at(-1);
      if (last && at - last.at < 3.4) {
        last.errors += p[0];
        last.rate += p[1];
      } else merged.push({ at, errors: p[0], rate: p[1] });
    });
    pinRow = `<div class="an-pins">${merged
      .map((p) => {
        const c = p.errors + p.rate;
        return `<span class="an-pin an-pin--${p.errors ? "err" : "rate"}" style="left:${p.at.toFixed(2)}%">${li(p.errors ? "octX" : "tri", 10)}${c > 1 ? `<b>${c}</b>` : ""}</span>`;
      })
      .join("")}</div>`;
    guides = merged
      .map((p) => `<span class="an-guide" style="left:${p.at.toFixed(2)}%"></span>`)
      .join("");
  }
  return `<div class="an-day${pins ? " an-day--pins" : ""}">${pinRow}<div class="an-plot" style="height:${height}px">${grid}${guides}<div class="an-cols">${cols}</div></div><div class="an-axis">${axis}</div></div>`;
}
function dayFoot(dates, totals, fmt, legendItems, extra = "") {
  const active = totals.filter((t) => t > 0);
  const peak = totals.indexOf(Math.max(...totals));
  const quiet = totals.length - active.length;
  return `<div class="an-foot"><span>Busiest <b>${day(dates[peak])}</b> (${fmt(totals[peak])})</span><span>Average <b>${fmt(sum(active) / active.length)}</b> per active day</span>${quiet ? `<span><b>${quiet}</b> quiet day${quiet === 1 ? "" : "s"}</span>` : ""}${extra}${legend(legendItems)}</div>`;
}

/* ---------- shared data ---------- */
const A = D.analytics;
const AM = D.analyticsMore;
// "All Time" covers every day in the range, leading quiet days included, as in the app
const DATES = A.activityPerDay.map((d) => d.date);
const RUNS = A.activityPerDay.map((d) => d.count);
const INC = AM.incidentsByDay.map((r) => (r ? [Math.max(0, r[0] - r[1]), r[1], r[2]] : null));

/** Models in token order with their colour, token kinds and AI Credits. */
const MODELS = A.modelDistribution.map((m, i) => {
  const credits = AM.modelAic[i];
  return {
    ...m,
    color: MODEL_COLORS[i] || "var(--neutral-emphasis)",
    credits,
    usd: credits * 0.01,
    cacheRead: m.cacheReadTokens,
    cacheWrite: m.cacheWriteTokens,
    fresh: m.inputTokens - m.cacheReadTokens - m.cacheWriteTokens,
    output: m.outputTokens,
    hit: (m.cacheReadTokens / m.inputTokens) * 100,
  };
});
const COMP = Object.fromEntries(COMPOSITION.map(([k]) => [k, sum(MODELS.map((m) => m[k]))]));
COMP.total = A.totalTokens;
COMP.input = sum(MODELS.map((m) => m.inputTokens));

/* ======================= Analytics dashboard ======================= */
export function viewAnalytics() {
  const all = D.costs.all;
  const runs = sum(RUNS);
  const activeDays = RUNS.filter(Boolean).length;
  const errors = sum(INC.map((r) => (r ? r[0] : 0)));
  const rate = sum(INC.map((r) => (r ? r[1] : 0)));
  const P = AM.apiDurationStats;
  const tokParts = COMPOSITION.filter(([k]) => COMP[k] > 0).map(([k, l, c]) => [
    (COMP[k] / COMP.total) * 100,
    c,
    `${l}: ${num(COMP[k])}`,
  ]);
  const tokB = (A.totalTokens / 1e9).toFixed(1);
  const kpis =
    `<div class="an-kpis">` +
    kpi(
      "Sessions",
      "layers",
      `<span data-count="${A.totalSessions}">${A.totalSessions}</span>`,
      strip(RUNS) +
        note(`<b>${full(runs)}</b> runs · active <b>${activeDays}</b> of ${DATES.length} days`),
    ) +
    kpi(
      "Tokens",
      "zap",
      `<span data-count="${tokB}" data-dec="1" data-suffix="B">${num(A.totalTokens)}</span>`,
      meter(tokParts) +
        note(
          `<b>${share((COMP.cacheRead / COMP.total) * 100)}</b> cache reads · ${num(COMP.fresh)} fresh`,
        ),
    ) +
    kpi(
      "AI Credits",
      "coins",
      `<span data-count="${Math.round(all.aic)}" data-fmt="int">${full(all.aic)}</span><small>AIC</small>`,
      note(`≈ ${usd(all.usd)} · 0 of ${A.totalSessions} observed`),
    ) +
    kpi(
      "Model time / session",
      "clock",
      `<span>${dur(P.medianMs)}</span>`,
      note(`median · p95 <b>${dur(P.p95Ms)}</b> · ${full(P.totalSessionsWithDuration)} timed`),
    ) +
    kpi(
      "Errors",
      "octA",
      `<span data-count="${errors + rate}">${errors + rate}</span>`,
      note(`<b>${rate}</b> rate limits · in ${A.sessionsWithErrors} sessions`),
    ) +
    "</div>";

  // Activity: AI Credits per day (Cost), Copilot only in the showcase.
  const cost = AM.aicByDay;
  const fmtC = (v) => aic(v);
  const axisC = (v) => num(v);
  const activity = panel(
    "Activity",
    `<div class="an-switches">${seg(["Cost", "Tokens", "Runs"])}${seg(["Bars", "Lines"])}</div>`,
    `<div class="an-pb">${dayChart({
      dates: DATES,
      series: [{ color: COPILOT }],
      values: [cost],
      fmt: axisC,
      height: 170,
      pins: INC.map((r) => (r && (r[0] || r[1]) ? r : null)),
    })}${dayFoot(DATES, cost, fmtC, [
      [COPILOT, "Copilot"],
      ["var(--danger-fg)", "Error", true],
      ["var(--warning-fg)", "Rate limit", true],
    ])}</div>`,
  );

  const maxTok = MODELS[0].tokens;
  const modelMix = panel(
    "Model mix",
    `<span>${MODELS.length} models</span><span class="an-link">Compare models ${li("arrowR", 12)}</span>`,
    `<div class="an-pb">${meter(
      MODELS.map((m) => [m.percentage, m.color]),
      "an-meter--lg",
    )}<div class="an-rows"><div class="an-rowh an-g-mix"><span>Model</span><span>Share of tokens</span><span class="an-num">%</span><span class="an-num">Tokens</span><span class="an-num">Cost</span></div>${MODELS.map(
      (m) =>
        `<div class="an-row an-g-mix"><span class="an-name">${sw(m.color)}<span>${m.model}</span></span>${track([[(m.tokens / maxTok) * 100, m.color]])}<span class="an-num">${share(m.percentage)}</span><span class="an-num an-mut">${num(m.tokens)}</span><span class="an-num an-mut">${aic(m.credits)}</span></div>`,
    ).join("")}</div></div>`,
  );

  const parts = COMPOSITION.filter(([k]) => COMP[k] > 0);
  const tokenMix = panel(
    "What the tokens were",
    `<span>${num(COMP.total)} tokens</span>`,
    `<div class="an-pb">${meter(
      parts.map(([k, , c]) => [(COMP[k] / COMP.total) * 100, c]),
      "an-meter--lg an-meter--xl",
    )}<div class="an-legend an-legend--vals">${parts.map(([k, l, c]) => `<span>${sw(c)}${l} <b>${num(COMP[k])}</b>${share((COMP[k] / COMP.total) * 100)}</span>`).join("")}</div><div class="an-rows"><div class="an-rowh an-g-tok"><span>Model</span><span>Cache reads · writes · fresh · output</span><span class="an-num">Tokens</span></div>${MODELS.map(
      (m) =>
        `<div class="an-row an-g-tok"><span class="an-name"><span class="an-src-ic">${sourceLogo("copilot", 12)}</span><span>${m.model}</span></span>${track(
          parts.filter(([k]) => m[k] > 0).map(([k, , c]) => [(m[k] / m.tokens) * 100, c]),
          "an-track--tall",
        )}<span class="an-num an-mut">${num(m.tokens)}</span></div>`,
    ).join("")}</div></div>`,
  );

  // Cost, "By source": Copilot in AI Credits, then its models by cost.
  const priced = MODELS.slice().sort((a, b) => b.credits - a.credits);
  const costPanel = panel(
    "Cost",
    seg(["By source", "Running total"]),
    `<div class="an-cost"><div class="an-cost-card"><div class="an-cost-h"><span class="an-src-ic">${sourceLogo("copilot", 14)}</span>Copilot<span class="an-cost-aside">AI Credits</span></div><div class="an-tv an-tv--lg"><span data-count="${Math.round(all.aic)}" data-fmt="int" data-suffix=" AIC">${aic(all.aic)}</span><small>≈ ${usd(all.usd)}</small></div>${meter([[100, "var(--accent-muted)"]])}<dl class="an-kv"><dt>Basis</dt><dd>estimated from tokens</dd><dt>Observed in</dt><dd>0 of ${full(A.totalSessions)} sessions</dd><dt>Per session</dt><dd>${aic(all.aic / A.totalSessions)}</dd></dl></div><div class="an-cost-card"><div class="an-cost-h">${li("cpu", 14)}By model<span class="an-cost-aside an-link">Compare models ${li("arrowR", 12)}</span></div><div class="an-rows">${priced
      .slice(0, 4)
      .map(
        (m) =>
          `<div class="an-row an-g-cost"><span class="an-name">${sw(m.color)}<span>${m.model}</span></span>${track([[(m.credits / priced[0].credits) * 100, m.color]])}<span class="an-num">${aic(m.credits)}</span></div>`,
      )
      .join("")}</div></div></div>`,
    "an-panel--flush",
  );

  // Model time & pace: five statistics on a log axis, then the work's pace.
  const lo = Math.log(P.minMs),
    span = Math.log(P.maxMs) - lo;
  const marks = [
    ["min", P.minMs, "var(--text-tertiary)"],
    ["median", P.medianMs, "var(--accent-fg)"],
    ["avg", P.avgMs, "var(--chart-secondary)"],
    ["p95", P.p95Ms, "var(--warning-fg)"],
    ["max", P.maxMs, "var(--text-tertiary)"],
  ].map(([label, ms, color]) => ({ label, ms, color, at: ((Math.log(ms) - lo) / span) * 100 }));
  const rowEnd = [-99, -99];
  for (const m of marks) {
    m.row = m.at - rowEnd[0] >= 13 ? 0 : 1;
    rowEnd[m.row] = m.at;
  }
  const med = marks[1],
    p95 = marks[3];
  const PM = AM.productivityMetrics;
  const paceTiles = [
    ["msg", "Turns / session", PM.avgTurnsPerSession.toFixed(1), "sessions with turns"],
    ["wrench", "Tool calls / turn", PM.avgToolCallsPerTurn.toFixed(1), "across all turns"],
    ["zap", "Tokens / turn", num(PM.avgTokensPerTurn), "incl. cache reads"],
    ["gauge", "Output speed", num(PM.avgTokensPerApiSecond), "output tokens per model second"],
  ];
  const pace = panel(
    "Model time &amp; pace",
    "",
    `<div class="an-pace"><div class="an-tile-l">${li("clock")}Model time per session<span class="an-tile-aside">${full(P.totalSessionsWithDuration)} of ${full(A.totalSessions)} sessions timed · log scale</span></div><div class="an-pace-strip"><div class="an-pace-axis"></div><span class="an-pace-band an-gx" style="left:${med.at}%;width:${p95.at - med.at}%"></span>${marks
      .map(
        (m) =>
          `<span class="an-pace-tick" style="left:${m.at}%;background:${m.color}"></span><span class="an-pace-lab${m.at < 4 ? " s" : m.at > 96 ? " e" : ""}" style="left:${m.at}%;top:${34 + m.row * 14}px">${m.label} <b>${dur(m.ms)}</b></span>`,
      )
      .join(
        "",
      )}</div></div><div class="an-tiles an-tiles--4">${paceTiles.map(([i, l, v, d]) => `<div class="an-tile"><div class="an-tile-l">${icon(i)}${l}</div><div class="an-tv">${v}</div><div class="an-tile-d">${d}</div></div>`).join("")}</div>`,
    "an-panel--flush",
  );

  // Incidents (tiles) and the cache.
  const KINDS = [
    ["Errors", "octX", "var(--danger-fg)", 0],
    ["Rate limits", "tri", "var(--warning-fg)", 1],
    ["Compactions", "minimize", "var(--chart-secondary)", 2],
    ["Truncations", "scissors", "var(--neutral-emphasis)", 3],
  ];
  const incidents = panel(
    "Incidents",
    `<span class="an-ellip">${A.sessionsWithErrors} sessions with errors</span>${seg(["Tiles", "Chart"])}`,
    `<div class="an-tiles an-inc">${KINDS.map(([label, i, color, k]) => {
      const per = INC.map((r) => (r && k < 3 ? r[k] : 0));
      const total = sum(per);
      const b = bin(per, 62),
        max = Math.max(1, ...b);
      return `<div class="an-tile"><div class="an-tile-l">${li(i)}${label}</div><div class="an-tv${total ? "" : " an-tv--mut"}"><span${total ? ` data-count="${total}"` : ""}>${total}</span><small>${total ? `${k === 0 ? "excl. rate limits · " : ""}${((total / runs) * 100).toFixed(1)} per 100 runs` : "none"}</small></div><div class="an-inc-bars">${b.map((v) => (v ? `<i class="an-bar" style="height:${Math.max(8, (v / max) * 100).toFixed(1)}%;background:${color}"></i>` : '<i class="z"></i>')).join("")}</div></div>`;
    }).join("")}</div>`,
    "an-panel--flush",
  );
  const C = A.cacheStats;
  const inParts = [
    ["Cache reads", COMP.cacheRead, "var(--chart-primary)"],
    ["Cache writes", COMP.cacheWrite, "var(--chart-secondary)"],
    ["Fresh input", COMP.fresh, "var(--chart-cyan)"],
  ];
  const cache = panel(
    "Cache",
    "",
    `<div class="an-tiles an-tiles--1"><div class="an-tile"><div class="an-tile-l">${ic("db", 13)}Input served from cache</div><div class="an-tv an-tv--lg"><span data-count="${C.cacheHitRate}" data-dec="1" data-suffix="%">${pct(C.cacheHitRate)}</span><small>of ${num(C.totalInputTokens)} input tokens</small></div>${meter(
      inParts.map(([, v, c]) => [(v / C.totalInputTokens) * 100, c]),
      "an-meter--lg",
    )}<div class="an-legend an-legend--vals">${inParts.map(([l, v, c]) => `<span>${sw(c)}${l} <b>${num(v)}</b></span>`).join("")}</div></div></div>`,
    "an-panel--flush",
  );

  return (
    pageHead("Analytics Dashboard", `Aggregate metrics across all ${A.totalSessions} sessions`) +
    `<div class="an-page">${kpis}${activity}<div class="an-pair">${modelMix}${tokenMix}</div>${costPanel}${pace}<div class="an-pair">${incidents}${cache}</div></div>`
  );
}

/* ======================= Tools ======================= */
const AGENT_TOOLS = new Set([
  "task",
  "read_agent",
  "explore",
  "general-purpose",
  "code-review",
  "rubber-duck",
]);
const failures = (t) => Math.round(t.callCount * (1 - t.successRate));
const failRate = (t) => (t.callCount ? failures(t) / t.callCount : 0);
const failing = (t) => t.callCount >= 10 && failRate(t) >= 0.05;

export function viewTools() {
  const T = D.toolAnalysis;
  const tools = T.tools.slice().sort((a, b) => b.callCount - a.callCount);
  const calls = AM.callsByDay;
  const active = calls.filter(Boolean).length;
  const failed = sum(tools.map(failures));
  const failShare = failed / T.totalCalls;
  const worst = tools.filter(failing).sort((a, b) => failRate(b) - failRate(a))[0];
  const ms = { tool: 0, agent: 0 };
  for (const t of tools) ms[AGENT_TOOLS.has(t.name) ? "agent" : "tool"] += t.totalDurationMs;
  const totalMs = ms.tool + ms.agent;
  const top3 = (sum(tools.slice(0, 3).map((t) => t.callCount)) / T.totalCalls) * 100;
  const hours = Math.round(totalMs / 3.6e6);

  const kpis =
    `<div class="an-kpis an-kpis--4">` +
    kpi(
      "Tool calls",
      "wrench",
      `<span data-count="${T.totalCalls}" data-fmt="int">${full(T.totalCalls)}</span>`,
      strip(calls) +
        note(
          `<b>${full(T.totalCalls / active)}</b> a day on <b>${active}</b> of ${DATES.length} days`,
        ),
    ) +
    kpi(
      "Failed",
      "octX",
      `<span data-count="${Math.round(failShare * 100)}" data-suffix="%">${share(failShare * 100)}</span>`,
      meter([
        [100 - failShare * 100, "var(--success-fg)"],
        [failShare * 100, "var(--danger-fg)"],
      ]) +
        note(
          `<b>${full(failed)}</b> calls · worst ${worst.name} (${share(failRate(worst) * 100)})`,
        ),
    ) +
    kpi(
      "Tool time",
      "clock",
      `<span data-count="${hours}" data-fmt="int">${full(hours)}</span><small>h</small>`,
      meter([
        [(ms.tool / totalMs) * 100, "var(--chart-primary)"],
        [(ms.agent / totalMs) * 100, "var(--done-fg)"],
      ]) +
        note(
          `<b>${share((ms.tool / totalMs) * 100)}</b> tools · <b>${share((ms.agent / totalMs) * 100)}</b> subagents`,
        ),
    ) +
    kpi(
      "Tools used",
      "grid",
      `<span data-count="${tools.length}">${tools.length}</span>`,
      meter([[top3, "var(--accent-fg)"]]) +
        note(`top 3 make <b>${share(top3)}</b> · ${tools[0].name} leads`),
    ) +
    "</div>";

  // Calls per day: each day's calls split by the overall failure share
  // (the showcase records failures per tool, not per day).
  const bad = calls.map((c) => Math.round(c * failShare));
  const ok = calls.map((c, i) => c - bad[i]);
  const perDay = panel(
    "Calls per day",
    `<div class="an-switches">${seg(["Calls", "Failures", "Tool time"])}${seg(["Bars", "Lines"])}</div>`,
    `<div class="an-pb">${dayChart({
      dates: DATES,
      series: [{ color: "var(--accent-fg)" }, { color: "var(--danger-fg)" }],
      values: [ok, bad],
      fmt: num,
    })}${dayFoot(DATES, calls, (v) => full(v), [
      ["var(--accent-fg)", "Calls"],
      ["var(--danger-fg)", "Failed"],
    ])}</div>`,
  );

  const maxCalls = tools[0].callCount;
  const rank = panel(
    "Tools",
    seg(["Most used", "Failure rate", "Slowest", "Most time"]),
    `<div class="an-pb"><div class="an-rows an-rank"><div class="an-rowh an-g-rank"><span>Tool</span><span></span><span class="an-num">Calls</span><span class="an-num">Failed</span><span class="an-num">Avg</span><span class="an-num">Time</span></div>${tools
      .map((t) => {
        const f = failures(t);
        const tag = AGENT_TOOLS.has(t.name) ? '<small class="an-tag">subagent</small>' : "";
        return `<div class="an-row an-g-rank"><span class="an-name"><span>${t.name}${tag}</span></span>${track(
          [
            [((t.callCount - f) / maxCalls) * 100, "var(--accent-fg)"],
            [(f / maxCalls) * 100, "var(--danger-fg)"],
          ],
        )}<span class="an-num an-hi">${num(t.callCount)}</span><span class="an-num an-mut${failing(t) ? " an-warn" : ""}">${f ? share(failRate(t) * 100) : "—"}</span><span class="an-num an-mut">${callTime(t.avgDurationMs)}</span><span class="an-num an-mut">${toolTime(t.totalDurationMs)}</span></div>`;
      })
      .join("")}</div><div class="an-foot"><span><b>${tools.length}</b> tools</span>${legend([
      ["var(--accent-fg)", "Calls"],
      ["var(--danger-fg)", "Failed"],
    ])}</div></div>`,
  );

  // When tools run: weekday × hour, with each row's and column's total.
  const H = AM.toolHeatmap;
  const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
  const cell = (d, h) => H[d * 24 + h];
  const max = Math.max(...H);
  const dayT = DAYS.map((_, d) => sum(H.slice(d * 24, d * 24 + 24)));
  const hourT = Array.from({ length: 24 }, (_, h) => sum(DAYS.map((_, d) => cell(d, h))));
  const total = sum(H);
  const peakI = H.indexOf(max);
  const peakHour = hourT.indexOf(Math.max(...hourT));
  const hh = (h) => `${String(h).padStart(2, "0")}:00`;
  const lvl = (v) => (v ? Math.min(5, Math.ceil((v / max) * 5)) : 0);
  let heat = "<span></span>";
  for (let h = 0; h < 24; h++)
    heat += `<span class="an-heat-h">${h % 3 ? "" : String(h).padStart(2, "0")}</span>`;
  heat += "<span></span>";
  DAYS.forEach((name, d) => {
    heat += `<span class="an-heat-d">${name}</span>`;
    for (let h = 0; h < 24; h++)
      heat += `<i class="an-heat-c" data-l="${lvl(cell(d, h))}">${cell(d, h)}</i>`;
    heat += `<span class="an-heat-t">${track([[(dayT[d] / Math.max(...dayT)) * 100, "var(--chart-primary)"]])}</span>`;
  });
  heat += "<span></span>";
  const maxH = Math.max(...hourT);
  for (let h = 0; h < 24; h++)
    heat += `<span class="an-heat-col"><i class="an-bar" style="height:${((hourT[h] / maxH) * 100).toFixed(1)}%"></i></span>`;
  heat += "<span></span>";
  const weekday = (sum(dayT.slice(0, 5)) / total) * 100;
  const heatPanel = panel(
    "When tools run",
    "<span>Local time</span>",
    `<div class="an-pb"><div class="an-heat-wrap"><div class="an-heat">${heat}</div></div><div class="an-foot"><span>Busiest <b>${DAYS[Math.floor(peakI / 24)]} ${hh(peakI % 24)}</b> (${max})</span><span><b>${share(weekday)}</b> on weekdays</span><span>Peak hour <b>${hh(peakHour)}</b></span><span class="an-legend"><span>Fewer ${[1, 2, 3, 4, 5].map((l) => `<i class="an-sw an-heat-c" data-l="${l}"></i>`).join("")} More</span></span></div></div>`,
  );

  return (
    pageHead("Tool Analysis", "Performance and usage metrics across all tool invocations") +
    `<div class="an-page">${kpis}${perDay}${rank}${heatPanel}</div>`
  );
}

/* ======================= Code ======================= */
export function viewCode() {
  const C = D.codeImpact;
  const dates = C.changesByDay.map((d) => d.date);
  const add = C.changesByDay.map((d) => d.additions);
  const del = C.changesByDay.map((d) => d.deletions);
  const changed = C.linesAdded + C.linesRemoved;
  const totals = add.map((a, i) => a + del[i]);
  const peak = totals.indexOf(Math.max(...totals));
  const active = add.filter((v, i) => v || del[i]).length;
  const types = C.fileTypeBreakdown
    .slice()
    .sort((a, b) => b.count - a.count)
    .map((t, i) => ({ ...t, color: TYPE_COLORS[i] || "var(--text-tertiary)" }));
  const mods = sum(types.map((t) => t.count));
  const coloured = types.filter((t) => !t.color.includes("tertiary"));
  const rest = types.filter((t) => t.color.includes("tertiary"));
  const split = coloured
    .map((t) => [(t.count / mods) * 100, t.color, `${t.extension}: ${t.count}`])
    .concat(
      rest.length ? [[(sum(rest.map((t) => t.count)) / mods) * 100, "var(--text-tertiary)"]] : [],
    );
  const net = C.netChange;

  const kpis =
    `<div class="an-kpis an-kpis--4">` +
    kpi(
      "Lines added",
      "plus",
      `<span data-count="${C.linesAdded}" data-fmt="int" data-prefix="+">+${full(C.linesAdded)}</span>`,
      strip(add, "var(--success-fg)") +
        note(
          `busiest <b>${day(dates[peak])}</b> · active <b>${active}</b> of ${dates.length} days`,
        ),
    ) +
    kpi(
      "Lines removed",
      "minus",
      `<span data-count="${C.linesRemoved}" data-fmt="int" data-prefix="−">−${full(C.linesRemoved)}</span>`,
      meter([
        [(C.linesAdded / changed) * 100, "var(--success-fg)"],
        [(C.linesRemoved / changed) * 100, "var(--danger-fg)"],
      ]) + note(`<b>${(C.linesAdded / C.linesRemoved).toFixed(1)}</b> added per line removed`),
    ) +
    kpi(
      "Net change",
      "diff",
      `<span class="${net >= 0 ? "c-success" : "c-danger"}" data-count="${Math.abs(net)}" data-fmt="int" data-prefix="${net >= 0 ? "+" : "−"}">${net >= 0 ? "+" : "−"}${full(Math.abs(net))}</span>`,
      note(`code ${net >= 0 ? "grew" : "shrank"} · <b>${num(changed)}</b> lines changed`),
    ) +
    kpi(
      "Files touched",
      "fileCode",
      `<span data-count="${C.filesModified}" data-fmt="int">${full(C.filesModified)}</span>`,
      meter(split) +
        note(
          `<b>${full(mods)}</b> modifications · ${(mods / C.filesModified).toFixed(1)} per file`,
        ),
    ) +
    "</div>";

  const changes = panel(
    "Changes per day",
    seg(["Bars", "Lines"]),
    `<div class="an-pb">${dayChart({
      dates,
      series: [{ color: "var(--success-fg)" }, { color: "var(--danger-fg)" }],
      values: [add, del],
      fmt: num,
    })}`.concat(
      `<div class="an-foot"><span>Busiest <b>${day(dates[peak])}</b> (+${num(add[peak])} / −${num(del[peak])})</span><span>Average <b>${num(sum(totals) / active)}</b> lines per active day</span>${legend(
        [
          ["var(--success-fg)", "Added"],
          ["var(--danger-fg)", "Removed"],
        ],
      )}</div></div>`,
    ),
  );

  const maxT = types[0].count;
  const fileTypes = panel(
    "File types",
    `<span>${full(mods)} modifications</span>`,
    `<div class="an-pb an-col-body">${meter(split, "an-meter--lg an-meter--split")}<div class="an-rows"><div class="an-rowh an-g-types"><span>Type</span><span></span><span class="an-num">Edits</span><span class="an-num">Share</span></div>${types
      .slice(0, 8)
      .map(
        (t) =>
          `<div class="an-row an-g-types"><span class="an-name">${sw(t.color)}<span class="an-mono">${t.extension}</span></span>${track([[(t.count / maxT) * 100, t.color]])}<span class="an-num">${t.count}</span><span class="an-num an-mut">${share((t.count / mods) * 100)}</span></div>`,
      )
      .join(
        "",
      )}</div><p class="an-note2">a file counts once for each session that modified it</p></div>`,
  );

  const maxF = Math.max(...C.mostModifiedFiles.map((f) => f.additions));
  const files = panel(
    "Most-modified files",
    "<span>by sessions</span>",
    `<div class="an-pb an-col-body"><div class="an-rows"><div class="an-rowh an-g-files"><span>File</span><span></span><span class="an-num">Sessions</span></div>${C.mostModifiedFiles
      .slice(0, 10)
      .map((f) => {
        const parts = f.path.split("/");
        const name = parts.pop();
        const folder = parts.length > 2 ? `…/${parts.slice(-2).join("/")}` : parts.join("/");
        return `<div class="an-row an-g-files"><span class="an-name"><span class="an-file"><span class="an-mono">${esc(name)}</span>${folder ? `<small>${esc(folder)}</small>` : ""}</span></span>${track([[(f.additions / maxF) * 100, "var(--accent-fg)"]])}<span class="an-num">${f.additions}</span></div>`;
      })
      .join(
        "",
      )}</div><div class="an-foot"><span>Top <b>${Math.min(10, C.mostModifiedFiles.length)}</b> of <b>${full(C.filesModified)}</b> files</span></div></div>`,
  );

  return (
    pageHead("Code Impact", "Code changes and file modifications across all sessions") +
    `<div class="an-page">${kpis}${changes}<div class="an-pair">${fileTypes}${files}</div></div>`
  );
}

/* ======================= Models ======================= */
const statCard = (value, label, cls, count) =>
  `<div class="rp-card an-stat"><div class="an-stat-v ${cls}"${count || ""}>${value}</div><div class="an-stat-l">${label}</div></div>`;

/** Cost per 1M tokens against tokens used (log), bubbles sized by spend. */
function efficiencyMap() {
  const W = 520,
    HT = 290,
    P = { l: 46, r: 14, t: 12, b: 34 };
  const pw = W - P.l - P.r,
    ph = HT - P.t - P.b;
  const rows = MODELS.map((m) => ({ ...m, rate: m.usd / (m.tokens / 1e6) }));
  const t0 = 10 ** Math.floor(Math.log10(Math.min(...rows.map((r) => r.tokens))));
  const t1 = 10 ** Math.ceil(Math.log10(Math.max(...rows.map((r) => r.tokens))));
  const x = (v) =>
    P.l + ((Math.log10(v) - Math.log10(t0)) / (Math.log10(t1) - Math.log10(t0))) * pw;
  const { top, ticks } = niceTicks(Math.max(...rows.map((r) => r.rate)) * 1.08);
  const y = (v) => P.t + ph - (v / top) * ph;
  const avg = sum(rows.map((r) => r.usd)) / (sum(rows.map((r) => r.tokens)) / 1e6);
  const maxSpend = Math.max(...rows.map((r) => r.usd));
  const rMax = Math.min(22, Math.max(12, pw / 28));
  const marks = rows.map((r) => ({
    r,
    cx: x(r.tokens),
    cy: y(r.rate),
    rad: 3.5 + (rMax - 3.5) * Math.sqrt(r.usd / maxSpend),
  }));
  // Labels: right of the bubble, else left, above or below, clear of bubbles,
  // the average's caption and each other.
  const boxes = [
    { x: P.l, y: y(avg) - 17, w: 130, h: 15 },
    ...marks.map((m) => ({ x: m.cx - m.rad, y: m.cy - m.rad, w: m.rad * 2, h: m.rad * 2 })),
  ];
  const hit = (b) =>
    boxes.some((o) => b.x < o.x + o.w && b.x + b.w > o.x && b.y < o.y + o.h && b.y + b.h > o.y);
  const labels = marks.map((m) => {
    const w = m.r.model.length * 5.9,
      h = 12;
    const tries = [
      [m.cx + m.rad + 5, m.cy - h / 2],
      [m.cx - m.rad - 5 - w, m.cy - h / 2],
      [m.cx - w / 2, m.cy - m.rad - 4 - h],
      [m.cx - w / 2, m.cy + m.rad + 4],
      [m.cx + m.rad + 3, m.cy + m.rad - 2],
      [m.cx - m.rad - 3 - w, m.cy + m.rad - 2],
    ];
    const ok =
      tries.find(
        ([bx, by]) =>
          bx >= P.l &&
          bx + w <= W - 2 &&
          by >= P.t + 16 &&
          by + h <= P.t + ph &&
          !hit({ x: bx, y: by, w, h }),
      ) || tries[0];
    boxes.push({ x: ok[0], y: ok[1], w, h });
    return `<text x="${ok[0].toFixed(1)}" y="${(ok[1] + 9.5).toFixed(1)}" class="an-ch-lab">${m.r.model}</text>`;
  });
  const xt = [];
  for (let v = t0; v <= t1 * 1.0001; v *= 10) xt.push(v);
  const tok = (v) => (v >= 1e9 ? `${v / 1e9}B` : v >= 1e6 ? `${v / 1e6}M` : `${v / 1e3}K`);
  const rateT = (v) => `$${clean(v, 2)}`;
  return `<div class="an-legend an-ch-legend">${MODELS.map((m) => `<span><i class="an-dot" style="background:${m.color}"></i>${m.model}</span>`).join("")}</div><svg class="an-ch" viewBox="0 0 ${W} ${HT}" role="img" aria-label="Cost per million tokens against tokens used"><rect x="${P.l}" y="${P.t}" width="${pw}" height="${(y(avg) - P.t).toFixed(1)}" class="an-ch-above"/><text x="${P.l + 6}" y="${P.t + 12}" class="an-ch-note">Costs more per token than your average</text><g class="an-ch-grid">${ticks.map((t) => `<line x1="${P.l}" x2="${P.l + pw}" y1="${y(t).toFixed(1)}" y2="${y(t).toFixed(1)}"/>`).join("")}${xt.map((t) => `<line x1="${x(t).toFixed(1)}" x2="${x(t).toFixed(1)}" y1="${P.t}" y2="${P.t + ph}"/>`).join("")}</g><g class="an-ch-axis">${[0, ...ticks].map((t) => `<text x="${P.l - 8}" y="${(y(t) + 3.5).toFixed(1)}" text-anchor="end">${rateT(t)}</text>`).join("")}${xt.map((t, i) => `<text x="${x(t).toFixed(1)}" y="${P.t + ph + 16}" text-anchor="${i === 0 ? "start" : i === xt.length - 1 ? "end" : "middle"}">${tok(t)}</text>`).join("")}<text x="${P.l + pw}" y="${HT - 3}" text-anchor="end" class="an-ch-note">Tokens used (log scale) →</text></g><line x1="${P.l}" x2="${P.l + pw}" y1="${y(avg).toFixed(1)}" y2="${y(avg).toFixed(1)}" class="an-ch-avg"/><text x="${P.l + 6}" y="${(y(avg) - 5).toFixed(1)}" class="an-ch-avgl">Average ${rateT(avg)} / 1M</text>${marks
    .slice()
    .sort((a, b) => b.rad - a.rad)
    .map(
      (m) =>
        `<circle cx="${m.cx.toFixed(1)}" cy="${m.cy.toFixed(1)}" r="${m.rad.toFixed(1)}" fill="${m.r.color}" fill-opacity="0.85" stroke="var(--canvas-subtle)" stroke-width="2" class="an-pop"/>`,
    )
    .join("")}${labels.join("")}</svg><p class="an-ch-foot">Bubble size is total spend.</p>`;
}

/** Each model's share of tokens beside its share of spend, as ribbons. */
function spendShift() {
  const W = 520,
    HT = 290,
    TOP = 26,
    BOT = 8,
    BAR = 14,
    GAP = 3;
  const xL = 196,
    xR = 316;
  const totTok = sum(MODELS.map((m) => m.tokens)),
    totUsd = sum(MODELS.map((m) => m.usd));
  const avail = HT - TOP - BOT - GAP * (MODELS.length - 1);
  let l = TOP,
    r = TOP;
  const bands = MODELS.map((m) => {
    const ts = m.tokens / totTok,
      ss = m.usd / totUsd;
    const b = { m, ts, ss, l0: l, l1: l + ts * avail, r0: r, r1: r + ss * avail };
    l = b.l1 + GAP;
    r = b.r1 + GAP;
    return b;
  });
  // Labels sit at their band's middle, nudged apart where bands are thin.
  const spread = (ys) => {
    const out = ys.slice();
    for (let i = 1; i < out.length; i++) out[i] = Math.max(out[i], out[i - 1] + 13);
    const over = out.at(-1) - (HT - 6);
    if (over > 0)
      for (let i = out.length - 1; i >= 0; i--)
        out[i] = Math.min(out[i] - over, i < out.length - 1 ? out[i + 1] - 13 : out[i] - over);
    return out;
  };
  const ly = spread(bands.map((b) => (b.l0 + b.l1) / 2));
  const ry = spread(bands.map((b) => (b.r0 + b.r1) / 2));
  const mid = (xL + BAR + xR) / 2;
  return `<p class="an-ch-cap">A band that widens costs more than its share of use; one that narrows costs less.</p><svg class="an-ch" viewBox="0 0 ${W} ${HT}" role="img" aria-label="Each model's share of tokens beside its share of spend"><text x="${xL + BAR / 2}" y="12" text-anchor="middle" class="an-ch-head">Tokens</text><text x="${xR + BAR / 2}" y="12" text-anchor="middle" class="an-ch-head">Spend</text>${bands
    .map((b, i) => {
      const d = Math.round(b.ss * 100 - b.ts * 100);
      return `<path d="M${xL + BAR} ${b.l0.toFixed(1)} C${mid} ${b.l0.toFixed(1)} ${mid} ${b.r0.toFixed(1)} ${xR} ${b.r0.toFixed(1)} L${xR} ${b.r1.toFixed(1)} C${mid} ${b.r1.toFixed(1)} ${mid} ${b.l1.toFixed(1)} ${xL + BAR} ${b.l1.toFixed(1)} Z" fill="${b.m.color}" class="an-ribbon"/><rect x="${xL}" y="${b.l0.toFixed(1)}" width="${BAR}" height="${Math.max(1, b.l1 - b.l0).toFixed(1)}" rx="3" fill="${b.m.color}"/><rect x="${xR}" y="${b.r0.toFixed(1)}" width="${BAR}" height="${Math.max(1, b.r1 - b.r0).toFixed(1)}" rx="3" fill="${b.m.color}"/><text x="${xL - 8}" y="${(ly[i] + 4).toFixed(1)}" text-anchor="end" class="an-ch-lab">${b.m.model}  <tspan class="an-ch-val">${Math.round(b.ts * 100)}%</tspan></text><text x="${xR + BAR + 8}" y="${(ry[i] + 4).toFixed(1)}" class="an-ch-lab"><tspan class="an-ch-val">${Math.round(b.ss * 100)}%</tspan>${d ? `<tspan dx="6" class="an-ch-delta">${d > 0 ? "+" : "−"}${Math.abs(d)} pts</tspan>` : ""}</text>`;
    })
    .join("")}</svg><p class="an-ch-foot">Spend counts AI Credits at $0.01.</p>`;
}

export function viewModels() {
  const all = D.costs.all;
  const tokB = (A.totalTokens / 1e9).toFixed(1);
  const stats =
    '<div class="an-stats">' +
    statCard(MODELS.length, "Models Used", "c-accent", ` data-count="${MODELS.length}"`) +
    statCard(
      num(A.totalTokens),
      "Total Tokens",
      "c-done",
      ` data-count="${tokB}" data-dec="1" data-suffix="B"`,
    ) +
    statCard(
      aic(all.aic),
      "AI Credits",
      "c-success",
      ` data-count="${Math.round(all.aic)}" data-fmt="int" data-suffix=" AIC"`,
    ) +
    statCard("0", "Sessions with Observed AIC", "c-done") +
    "</div>";
  const cards = `<div class="an-mcards">${MODELS.map(
    (m) =>
      `<div class="an-mcard"><div class="an-mcard-n"><i class="an-dot" style="background:${m.color}"></i><span>${m.model}</span></div><div class="an-mcard-s"><div><span>Tokens</span><b>${num(m.tokens)}</b></div><div><span>AI Credits</span><b>${aic(m.credits)}</b></div><div><span>Cache Hit</span><b>${pct(m.hit)}</b></div><div><span>AIC Source</span><b>Estimated</b></div></div><div class="an-mcard-bar"><i class="an-gx" style="width:${m.percentage}%;background:${m.color}"></i></div><div class="an-mcard-f">${pct(m.percentage)} of total tokens</div></div>`,
  ).join("")}</div>`;
  const matrix = `<section class="rp-card rp-panel an-panel an-sp"><div class="an-sp-h"><span>Performance Matrix</span>${seg(["Raw", "Per 10M Tokens", "Share %"])}</div><div class="an-scroll"><table class="an-mtx"><thead><tr><th>Model</th><th class="n">Total ↓</th><th class="n hide-sm">Input</th><th class="n hide-sm">Output</th><th class="n">Cache</th><th class="n">Share</th><th class="n">AI Credits</th></tr></thead><tbody>${MODELS.map(
    (m) =>
      `<tr><td><span class="an-name"><i class="an-dot" style="background:${m.color}"></i><b>${m.model}</b></span></td><td class="n">${num(m.tokens)}</td><td class="n hide-sm">${num(m.inputTokens)}</td><td class="n hide-sm">${num(m.outputTokens)}</td><td class="n">${num(m.cacheReadTokens)} (${pct(m.hit)})</td><td class="n"><span class="an-share">${pct(m.percentage)}${track([[(m.percentage / MODELS[0].percentage) * 100, m.color]])}</span></td><td class="n">${aic(m.credits)}</td></tr>`,
  ).join("")}</tbody></table></div></section>`;
  const charts = `<div class="an-pair"><section class="rp-card rp-panel an-panel an-sp"><div class="an-sp-h"><span>Cost Efficiency</span></div><div class="an-pb">${efficiencyMap()}</div></section><section class="rp-card rp-panel an-panel an-sp"><div class="an-sp-h"><span>Token Share vs Spend Share</span></div><div class="an-pb">${spendShift()}</div></section></div>`;
  return (
    pageHead("Model Comparison", "Performance and cost metrics across all models") +
    `<div class="an-page">${stats}${cards}${matrix}${charts}</div>`
  );
}

/* ======================= Skills ======================= */
export function viewSkills() {
  const U = Object.fromEntries(D.skillUsage.skills.map((s) => [s.name, s]));
  const global = D.skills.filter((s) => s.scope === "global").length;
  const SK = {
    installed: D.skills.length,
    global,
    project: D.skills.length - global,
    active: D.skills.filter((s) => s.enabled).length,
    used: D.skillUsage.skills.length,
  };
  return (
    '<div class="rp-page-head"><div><h3 class="rp-page-h">Skills</h3><p class="rp-page-sub">What is installed, what gets used, and what each costs</p></div><span class="rp-btn rp-btn--primary">' +
    ic("plus", 14) +
    "New Skill</span></div>" +
    '<p class="c-sec" style="font-size:12.5px;margin-bottom:14px">' +
    SK.installed +
    " installed · " +
    SK.global +
    " global · " +
    SK.project +
    " project · " +
    SK.active +
    " active · " +
    SK.used +
    " used in all time</p>" +
    '<div class="cards3">' +
    D.skills
      .map((s) => {
        const u = U[s.name];
        return (
          '<div class="rp-card mini-card"><h4><span class="mini-ico" style="width:28px;height:28px">' +
          ic(s.scope === "global" ? "zap" : "folder", 14) +
          "</span>" +
          s.name +
          "</h4><p>" +
          esc(s.description) +
          '</p><div class="rp-chips"><span class="rp-badge rp-badge--' +
          (s.scope === "global" ? "accent" : "success") +
          '">' +
          (s.scope === "global" ? "Global" : "Project") +
          '</span><span class="rp-badge rp-badge--neutral mono">Listing ~' +
          s.frontmatterTokens +
          " · On use ~" +
          s.instructionTokens +
          "</span>" +
          (u ? "" : '<span class="rp-badge rp-badge--warning">Unused</span>') +
          "</div>" +
          '<div class="mini-stats"><div><div class="t">Uses</div><div class="v">' +
          (u ? u.uses : 0) +
          '</div></div><div><div class="t">Sessions</div><div class="v">' +
          (u ? u.sessions : 0) +
          '</div></div><div><div class="t">Tokens/use</div><div class="v">' +
          (u ? `~${fmtTok(u.medianContentTokens)}` : "—") +
          "</div></div></div></div>"
        );
      })
      .join("") +
    "</div>"
  );
}
