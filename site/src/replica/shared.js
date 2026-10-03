import { D } from "../data.js";

export const NOW = new Date(D.now).getTime();
export const RM = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/* ---------------------------------------------------------------- helpers */
export const esc = (s) =>
  String(s).replace(
    /[&<>"]/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c],
  );
export function fmtTok(n) {
  if (n >= 1e6) return `${(n / 1e6).toFixed(1).replace(/\.0$/, "")}M`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(1).replace(/\.0$/, "")}K`;
  return String(Math.round(n));
}
export function fmtDur(ms) {
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  return `${m}m ${s % 60}s`;
}
export function relTime(t) {
  const ms = NOW - (typeof t === "number" ? t : new Date(t).getTime());
  const m = Math.max(1, Math.floor(ms / 60000));
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}
export function clock(iso) {
  const d = new Date(iso);
  let h = d.getUTCHours();
  const ap = h >= 12 ? "pm" : "am";
  h = h % 12 || 12;
  const p = (n) => String(n).padStart(2, "0");
  return `${p(h)}:${p(d.getUTCMinutes())}:${p(d.getUTCSeconds())} ${ap}`;
}
export const trunc = (s, n) => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s);
export const AG = {
  main: "#6366f1",
  explore: "#22d3ee",
  "general-purpose": "#a78bfa",
  "code-review": "#f472b6",
  task: "#fbbf24",
  "rubber-duck": "#fde047",
};
export const AG_ICON = {
  explore: "search",
  "general-purpose": "hammer",
  "code-review": "eye",
  main: "bot",
  task: "zap",
};

/* ----------------------------------------------------------- derived data */
export const HERO = D.sessions[0];
export const T8 = D.heroTurns[8];

export const AGENTS = T8.toolCalls
  .filter((t) => t.isSubagent)
  .map((t) => ({
    id: t.toolCallId,
    type: t.arguments.agent_type,
    name: t.agentDisplayName,
    model: t.model,
    ms: t.durationMs,
    tools: t.totalToolCalls,
    tokens: t.totalTokens,
    inside: T8.toolCalls.filter((c) => c.parentToolCallId === t.toolCallId).length,
    start: new Date(t.startedAt).getTime(),
    end: new Date(t.completedAt).getTime(),
  }));
export const AGI = Object.fromEntries(AGENTS.map((a) => [a.id, a]));
export const MM = D.heroMetrics.modelMetrics;
export const MODEL_ROWS = Object.keys(MM).map((k) => ({
  model: k,
  tok: MM[k].usage.inputTokens + MM[k].usage.outputTokens,
  input: MM[k].usage.inputTokens,
  cache: MM[k].usage.cacheReadTokens,
}));
export const TOK_TOTAL = MODEL_ROWS.reduce((a, r) => a + r.tok, 0);
export const IN_TOTAL = MODEL_ROWS.reduce((a, r) => a + r.input, 0);
export const CACHE_READ = MODEL_ROWS.reduce((a, r) => a + r.cache, 0);
export const CACHE_PCT = (CACHE_READ / IN_TOTAL) * 100;
export const CTX = D.heroContextTimeline;
export const CTX_PEAK = Math.max.apply(
  null,
  CTX.points.map((p) => p.totalTokens),
);
export const CTX_LAST = CTX.points[CTX.points.length - 1].totalTokens;
export const T8_START = Math.min(...AGENTS.map((a) => a.start));
export const LANE_SPAN = Math.ceil(T8.durationMs / 60000) * 60;
export const AG_LABEL = {
  explore: "Explore",
  "general-purpose": "General-purpose",
  "code-review": "Code-review",
  task: "Task",
  "rubber-duck": "Rubber-duck",
};
export const TODO_COUNTS = D.todoCounts;

export function chips(s) {
  return (
    '<span class="rp-badge rp-badge--accent">' +
    esc(s.repository) +
    "</span>" +
    '<span class="rp-badge rp-badge--success">' +
    esc(s.branch) +
    "</span>" +
    '<span class="rp-badge rp-badge--done">' +
    esc(s.currentModel) +
    "</span>" +
    '<span class="rp-badge rp-badge--neutral">' +
    esc(s.hostType || "cli") +
    "</span>"
  );
}

/* --------------------------------------------------------------- the nav */
export const NAV = [
  ["sessions", "Sessions", "grid", `<span class="rp-nav-badge">${D.sessionCount}</span>`],
  [
    "search",
    "Search",
    "search",
    '<span class="rp-nav-badge"><span class="rp-kbd">Ctrl+K</span></span>',
  ],
  ["analytics", "Analytics", "chart"],
  ["tools", "Tools", "wrench"],
  ["code", "Code", "code"],
  "Advanced",
  ["models", "Models", "network"],
  ["compare", "Compare", "columns"],
  ["export", "Export", "upload"],
  "Orchestration",
  ["command", "Command Centre", "compass"],
  ["worktrees", "Worktrees", "branch"],
  ["launcher", "Launcher", "rocket"],
  "Configuration",
  ["skills", "Skills", "zap"],
  ["agents", "Agents", "bot"],
  "-",
  ["settings", "Settings", "gear"],
];
export const TITLES = {
  sessions: "Sessions",
  search: "Session Search",
  analytics: "Analytics Dashboard",
  tools: "Tool Analysis",
  code: "Code Impact",
  models: "Model Comparison",
  compare: "Session Comparison",
  export: "Export",
  command: "Command Centre",
  worktrees: "Worktree Manager",
  launcher: "Session Launcher",
  skills: "Skills",
  agents: "Agents",
  settings: "Settings",
};
export const TABS = [
  ["overview", "Overview"],
  ["conversation", "Conversation", String(D.heroDetail.turnCount)],
  ["events", "Events", String(D.heroDetail.eventCount)],
  ["todos", "Todos"],
  ["metrics", "Metrics"],
  ["context", "Context"],
  ["explorer", "Explorer"],
  ["timeline", "Timeline"],
];

export const HAND =
  '<path d="M9 1.6c1 0 1.8.8 1.8 1.8v4.4c.3-.2.7-.3 1.1-.3.8 0 1.5.5 1.7 1.2.3-.2.7-.3 1.1-.3.9 0 1.6.6 1.8 1.4.3-.2.6-.2.9-.2 1 0 1.8.8 1.8 1.8v4.2c0 3.6-2.7 6.3-6.3 6.3h-1.6c-2 0-3.4-.7-4.6-2.1l-3.3-3.9c-.6-.7-.5-1.8.2-2.4.7-.6 1.7-.5 2.3.1l1.4 1.5V3.4c0-1 .8-1.8 1.7-1.8z" fill="#fafafa" stroke="#09090b" stroke-width="1.25" stroke-linejoin="round"/><path d="M10.8 11.2v2.6M13.7 11.6v2.3M16.6 12.3v1.9" stroke="#09090b" stroke-width="1" stroke-linecap="round"/>';
