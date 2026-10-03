import { D } from "../data.js";
import { ic } from "./icons.js";
import { esc, HERO, relTime } from "./shared.js";
import { panelContext, panelExplorer } from "./views-context.js";
import {
  detailHead,
  panelConversation,
  panelEvents,
  panelOverview,
  stat,
  tabsHTML,
} from "./views-session.js";
import { panelTimeline } from "./views-timeline.js";
import { panelMetrics, panelTodos } from "./views-todos.js";

export function viewSessionDetail(uid) {
  return (
    detailHead(HERO, true) +
    tabsHTML(false) +
    '<div class="sd-panels">' +
    '<div class="sd-panel" data-panel="overview">' +
    panelOverview() +
    "</div>" +
    '<div class="sd-panel" data-panel="conversation" hidden>' +
    panelConversation() +
    "</div>" +
    '<div class="sd-panel" data-panel="events" hidden>' +
    panelEvents() +
    "</div>" +
    '<div class="sd-panel" data-panel="todos" hidden>' +
    panelTodos(uid) +
    "</div>" +
    '<div class="sd-panel" data-panel="metrics" hidden>' +
    panelMetrics() +
    "</div>" +
    '<div class="sd-panel" data-panel="context" hidden>' +
    panelContext(uid) +
    "</div>" +
    '<div class="sd-panel" data-panel="explorer" hidden>' +
    panelExplorer() +
    "</div>" +
    '<div class="sd-panel" data-panel="timeline" hidden>' +
    panelTimeline(uid) +
    "</div>" +
    "</div>"
  );
}

export function viewSessionLite(s) {
  return (
    detailHead(s, s.isRunning) +
    tabsHTML(true) +
    '<div class="rp-stats">' +
    stat(s.eventCount, "Events", "c-accent") +
    stat(s.turnCount, "Turns", "c-accent") +
    stat(s.errorCount, "Errors", s.errorCount ? "c-danger" : "c-muted") +
    stat(s.compactionCount, "Compactions", "c-warning") +
    "</div>" +
    '<div class="rp-card stub" style="margin-top:14px"><b>Open the featured session</b><p>This demo fully populates one session, <em>Add Apple Pay to checkout</em>. In the app, every session opens with the same eight tabs.</p><button type="button" class="rp-btn rp-btn--primary" data-session="' +
    HERO.id +
    '">Open the Apple Pay session</button></div>'
  );
}

export const CT = {
  user_message: ["User Message", "success", "#34d399"],
  assistant_message: ["Assistant Message", "accent", "#60a5fa"],
  reasoning: ["Reasoning", "done", "#a78bfa"],
  tool_call: ["Tool Call", "warning", "#fbbf24"],
  tool_result: ["Tool Result", "warning", "#fb923c"],
  subagent: ["Subagent", "done", "#c084fc"],
};
export function viewSearch() {
  const R = D.search.search_content.results;
  const F = D.search.get_search_facets.byContentType;
  const order = [
    "user_message",
    "assistant_message",
    "reasoning",
    "tool_call",
    "tool_result",
    "subagent",
  ];
  const fc = Object.fromEntries(F);
  const facets = order
    .map(
      (k) =>
        '<div class="sr-facet"><span class="box"></span><span class="dot" style="background:' +
        CT[k][2] +
        '"></span>' +
        CT[k][0] +
        '<span class="n">' +
        (fc[k] || 0) +
        "</span></div>",
    )
    .join("");
  const res = R.slice(0, 6)
    .map((r) => {
      const t = CT[r.contentType];
      const snip = esc(r.snippet)
        .replace(/&lt;mark&gt;/g, "<mark>")
        .replace(/&lt;\/mark&gt;/g, "</mark>");
      return (
        '<div class="rp-card sr-res"><div class="sr-res-top"><span class="rp-badge rp-badge--accent">' +
        r.sessionRepository +
        '</span><span class="rp-badge rp-badge--success">' +
        r.sessionBranch +
        "</span>" +
        relTime(r.timestampUnix * 1000) +
        '<span class="rp-badge rp-badge--' +
        t[1] +
        ' type">' +
        t[0] +
        "</span></div>" +
        '<p class="sr-snip">' +
        snip +
        "</p>" +
        '<div class="sr-res-foot"><b>' +
        esc(r.sessionSummary) +
        "</b><span>Turn " +
        r.turnNumber +
        "</span><span>" +
        t[0].toLowerCase() +
        "</span>" +
        (r.toolName ? `<span class="rp-badge rp-badge--neutral mono">${r.toolName}</span>` : "") +
        '<button type="button" class="rp-btn rp-btn--sm rp-btn--ghost-accent"' +
        (r.sessionId === HERO.id
          ? ` data-session="${HERO.id}" data-goto-tab="conversation"`
          : ` data-session="${r.sessionId}"`) +
        ">View in session</button></div></div>"
      );
    })
    .join("");
  return (
    '<div class="rp-card sr-box">' +
    ic("search", 19, 'style="color:var(--text-tertiary)"') +
    '<span class="q"></span><span class="sr-caret"></span><span class="rp-kbd">Ctrl+K</span></div>' +
    '<div class="sr-syntax">' +
    [
      ['"phrase"', "exact match"],
      ["prefix*", "prefix search"],
      ["type:error", "filter by type"],
      ["repo:name", "filter by repo"],
      ["tool:grep", "filter by tool"],
    ]
      .map(
        (x) =>
          '<span class="sr-syn"><code>' +
          esc(x[0]) +
          "</code>" +
          x[1] +
          '<span class="shine"></span></span>',
      )
      .join("") +
    '<span class="sr-syn" style="color:var(--accent-fg)">' +
    ic("info", 12) +
    "More syntax</span></div>" +
    '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px"><span class="rp-btn rp-btn--ghost-accent">' +
    ic("filter", 14) +
    'Filters</span><span class="rp-select" style="width:auto">Sort: Relevance ' +
    ic("chevD", 14) +
    "</span></div>" +
    '<div class="sr-cols"><aside class="rp-card sr-facets"><h6>Content type <span>Select All</span></h6>' +
    facets +
    '<h6 style="margin-top:18px">Repository</h6><div class="rp-select">All Repositories ' +
    ic("chevD", 14) +
    '</div><h6>Tool</h6><div class="rp-select">All Tools ' +
    ic("chevD", 14) +
    "</div></aside>" +
    '<div><div class="rp-card sr-found"><span class="sr-found-t">' +
    D.search.get_search_stats.totalRows.toLocaleString("en-US") +
    " indexed rows across " +
    D.search.get_search_stats.indexedSessions +
    " sessions</span>" +
    ic("list", 15, 'style="color:var(--text-tertiary)"') +
    '</div><div class="sr-results">' +
    res +
    "</div></div></div>"
  );
}

export const PROMPT =
  "Add saved payment methods to checkout. Reuse the PaymentProvider interface, keep card data in Stripe, and add Playwright coverage for returning customers.";
export function viewLauncher() {
  return (
    '<div class="ln"><div class="ln-form">' +
    '<h3 class="rp-page-h">Launch Session</h3><p class="rp-page-sub">Configure and launch a new Copilot CLI session</p>' +
    '<div style="height:1px;background:var(--border-subtle);margin:16px 0 14px"></div>' +
    '<div class="rp-section-title">Saved templates</div>' +
    '<div class="ln-tpls"><div class="rp-card ln-tpl"><span style="color:var(--accent-fg)">' +
    ic("search", 18) +
    "</span><b>Multi Agent Code Review</b><p>Comprehensive code review using multiple AI models</p></div>" +
    '<div class="rp-card ln-tpl"><span style="color:var(--success-fg)">' +
    ic("flask", 18) +
    "</span><b>Write Tests</b><p>Generate comprehensive test coverage for recent changes</p></div></div>" +
    '<div class="rp-section-title">Configuration</div>' +
    '<div class="rp-card ln-cfg">' +
    '<div class="ln-field"><label>Repository <a>Fetch Latest From Remote</a></label><div class="rp-select ln-repo"><span class="ph">Select a repository…</span>' +
    ic("chevD", 14) +
    '</div><div class="ln-path"><div class="rp-select ln-pathv"><span class="ph">Path</span></div><span class="rp-btn">Browse</span></div></div>' +
    '<div class="ln-field"><label>Branch <a>Reset to Default</a></label><div class="rp-select"><span class="ph">Leave blank to stay on current branch</span>' +
    ic("chevD", 14) +
    '</div><div class="hint">Optional — checks out or creates this branch before starting</div></div>' +
    '<div class="ln-field"><label>Model</label><div class="rp-select ln-model"><span class="ph">Default model</span>' +
    ic("chevD", 14) +
    "</div></div>" +
    '<div class="ln-field"><label>Reasoning Effort</label><div class="ln-effort"><i></i><span data-e="0">Low</span><span data-e="1" class="is-on">Medium</span><span data-e="2">High</span></div></div>' +
    "</div>" +
    '<div class="rp-section-title">Initial prompt</div>' +
    '<div class="rp-card ln-prompt"><div class="ln-textarea"><span class="ln-ptext"></span><span class="ph">Describe what Copilot should do…</span></div><div class="hint c-muted" style="font-size:11.5px;margin-top:8px">Prompt will be passed to the CLI via <span class="mono">--interactive</span> and executed automatically on session start</div></div>' +
    "</div>" +
    '<aside class="ln-side"><div class="k">Live preview</div>' +
    '<div class="ln-tiles"><div class="ln-tile"><div class="t">Est. cost</div><div class="v c-accent ln-cost">—</div></div><div class="ln-tile"><div class="t">Model tier</div><div class="v ln-tier">—</div></div><div class="ln-tile"><div class="t">Active sessions</div><div class="v c-success ln-active">1</div></div><div class="ln-tile"><div class="t">Template</div><div class="v">Custom</div></div></div>' +
    '<div class="ln-kv"><span>Repository</span><b class="kv-repo">—</b><span>Branch</span><b>default</b><span>Model</span><b class="kv-model">—</b><span>Reasoning</span><b class="kv-eff">Medium</b><span>Launch path</span><b>Terminal</b><span>Prompt</span><b class="kv-prompt">—</b></div>' +
    '<div class="k" style="margin-top:6px">Command preview</div><div class="ln-cmd"><span class="ln-cmd-t"></span><span class="cur"></span></div>' +
    '<button type="button" class="rp-btn ln-go" data-act="launch">' +
    ic("play", 15) +
    "<span>Launch Session</span></button>" +
    "</aside></div>"
  );
}
