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
const sessions = sessionListItems();
const analytics = call(showcaseAnalytics);
const heroDetail = sessionDetail(common.HERO_SESSION_ID, hero.heroShutdownMetrics);

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
};

validateShowcase(data);
const out = join(here, "../src/data/showcase.json");
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, `${JSON.stringify(data)}\n`);
console.log(
  `site data: wrote src/data/showcase.json (${Math.round(JSON.stringify(data).length / 1024)} KB)`,
);
