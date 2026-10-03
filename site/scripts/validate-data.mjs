// Shape checks for the landing page's build-time data. The page hand-places the
// showcase story (three subagents, a compaction, a ten-node todo graph), so a
// fixture rename must fail the build instead of rendering a broken page.

const TODO_IDS = [
  "map-flow",
  "provider",
  "device",
  "unit",
  "button",
  "cert",
  "review",
  "e2e",
  "pr",
  "docs",
];
const TURN_CALLS = [
  "intent-review",
  "agent-review",
  "agent-e2e",
  "agent-safari",
  "rev-diff",
  "saf-grep",
  "write-e2e",
  "write-peer",
  "read-safari",
  "read-review",
  "read-e2e",
];
const SUBAGENTS = ["agent-review", "agent-e2e", "agent-safari"];

const isNum = (v) => typeof v === "number" && Number.isFinite(v);
const isStr = (v) => typeof v === "string" && v.length > 0;
const isDate = (v) => isStr(v) && !Number.isNaN(Date.parse(v));

/** Throws one error that lists every problem found. */
export function validateShowcase(d) {
  const problems = [];
  const need = (ok, what) => {
    if (!ok) problems.push(what);
  };
  const fields = (obj, path, checks) => {
    if (!obj || typeof obj !== "object") return need(false, `${path} is missing`);
    for (const [key, check] of Object.entries(checks)) need(check(obj[key]), `${path}.${key}`);
  };

  need(isNum(d.sessionCount) && d.sessionCount > 0, "sessionCount");
  need(Array.isArray(d.sessions) && d.sessions.length >= 12, "sessions (need at least 12)");
  for (const [i, s] of (d.sessions ?? []).entries()) {
    fields(s, `sessions[${i}]`, {
      id: isStr,
      summary: isStr,
      repository: isStr,
      branch: isStr,
      currentModel: isStr,
      hostType: isStr,
      updatedAt: isDate,
      eventCount: isNum,
      turnCount: isNum,
    });
  }
  fields(d.heroDetail, "heroDetail", {
    id: isStr,
    summary: isStr,
    repository: isStr,
    branch: isStr,
    currentModel: isStr,
    hostType: isStr,
    createdAt: isDate,
    updatedAt: isDate,
    eventCount: isNum,
    turnCount: isNum,
    checkpointCount: isNum,
  });
  need(d.sessions?.[0]?.id === d.heroDetail?.id, "sessions[0] must be the hero session");

  const t8 = d.heroTurns?.[8];
  fields(t8, "heroTurns[8]", {
    turnIndex: isNum,
    eventIndex: isNum,
    userMessage: isStr,
    timestamp: isDate,
    endTimestamp: isDate,
    durationMs: isNum,
    model: isStr,
    toolCalls: Array.isArray,
    agentMessages: Array.isArray,
    assistantMessages: (v) => Array.isArray(v) && v.length >= 2,
  });
  const calls = new Map((t8?.toolCalls ?? []).map((c) => [c.toolCallId, c]));
  for (const id of TURN_CALLS) {
    const c = calls.get(id);
    fields(c, `heroTurns[8] tool call "${id}"`, {
      toolName: isStr,
      startedAt: isDate,
      completedAt: isDate,
      durationMs: isNum,
    });
  }
  for (const id of SUBAGENTS) {
    fields(calls.get(id), `subagent "${id}"`, {
      isSubagent: (v) => v === true,
      agentDisplayName: isStr,
      model: isStr,
      totalTokens: isNum,
      totalToolCalls: isNum,
      resultContent: isStr,
    });
    need(
      t8?.agentMessages?.some((m) => m.recipientToolCallId === id && m.isLaunch),
      `launch message for "${id}"`,
    );
  }
  need(
    calls.get("write-peer")?.parentToolCallId === "agent-review",
    "write-peer comes from agent-review",
  );
  fields(d.heroTurns?.[9], "heroTurns[9]", { userMessage: isStr, timestamp: isDate });

  const todoIds = (d.heroTodos?.todos ?? []).map((t) => t.id).sort();
  need(
    JSON.stringify(todoIds) === JSON.stringify([...TODO_IDS].sort()),
    `heroTodos ids (the graph layout expects ${TODO_IDS.join(", ")})`,
  );
  for (const dep of d.heroTodos?.deps ?? []) {
    need(
      TODO_IDS.includes(dep.todoId) && TODO_IDS.includes(dep.dependsOn),
      `heroTodos dep ${dep.todoId}`,
    );
  }
  need(d.todoCounts?.total === TODO_IDS.length, "todoCounts.total");

  const tl = d.heroContextTimeline;
  fields(tl, "heroContextTimeline", {
    points: (v) => Array.isArray(v) && v.length === 13,
    observedPointCount: isNum,
    estimatedPointCount: isNum,
    pairedCompactionCount: isNum,
    compactionCompleteCount: isNum,
    compactions: (v) => Array.isArray(v) && v.length > 0,
  });
  need(
    tl?.points?.some((p) => p.phase === "preCompaction"),
    "heroContextTimeline has a preCompaction point",
  );
  fields(d.compaction, "compaction", { turn: isNum, count: isNum, before: isNum, after: isNum });
  fields(d.heroMetrics, "heroMetrics", {
    totalApiDurationMs: isNum,
    shutdownType: isStr,
    currentModel: isStr,
    modelMetrics: (v) => v && Object.keys(v).length > 0,
    codeChanges: (v) => v && isNum(v.linesAdded) && isNum(v.linesRemoved),
  });
  fields(d.heroIncidents?.[0], "heroIncidents[0]", { summary: isStr, timestamp: isDate });
  need(isStr(d.heroPlan?.content), "heroPlan.content");
  need(
    d.heroFiles?.some((f) => f.path === "plan.md"),
    "heroFiles has plan.md",
  );

  for (const k of ["hero", "all"]) {
    need(isNum(d.costs?.[k]?.aic) && d.costs[k].aic > 0 && isNum(d.costs[k].usd), `costs.${k}`);
  }
  fields(d.analytics, "analytics", {
    totalSessions: isNum,
    totalTokens: isNum,
    tokenUsageByDay: (v) => Array.isArray(v) && v.length >= 62,
    activityPerDay: (v) => Array.isArray(v) && v.length >= 60,
    modelDistribution: (v) => Array.isArray(v) && v.length > 0,
    cacheStats: (v) => v && isNum(v.cacheHitRate),
  });
  fields(d.toolAnalysis, "toolAnalysis", {
    totalCalls: isNum,
    successRate: isNum,
    avgDurationMs: isNum,
    tools: (v) => Array.isArray(v) && v.length >= 7,
  });
  fields(d.codeImpact, "codeImpact", {
    filesModified: isNum,
    linesAdded: isNum,
    linesRemoved: isNum,
    netChange: isNum,
    fileTypeBreakdown: (v) => Array.isArray(v) && v.length > 0,
    mostModifiedFiles: Array.isArray,
  });
  need(isStr(d.searchQuery), "searchQuery");
  fields(d.search?.search_content, "search.search_content", {
    results: (v) => Array.isArray(v) && v.length >= 6,
    totalCount: isNum,
    latencyMs: isNum,
  });
  need(Array.isArray(d.search?.get_search_facets?.byContentType), "search facets");
  fields(d.search?.get_search_stats, "search.get_search_stats", {
    totalRows: isNum,
    indexedSessions: isNum,
  });
  need(Array.isArray(d.skills) && d.skills.length > 0, "skills");
  need(Array.isArray(d.skillUsage?.skills) && d.skillUsage.skills.length >= 5, "skillUsage.skills");

  if (problems.length) {
    throw new Error(
      `Landing page data no longer matches the showcase fixtures:\n  - ${problems.join("\n  - ")}\n` +
        "Update site/ (see docs/landing-page.md) or the fixtures in scripts/visual/showcase.",
    );
  }
}
