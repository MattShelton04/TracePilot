// The session Overview tab (apps/desktop/src/views/tabs/OverviewTab.vue and
// components/overview/): headline numbers, "What happened", the Context panel
// and the Activity chart. One renderer serves the scroll scene and the replica;
// its styles are in styles/overview.css.
import { D } from "../data.js";
import { dateTime, fmtInt } from "./format.js";

// Lucide icon paths
const P = {
  msg: '<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>',
  clock: '<circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>',
  diff: '<path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M9 10h6"/><path d="M12 13V7"/><path d="M9 17h6"/>',
  coins:
    '<circle cx="8" cy="8" r="6"/><path d="M18.09 10.37A6 6 0 1 1 10.34 18"/><path d="M7 6h1v4"/><path d="m16.71 13.88.7.71-2.82 2.82"/>',
  info: '<circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/>',
  flag: '<path d="M4 22V4a1 1 0 0 1 .4-.8A6 6 0 0 1 8 2c3 0 5 2 7.333 2q2 0 3.067-.8A1 1 0 0 1 20 4v10a1 1 0 0 1-.4.8A6 6 0 0 1 16 16c-3 0-5-2-8-2a6 6 0 0 0-4 1.528"/>',
  alert:
    '<path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3"/><path d="M12 9v4"/><path d="M12 17h.01"/>',
  archive:
    '<rect width="20" height="5" x="2" y="3" rx="1"/><path d="M4 8v11a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8"/><path d="M10 12h4"/>',
  timer:
    '<line x1="10" x2="14" y1="2" y2="2"/><line x1="12" x2="15" y1="14" y2="11"/><circle cx="12" cy="14" r="8"/>',
  arrow: '<path d="M5 12h14"/><path d="m12 5 7 7-7 7"/>',
  book: '<path d="M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H19a1 1 0 0 1 1 1v18a1 1 0 0 1-1 1H6.5a1 1 0 0 1 0-5H20"/><path d="M8 11V2l3 3 3-3v9"/>',
  branch:
    '<line x1="6" x2="6" y1="3" y2="15"/><circle cx="18" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><path d="M18 9a9 9 0 0 1-9 9"/>',
  folder:
    '<path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z"/>',
  copy: '<rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/>',
  hash: '<line x1="4" x2="20" y1="9" y2="9"/><line x1="4" x2="20" y1="15" y2="15"/><line x1="10" x2="8" y1="3" y2="21"/><line x1="16" x2="14" y1="3" y2="21"/>',
  monitor:
    '<rect width="20" height="14" x="2" y="3" rx="2"/><line x1="8" x2="16" y1="21" y2="21"/><line x1="12" x2="12" y1="17" y2="21"/>',
  shrink:
    '<path d="m15 15 6 6m-6-6v4.8m0-4.8h4.8"/><path d="M9 19.8V15m0 0H4.2M9 15l-6 6"/><path d="M15 4.2V9m0 0h4.8M15 9l6-6"/><path d="M9 4.2V9m0 0H4.2M9 9 3 3"/>',
};
const ic = (n, size = 13, w = 2) =>
  `<svg class="ovw-ic" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${P[n]}</svg>`;

const esc = (s) =>
  String(s).replace(
    /[&<>"]/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c],
  );

/** "47m 0s", "1h 4m", as the app's formatDuration */
function dur(ms) {
  const s = Math.round(ms / 1000);
  const h = Math.floor(s / 3600),
    m = Math.floor((s % 3600) / 60);
  if (h) return `${h}h ${m}m`;
  return m ? `${m}m ${s % 60}s` : `${s}s`;
}
/** "1:31 pm" in UTC */
function clock(ms) {
  const d = new Date(ms);
  const h = d.getUTCHours();
  return `${h % 12 || 12}:${String(d.getUTCMinutes()).padStart(2, "0")} ${h >= 12 ? "pm" : "am"}`;
}
const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = "Jan Feb Mar Apr May Jun Jul Aug Sept Oct Nov Dec".split(" ");
const day = (ms) => {
  const d = new Date(ms);
  return `${DAYS[d.getUTCDay()]}, ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
};

/** Changed files grouped by their first two folders, largest first (groupByFolder). */
function folders(paths) {
  const groups = new Map();
  for (const p of paths) {
    const parts = p.split("/");
    const f =
      parts.length > 2
        ? `${parts.slice(0, 2).join("/")}/`
        : parts.length === 2
          ? `${parts[0]}/`
          : "(root)";
    groups.set(f, (groups.get(f) ?? 0) + 1);
  }
  return [...groups]
    .map(([folder, n]) => ({ folder, n }))
    .sort((a, b) => b.n - a.n || a.folder.localeCompare(b.folder));
}
const FOLDER_COLORS = [
  "var(--chart-primary)",
  "var(--chart-info)",
  "var(--chart-secondary)",
  "var(--chart-lime)",
  "var(--chart-pink)",
  "var(--chart-orange)",
];

function model() {
  const s = D.heroDetail,
    m = D.heroMetrics,
    cc = m.codeChanges;
  const start = Date.parse(s.createdAt),
    end = Date.parse(s.updatedAt),
    span = end - start;
  const api = m.totalApiDurationMs;
  const aic = D.costs.hero.aic;
  const files = cc.filesModified;
  const groups = folders(files);
  const named = groups.slice(0, 3).map((g) => g.folder);
  if (groups.length > 3) named.push(`${groups.length - 3} more`);
  const last = named.pop();
  // diff blocks: five squares split between added and removed lines
  const added = Math.round((cc.linesAdded / (cc.linesAdded + cc.linesRemoved)) * 5);
  const blocks = Array.from({ length: 5 }, (_, i) => (i < added ? "a" : "r"));
  return {
    s,
    start,
    end,
    span,
    api,
    aic,
    cc,
    files,
    groups,
    blocks,
    where: `in ${named.length ? `${named.join(", ")} and ${last}` : last}`,
  };
}

function kpis(o) {
  const perTurn = (D.heroDetail.eventCount / D.heroDetail.turnCount).toFixed(1);
  const modelShare = Math.min(1, o.api / o.span);
  const kpi = (icon, label, value, foot, cls = "") =>
    `<div class="ovw-kpi${cls}"><div class="ovw-k-l">${ic(icon)}<span>${label}</span></div><div class="ovw-k-v">${value}</div><div class="ovw-k-foot">${foot}</div></div>`;
  return `<div class="ovw-kpis">${[
    kpi(
      "msg",
      "Turns",
      `<span data-fly="turns" data-count="${o.s.turnCount}">${o.s.turnCount}</span>`,
      `<span class="ovw-note"><b data-fly="events">${fmtInt(o.s.eventCount)}</b><span class="ovw-rest">events · ${perTurn} per turn</span></span>`,
    ),
    kpi(
      "clock",
      "Duration",
      dur(o.span),
      `<div class="ovw-meter"><i style="width:${(modelShare * 100).toFixed(1)}%"></i></div><span class="ovw-note"><b>${dur(o.api)}</b> waiting on the model</span>`,
    ),
    kpi(
      "diff",
      "Code changes",
      `<span class="ovw-add">+${fmtInt(o.cc.linesAdded)}</span><span class="ovw-del">−${fmtInt(o.cc.linesRemoved)}</span>`,
      `<span class="ovw-note"><span class="ovw-blocks">${o.blocks.map((b) => `<i class="${b}"></i>`).join("")}</span><b>${o.files.length}</b> files changed</span>`,
    ),
    kpi(
      "coins",
      `AI credits ${ic("info", 12, 1.5)}`,
      `<span data-count="${o.aic}" data-dec="1" data-suffix=" AIC">${o.aic.toFixed(1)} AIC</span>`,
      `<span class="ovw-note"><b>Estimated</b> · ${(o.aic / o.s.turnCount).toFixed(2)} AIC/turn</span>`,
    ),
  ].join("")}</div>`;
}

function panel(title, aside, body, cls = "") {
  return `<section class="ovw-panel${cls}"><header class="ovw-ph"><h4>${title}</h4>${aside ? `<span class="ovw-aside">${aside}</span>` : ""}</header>${body}</section>`;
}

function whatHappened(o) {
  const view = `<span class="ovw-link">View ${ic("arrow", 12)}</span>`;
  const tile = (icon, label, link, value, detail, cls = "") =>
    `<div class="ovw-tile${cls}"><div class="ovw-t-l">${ic(icon)}${label}${link ? view : ""}</div>${value}${detail != null ? `<div class="ovw-t-d">${detail}</div>` : ""}</div>`;
  const runs =
    D.heroMetrics.shutdownCount > 1
      ? `Resumed · ${D.heroMetrics.shutdownCount} runs`
      : "One continuous run";
  const inc = D.heroIncidents.length;
  const other = o.span - o.api;
  const footprint = o.groups
    .slice(0, FOLDER_COLORS.length)
    .map((g, i) => `<i style="flex-grow:${g.n};background:${FOLDER_COLORS[i]}"></i>`)
    .join("");
  const share = Math.min(1, o.api / o.span);
  return panel(
    "What happened",
    "",
    `<div class="ovw-tiles">${[
      tile(
        "flag",
        "Exit",
        false,
        `<div class="ovw-t-v"><span class="ovw-badge ok">${ic("flag")}</span>Ended normally</div>`,
        runs,
      ),
      tile(
        "alert",
        "Incidents",
        inc > 0,
        `<div class="ovw-t-v"><span class="ovw-badge ${inc ? "warn" : "ok"}">${ic("alert")}</span>${inc ? `${inc} incident${inc === 1 ? "" : "s"}` : "No incidents"}</div>`,
        inc
          ? `${D.compaction.count} compaction${D.compaction.count === 1 ? "" : "s"}`
          : "No errors, rate limits, compactions or truncations",
      ),
      tile(
        "diff",
        "Changes",
        false,
        `<div class="ovw-t-v mono"><span class="ovw-add">+${fmtInt(o.cc.linesAdded)}</span><span class="ovw-del">−${fmtInt(o.cc.linesRemoved)}</span></div><div class="ovw-bar">${footprint}</div>`,
        `${o.files.length} files ${esc(o.where)}`,
      ),
      tile(
        "archive",
        "Saved state",
        true,
        `<div class="ovw-t-v">${o.s.checkpointCount} checkpoint${o.s.checkpointCount === 1 ? "" : "s"}${D.heroPlan ? " · a plan" : ""}</div>`,
        D.heroCheckpoint ? `Latest: “${esc(D.heroCheckpoint)}”` : "",
      ),
      `<div class="ovw-tile wide"><div class="ovw-t-l">${ic("timer")}Where the time went<span class="ovw-t-aside">${dur(o.span)}</span></div>
        <div class="ovw-bar ovw-split"><i class="m" style="flex-grow:${share}"></i><i class="o" style="flex-grow:${1 - share}"></i></div>
        <div class="ovw-legend"><span><i class="m"></i>Model <b>${dur(o.api)}</b></span><span><i class="o"></i>Everything else <b>${dur(other)}</b></span></div></div>`,
    ].join("")}</div>`,
  );
}

// reasoning effort as the app draws it: four rising bars, filled to the level (effortLevel)
const EFFORT = { minimal: 1, low: 1, medium: 2, high: 3, xhigh: 4, max: 4 };
function effort(e) {
  const level = e ? (EFFORT[e.toLowerCase()] ?? 0) : 0;
  const name = !e
    ? "Model default"
    : e === "xhigh"
      ? "Extra high"
      : e[0].toUpperCase() + e.slice(1);
  const bars = [1, 2, 3, 4].map((n) => `<i${n <= level ? ' class="on"' : ""}></i>`).join("");
  return `<span class="ovw-effort" title="Main agent reasoning effort"><span class="ovw-bars${e ? "" : " unset"}">${bars}</span>${name}</span>`;
}

function contextPanel(o) {
  const cwd = o.s.cwd || "";
  const cut = Math.max(cwd.lastIndexOf("\\"), cwd.lastIndexOf("/")) + 1;
  const facet = (label, body) =>
    `<div class="ovw-facet"><div class="ovw-f-l">${label}</div><div class="ovw-f-b">${body}</div></div>`;
  const hoursAgo = Math.round((Date.parse(D.now) - o.start) / 60000);
  const agoText = hoursAgo < 60 ? `${hoursAgo}m ago` : `${Math.round(hoursAgo / 60)}h ago`;
  return panel(
    "Context",
    agoText,
    [
      facet(
        "Where",
        `<div class="ovw-line">${ic("book", 14)}<b>${esc(o.s.repository)}</b><span class="ovw-sep">/</span><span class="ovw-branch">${ic("branch", 12)}${esc(o.s.branch)}</span></div>
         <div class="ovw-line">${ic("folder", 14)}<span class="ovw-cwd"><span>${esc(cwd.slice(0, cut))}</span>${esc(cwd.slice(cut))}</span><span class="ovw-copy">${ic("copy", 12)}</span></div>`,
      ),
      facet(
        "Agent",
        `<div class="ovw-line"><span class="ovw-model">${esc(o.s.currentModel)}</span>${effort(o.s.reasoningEffort)}${o.s.hostType ? `<span class="ovw-host">${ic("monitor", 12)}${esc(o.s.hostType)}</span>` : ""}</div>`,
      ),
      facet(
        "When",
        `<div class="ovw-line"><b>${day(o.start)}</b><span class="mono">${clock(o.start)} <span class="ovw-sep">→</span> ${clock(o.end)}</span></div>
         <span class="ovw-small">Created ${dateTime(o.s.createdAt)} · updated ${dateTime(o.s.updatedAt)}</span>`,
      ),
      facet(
        "Session",
        `<div class="ovw-line">${ic("hash", 12)}<span class="ovw-id mono">${o.s.id}</span><span class="ovw-copy">${ic("copy", 12)}</span></div>`,
      ),
    ].join(""),
  );
}

function activity(o) {
  const starts = (D.heroTurnStarts ?? []).map(Date.parse);
  const bins = Math.max(16, Math.min(48, Math.round(starts.length / 1.5)));
  const counts = new Array(bins).fill(0);
  for (const t of starts)
    counts[Math.min(bins - 1, Math.max(0, Math.floor(((t - o.start) / o.span) * bins)))] += 1;
  const max = Math.max(1, ...counts);
  const bars = counts
    .map((n, i) => {
      const left = (i / bins) * 100;
      const h = n ? Math.max(6, (n / max) * 100) : 0;
      return `<span class="ovw-col" style="left:${left}%;width:${100 / bins}%"><span class="ovw-b${n ? "" : " empty"}"${n ? ` style="height:${h}%"` : ""}></span></span>`;
    })
    .join("");
  const marks = D.heroIncidents
    .filter((i) => i.eventType === "compaction")
    .map((i) => ((Date.parse(i.timestamp) - o.start) / o.span) * 100);
  const pins = marks
    .map((pct) => `<span class="ovw-pin" style="left:${pct}%">${ic("shrink", 10, 2.5)}</span>`)
    .join("");
  const guides = marks
    .map((pct) => `<span class="ovw-guide" style="left:${pct}%"></span>`)
    .join("");
  const ticks = Array.from({ length: 5 }, (_, i) => {
    const pct = i * 25;
    return `<span class="ovw-tick${i === 0 ? " s" : i === 4 ? " e" : ""}" style="left:${pct}%">${clock(o.start + (o.span * i) / 4)}</span>`;
  }).join("");
  const peak = counts.indexOf(max);
  const perMin = starts.length / (o.span / 60000);
  return panel(
    "Activity",
    "Turns over time",
    `<div class="ovw-act">
      <div class="ovw-pins">${pins}</div>
      <div class="ovw-bars-plot">${guides}${bars}</div>
      <div class="ovw-axis">${ticks}</div>
      <div class="ovw-act-foot">${max > 1 ? `<span>Busiest <b>${clock(o.start + (peak * o.span) / bins)}</b> (${max} turns)</span>` : ""}<span>Average <b>${perMin.toFixed(1)} turns/min</b></span><span class="ovw-legend-r"><span><i></i>Compaction</span></span></div>
    </div>`,
    " ovw-activity",
  );
}

/** The Overview tab. `full` adds the incidents and plan sections below the chart. */
export function overviewHTML(full = false) {
  const o = model();
  let h = `${kpis(o)}<div class="ovw-row">${whatHappened(o)}${contextPanel(o)}</div>${activity(o)}`;
  if (full) {
    const inc = D.heroIncidents[0];
    h += `<section class="ovw-panel ovw-inc"><header class="ovw-ph"><h4>Incidents</h4><span class="ovw-count">${D.heroIncidents.length}</span></header>
      <div class="ovw-inc-row"><span class="ovw-inc-b">Compaction</span><span>${esc(inc.summary)}</span><span class="ovw-inc-d">▸ Detail</span><time>${clock(Date.parse(inc.timestamp))}</time></div></section>`;
  }
  return `<div class="ovw">${h}</div>`;
}
