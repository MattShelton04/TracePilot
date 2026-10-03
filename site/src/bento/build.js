import { AGENT_RUNS, D } from "../data.js";
import { fmtPct, fmtUsd } from "../lib/format.js";
import { AGENTS, esc, fmtInt, fmtK, ic, seeded, smoothPath, sparkPath, tile } from "./helpers.js";

export function buildBento(el) {
  const A = D.analytics;
  const raw = A.tokenUsageByDay.slice(-62).map((d) => d.tokens);
  // 7-day rolling mean, drawn as a smooth curve: the trend, not daily noise
  const days = raw.slice(6).map((_, i) => raw.slice(i, i + 7).reduce((a, b) => a + b, 0) / 7);
  const tokSpark = smoothPath(days, 460, 120, 8);
  const all = D.costs.all;
  const analytics =
    '<div class="kpis"><div class="kpi"><b style="color:#818cf8" data-count="' +
    A.totalSessions +
    '">' +
    A.totalSessions +
    "</b><span>Total Sessions</span></div>" +
    '<div class="kpi"><b style="color:#a78bfa">' +
    (A.totalTokens / 1e6).toFixed(1) +
    "M</b><span>Total Tokens</span></div>" +
    '<div class="kpi"><b style="color:#a78bfa" data-count="' +
    Math.round(all.aic) +
    '" data-suffix=" AIC">' +
    fmtInt(all.aic) +
    " AIC</b><span>AI Credits</span></div>" +
    '<div class="kpi"><b style="color:#34d399">' +
    fmtUsd(all.usd) +
    "</b><span>AIC USD Equivalent</span></div></div>" +
    '<div class="mini-h"><span>Token usage over time</span><span>last 8 weeks</span></div>' +
    '<svg class="spark-svg" viewBox="0 0 460 120" preserveAspectRatio="none" height="120"><defs><linearGradient id="tokfill" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="#6366f1" stop-opacity=".28"/><stop offset="1" stop-color="#6366f1" stop-opacity="0"/></linearGradient></defs>' +
    [30, 60, 90]
      .map((y) => `<line x1="0" x2="460" y1="${y}" y2="${y}" stroke="rgba(255,255,255,.05)"/>`)
      .join("") +
    '<path data-fill d="' +
    tokSpark +
    ' L457 120 L3 120 Z" fill="url(#tokfill)"/><path data-draw d="' +
    tokSpark +
    '" fill="none" stroke="#6366f1" stroke-width="1.6" stroke-linejoin="round" pathLength="1" stroke-dasharray="1 1"/></svg>';

  const agentList = AGENT_RUNS.filter((a) => AGENTS[a.type]);
  const agents =
    '<div class="agent-rows">' +
    agentList
      .map((a) => {
        const ag = AGENTS[a.type];
        const rnd = seeded(a.seed);
        const vals = Array.from(
          { length: 24 },
          (_, i) => 0.5 + Math.sin(i * 1.3 + a.seed) * 0.28 + rnd() * 0.4,
        );
        return (
          '<div class="arow" style="--ac:' +
          ag.color +
          '"><span class="ai">' +
          ic(ag.icon) +
          '</span><span class="an">' +
          a.type +
          "<span>median " +
          a.median +
          " · " +
          fmtPct(a.failed) +
          ' failed</span></span><svg viewBox="0 0 92 26" width="92" height="26" class="spark-svg"><path data-draw d="' +
          sparkPath(vals, 92, 26, 2) +
          '" fill="none" stroke="' +
          ag.color +
          '" stroke-width="1.4" stroke-linejoin="round" pathLength="1" stroke-dasharray="1 1"/></svg><span class="ar" data-count="' +
          a.runs +
          '">' +
          a.runs +
          "<span>runs</span></span></div>"
        );
      })
      .join("") +
    "</div>";

  const sk = D.skillUsage.skills;
  const skills =
    '<div class="skill-rows">' +
    sk
      .slice(0, 5)
      .map((s) => {
        const vals = (s.dailyUses || []).map((d) => d.uses);
        return (
          '<div class="skrow"><b>' +
          esc(s.name) +
          "</b><span>" +
          s.uses +
          " uses · ~" +
          fmtK(s.medianContentTokens) +
          ' tok</span><svg viewBox="0 0 64 24" width="64" height="24" class="spark-svg"><path data-draw d="' +
          sparkPath(vals.length > 1 ? vals : [0, 1], 64, 24, 2) +
          '" fill="none" stroke="#818cf8" stroke-width="1.3" pathLength="1" stroke-dasharray="1 1"/></svg></div>'
        );
      })
      .join("") +
    "</div>";

  // todos DAG
  const T = D.heroTodos;
  const pos = {
    "map-flow": [1.5, 0],
    provider: [0.75, 1],
    device: [2.25, 1],
    unit: [0, 2],
    button: [1.5, 2],
    cert: [3, 2],
    review: [0.75, 3],
    e2e: [2.25, 3],
    pr: [0.75, 4],
    docs: [2.25, 4],
  };
  const NW = 80,
    NH = 28,
    gx = 89,
    gy = 60,
    ox = 2,
    oy = 2;
  const np = (id) => ({ x: ox + pos[id][0] * gx, y: oy + pos[id][1] * gy });
  let dag = '<svg class="dag-svg" viewBox="0 0 352 274" data-dag>';
  T.deps.forEach((d, _i) => {
    const a = np(d.dependsOn),
      b = np(d.todoId);
    const x1 = a.x + NW / 2,
      y1 = a.y + NH,
      x2 = b.x + NW / 2,
      y2 = b.y;
    const blocked = d.todoId === "cert";
    dag +=
      '<path data-edge="' +
      pos[d.dependsOn][1] +
      '" d="M' +
      x1 +
      " " +
      y1 +
      " C" +
      x1 +
      " " +
      (y1 + 18) +
      " " +
      x2 +
      " " +
      (y2 - 18) +
      " " +
      x2 +
      " " +
      y2 +
      '" fill="none" stroke="' +
      (blocked ? "rgba(251,113,133,.55)" : "rgba(52,211,153,.4)") +
      '" stroke-width="1.2" pathLength="1" stroke-dasharray="1 1"/>';
  });
  T.todos.forEach((t) => {
    if (!pos[t.id]) return;
    const p = np(t.id);
    const st = t.status;
    const stroke =
      st === "done"
        ? "rgba(52,211,153,.55)"
        : st === "in_progress"
          ? "#818cf8"
          : st === "blocked"
            ? "#fb7185"
            : "rgba(255,255,255,.2)";
    const fill =
      st === "done"
        ? "#0c1f19"
        : st === "in_progress"
          ? "#17173a"
          : st === "blocked"
            ? "#1f0f14"
            : "#141416";
    const mark = st === "done" ? "✓" : st === "in_progress" ? "•" : st === "blocked" ? "⊘" : "○";
    const mc =
      st === "done"
        ? "#34d399"
        : st === "in_progress"
          ? "#818cf8"
          : st === "blocked"
            ? "#fb7185"
            : "#a1a1aa";
    const title = t.title.length > 12 ? `${t.title.slice(0, 11)}…` : t.title;
    dag +=
      '<g data-node="' +
      pos[t.id][1] +
      '" data-st="' +
      st +
      '"><rect x="' +
      p.x +
      '" y="' +
      p.y +
      '" width="' +
      NW +
      '" height="' +
      NH +
      '" rx="4" fill="' +
      fill +
      '" stroke="' +
      stroke +
      '"' +
      (st === "blocked" ? ' stroke-dasharray="3 2"' : "") +
      '/><text x="' +
      (p.x + 7) +
      '" y="' +
      (p.y + 17.8) +
      '"><tspan fill="' +
      mc +
      '">' +
      mark +
      "</tspan> " +
      esc(title) +
      "</text></g>";
  });
  dag += "</svg>";
  const TC = D.todoCounts,
    pc = (n) => Math.round((n / TC.total) * 100);
  const todos =
    '<div class="prog"><div class="pt"><span>' +
    TC.done +
    "/" +
    TC.total +
    ' completed</span><span data-count="' +
    pc(TC.done) +
    '" data-suffix="%">' +
    pc(TC.done) +
    '%</span></div><div class="pb"><i style="width:' +
    pc(TC.done) +
    '%;background:#34d399"></i><i style="width:' +
    pc(TC.in_progress) +
    '%;background:#818cf8"></i><i style="width:' +
    pc(TC.blocked) +
    '%;background:#fb7185"></i></div></div>' +
    dag;

  const S = D.search.search_content;
  const typeC = {
    user_message: ["User Message", "#34d399", "rgba(16,185,129,.15)"],
    assistant_message: ["Assistant Message", "#818cf8", "rgba(99,102,241,.15)"],
    tool_result: ["Tool Result", "#fb923c", "rgba(251,146,60,.14)"],
    reasoning: ["Reasoning", "#a78bfa", "rgba(139,92,246,.15)"],
  };
  const search =
    '<div class="sbar">' +
    ic("search") +
    '<span data-type="' +
    esc(D.searchQuery) +
    '">' +
    esc(D.searchQuery) +
    '</span><span class="k">Ctrl+K</span></div>' +
    '<div class="syn"><span>"phrase"</span><span>prefix*</span><span>type:error</span><span>repo:name</span><span>tool:grep</span></div>' +
    '<div class="found" data-found>Found <b>' +
    S.totalCount +
    '</b> results <span class="ms">(' +
    S.latencyMs +
    "ms)</span></div>" +
    S.results
      .slice(0, 3)
      .map((r) => {
        const tc = typeC[r.contentType] || ["Result", "#a1a1aa", "rgba(255,255,255,.08)"];
        return (
          '<div class="sres"><div class="top"><span class="chip repo">' +
          esc(r.sessionRepository) +
          '</span><span class="chip branch">' +
          esc(r.sessionBranch) +
          '</span><span class="ty" style="color:' +
          tc[1] +
          ";background:" +
          tc[2] +
          '">' +
          tc[0] +
          "</span></div><p>" +
          r.snippet.replace(/<mark>/g, '<mark style="--hl:1">') +
          "</p></div>"
        );
      })
      .join("");

  const TA = D.toolAnalysis;
  const tools =
    '<div class="code-kpis"><div class="kpi"><b style="color:#818cf8">' +
    fmtInt(TA.totalCalls) +
    '</b><span>Tool calls</span></div><div class="kpi"><b style="color:#34d399">' +
    Math.round(TA.successRate * 100) +
    "%</b><span>Success</span></div></div>" +
    '<div class="mini-h"><span>Invocations</span><span>success</span></div>' +
    TA.tools
      .slice(0, 6)
      .map(
        (t) =>
          '<div class="hbar" style="grid-template-columns:64px 1fr 40px"><span class="n">' +
          t.name +
          '</span><span class="t"><span class="f" style="display:block;width:' +
          ((t.callCount / TA.tools[0].callCount) * 100).toFixed(1) +
          '%"></span></span><span class="v">' +
          (t.successRate * 100).toFixed(t.successRate === 1 ? 0 : 1).replace(/\.0$/, "") +
          "%</span></div>",
      )
      .join("");

  const MD = A.modelDistribution;
  const maxPct = Math.max(...MD.map((m) => m.percentage));
  const mcol = {
    "claude-opus-5.5": "#8b5cf6",
    "gpt-6-sol": "#34d399",
    "gpt-6-luna": "#fbbf24",
    "gpt-5.6-luna": "#fb7185",
    "claude-sonnet-5": "#a78bfa",
    "claude-haiku-4.5": "#22d3ee",
  };
  const models =
    '<div class="code-kpis"><div class="kpi"><b style="color:#818cf8">' +
    MD.length +
    '</b><span>Models used</span></div><div class="kpi"><b style="color:#34d399">' +
    fmtInt(all.aic) +
    " AIC</b><span>AI Credits</span></div></div>" +
    '<div class="mini-h"><span>Share of tokens</span><span>tokens</span></div>' +
    MD.map(
      (m) =>
        '<div class="mrow" style="--mc:' +
        (mcol[m.model] || "#818cf8") +
        '"><i></i><span class="mn">' +
        m.model +
        '</span><span class="t"><span class="f" style="display:block;width:' +
        ((m.percentage / maxPct) * 100).toFixed(1) +
        '%"></span></span><span class="mv">' +
        fmtK(m.tokens) +
        "</span></div>",
    ).join("");

  const CI = D.codeImpact;
  const code =
    '<div class="code-kpis"><div class="kpi"><b style="color:#34d399">+' +
    fmtInt(CI.linesAdded) +
    '</b><span>Lines added</span></div><div class="kpi"><b style="color:#fb7185">−' +
    fmtInt(CI.linesRemoved) +
    "</b><span>Lines removed</span></div></div>" +
    '<div class="mini-h"><span>File modifications by type</span><span>' +
    CI.filesModified +
    " paths</span></div>" +
    CI.fileTypeBreakdown
      .slice(0, 6)
      .map(
        (f) =>
          '<div class="hbar" style="grid-template-columns:44px 1fr 60px;--bc:linear-gradient(90deg,#6366f1,#8b5cf6)"><span class="n">' +
          f.extension +
          '</span><span class="t"><span class="f" style="display:block;width:' +
          ((f.count / CI.fileTypeBreakdown[0].count) * 100).toFixed(1) +
          '%"></span></span><span class="v">' +
          f.count +
          " mods</span></div>",
      )
      .join("");

  const explorer =
    '<div class="tree"><div class="dir" style="font-family:var(--font-family);font-size:10.5px;letter-spacing:.08em;text-transform:uppercase;color:var(--text-tertiary);height:22px">Session files · 7</div>' +
    "<div>" +
    ic("braces") +
    'events.jsonl<span class="sz">2.2 MB</span></div>' +
    '<div class="on">' +
    ic("file") +
    'plan.md<span class="sz">500 B</span></div>' +
    "<div>" +
    ic("database") +
    'session.db<span class="sz">48 KB</span></div>' +
    "<div>" +
    ic("lines") +
    'workspace.yaml<span class="sz">418 B</span></div>' +
    '<div class="dir">' +
    ic("folder") +
    'checkpoints<span class="sz">(2)</span></div>' +
    '<div class="ind">' +
    ic("file") +
    '001-provider-fl…<span class="sz">1.3 KB</span></div>' +
    '<div class="ind">' +
    ic("file") +
    'index.md<span class="sz">212 B</span></div>' +
    '<div class="dir">' +
    ic("folder") +
    'files<span class="sz">(1)</span></div>' +
    '<div class="ind">' +
    ic("file") +
    'review-notes.md<span class="sz">2 KB</span></div></div>';

  el.innerHTML =
    tile("t-analytics", 1, "chart", "Analytics", `${A.totalSessions} sessions`, analytics) +
    tile(
      "t-agents",
      2,
      "bot",
      "Agents",
      `${AGENT_RUNS.reduce((n, a) => n + a.runs, 0)} runs`,
      agents,
    ) +
    tile("t-skills", 0, "zap", "Skills", `${D.skillUsage.totalUses} uses`, skills) +
    tile("t-todos", 0, "list", "Todos", "dependency graph", todos) +
    tile("t-search", 2, "search", "Search", "FTS5", search) +
    tile("t-tools", 1, "wrench", "Tool analysis", `${TA.tools.length} tools`, tools) +
    tile("t-models", 2, "network", "Model comparison", `${MD.length} models`, models) +
    tile("t-code", 1, "code", "Code impact", `net +${fmtInt(CI.netChange)}`, code) +
    tile("t-explorer", 0, "folder", "Explorer", "session state", explorer);
}
