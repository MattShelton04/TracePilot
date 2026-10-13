// Builds site/src/data/showcase.json from the README showcase fixtures
// (scripts/visual/showcase), so the landing page shows the same synthetic
// workspace as the screenshots. Costs come from the app's own pricing code.
// Run through tsx (the pricing module is TypeScript): `pnpm site:build` does this.
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { AI_CREDIT_USD, calculateMetricsTokenCost } from "@tracepilot/types";
import { validateShowcase } from "./validate-data.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const showcase = (name) => import(`../../scripts/visual/showcase/${name}.mjs`);

const { sessionListItems, sessionDetail } = await showcase("sessions");
const hero = await showcase("hero");
const { heroTurns } = await showcase("conversation");
const { showcaseAnalytics, showcaseToolAnalysis, showcaseCodeImpact } = await showcase("analytics");
const { showcaseSearch, showcaseSkills, showcaseSkillUsage, SEARCH_QUERY } =
  await showcase("library");
const common = await showcase("common");

const call = (v) => (typeof v === "function" ? v({}) : v);

// The showcase splits its sessions and model usage between Copilot CLI and Claude Code.
// The page prices all usage in AI Credits and keeps its own illustrative split (like
// AGENT_RUNS in src/data.js, kept by hand): a few library sessions show as Claude Code
// sessions (no host, the source's own run state). So fold the sources back first.
const copilotModel = (model) => model.replace(/^(claude-[a-z]+-\d+)-(\d+)$/, "$1.$2");
const asCopilot = (s) => ({
  ...s,
  source: "copilot",
  hostType: "cli",
  copilotVersion: common.CLI_VERSION,
  currentModel: copilotModel(s.currentModel),
  isRunning: s.id === common.HERO_SESSION_ID,
  runStatus: null,
});
function mergeByModel(rows, key) {
  const merged = new Map();
  for (const { source, costUsd, costUsdPartial, ...row } of rows) {
    const model = copilotModel(row.model);
    const id = key(row, model);
    const into = merged.get(id);
    if (!into) {
      merged.set(id, { ...row, model });
      continue;
    }
    for (const [field, value] of Object.entries(row)) {
      if (typeof value === "number") into[field] += value;
    }
  }
  return [...merged.values()];
}
function foldSources(analytics) {
  const models = mergeByModel(analytics.modelDistribution, (_row, model) => model);
  const total = models.reduce((n, m) => n + m.tokens, 0);
  return {
    ...analytics,
    modelDistribution: models
      .map((m) => ({ ...m, percentage: Number(((m.tokens / total) * 100).toFixed(1)) }))
      .sort((a, b) => b.tokens - a.tokens),
    modelUsageByDay: mergeByModel(
      analytics.modelUsageByDay,
      (row, model) => `${row.date}:${model}`,
    ),
  };
}

const CLAUDE_CODE = new Set([
  "Fix flaky Playwright checkout tests",
  "Audit dark-mode design tokens",
  "Draft ADR for event sourcing",
  "Triage Dependabot alerts",
]);
const RUN_STATUS = {
  "Add Apple Pay to checkout": "busy",
  "Fix flaky Playwright checkout tests": "waiting",
};
const sessions = sessionListItems().map((item) => {
  const s = asCopilot(item);
  const runStatus = RUN_STATUS[s.summary] ?? null;
  if (!CLAUDE_CODE.has(s.summary)) return { ...s, source: "copilot", runStatus };
  return {
    ...s,
    source: "claudeCode",
    hostType: null,
    copilotVersion: null,
    isRunning: s.isRunning || runStatus != null,
    runStatus,
  };
});
const analytics = foldSources(call(showcaseAnalytics));
const heroDetail = {
  ...sessionDetail(common.HERO_SESSION_ID, hero.heroShutdownMetrics),
  source: "copilot",
  runStatus: "busy",
  // the fixtures record no reasoning effort; the story's session ran at high, as the launcher shows
  reasoningEffort: "high",
};

const usdToCost = (aic) => ({ aic, usd: aic * AI_CREDIT_USD });
function creditsFor(modelMetrics, at) {
  const cost = calculateMetricsTokenCost(modelMetrics, {
    billingProvider: "github-copilot",
    pricingKind: "usage-token-rate",
    at,
  });
  if (cost.aiCredits == null) throw new Error(`Unpriced models: ${cost.warnings.join("; ")}`);
  return usdToCost(cost.aiCredits);
}
const byModel = Object.fromEntries(
  analytics.modelDistribution.map((m) => [
    m.model,
    {
      usage: {
        inputTokens: m.inputTokens,
        outputTokens: m.outputTokens,
        cacheReadTokens: m.cacheReadTokens,
        cacheWriteTokens: m.cacheWriteTokens,
      },
    },
  ]),
);

// The turn the page tells the story of: the one where subagents ran and the
// context compacted.
const agentTurns = heroTurns.filter((t) => t.toolCalls?.some((c) => c.isSubagent));
const storyTurn = heroTurns[8];
const compaction = hero.heroIncidents.find((i) => i.eventType === "compaction");
const todoCounts = { done: 0, in_progress: 0, pending: 0, blocked: 0, total: 0 };
for (const t of hero.heroTodos.todos) {
  todoCounts[t.status] += 1;
  todoCounts.total += 1;
}
const pick = (o, keys) => Object.fromEntries(keys.map((k) => [k, o[k]]));

const data = {
  now: common.SHOWCASE_NOW,
  sessionCount: sessions.length,
  sessions: sessions.slice(0, 24),
  heroDetail,
  heroTurns: { 8: storyTurn, 9: heroTurns[9] },
  // turn start times for the Overview's Activity chart
  heroTurnStarts: heroTurns.map((t) => t.timestamp),
  heroCheckpoint: hero.heroCheckpoints.at(-1)?.title,
  agentTurn: storyTurn.turnIndex,
  agentTurnCount: agentTurns.length,
  heroTodos: hero.heroTodos,
  todoCounts,
  heroPlan: hero.heroPlan,
  heroIncidents: hero.heroIncidents,
  heroContextTimeline: hero.heroContextTimeline,
  heroMetrics: hero.heroShutdownMetrics,
  heroFiles: hero.heroFiles,
  compaction: {
    turn: hero.heroContextTimeline.compactions[0]?.startTurn,
    count: hero.heroContextTimeline.compactionCompleteCount,
    before: compaction?.detailJson?.preCompactionTokens,
    after: compaction?.detailJson?.postCompactionTokens,
  },
  costs: {
    hero: creditsFor(hero.heroShutdownMetrics.modelMetrics, new Date(heroDetail.createdAt)),
    all: creditsFor(byModel),
  },
  analytics: pick(analytics, [
    "totalSessions",
    "totalTokens",
    "tokenUsageByDay",
    "activityPerDay",
    "modelDistribution",
    "cacheStats",
    "sessionsWithErrors",
    "totalRateLimits",
    "totalCompactions",
    "totalTruncations",
  ]),
  toolAnalysis: pick(call(showcaseToolAnalysis), [
    "totalCalls",
    "successRate",
    "avgDurationMs",
    "tools",
  ]),
  codeImpact: call(showcaseCodeImpact),
  searchQuery: SEARCH_QUERY,
  search: pick(showcaseSearch, ["search_content", "get_search_facets", "get_search_stats"]),
  skills: showcaseSkills,
  skillUsage: showcaseSkillUsage,

  // ---- Analytics, Tools, Code and Models replicas (src/replica/views-analytics.js, bento) ----
  // Compact extras the redesigned pages chart; arrays run over analytics.activityPerDay's days.
  analyticsMore: analyticsMore((await showcase("sessions")).showcaseSessions),
};

function analyticsMore(showcaseSessions) {
  const days = analytics.activityPerDay.map((d) => d.date);
  const round1 = (n) => Math.round(n * 10) / 10;
  // AI Credits per day, priced like costs.all (current rates), for the Activity "Cost" metric.
  const aicByDay = days.map((date) => {
    const rows = analytics.modelUsageByDay.filter((r) => r.date === date);
    if (!rows.length) return 0;
    const metrics = Object.fromEntries(
      rows.map((r) => [
        r.model,
        {
          usage: {
            inputTokens: r.inputTokens,
            outputTokens: r.outputTokens,
            cacheReadTokens: r.cacheReadTokens,
            cacheWriteTokens: r.cacheWriteTokens,
          },
        },
      ]),
    );
    return round1(creditsFor(metrics).aic);
  });
  const modelAic = analytics.modelDistribution.map((m) =>
    round1(creditsFor({ [m.model]: byModel[m.model] }).aic),
  );
  // Tool calls per day, by each session's last day (as the app's callsByDay).
  const callsByDay = days.map((date) =>
    showcaseSessions
      .filter((s) => s.updatedAt.slice(0, 10) === date)
      .reduce((n, s) => n + s._usage.toolCalls, 0),
  );
  const inc = new Map(analytics.incidentsByDay.map((r) => [r.date, r]));
  const tools = call(showcaseToolAnalysis);
  return {
    aicByDay,
    modelAic,
    callsByDay,
    // [errors, rateLimits, compactions] per day
    incidentsByDay: days.map((date) => {
      const r = inc.get(date);
      return r ? [r.errors, r.rateLimits, r.compactions] : 0;
    }),
    apiDurationStats: analytics.apiDurationStats,
    productivityMetrics: analytics.productivityMetrics,
    // weekday (Mon first) × hour counts, row-major
    toolHeatmap: tools.activityHeatmap.map((c) => c.count),
  };
}

validateShowcase(data);
const out = join(here, "../src/data/showcase.json");
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, `${JSON.stringify(data)}\n`);
console.log(
  `site data: wrote src/data/showcase.json (${Math.round(JSON.stringify(data).length / 1024)} KB)`,
);
