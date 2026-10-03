import { D, VERSION } from "../data.js";
import { LOGO_ICON } from "../lib/assets.js";
import { ic } from "./icons.js";

/* ---------- formatting ---------- */
export const esc = (s) =>
  String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
export const fmtK = (n) => {
  if (n >= 1e6) return `${(n / 1e6).toFixed(1).replace(/\.0$/, "")}M`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(1).replace(/\.0$/, "")}K`;
  return String(Math.round(n));
};
export const NOW = new Date(D.now).getTime();
export const ago = (iso) => {
  const m = Math.round((NOW - new Date(iso).getTime()) / 60000);
  if (m < 60) return `${Math.max(1, m)}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
};
export const dur = (ms) => {
  const s = Math.round(ms / 1000);
  const m = Math.floor(s / 60);
  return m ? `${m}m ${s % 60}s` : `${s}s`;
};
export const clock = (iso) => {
  const d = new Date(iso);
  let h = d.getUTCHours();
  const ap = h >= 12 ? "pm" : "am";
  h = h % 12 || 12;
  const p2 = (x) => String(x).padStart(2, "0");
  return `${p2(h)}:${p2(d.getUTCMinutes())}:${p2(d.getUTCSeconds())} ${ap}`;
};

export const chipsFor = (s) =>
  [
    `<span class="chip c-repo">${esc(s.repository)}</span>`,
    `<span class="chip c-branch">${esc(s.branch)}</span>`,
    `<span class="chip c-model">${esc(s.currentModel)}</span>`,
    `<span class="chip c-host">${esc(s.hostType)}</span>`,
  ].join("");

/* ---------- shell ---------- */
export const NAV = [
  ["sessions", "grid", "Sessions", `<span class="sb-badge" data-count>${D.sessionCount}</span>`],
  ["search", "search", "Search", '<span class="sb-kbd">Ctrl+K</span>'],
  ["analytics", "chart", "Analytics"],
  ["tools", "wrench", "Tools"],
  ["code", "code", "Code"],
  "ADVANCED",
  ["models", "network", "Models"],
  ["compare", "columns", "Compare"],
  ["export", "share", "Export"],
  "ORCHESTRATION",
  ["command", "compass", "Command Centre"],
  ["worktrees", "branch", "Worktrees"],
  ["launcher", "rocket", "Launcher"],
  "CONFIGURATION",
  ["skills", "zap", "Skills"],
  ["agents", "bot", "Agents"],
  "DIV",
  ["settings", "settings", "Settings"],
];
export function sidebar(active, collapsed) {
  let h = `<aside class="sb${collapsed ? " sb-collapsed" : ""}"><div class="sb-brand"><img src="${LOGO_ICON}" alt="">TracePilot${ic("chevL")}</div>`;
  for (const it of NAV) {
    if (it === "DIV") {
      h += '<div class="sb-div"></div>';
      continue;
    }
    if (typeof it === "string") {
      h += `<div class="sb-sec">${it}</div>`;
      continue;
    }
    // the highlight sits inside the active item, so it needs no measuring to place
    const on = it[0] === active;
    h += `<div class="sb-item${on ? " on" : ""}" data-nav="${it[0]}">${on ? '<i class="sb-hl"></i>' : ""}${ic(it[1])}<span class="sb-t">${it[2]}</span>${it[3] || ""}</div>`;
  }
  h += `<div class="sb-foot"><span>v${VERSION}</span><span class="btnico">${ic("sun")}</span></div></aside>`;
  return h;
}
export function shell(active, mainHTML, collapsed) {
  return (
    `<div class="app"><div class="tb"><img src="${LOGO_ICON}" alt="">TracePilot<div class="tb-ctrls"><span>${ic("minus")}</span><span>${ic("square")}</span><span>${ic("x")}</span></div></div>` +
    `<div class="body">${sidebar(active, collapsed)}<div class="main">${mainHTML}</div></div></div>`
  );
}
export const crumbs = (...parts) =>
  parts
    .map((p, i) => (i === parts.length - 1 ? `<b>${p}</b>` : `<span>${p}</span>${ic("chevR")}`))
    .join("");

export const HAND =
  '<path d="M9 1.6c1 0 1.8.8 1.8 1.8v4.4c.3-.2.7-.3 1.1-.3.8 0 1.5.5 1.7 1.2.3-.2.7-.3 1.1-.3.9 0 1.6.6 1.8 1.4.3-.2.6-.2.9-.2 1 0 1.8.8 1.8 1.8v4.2c0 3.6-2.7 6.3-6.3 6.3h-1.6c-2 0-3.4-.7-4.6-2.1l-3.3-3.9c-.6-.7-.5-1.8.2-2.4.7-.6 1.7-.5 2.3.1l1.4 1.5V3.4c0-1 .8-1.8 1.7-1.8z" fill="#fafafa" stroke="#09090b" stroke-width="1.25" stroke-linejoin="round"/><path d="M10.8 11.2v2.6M13.7 11.6v2.3M16.6 12.3v1.9" stroke="#09090b" stroke-width="1" stroke-linecap="round"/>';
export const cursorHTML = `<div class="cursor" style="--hand:0"><svg class="c-arrow" viewBox="0 0 24 24"><path d="M4.5 2.5 19 12.6l-6.6 1.3 3.9 7.2-2.6 1.4-3.9-7.3-5.3 4.3z" fill="#fafafa" stroke="#09090b" stroke-width="1.3" stroke-linejoin="round"/></svg><svg class="c-hand" viewBox="0 0 24 24">${HAND}</svg></div><div class="ripple"></div>`;

export function toolbar() {
  return `<div class="toolbar panel">
    <span class="abtn">${ic("clipboard")}Copy Resume Command</span><span class="abtn">${ic("play")}Resume in Terminal</span>
    <span class="abtn">${ic("folderOpen")}Open Folder</span><span class="abtn">${ic("share")}Export</span><span class="grow"></span>
    <span class="cache-chip">${ic("timer")}<span class="cache-label">Cache expiring</span> · <span class="cache-time">3:45</span></span>
    <span class="auto">${ic("refresh")}<span><i></i> Auto</span></span></div>`;
}
export const TABS = [
  ["overview", "Overview"],
  ["conversation", "Conversation", D.heroDetail.turnCount],
  ["events", "Events", D.heroDetail.eventCount],
  ["todos", "Todos"],
  ["metrics", "Metrics"],
  ["context", "Context"],
  ["explorer", "Explorer"],
  ["timeline", "Timeline"],
];
export const tabsHTML = (active) =>
  `<div class="tabs">${TABS.map((t) => `<span class="tab${t[0] === active ? " on" : ""}" data-tab="${t[0]}">${t[1]}${t[2] ? `<span class="n">${t[2]}</span>` : ""}</span>`).join("")}<i class="tab-ink"></i></div>`;
export function placeInk(root, key) {
  const ink = root.querySelector(".tab-ink");
  const t = root.querySelector(`.tab[data-tab="${key}"]`);
  if (!ink || !t) return;
  ink.style.width = `${t.offsetWidth}px`;
  ink.style.transform = `translateX(${t.offsetLeft}px)`;
}

/* ---------- library ---------- */
export function cardHTML(s, extra) {
  const active = s.isRunning;
  const foot = [
    `<span>${ic("activity")}<span class="num" data-k="events">${s.eventCount}</span></span>`,
    `<span>${ic("msg")}<span class="num" data-k="turns">${s.turnCount}</span></span>`,
    s.errorCount ? `<span class="err">${ic("alert")}${s.errorCount}</span>` : "",
    s.compactionCount ? `<span class="cmp">${ic("rotate")}${s.compactionCount}</span>` : "",
    `<span class="ago">${extra?.ago ? extra.ago : ago(s.updatedAt)}</span>`,
  ].join("");
  return `<div class="card${active ? " is-active" : ""}${extra?.cls ? ` ${extra.cls}` : ""}" data-id="${s.id}">
    <div class="card-title">${active ? '<i class="dot-live"></i>' : ""}<span class="t">${esc(s.summary)}</span></div>
    ${active ? '<span class="badge-active">Active</span>' : ""}
    <div class="chips">${chipsFor(s)}</div>
    <div class="card-foot">${foot}</div></div>`;
}
export function libraryContent(sessions, count) {
  return `<div class="filterbar panel">
    <div class="fsearch">${ic("search")}Search sessions...</div>
    <div class="fsel">All Repos${ic("chevD")}</div><div class="fsel">All Branches${ic("chevD")}</div><div class="fsel" style="min-width:120px">Newest first${ic("chevD")}</div>
    <span class="fcount"><span data-count>${count}</span> sessions</span><span class="auto">${ic("refresh")}<span><i></i> Auto</span></span></div>
    <div class="grid">${sessions.map((s) => cardHTML(s, s.__extra)).join("")}</div>`;
}

export const planHTML = (md) =>
  md
    .split(/\r?\n/)
    .filter(Boolean)
    .slice(0, 7)
    .map((l) => {
      const inl = (t) => esc(t).replace(/`([^`]+)`/g, "<code>$1</code>");
      if (l.startsWith("# ")) return `<h4>${inl(l.slice(2))}</h4>`;
      if (l.startsWith("## ")) return `<h5>${inl(l.slice(3))}</h5>`;
      return `<p>• ${inl(l.replace(/^- /, ""))}</p>`;
    })
    .join("");

export const AG = {
  review: { color: "#f472b6", type: "code-review", icon: "eye", label: "Code-review" },
  e2e: { color: "#a78bfa", type: "general-purpose", icon: "hammer", label: "General-purpose" },
  safari: { color: "#22d3ee", type: "explore", icon: "search", label: "Explore" },
  main: { color: "#6366f1", type: "main", icon: "bot" },
};
