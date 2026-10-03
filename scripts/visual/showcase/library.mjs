// Search results and installed skills for the README showcase.

import { ago, HOUR, MINUTE } from "./common.mjs";
import { heroSession, showcaseSessions } from "./sessions.mjs";

export const SEARCH_QUERY = "idempotency";

const [, idempotency, , , , latency, , , otel] = showcaseSessions;
const hit = (id, session, contentType, turnNumber, snippet, toolName = null) => ({
  id,
  sessionId: session.id,
  contentType,
  turnNumber,
  eventIndex: turnNumber * 40,
  timestampUnix: Math.floor(Date.parse(session.updatedAt) / 1000) - turnNumber * 300,
  toolName,
  snippet,
  metadataJson: null,
  sessionSummary: session.summary,
  sessionRepository: session.repository,
  sessionBranch: session.branch,
  sessionUpdatedAt: session.updatedAt,
});

const results = [
  hit(
    1,
    idempotency,
    "user_message",
    0,
    "Make payment retries safe: every POST to /charges should accept an <mark>Idempotency</mark>-Key and return the original response on replay.",
  ),
  hit(
    2,
    idempotency,
    "assistant_message",
    3,
    "I'll store <mark>idempotency</mark> keys in Redis with a 24 h TTL and lock per key so concurrent retries wait for the first request.",
  ),
  hit(
    3,
    idempotency,
    "tool_result",
    9,
    "✓ test/charges.<mark>idempotency</mark>.test.ts (18 tests) 412ms",
    "powershell",
  ),
  hit(
    4,
    idempotency,
    "reasoning",
    14,
    "Replaying a cached 500 would make the <mark>idempotency</mark> layer sticky for failures. Only cache 2xx and 4xx responses.",
  ),
  hit(
    5,
    latency,
    "assistant_message",
    7,
    "The p95 regression lines up with the <mark>idempotency</mark> lock: requests without a key still take the Redis round-trip.",
  ),
  hit(
    6,
    latency,
    "tool_call",
    11,
    'grep -rn "withIdempotency" src/ — wraps 14 handlers, including read-only GETs that never needed <mark>idempotency</mark>.',
    "grep",
  ),
  hit(
    7,
    heroSession,
    "subagent",
    8,
    "Confirm the Apple Pay charge path forwards the <mark>idempotency</mark> key from the checkout client.",
  ),
  hit(
    8,
    otel,
    "assistant_message",
    21,
    "Added an <mark>idempotency</mark>.replayed span attribute so traces show when a response came from the cache.",
  ),
];

export const showcaseSearch = {
  search_content: { results, totalCount: 23, hasMore: true, query: SEARCH_QUERY, latencyMs: 4 },
  get_search_facets: {
    byContentType: [
      ["assistant_message", 9],
      ["tool_result", 6],
      ["user_message", 3],
      ["reasoning", 2],
      ["tool_call", 2],
      ["subagent", 1],
    ],
    byRepository: [
      ["acme/payments-api", 19],
      ["acme/checkout-web", 4],
    ],
    byToolName: [
      ["powershell", 4],
      ["grep", 2],
      ["view", 2],
    ],
    totalMatches: 23,
    sessionCount: 4,
  },
  get_search_stats: {
    totalRows: 286_412,
    indexedSessions: showcaseSessions.length,
    totalSessions: showcaseSessions.length,
    contentTypeCounts: [
      ["tool_result", 121_870],
      ["tool_call", 96_204],
      ["assistant_message", 38_118],
      ["reasoning", 21_455],
      ["user_message", 6_940],
      ["subagent", 1_825],
    ],
  },
  get_search_repositories: [
    ...new Set(showcaseSessions.map((session) => session.repository)),
  ].sort(),
  get_search_tool_names: ["create", "edit", "grep", "powershell", "view", "web_fetch"],
};

const skillBase = {
  scope: "global",
  enabled: true,
  hasAssets: false,
  assetCount: 0,
  modifiedAt: ago(9 * 24 * HOUR),
};
const skillRows = [
  [
    "pr-description",
    "Write a pull request description with context, test plan and screenshots.",
    34,
    210,
    128,
    41,
    "personal",
  ],
  [
    "playwright-debugging",
    "Diagnose flaky Playwright tests from traces, retries and screenshots.",
    41,
    380,
    74,
    22,
    "personal",
  ],
  [
    "terraform-plan-review",
    "Review a Terraform plan for destructive changes and drift.",
    29,
    260,
    33,
    9,
    "project",
  ],
  ["release-notes", "Turn merged PRs into user-facing release notes.", 22, 190, 18, 7, "personal"],
  [
    "security-review",
    "Check a diff for injection, auth and secrets issues before merge.",
    31,
    330,
    12,
    6,
    "personal",
  ],
  [
    "adr-writer",
    "Draft an architecture decision record from a design discussion.",
    26,
    240,
    0,
    0,
    "project",
  ],
];

export const showcaseSkills = skillRows.map(
  ([name, description, frontmatterTokens, instructionTokens, , , source]) => ({
    ...skillBase,
    name,
    description,
    directory: `C:\\Users\\dev\\.copilot\\skills\\${name}`,
    scope: source === "project" ? "repository" : "global",
    frontmatterTokens,
    instructionTokens,
    contentSha256: `${name}-sha`,
  }),
);

const dailyUses = (seed) =>
  Array.from({ length: 14 }, (_, index) => ({
    date: new Date(Date.parse(ago(0)) - (13 - index) * 24 * HOUR).toISOString().slice(0, 10),
    uses: ((index * 7 + seed * 3) % 9) + (index % 7 > 4 ? 0 : 2),
  }));

export const showcaseSkillUsage = {
  totalUses: skillRows.reduce((total, row) => total + row[4], 0),
  totalSessions: 58,
  unknownTriggerUses: 61,
  fallbackUses: 5,
  totalContentTokens: 412_300,
  usesWithContent: 252,
  skills: skillRows
    .filter((row) => row[4] > 0)
    .map(([name, description, , instructionTokens, uses, sessions, source], index) => ({
      name,
      normalizedName: name,
      description,
      uses,
      sessions,
      repositories: Math.min(4, Math.ceil(sessions / 6)),
      firstUsed: ago((60 - index * 7) * 24 * HOUR),
      lastUsed: ago((index * 5 + 40) * MINUTE),
      userInvoked: Math.round(uses * 0.3),
      agentInvoked: Math.round(uses * 0.45),
      unknownTrigger: uses - Math.round(uses * 0.3) - Math.round(uses * 0.45),
      mainAgentUses: Math.round(uses * 0.8),
      subagentUses: uses - Math.round(uses * 0.8),
      fallbackUses: index === 1 ? 2 : 0,
      medianContentTokens: instructionTokens * 9,
      usesWithContent: uses,
      latestContentSha256: `${name}-sha`,
      contentVersions: 1 + (index % 3),
      paths: [
        {
          path: `C:\\Users\\dev\\.copilot\\skills\\${name}\\SKILL.md`,
          directory: `C:\\Users\\dev\\.copilot\\skills\\${name}`,
          uses,
        },
      ],
      topModels: [{ label: "claude-opus-5.5", uses: Math.round(uses * 0.6) }],
      topRepositories: [{ label: "acme/checkout-web", uses: Math.round(uses * 0.5) }],
      dailyUses: dailyUses(index),
      pluginName: null,
      source,
    })),
};
