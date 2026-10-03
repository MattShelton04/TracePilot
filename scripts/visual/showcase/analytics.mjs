// Cross-session analytics derived from the showcase session history, so the
// Analytics, Tools, Code and Models pages agree with the session library.

import { between, DAY, isoDate, NOW_MS, rng } from "./common.mjs";
import { showcaseSessions } from "./sessions.mjs";

const days = Array.from({ length: 92 }, (_, index) => isoDate(NOW_MS - (91 - index) * DAY));
const dayOf = (session) => session.updatedAt.slice(0, 10);
const sum = (rows, key) => rows.reduce((total, row) => total + row[key], 0);

function perDay(map) {
  return days.map((date) =>
    map(
      showcaseSessions.filter((session) => dayOf(session) === date),
      date,
    ),
  );
}

function usageTotals(sessions) {
  return {
    inputTokens: sessions.reduce((total, s) => total + s._usage.inputTokens, 0),
    outputTokens: sessions.reduce((total, s) => total + s._usage.outputTokens, 0),
    cacheReadTokens: sessions.reduce((total, s) => total + s._usage.cacheReadTokens, 0),
    requests: sessions.reduce((total, s) => total + s._usage.requests, 0),
  };
}

function modelRows() {
  const models = [...new Set(showcaseSessions.map((session) => session.currentModel))];
  const rows = models.map((model) => {
    const usage = usageTotals(showcaseSessions.filter((session) => session.currentModel === model));
    return {
      model,
      tokens: usage.inputTokens + usage.outputTokens,
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
      cacheReadTokens: usage.cacheReadTokens,
      cacheWriteTokens: model.startsWith("claude") ? Math.round(usage.inputTokens * 0.04) : 0,
      premiumRequests: 0,
      requestCount: usage.requests,
    };
  });
  const total = sum(rows, "tokens");
  return rows
    .map((row) => ({ ...row, percentage: Number(((row.tokens / total) * 100).toFixed(1)) }))
    .sort((a, b) => b.tokens - a.tokens);
}

function durationStats() {
  const values = showcaseSessions
    .map((session) => session._usage.apiDurationMs)
    .sort((a, b) => a - b);
  const at = (fraction) =>
    values[Math.min(values.length - 1, Math.floor(values.length * fraction))];
  return {
    avgMs: Math.round(values.reduce((total, value) => total + value, 0) / values.length),
    medianMs: at(0.5),
    p95Ms: at(0.95),
    minMs: values[0],
    maxMs: values.at(-1),
    totalSessionsWithDuration: values.length,
  };
}

export function showcaseAnalytics() {
  const usage = usageTotals(showcaseSessions);
  const turns = showcaseSessions.reduce((total, session) => total + session.turnCount, 0);
  const toolCalls = showcaseSessions.reduce(
    (total, session) => total + session._usage.toolCalls,
    0,
  );
  const apiMs = showcaseSessions.reduce(
    (total, session) => total + session._usage.apiDurationMs,
    0,
  );
  const totalTokens = usage.inputTokens + usage.outputTokens;
  const models = modelRows();
  return {
    totalSessions: showcaseSessions.length,
    totalTokens,
    totalCost: 0,
    totalPremiumRequests: 0,
    tokenUsageByDay: perDay((sessions, date) => {
      const day = usageTotals(sessions);
      return { date, tokens: day.inputTokens + day.outputTokens };
    }),
    activityPerDay: perDay((sessions, date) => ({ date, count: sessions.length })),
    modelDistribution: models,
    costByDay: perDay((_sessions, date) => ({ date, cost: 0 })),
    modelUsageByDay: days.flatMap((date) =>
      models
        .map(({ model }) => {
          const day = usageTotals(
            showcaseSessions.filter(
              (session) => dayOf(session) === date && session.currentModel === model,
            ),
          );
          return {
            date,
            model,
            inputTokens: day.inputTokens,
            outputTokens: day.outputTokens,
            cacheReadTokens: day.cacheReadTokens,
            cacheWriteTokens: model.startsWith("claude") ? Math.round(day.inputTokens * 0.04) : 0,
          };
        })
        .filter((row) => row.inputTokens > 0),
    ),
    apiDurationStats: durationStats(),
    productivityMetrics: {
      avgTurnsPerSession: Number((turns / showcaseSessions.length).toFixed(1)),
      avgToolCallsPerTurn: Number((toolCalls / turns).toFixed(1)),
      avgTokensPerTurn: Math.round(totalTokens / turns),
      avgTokensPerApiSecond: Math.round(totalTokens / (apiMs / 1000)),
    },
    cacheStats: {
      totalCacheReadTokens: usage.cacheReadTokens,
      totalInputTokens: usage.inputTokens,
      cacheHitRate: Number(((usage.cacheReadTokens / usage.inputTokens) * 100).toFixed(1)),
      nonCachedInputTokens: usage.inputTokens - usage.cacheReadTokens,
    },
    sessionsWithErrors: showcaseSessions.filter((session) => session.errorCount > 0).length,
    totalRateLimits: sum(showcaseSessions, "rateLimitCount"),
    totalCompactions: sum(showcaseSessions, "compactionCount"),
    totalTruncations: 0,
    incidentsByDay: perDay((sessions, date) => ({
      date,
      errors: sum(sessions, "errorCount"),
      rateLimits: sum(sessions, "rateLimitCount"),
      compactions: sum(sessions, "compactionCount"),
      truncations: 0,
    })).filter((row) => row.errors + row.rateLimits + row.compactions > 0),
    promptCache: {
      sessionsWithPredicted: 141,
      resumedWindows: 512,
      warmResumes: 391,
      resumesAfterExpiry: 121,
      medianIdleSeconds: 214,
      resentPrefixTokens: 9_830_000,
      resentPrefixTokensByModel: [
        { model: "claude-opus-5.5", tokens: 5_410_000 },
        { model: "gpt-6-sol", tokens: 2_870_000 },
        { model: "claude-sonnet-5", tokens: 1_550_000 },
      ],
      topChangeKinds: [
        { kind: "history", count: 38 },
        { kind: "tools", count: 17 },
        { kind: "system", count: 6 },
      ],
      observedTtls: [
        { model: "claude-opus-5.5", ttlSeconds: 300, observations: 228 },
        { model: "gpt-6-sol", ttlSeconds: 1800, observations: 164 },
      ],
    },
  };
}

const toolProfile = [
  // name, share of calls, success rate, average ms
  ["view", 0.24, 0.995, 110],
  ["powershell", 0.19, 0.91, 6_800],
  ["edit", 0.17, 0.97, 240],
  ["grep", 0.11, 0.99, 190],
  ["glob", 0.06, 0.995, 120],
  ["create", 0.05, 0.98, 210],
  ["report_intent", 0.05, 1, 4],
  ["explore", 0.03, 0.97, 52_000],
  ["sql", 0.025, 0.99, 30],
  ["read_agent", 0.02, 0.98, 41_000],
  ["web_fetch", 0.015, 0.93, 2_300],
  ["code-review", 0.01, 0.95, 210_000],
  ["general-purpose", 0.01, 0.94, 286_000],
  ["write_agent", 0.005, 1, 800],
];

export function showcaseToolAnalysis() {
  const totalCalls = showcaseSessions.reduce(
    (total, session) => total + session._usage.toolCalls,
    0,
  );
  const tools = toolProfile.map(([name, share, successRate, avgDurationMs]) => {
    const callCount = Math.round(totalCalls * share);
    return {
      name,
      callCount,
      successRate,
      avgDurationMs,
      totalDurationMs: callCount * avgDurationMs,
    };
  });
  const calls = sum(tools, "callCount");
  const random = rng(7);
  const activityHeatmap = [];
  for (let day = 0; day < 7; day++) {
    for (let hour = 0; hour < 24; hour++) {
      const weekday = day < 5;
      const working = hour >= 8 && hour <= 18;
      const lunch = hour === 12;
      const base = weekday
        ? working
          ? lunch
            ? 14
            : 30
          : hour >= 19 && hour <= 22
            ? 8
            : 1
        : working
          ? 5
          : 1;
      activityHeatmap.push({
        day,
        hour,
        count: Math.max(0, Math.round(base * (0.6 + random() * 0.8))),
      });
    }
  }
  return {
    totalCalls: calls,
    successRate:
      tools.reduce((total, tool) => total + tool.successRate * tool.callCount, 0) / calls,
    avgDurationMs: Math.round(sum(tools, "totalDurationMs") / calls),
    mostUsedTool: "view",
    tools,
    activityHeatmap,
  };
}

// The backend ranks paths by how many sessions modified them.
const files = [
  ["package.json", 41],
  ["src/stores/cart.ts", 31],
  ["src/components/checkout/PaymentMethods.vue", 27],
  ["pnpm-lock.yaml", 24],
  ["src/api/client.ts", 19],
  ["src/payments/registry.ts", 16],
  ["infra/modules/payments/main.tf", 14],
  ["src/api/idempotency.ts", 11],
];

export function showcaseCodeImpact() {
  const random = rng(11);
  const changesByDay = days.slice(-30).map((date) => {
    const weekday = new Date(`${date}T12:00:00Z`).getUTCDay();
    const scale = weekday === 0 || weekday === 6 ? 0.15 : 1;
    return {
      date,
      additions: Math.round(between(random, 180, 1_400) * scale),
      deletions: Math.round(between(random, 60, 700) * scale),
    };
  });
  const linesAdded = sum(changesByDay, "additions");
  const linesRemoved = sum(changesByDay, "deletions");
  const types = [
    [".ts", 214],
    [".vue", 96],
    [".tf", 41],
    [".md", 38],
    [".json", 27],
    [".css", 19],
    [".yaml", 12],
  ];
  const filesModified = types.reduce((total, [, count]) => total + count, 0);
  return {
    filesModified,
    linesAdded,
    linesRemoved,
    netChange: linesAdded - linesRemoved,
    fileTypeBreakdown: types.map(([extension, count]) => ({
      extension,
      count,
      percentage: Number(((count / filesModified) * 100).toFixed(1)),
    })),
    mostModifiedFiles: files.map(([path, sessions]) => ({
      path,
      additions: sessions,
      deletions: 0,
    })),
    changesByDay,
  };
}
