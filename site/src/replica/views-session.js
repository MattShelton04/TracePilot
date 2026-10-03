import { D } from "../data.js";
import { dateTime, fmtAic, lat } from "../lib/format.js";
import { ic } from "./icons.js";
import {
  AG,
  AG_ICON,
  AG_LABEL,
  AGENTS,
  AGI,
  chips,
  clock,
  esc,
  fmtDur,
  fmtTok,
  relTime,
  T8,
  T8_START,
  TABS,
  trunc,
} from "./shared.js";

/* ============================================================ view HTML */
export function sessionCard(s, extraCls) {
  const live = s.isRunning;
  let stats =
    '<span class="scard-stat">' +
    ic("activity", 14) +
    s.eventCount +
    "</span>" +
    '<span class="scard-stat">' +
    ic("msg", 14) +
    s.turnCount +
    "</span>";
  if (s.errorCount)
    stats += `<span class="scard-stat err">${ic("alert", 14)}${s.errorCount}</span>`;
  if (s.compactionCount)
    stats += `<span class="scard-stat warn">${ic("rotate", 14)}${s.compactionCount}</span>`;
  return (
    '<button type="button" class="rp-card scard' +
    (live ? " is-live" : "") +
    (extraCls ? ` ${extraCls}` : "") +
    '" data-session="' +
    s.id +
    '" aria-label="Open session: ' +
    esc(s.summary) +
    '">' +
    '<span class="scard-head">' +
    (live ? '<span class="rp-live-dot"></span>' : "") +
    '<span class="scard-title">' +
    esc(s.summary) +
    "</span></span>" +
    (live ? '<span class="rp-badge rp-badge--success scard-active">Active</span>' : "") +
    '<span class="rp-chips">' +
    chips(s) +
    "</span>" +
    '<span class="scard-foot"><span class="scard-stats">' +
    stats +
    '</span><span class="scard-time">' +
    (s.timeLabel || relTime(s.updatedAt)) +
    "</span></span>" +
    "</button>"
  );
}

export function viewSessions() {
  return (
    '<div class="rp-card lib-toolbar">' +
    '<div class="rp-input">' +
    ic("search", 15) +
    "<span>Search sessions...</span></div>" +
    '<div class="rp-select">All Repos ' +
    ic("chevD", 14) +
    "</div>" +
    '<div class="rp-select">All Branches ' +
    ic("chevD", 14) +
    "</div>" +
    '<div class="rp-select">Newest first ' +
    ic("chevD", 14) +
    "</div>" +
    '<span class="lib-count">' +
    D.sessionCount +
    " sessions</span>" +
    '<span class="lib-refresh">' +
    ic("refresh", 14) +
    '<i class="rp-check"></i>Auto</span>' +
    "</div>" +
    '<div class="lib-grid">' +
    D.sessions
      .slice(0, 12)
      .map((s) => sessionCard(s))
      .join("") +
    "</div>"
  );
}

export function detailHead(s, live) {
  return (
    '<div class="sd-head"><h3 class="sd-title">' +
    esc(s.summary) +
    '</h3><div class="rp-chips">' +
    chips(s) +
    "</div></div>" +
    '<div class="rp-card sd-actions">' +
    '<button type="button" class="rp-btn">' +
    ic("clipboard", 15) +
    "Copy Resume Command</button>" +
    '<button type="button" class="rp-btn">' +
    ic("play", 14) +
    "Resume in Terminal</button>" +
    '<button type="button" class="rp-btn">' +
    ic("folder", 15) +
    "Open Folder</button>" +
    '<button type="button" class="rp-btn" data-nav="export">' +
    ic("upload", 15) +
    "Export</button>" +
    '<span class="spacer"></span>' +
    (live
      ? '<span class="cache-chip" title="Prompt cache TTL countdown">' +
        ic("timer", 14) +
        '<span class="cc-t">Cache expiring · 3:45</span></span>'
      : "") +
    '<span class="lib-refresh">' +
    ic("refresh", 14) +
    '<i class="rp-check"></i>Auto</span>' +
    "</div>"
  );
}

export function tabsHTML(disabled) {
  return (
    '<div class="sd-tabs-wrap"><div class="sd-tabs" role="tablist">' +
    TABS.map(
      (t) =>
        '<button type="button" role="tab" class="sd-tab" ' +
        (disabled ? "data-ltab" : "data-tab") +
        '="' +
        t[0] +
        '"' +
        (disabled && t[0] !== "overview" ? " disabled" : "") +
        ">" +
        t[1] +
        (t[2] ? `<span class="cnt">${t[2]}</span>` : "") +
        "</button>",
    ).join("") +
    '<span class="sd-ink"></span></div></div>'
  );
}

export function stat(v, l, cls, attrs) {
  return (
    '<div class="rp-card rp-stat"><div class="rp-stat-v ' +
    (cls || "") +
    '"' +
    (attrs || "") +
    ">" +
    v +
    '</div><div class="rp-stat-l">' +
    l +
    "</div></div>"
  );
}

export function panelOverview() {
  const s = D.heroDetail,
    m = D.heroMetrics,
    inc = D.heroIncidents[0];
  const aic = D.costs.hero.aic;
  return (
    '<div class="rp-stats">' +
    stat(String(s.eventCount), "Events", "c-accent", ` data-count="${s.eventCount}"`) +
    stat(String(s.turnCount), "Turns", "c-accent", ` data-count="${s.turnCount}"`) +
    stat(
      String(s.checkpointCount),
      "Checkpoints",
      "c-success",
      ` data-count="${s.checkpointCount}"`,
    ) +
    stat(
      fmtAic(aic),
      "AI Credits",
      "c-done",
      ` data-count="${aic}" data-dec="1" data-suffix=" AIC"`,
    ) +
    "</div>" +
    '<div class="ov-grid">' +
    '<div class="rp-card rp-panel"><div class="rp-panel-head"><span class="rp-section-title">Session info</span></div><div class="rp-panel-body"><dl class="kv">' +
    "<dt>Session ID</dt><dd>" +
    s.id +
    "</dd><dt>Repository</dt><dd>" +
    esc(s.repository) +
    "</dd><dt>Branch</dt><dd>" +
    esc(s.branch) +
    "</dd><dt>Model</dt><dd>" +
    s.currentModel +
    "</dd><dt>Host</dt><dd>" +
    esc(s.hostType) +
    "</dd><dt>Duration</dt><dd>" +
    fmtDur(m.totalApiDurationMs) +
    "</dd><dt>Created</dt><dd>" +
    dateTime(s.createdAt) +
    "</dd><dt>Updated</dt><dd>" +
    dateTime(s.updatedAt) +
    "</dd></dl></div></div>" +
    '<div class="rp-card rp-panel"><div class="rp-panel-head"><span class="rp-section-title">Session summary</span></div><div class="rp-panel-body"><p style="margin-bottom:14px">' +
    esc(s.summary) +
    '</p><dl class="kv">' +
    "<dt>API Duration</dt><dd>" +
    fmtDur(m.totalApiDurationMs) +
    '</dd><dt>Current Model</dt><dd><span class="rp-badge rp-badge--done">' +
    m.currentModel +
    "</span></dd><dt>Shutdown Type</dt><dd>" +
    esc(m.shutdownType) +
    '</dd><dt>Code Changes</dt><dd><b class="c-success">+' +
    m.codeChanges.linesAdded +
    '</b> <span class="c-muted">/</span> <b class="c-danger">−' +
    m.codeChanges.linesRemoved +
    "</b></dd></dl></div></div>" +
    "</div>" +
    '<div class="rp-card ov-incident"><b>Incidents</b><span class="count">' +
    D.heroIncidents.length +
    '</span><span class="rp-badge rp-badge--warning">Compaction</span><span>' +
    esc(inc.summary) +
    '</span><span class="c-muted" style="margin-left:auto">' +
    clock(inc.timestamp) +
    "</span></div>"
  );
}

export function panelConversation() {
  const order = ["agent-review", "agent-e2e", "agent-safari"];
  const cards = order
    .map((id) => {
      const a = AGI[id];
      return (
        '<div class="sa" style="--ag:' +
        AG[a.type] +
        '" data-agent="' +
        id +
        '"><span class="sa-charge"></span>' +
        '<div class="sa-row"><span class="sa-badge">' +
        ic(AG_ICON[a.type], 11) +
        esc(a.name) +
        '</span><span class="sa-title">' +
        esc(a.name) +
        "</span>" +
        '<span class="sa-meta"><span class="model">' +
        a.model +
        '</span><span class="dur" data-ms="' +
        a.ms +
        '">' +
        fmtDur(a.ms) +
        '</span><span class="sa-status"></span>' +
        ic("chevR", 13) +
        "</span></div>" +
        '<div class="sa-sub">' +
        a.inside +
        " tool call" +
        (a.inside > 1 ? "s" : "") +
        " inside · " +
        fmtTok(a.tokens) +
        " tok · " +
        a.tools +
        " tool execs</div></div>"
      );
    })
    .join("");
  const call = (id) => T8.toolCalls.find((c) => c.toolCallId === id);
  // seconds after the agents launched; read-backs land when the read returns
  const at = (c, end) =>
    Math.round((new Date(end ? c.completedAt : c.startedAt).getTime() - T8_START) / 1000);
  const row = (icon, id, label, end) => {
    const c = call(id);
    return [icon, c.toolName, label, lat(c.durationMs), at(c, end)];
  };
  const rows = [
    row("send", "write-e2e", `→ ${AGI["agent-e2e"].name} · ${call("write-e2e").arguments.message}`),
    row("inbox", "read-safari", AGI["agent-safari"].name, true),
    row("inbox", "read-review", AGI["agent-review"].name, true),
    row("inbox", "read-e2e", AGI["agent-e2e"].name, true),
  ]
    .map(
      (r) =>
        '<div class="tl-row" data-at="' +
        r[4] +
        '">' +
        ic(r[0], 14) +
        "<b>" +
        r[1] +
        '</b><span class="args">' +
        esc(r[2]) +
        '</span><span class="d">' +
        r[3] +
        '</span><span class="ok">' +
        ic("check", 13) +
        "</span>" +
        ic("chevR", 13, 'style="color:var(--text-placeholder)"') +
        "</div>",
    )
    .join("");
  const pills = AGENTS.slice()
    .sort((a, b) => a.ms - b.ms)
    .map((a) => [`${AG_LABEL[a.type]} agent completed`, fmtDur(a.ms), a.id])
    .map(
      (p) =>
        '<span class="cv-pill" data-for="' +
        p[2] +
        '">' +
        ic("check", 13) +
        p[0] +
        ' <span class="d">' +
        p[1] +
        "</span></span>",
    )
    .join("");
  return (
    '<div class="cv">' +
    '<div class="cv-turn"><div class="cv-head">' +
    ic("user", 15) +
    '<b class="user">User</b><span class="t">T8</span><span class="time">' +
    clock(T8.timestamp) +
    "</span></div>" +
    '<div class="cv-bubble">' +
    esc(T8.userMessage) +
    "</div></div>" +
    '<div class="cv-turn cv-turn--asst">' +
    '<div class="cv-msg cv-m1"><div class="cv-head">' +
    ic("bot", 15) +
    '<b>Copilot</b><span class="time">' +
    clock(T8.timestamp) +
    "</span></div><p>" +
    esc(T8.assistantMessages[0].content) +
    "</p></div>" +
    '<div class="cv-msg cv-m2"><div class="cv-head">' +
    ic("bot", 15) +
    '<b>Copilot</b><span class="time">' +
    clock(T8.endTimestamp) +
    "</span></div><p>" +
    esc(T8.assistantMessages[1].content) +
    "</p></div>" +
    '<div class="cv-intent">' +
    ic("target", 14) +
    "Reviewing changes</div>" +
    '<div class="cv-launch">' +
    ic("zap", 14) +
    "3 agents launched in parallel</div>" +
    '<div class="cv-agents">' +
    cards +
    "</div>" +
    '<div class="tl-rows">' +
    rows +
    "</div>" +
    '<div class="cv-pills">' +
    pills +
    "</div>" +
    "</div></div>"
  );
}

export function panelEvents() {
  const call = (id) => T8.toolCalls.find((c) => c.toolCallId === id);
  const comp = D.heroContextTimeline.compactions[0];
  const ev = [
    [T8.timestamp, "user.message", "success", T8.userMessage],
    [T8.timestamp, "assistant.message", "accent", T8.assistantMessages[0].content],
    [
      call("intent-review").startedAt,
      "tool.execution_start",
      "warning",
      `report_intent · ${call("intent-review").arguments.intent}`,
    ],
  ];
  AGENTS.forEach((a) => {
    ev.push([new Date(a.start).toISOString(), "subagent.started", "done", `${a.type} · ${a.name}`]);
  });
  const pwsh = call("rev-diff"),
    grep = call("saf-grep"),
    write = call("write-e2e");
  ev.push([
    pwsh.completedAt,
    "tool.execution_complete",
    "warning",
    `${pwsh.toolName} · ${pwsh.arguments.command}`,
  ]);
  ev.push([
    grep.completedAt,
    "tool.execution_complete",
    "warning",
    `${grep.toolName} · ${grep.arguments.pattern} in ${grep.arguments.path}`,
  ]);
  ev.push([
    write.completedAt,
    "tool.execution_complete",
    "warning",
    `${write.toolName} · ${write.resultContent.split(/[.\n]/)[0]}`,
  ]);
  AGENTS.forEach((a) => {
    ev.push([
      new Date(a.end).toISOString(),
      "subagent.completed",
      "done",
      `${a.type} · ${fmtDur(a.ms)} · ${fmtTok(a.tokens)} tok`,
    ]);
  });
  const compStart = new Date(new Date(comp.timestamp).getTime() - comp.durationMs).toISOString();
  ev.push([
    compStart,
    "session.compaction_start",
    "neutral",
    `${comp.beforeTokens.toLocaleString("en-US")} tokens before compaction`,
  ]);
  ev.push([
    comp.timestamp,
    "session.compaction_complete",
    "neutral",
    "→ " +
      comp.afterTokens.toLocaleString("en-US") +
      " tokens · checkpoint " +
      comp.checkpointNumber,
  ]);
  const rows = ev
    .map((e, i) => ({ e, i, t: new Date(e[0]).getTime() }))
    .sort((a, b) => a.t - b.t || a.i - b.i)
    .map((x, k) => [
      T8.eventIndex + k,
      new Date(x.t).toISOString().slice(11, 19),
      x.e[1],
      x.e[2],
      x.e[3],
    ]);
  return (
    '<div class="rp-card rp-panel"><table class="ev-table"><thead><tr><th>#</th><th>Time</th><th>Type</th><th>Summary</th></tr></thead><tbody>' +
    rows
      .map(
        (r) =>
          '<tr><td class="mono">' +
          r[0] +
          '</td><td class="mono">' +
          r[1] +
          '</td><td><span class="rp-badge rp-badge--' +
          r[3] +
          '">' +
          r[2] +
          "</span></td><td>" +
          esc(trunc(r[4], 70)) +
          "</td></tr>",
      )
      .join("") +
    "</tbody></table></div>"
  );
}
