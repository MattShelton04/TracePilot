// Session library for the README showcase: a hand-written recent week on top
// of three months of generated history, so list counts, analytics totals and
// per-day charts all describe the same sessions.

import {
  ago,
  between,
  CLI_VERSION,
  DAY,
  HERO_CWD,
  HERO_SESSION_ID,
  HOUR,
  MINUTE,
  NOW_MS,
  pick,
  rng,
} from "./common.mjs";

const recent = [
  // [summary, repository, branch, model, hours ago, events, turns, errors, rate limits, compactions]
  [
    "Add Apple Pay to checkout",
    "acme/checkout-web",
    "feature/apple-pay",
    "claude-opus-5.5",
    0.02,
    1284,
    12,
    0,
    0,
    1,
  ],
  [
    "Make payment retries idempotent",
    "acme/payments-api",
    "feat/idempotency-keys",
    "gpt-6-sol",
    1.6,
    3412,
    61,
    2,
    0,
    3,
  ],
  [
    "Fix flaky Playwright checkout tests",
    "acme/checkout-web",
    "fix/flaky-e2e",
    "claude-sonnet-5",
    3.1,
    906,
    22,
    1,
    0,
    0,
  ],
  [
    "Upgrade Terraform AWS provider to v6",
    "acme/infra",
    "chore/aws-provider-v6",
    "gpt-5.6-luna",
    5.4,
    1530,
    27,
    0,
    1,
    1,
  ],
  [
    "Audit dark-mode design tokens",
    "acme/design-system",
    "feat/dark-tokens",
    "claude-opus-5.5",
    8.2,
    742,
    18,
    0,
    0,
    0,
  ],
  [
    "Investigate p95 latency regression",
    "acme/payments-api",
    "main",
    "gpt-6-sol",
    21,
    2208,
    44,
    3,
    2,
    2,
  ],
  [
    "Draft ADR for event sourcing",
    "acme/platform-docs",
    "docs/adr-event-sourcing",
    "claude-sonnet-5",
    26,
    388,
    11,
    0,
    0,
    0,
  ],
  [
    "Move cart state to Pinia",
    "acme/checkout-web",
    "refactor/pinia-cart",
    "gpt-6-luna",
    30,
    1876,
    39,
    0,
    0,
    2,
  ],
  [
    "Add OpenTelemetry tracing",
    "acme/payments-api",
    "feat/otel",
    "claude-opus-5.5",
    46,
    2650,
    52,
    1,
    0,
    2,
  ],
  ["Triage Dependabot alerts", "acme/mobile-app", "main", "claude-haiku-4.5", 50, 214, 9, 0, 0, 0],
  [
    "Write v3.8 release notes",
    "acme/mobile-app",
    "release/3.8",
    "gpt-5.6-luna",
    53,
    326,
    8,
    0,
    0,
    0,
  ],
  [
    "Generate GraphQL client types",
    "acme/checkout-web",
    "chore/codegen",
    "gpt-6-sol",
    70,
    611,
    15,
    0,
    0,
    0,
  ],
];

const historyTitles = [
  "Add rate limiting to webhooks",
  "Refactor order summary component",
  "Fix currency rounding in invoices",
  "Speed up CI test sharding",
  "Add feature flag cleanup script",
  "Document payment error codes",
  "Migrate icons to SVG sprites",
  "Harden CSP for checkout",
  "Fix timezone bug in receipts",
  "Add retry budget to API client",
  "Review accessibility of forms",
  "Split monolith settings page",
  "Add Kubernetes readiness probes",
  "Investigate memory leak in worker",
  "Port date utils to Temporal",
  "Add snapshot tests for emails",
  "Tune Postgres connection pool",
  "Clean up unused translations",
  "Add metrics for refund flow",
  "Explain legacy discount engine",
  "Prototype saved payment methods",
  "Fix Android deep links",
  "Add Storybook interaction tests",
  "Reduce bundle size of checkout",
];
const historyRepos = [
  ["acme/checkout-web", ["main", "feat/saved-cards", "fix/a11y-forms", "perf/bundle"]],
  ["acme/payments-api", ["main", "feat/refund-metrics", "fix/rounding"]],
  ["acme/design-system", ["main", "feat/storybook-tests"]],
  ["acme/infra", ["main", "chore/k8s-probes"]],
  ["acme/mobile-app", ["main", "fix/deep-links"]],
];
const historyModels = [
  "claude-opus-5.5",
  "claude-opus-5.5",
  "gpt-6-sol",
  "gpt-6-sol",
  "claude-sonnet-5",
  "gpt-5.6-luna",
  "gpt-6-luna",
  "claude-haiku-4.5",
];

function historySessions() {
  const random = rng(20260930);
  const sessions = [];
  for (let index = 0; index < 360; index++) {
    // Older history is sparser, weekdays are busier than weekends.
    let hoursAgo = 74 + index * 5.8 + random() * 5;
    const weekday = new Date(NOW_MS - hoursAgo * HOUR).getUTCDay();
    if (weekday === 0 || weekday === 6) hoursAgo += 48;
    const [repository, branches] = pick(random, historyRepos);
    const turns = between(random, 4, 70);
    sessions.push({
      summary: pick(random, historyTitles),
      repository,
      branch: pick(random, branches),
      model: pick(random, historyModels),
      hoursAgo,
      events: turns * between(random, 18, 42),
      turns,
      errors: random() < 0.12 ? between(random, 1, 3) : 0,
      rateLimits: random() < 0.08 ? 1 : 0,
      compactions: turns > 40 ? between(random, 1, 3) : 0,
    });
  }
  return sessions;
}

function uuid(random) {
  const hex = () => Math.floor(random() * 16).toString(16);
  const part = (length) => Array.from({ length }, hex).join("");
  return `${part(8)}-${part(4)}-4${part(3)}-a${part(3)}-${part(12)}`;
}

function buildSessions() {
  const random = rng(42);
  const rows = [
    ...recent.map(
      ([
        summary,
        repository,
        branch,
        model,
        hoursAgo,
        events,
        turns,
        errors,
        rateLimits,
        compactions,
      ]) => ({
        summary,
        repository,
        branch,
        model,
        hoursAgo,
        events,
        turns,
        errors,
        rateLimits,
        compactions,
      }),
    ),
    ...historySessions(),
  ];
  return rows.map((row, index) => {
    const id = index === 0 ? HERO_SESSION_ID : uuid(random);
    // The hero's authored turns span 46 minutes and it is still running.
    const durationHours =
      index === 0 ? 47 / 60 : Math.max(0.3, row.turns * (0.04 + random() * 0.06));
    const updatedMs = NOW_MS - row.hoursAgo * HOUR;
    // Tokens scale with turns; cache reads dominate long sessions.
    const inputTokens = row.turns * between(random, 52_000, 140_000);
    const outputTokens = Math.round(inputTokens * (0.018 + random() * 0.014));
    const cacheReadTokens = Math.round(inputTokens * (0.62 + random() * 0.26));
    return {
      id,
      summary: row.summary,
      repository: row.repository,
      branch: row.branch,
      cwd: `C:\\code\\${row.repository.replace("/", "\\")}`,
      hostType: "cli",
      createdAt: new Date(updatedMs - durationHours * HOUR).toISOString(),
      updatedAt: new Date(updatedMs).toISOString(),
      eventCount: row.events,
      turnCount: row.turns,
      currentModel: row.model,
      copilotVersion: CLI_VERSION,
      isRunning: index === 0,
      errorCount: row.errors,
      rateLimitCount: row.rateLimits,
      compactionCount: row.compactions,
      truncationCount: 0,
      // Analytics inputs (not part of the IPC list item).
      _usage: {
        inputTokens,
        outputTokens,
        cacheReadTokens,
        requests: row.turns * between(random, 3, 7),
        apiDurationMs: Math.round(durationHours * HOUR * (0.32 + random() * 0.25)),
        toolCalls: row.turns * between(random, 3, 9),
      },
    };
  });
}

export const showcaseSessions = buildSessions();

export function sessionListItems() {
  return showcaseSessions.map(({ _usage, ...item }) => item);
}

export function findSession(id) {
  return showcaseSessions.find((session) => session.id === id) ?? showcaseSessions[0];
}

export const heroSession = showcaseSessions[0];

export function sessionDetail(id, shutdownMetrics) {
  const session = findSession(id);
  const {
    _usage,
    isRunning,
    errorCount,
    rateLimitCount,
    compactionCount,
    truncationCount,
    ...detail
  } = session;
  const hero = session.id === HERO_SESSION_ID;
  return {
    ...detail,
    cwd: hero ? HERO_CWD : session.cwd,
    gitRoot: hero ? HERO_CWD : session.cwd,
    hasPlan: hero,
    hasCheckpoints: hero || session.compactionCount > 0,
    checkpointCount: hero ? 1 : session.compactionCount,
    shutdownMetrics: hero ? shutdownMetrics : null,
  };
}

export const heroStartMs = Date.parse(heroSession.createdAt);
export const heroAt = (minutes) => new Date(heroStartMs + minutes * MINUTE).toISOString();
export { ago, DAY };
