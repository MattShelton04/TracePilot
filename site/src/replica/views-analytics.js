import { D } from "../data.js";
import { fmtInt, fmtUsd } from "../lib/format.js";
import { ic } from "./icons.js";
import { esc, fmtTok } from "./shared.js";
import { stat } from "./views-session.js";

export function pageHead(title, sub, right) {
  return (
    '<div class="rp-page-head"><div><h3 class="rp-page-h">' +
    title +
    '</h3><p class="rp-page-sub">' +
    sub +
    "</p>" +
    '<div class="rp-seg rp-seg--solid an-range"><button type="button" class="is-active">All Time</button><button type="button">7 Days</button><button type="button">30 Days</button><button type="button">90 Days</button></div></div>' +
    (right ||
      `<div class="rp-select" style="width:170px">All Repositories ${ic("chevD", 14)}</div>`) +
    "</div>"
  );
}
export function lineChart(vals, color, h) {
  const W = 420,
    H = h || 150,
    max = Math.max.apply(null, vals) || 1;
  const pts = vals.map((v, i) => [
    10 + (i / (vals.length - 1)) * (W - 20),
    H - 12 - (v / max) * (H - 30),
  ]);
  const d = pts.map((p, i) => `${(i ? "L" : "M") + p[0].toFixed(1)} ${p[1].toFixed(1)}`).join(" ");
  return (
    '<svg class="dg" viewBox="0 0 ' +
    W +
    " " +
    H +
    '"><path d="' +
    d +
    " L" +
    (W - 10) +
    " " +
    (H - 12) +
    " L10 " +
    (H - 12) +
    ' Z" fill="' +
    color +
    '" fill-opacity="0.08"/><path class="an-line" d="' +
    d +
    '" fill="none" stroke="' +
    color +
    '" stroke-width="1.6" stroke-linejoin="round"/></svg>'
  );
}
export function barChart(vals, color, h) {
  const W = 420,
    H = h || 150,
    max = Math.max.apply(null, vals) || 1,
    bw = (W - 20) / vals.length;
  return (
    '<svg class="dg" viewBox="0 0 ' +
    W +
    " " +
    H +
    '">' +
    vals
      .map(
        (v, i) =>
          '<rect class="an-bar" x="' +
          (10 + i * bw + 1) +
          '" y="' +
          (H - 12 - (v / max) * (H - 30)) +
          '" width="' +
          Math.max(1, bw - 2.5) +
          '" height="' +
          (v / max) * (H - 30) +
          '" rx="1" fill="' +
          color +
          '" opacity="0.85"/>',
      )
      .join("") +
    "</svg>"
  );
}
export function viewAnalytics() {
  const A = D.analytics,
    all = D.costs.all;
  const tokM = `${(A.totalTokens / 1e6).toFixed(1)}M`;
  const edge = (v, l, tone) =>
    stat(String(v), l, "", v ? ` data-count="${v}"` : "").replace(
      "rp-stat",
      `rp-stat" style="border-left-color:var(--${tone}-emphasis)`,
    );
  const tok = A.tokenUsageByDay.slice(-60).map((d) => d.tokens);
  const act = A.activityPerDay.slice(-60).map((d) => d.count);
  return (
    pageHead(
      "Analytics Dashboard",
      `Aggregate metrics across all ${A.totalSessions} sessions`,
      "",
    ) +
    '<div class="rp-stats">' +
    stat(
      String(A.totalSessions),
      "Total Sessions",
      "c-accent",
      ` data-count="${A.totalSessions}"`,
    ) +
    stat(
      tokM,
      "Total Tokens",
      "c-done",
      ` data-count="${tokM.slice(0, -1)}" data-dec="1" data-suffix="M"`,
    ) +
    stat(
      `${fmtInt(all.aic)} AIC`,
      "AI Credits",
      "c-accent",
      ` data-count="${Math.round(all.aic)}" data-fmt="int" data-suffix=" AIC"`,
    ) +
    stat(
      fmtUsd(all.usd),
      "AIC USD Equivalent",
      "c-success",
      ` data-count="${all.usd.toFixed(2)}" data-dec="2" data-prefix="$" data-fmt="money"`,
    ) +
    "</div>" +
    '<div class="rp-stats an-row2">' +
    edge(A.sessionsWithErrors, "Sessions with Errors", "danger") +
    edge(A.totalRateLimits, "Total Rate Limits", "warning") +
    edge(A.totalCompactions, "Total Compactions", "done") +
    edge(A.totalTruncations, "Total Truncations", "neutral") +
    "</div>" +
    '<div class="an-charts"><div class="rp-card rp-panel"><div class="rp-panel-head"><span class="rp-section-title">Token usage over time</span></div><div class="rp-panel-body">' +
    lineChart(tok, "#6366f1") +
    '</div></div><div class="rp-card rp-panel"><div class="rp-panel-head"><span class="rp-section-title">Session activity per day</span></div><div class="rp-panel-body">' +
    barChart(act, "#6366f1") +
    "</div></div></div>"
  );
}
export function viewTools() {
  const T = D.toolAnalysis;
  return (
    pageHead("Tool Analysis", "Performance and usage metrics across all tool invocations") +
    '<div class="rp-stats">' +
    stat(
      fmtInt(T.totalCalls),
      "Total Tool Calls",
      "c-accent",
      ` data-count="${T.totalCalls}" data-fmt="int"`,
    ) +
    stat(String(T.tools.length), "Unique Tools", "c-accent", ` data-count="${T.tools.length}"`) +
    stat(
      `${Math.round(T.successRate * 100)}%`,
      "Success Rate",
      "c-success",
      ` data-count="${Math.round(T.successRate * 100)}" data-suffix="%"`,
    ) +
    stat(
      `${(T.avgDurationMs / 1000).toFixed(1)}s`,
      "Avg Duration",
      "c-warning",
      ` data-count="${(T.avgDurationMs / 1000).toFixed(1)}" data-dec="1" data-suffix="s"`,
    ) +
    "</div>" +
    '<div class="rp-card rp-panel" style="margin-top:14px"><div class="rp-panel-head"><span class="rp-section-title">Tool usage breakdown</span></div><table class="tbl"><thead><tr><th>Tool</th><th>Invocations</th><th>Success rate</th><th>Avg duration</th></tr></thead><tbody>' +
    T.tools
      .slice(0, 7)
      .map(
        (t) =>
          "<tr><td><b>" +
          t.name +
          "</b></td><td>" +
          t.callCount.toLocaleString("en-US") +
          "</td><td>" +
          +(t.successRate * 100).toFixed(1) +
          '%<div class="sbar"><span style="width:' +
          t.successRate * 100 +
          '%"></span></div></td><td>' +
          (t.avgDurationMs >= 1000
            ? `${(t.avgDurationMs / 1000).toFixed(1)}s`
            : `${t.avgDurationMs}ms`) +
          "</td></tr>",
      )
      .join("") +
    "</tbody></table></div>"
  );
}
export function viewCode() {
  const C = D.codeImpact;
  const max = C.fileTypeBreakdown[0].count;
  return (
    pageHead("Code Impact", "Code changes and file modifications across all sessions") +
    '<div class="rp-stats">' +
    stat(
      String(C.filesModified),
      "Unique File Paths",
      "c-accent",
      ` data-count="${C.filesModified}"`,
    ) +
    stat(
      `+${fmtInt(C.linesAdded)}`,
      "Lines Added",
      "c-success",
      ` data-count="${C.linesAdded}" data-fmt="int" data-prefix="+"`,
    ) +
    stat(
      `−${fmtInt(C.linesRemoved)}`,
      "Lines Removed",
      "c-danger",
      ` data-count="${C.linesRemoved}" data-fmt="int" data-prefix="−"`,
    ) +
    stat(
      `+${fmtInt(C.netChange)}`,
      "Net Change",
      "c-done",
      ` data-count="${C.netChange}" data-fmt="int" data-prefix="+"`,
    ) +
    "</div>" +
    '<div class="an-charts"><div class="rp-card rp-panel"><div class="rp-panel-head"><span class="rp-section-title">File modifications by type</span></div><div class="rp-panel-body"><div class="hb">' +
    C.fileTypeBreakdown
      .map(
        (f) =>
          '<span class="mono">' +
          f.extension +
          '</span><div class="bar"><span style="width:' +
          (f.count / max) * 100 +
          '%"></span></div><span class="n">' +
          f.count +
          " modifications</span>",
      )
      .join("") +
    '</div></div></div><div class="rp-card rp-panel"><div class="rp-panel-head"><span class="rp-section-title">Most modified file paths</span></div><div class="rp-panel-body" style="font-size:12px">' +
    C.mostModifiedFiles
      .slice(0, 7)
      .map(
        (f) =>
          '<div style="display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px solid var(--border-subtle)"><span class="mono" style="font-size:11px">' +
          f.path +
          "</span><b>" +
          f.additions +
          " sessions</b></div>",
      )
      .join("") +
    "</div></div></div>"
  );
}
export function viewModels() {
  const cols = ["#818cf8", "#34d399", "#fbbf24", "#fb7185", "#a78bfa", "#22d3ee"];
  const A = D.analytics,
    MD = A.modelDistribution,
    tokM = `${(A.totalTokens / 1e6).toFixed(1)}M`;
  return (
    pageHead("Model Comparison", "Performance and cost metrics across all models") +
    '<div class="rp-stats" style="margin-bottom:14px">' +
    stat(String(MD.length), "Models Used", "c-accent", ` data-count="${MD.length}"`) +
    stat(
      tokM,
      "Total Tokens",
      "c-done",
      ` data-count="${tokM.slice(0, -1)}" data-dec="1" data-suffix="M"`,
    ) +
    stat(
      `${fmtInt(D.costs.all.aic)} AIC`,
      "AI Credits",
      "c-success",
      ` data-count="${Math.round(D.costs.all.aic)}" data-fmt="int" data-suffix=" AIC"`,
    ) +
    stat(
      `${A.cacheStats.cacheHitRate}%`,
      "Cache Hit Rate",
      "c-accent",
      ` data-count="${A.cacheStats.cacheHitRate}" data-dec="1" data-suffix="%"`,
    ) +
    "</div>" +
    '<div class="cards3">' +
    D.analytics.modelDistribution
      .map(
        (m, i) =>
          '<div class="rp-card mini-card"><h4><span style="width:8px;height:8px;border-radius:50%;background:' +
          cols[i] +
          '"></span>' +
          m.model +
          '</h4><div class="mini-stats" style="border-top:0;margin-top:6px"><div><div class="t">Tokens</div><div class="v">' +
          fmtTok(m.tokens) +
          '</div></div><div><div class="t">Cache hit</div><div class="v">' +
          ((m.cacheReadTokens / m.inputTokens) * 100).toFixed(1) +
          '%</div></div><div><div class="t">Requests</div><div class="v">' +
          m.requestCount.toLocaleString("en-US") +
          '</div></div></div><div class="mt-track" style="height:5px"><span style="width:' +
          m.percentage * 3 +
          "%;background:" +
          cols[i] +
          '"></span></div><div class="c-muted" style="font-size:11px">' +
          m.percentage +
          "% of total tokens</div></div>",
      )
      .join("") +
    "</div>"
  );
}
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
