import { AGENT_RUNS, DOWNLOAD_URL } from "../data.js";
import { fmtPct } from "../lib/format.js";
import { ic } from "./icons.js";
import { AG, AG_ICON } from "./shared.js";

export function viewAgents() {
  const A = AGENT_RUNS;
  const runs = A.reduce((n, a) => n + a.runs, 0);
  const failed = A.reduce((n, a) => n + a.runs * a.failed, 0) / runs;
  const unresolved = A.filter((a) => a.tags.includes("Unresolved")).length;
  const tagCls = {
    "Built-in": "neutral",
    "Model mismatch": "warning",
    Slower: "warning",
    Failing: "danger",
    Unresolved: "warning",
  };
  return (
    '<div class="rp-page-head"><div><h3 class="rp-page-h">Agents</h3><p class="rp-page-sub">Definitions and cross-session usage for every Copilot CLI agent</p></div><span class="rp-btn rp-btn--primary">' +
    ic("plus", 14) +
    "New Agent</span></div>" +
    '<p class="c-sec" style="font-size:12.5px;margin-bottom:14px">9 agents · 6 built-in · 1 personal · 1 project · <span class="c-warning">' +
    unresolved +
    " unresolved</span> · " +
    runs +
    " runs in all time · " +
    (failed * 100).toFixed(1) +
    "% failed or cancelled</p>" +
    '<div class="cards3">' +
    A.map(
      (a) =>
        '<div class="rp-card mini-card"><h4><span class="mini-ico" style="width:28px;height:28px;color:' +
        (AG[a.type] || "#a1a1aa") +
        '">' +
        ic(AG_ICON[a.type] || "bot", 14) +
        "</span>" +
        a.type +
        (a.name
          ? ` <span class="c-muted" style="font-weight:400;font-size:11.5px">${a.name}</span>`
          : "") +
        "</h4><p>" +
        a.description +
        '</p><div class="rp-chips">' +
        a.tags.map((t) => `<span class="rp-badge rp-badge--${tagCls[t]}">${t}</span>`).join("") +
        '</div><div class="mini-stats"><div><div class="t">Runs</div><div class="v">' +
        a.runs +
        '</div></div><div><div class="t">Median</div><div class="v">' +
        a.median +
        '</div></div><div><div class="t">Failed</div><div class="v' +
        (a.failed > 0.1 ? " c-danger" : "") +
        '">' +
        fmtPct(a.failed) +
        "</div></div></div></div>",
    ).join("") +
    "</div>"
  );
}
export function viewWorktrees() {
  const W = [
    [
      "chore/aws-provider-v6",
      "C:\\code\\acme\\infra.worktrees\\chore-aws…",
      "595b47db",
      "41 MB",
      "Active",
      "9h ago",
    ],
    [
      "chore/codegen",
      "C:\\code\\acme\\checkout-web.worktrees\\ch…",
      "be100533",
      "127 MB",
      "Active",
      "4d ago",
    ],
    [
      "feat/idempotency-keys",
      "C:\\code\\acme\\payments-api.worktrees\\fe…",
      "49d73eb4",
      "74 MB",
      "Active",
      "4h ago",
    ],
    [
      "feature/apple-pay",
      "C:\\code\\acme\\checkout-web.worktrees\\fe…",
      "4f1c2a9e",
      "148 MB",
      "Active",
      "57m ago",
    ],
    [
      "fix/flaky-e2e",
      "C:\\code\\acme\\checkout-web.worktrees\\fi…",
      "4bd83441",
      "131 MB",
      "Active",
      "7h ago",
    ],
    [
      "fix/rounding",
      "C:\\code\\acme\\payments-api.worktrees\\fi…",
      "48634fa5",
      "66 MB",
      "Stale",
      "1mo ago",
    ],
    ["main", "C:\\code\\acme\\checkout-web", "", "612 MB", "Active", "7mo ago"],
    [
      "perf/bundle",
      "C:\\code\\acme\\checkout-web.worktrees\\pe…",
      "ecca221e",
      "122 MB",
      "Stale",
      "1mo ago",
    ],
  ];
  return (
    '<div class="rp-page-head"><div><h3 class="rp-page-h">Worktree Manager</h3><p class="rp-page-sub">Total: 12 · Active: 10 · <span class="c-warning">Stale: 2</span> · Disk: 1.9 GB</p></div><span class="rp-btn rp-btn--primary">' +
    ic("plus", 14) +
    "Create Worktree</span></div>" +
    '<div class="rp-card" style="padding:10px 14px;margin-bottom:14px;color:var(--warning-fg);font-size:12.5px;display:flex;align-items:center;gap:8px;border-color:rgba(245,158,11,.35)">' +
    ic("alert", 15) +
    "<b>2 stale worktrees</b> — 188 MB reclaimable</div>" +
    '<div class="rp-card rp-panel"><table class="tbl"><thead><tr><th></th><th>Path / branch</th><th>Session</th><th>Disk</th><th>Status</th><th>Created</th></tr></thead><tbody>' +
    W.map(
      (w) =>
        '<tr><td style="width:40px"><span class="wt-ico' +
        (w[4] === "Stale" ? " stale" : w[0] === "main" ? " main" : "") +
        '">' +
        ic(w[0] === "main" ? "folder" : "branch", 14) +
        "</span></td><td><b>" +
        w[0] +
        '</b><div class="mono c-muted" style="font-size:10.5px">' +
        w[1] +
        '</div></td><td class="mono c-accent" style="font-size:11px">' +
        (w[2] || '<i class="c-muted">No session</i>') +
        "</td><td>" +
        w[3] +
        '</td><td><span class="rp-badge rp-badge--' +
        (w[4] === "Stale" ? "warning" : "success") +
        '">' +
        w[4] +
        '</span></td><td class="c-muted">' +
        w[5] +
        "</td></tr>",
    ).join("") +
    "</tbody></table></div>"
  );
}
export function viewStub(name) {
  const info = {
    compare: [
      "columns",
      "Session Comparison",
      "Put two sessions side by side and normalise tokens, credits and tool calls by turns or duration.",
    ],
    export: [
      "upload",
      "Export",
      "Export sessions as Markdown, TracePilot JSON or a raw archive, with configurable sections and path redaction.",
    ],
    command: [
      "compass",
      "Command Centre",
      "Repository and session status, recent activity and system dependency health in one place.",
    ],
    settings: [
      "gear",
      "Settings",
      "Pricing, session-state location, indexing, update checks and optional features.",
    ],
  }[name];
  return (
    '<div class="rp-page-head"><div><h3 class="rp-page-h">' +
    info[1] +
    '</h3><p class="rp-page-sub">' +
    info[2] +
    '</p></div></div><div class="rp-card stub"><span class="mini-ico">' +
    ic(info[0], 20) +
    "</span><b>" +
    info[1] +
    " lives in the desktop app</b><p>This in-browser demo covers the session views, search and the launcher. Download TracePilot to explore " +
    info[1] +
    ' with your own sessions.</p><a class="rp-btn rp-btn--primary" href="' +
    DOWNLOAD_URL +
    '" target="_blank" rel="noopener">Download TracePilot</a></div>'
  );
}
