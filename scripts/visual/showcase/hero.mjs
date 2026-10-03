// Per-session artifacts for the hero session: todos with dependencies, plan,
// checkpoint, shutdown metrics, context and prompt-cache timelines, files.

import { NOW_MS } from "./common.mjs";
import { heroTurns } from "./conversation.mjs";
import { heroAt, heroSession } from "./sessions.mjs";

const todo = (id, title, status, description) => ({
  id,
  title,
  status,
  ...(description ? { description } : {}),
});

export const heroTodos = {
  todos: [
    todo("map-flow", "Map checkout payment flow", "done"),
    todo("provider", "Implement ApplePayProvider behind flag", "done"),
    todo("device", "Detect Apple Pay device support", "done"),
    todo("unit", "Unit tests for the provider", "done"),
    todo("button", "Render Apple Pay button in checkout", "done"),
    todo("review", "Code review and fix findings", "done"),
    todo("e2e", "Playwright Apple Pay scenario", "done"),
    todo("pr", "Open draft PR with test plan", "in_progress"),
    todo("docs", "Update merchant onboarding docs", "pending"),
    todo(
      "cert",
      "Rotate staging merchant certificate",
      "blocked",
      "Waiting on ops access to the Apple developer account.",
    ),
  ],
  deps: [
    ["provider", "map-flow"],
    ["device", "map-flow"],
    ["unit", "provider"],
    ["button", "provider"],
    ["button", "device"],
    ["review", "unit"],
    ["review", "button"],
    ["e2e", "button"],
    ["pr", "review"],
    ["pr", "e2e"],
    ["docs", "e2e"],
    ["cert", "device"],
  ].map(([todoId, dependsOn]) => ({ todoId, dependsOn })),
};

export const heroPlan = {
  content:
    "# Apple Pay in checkout\n\n## Approach\n\n- Implement `ApplePayProvider` against the existing `PaymentProvider` interface.\n- Validate merchants through the existing `/payments/session` endpoint.\n- Register behind the `applePay` flag; the Stripe card flow stays untouched.\n- Render the button only where `canMakePayment()` succeeds.\n\n## Verification\n\n- Unit tests for validation, cancellation and token mapping.\n- Playwright scenario with a stubbed `ApplePaySession`.\n- Code review before opening the PR.\n",
};

export const heroCheckpoints = [
  {
    number: 1,
    title: "Provider, flag and checkout UI implemented",
    filename: "001-provider-flag-and-checkout-ui-implemented.md",
    content:
      "<overview>\nAdding Apple Pay to checkout through the existing PaymentProvider interface.\n</overview>\n\n<work_done>\n- ApplePayProvider with merchant validation\n- Registered behind the applePay flag\n- Device support detection and checkout button\n- 31 passing payment unit tests\n</work_done>\n\n<next_steps>\n- Code review, Playwright coverage, open the PR\n</next_steps>",
  },
];

const metric = (count, input, cacheRead, output, cacheWrite = 0) => ({
  requests: { count, cost: 0 },
  usage: {
    inputTokens: input,
    outputTokens: output,
    cacheReadTokens: cacheRead,
    cacheWriteTokens: cacheWrite,
  },
});

export const heroShutdownMetrics = {
  shutdownType: "routine",
  shutdownCount: 1,
  totalPremiumRequests: 0,
  totalApiDurationMs: 1_684_000,
  sessionStartTime: Date.parse(heroSession.createdAt),
  currentModel: "claude-opus-5.5",
  codeChanges: {
    filesModified: [
      "src/payments/providers/applePay.ts",
      "src/payments/providers/applePay.test.ts",
      "src/payments/registry.ts",
      "src/payments/types.ts",
      "src/composables/useDeviceSupport.ts",
      "src/components/checkout/PaymentMethods.vue",
      "e2e/checkout/apple-pay.spec.ts",
    ],
    linesAdded: 548,
    linesRemoved: 37,
  },
  modelMetrics: {
    "claude-opus-5.5": metric(148, 3_912_000, 3_406_000, 92_400, 241_000),
    "claude-sonnet-5": metric(31, 528_400, 411_000, 21_300, 38_000),
    "gpt-6-sol": metric(23, 412_800, 331_500, 14_100),
    "claude-haiku-4.5": metric(22, 144_270, 90_100, 6_050, 12_400),
  },
};

const contextPoints = [
  [0, "turn", 18_400, "estimated"],
  [1, "turn", 31_200, "estimated"],
  [2, "turn", 44_900, "estimated"],
  [3, "turn", 61_300, "estimated"],
  [4, "turn", 70_800, "estimated"],
  [5, "turn", 88_100, "estimated"],
  [6, "turn", 104_600, "estimated"],
  [7, "turn", 121_900, "estimated"],
  [8, "preCompaction", 158_700, "observed"],
  [8, "postCompaction", 6_200, "estimated"],
  [9, "turn", 21_400, "estimated"],
  [10, "turn", 33_800, "estimated"],
  [11, "turn", 41_300, "estimated"],
];
const SYSTEM = 9_420;
const DEFINITIONS = 14_860;

export const heroContextTimeline = {
  turnCount: heroTurns.length,
  observedPointCount: 1,
  estimatedPointCount: contextPoints.length - 1,
  compactionStartCount: 1,
  compactionCompleteCount: 1,
  pairedCompactionCount: 1,
  methodology:
    "Top-level layers are observed at Copilot compaction/shutdown anchors; between-anchor conversation totals are calibrated estimates.",
  reportedTokenLimit: 200_000,
  events: heroTurns.map((turn) => ({
    turn: turn.turnIndex,
    eventIndex: turn.eventIndex,
    timestamp: turn.timestamp,
    kind: "userMessage",
    label: "User message",
    preview: turn.userMessage,
  })),
  points: contextPoints.map(([turn, phase, conversation, source]) => ({
    turn,
    phase,
    timestamp: heroTurns[turn].timestamp,
    systemTokens: SYSTEM,
    toolDefinitionTokens: DEFINITIONS,
    conversationTokens: conversation,
    contextChangeTokens: null,
    totalTokens: SYSTEM + DEFINITIONS + conversation,
    source,
  })),
  compactions: [
    {
      startTurn: 8,
      completeTurn: 8,
      timestamp: heroTurns[8].endTimestamp,
      success: true,
      checkpointNumber: 1,
      beforeTokens: SYSTEM + DEFINITIONS + 158_700,
      afterTokens: SYSTEM + DEFINITIONS + 6_200,
      tokensRemoved: 152_500,
      afterSource: "estimated",
      summaryTokens: 6_200,
      compactionModel: "claude-opus-5.5",
      durationMs: 41_000,
    },
  ],
  topToolCalls: [
    [8, "read-e2e", "read_agent", 48, 14_210],
    [8, "read-review", "read_agent", 46, 11_830],
    [0, "read-registry", "read_agent", 44, 6_920],
    [5, "t5-1", "powershell", 61, 4_480],
    [8, "rev-diff", "powershell", 58, 3_910],
  ].map(([turn, toolCallId, toolName, argumentTokens, resultTokens]) => ({
    turn,
    toolCallId,
    toolName,
    argumentTokens,
    resultTokens,
    totalTokens: argumentTokens + resultTokens,
    success: true,
  })),
  toolTypes: [
    ["read_agent", 5, 228, 47_410],
    ["view", 9, 340, 31_920],
    ["powershell", 12, 690, 22_840],
    ["edit", 9, 2_880, 1_310],
    ["grep", 4, 120, 2_210],
    ["create", 3, 3_460, 180],
  ].map(([toolName, callCount, argumentTokens, resultTokens], _index, rows) => {
    const total = rows.reduce((sum, row) => sum + row[2] + row[3], 0);
    return {
      toolName,
      callCount,
      errorCount: 0,
      argumentTokens,
      resultTokens,
      totalTokens: argumentTokens + resultTokens,
      percentage: ((argumentTokens + resultTokens) / total) * 100,
    };
  }),
};

const at = (offsetSeconds) => new Date(NOW_MS + offsetSeconds * 1000).toISOString();

export const heroPromptCache = {
  source: "checkpoints",
  checkpointCount: 3,
  baselineCount: 3,
  malformedEntryCount: 0,
  windows: [
    {
      index: 0,
      idleStart: heroAt(14),
      resumeAt: heroAt(17.2),
      idleSeconds: 192,
      model: "claude-opus-5.5",
      expiresAt: heroAt(19),
      ttlSeconds: 300,
      outcome: "warm",
      confidence: "predicted",
      resumeOffsetSeconds: -108,
      resumeEventIndex: null,
      resumeInteractionId: null,
      resumeSource: null,
      prefixTokens: 88_100,
      interactionNanoAiu: null,
      observedResume: null,
      prefixChanges: [],
    },
    {
      index: 1,
      idleStart: heroAt(21),
      resumeAt: heroAt(29.5),
      idleSeconds: 510,
      model: "claude-opus-5.5",
      expiresAt: heroAt(26),
      ttlSeconds: 300,
      outcome: "expired",
      confidence: "predicted",
      resumeOffsetSeconds: 210,
      resumeEventIndex: null,
      resumeInteractionId: null,
      resumeSource: null,
      prefixTokens: 121_900,
      interactionNanoAiu: null,
      observedResume: null,
      prefixChanges: [],
    },
    {
      index: 2,
      idleStart: at(-75),
      resumeAt: null,
      idleSeconds: null,
      model: "claude-opus-5.5",
      expiresAt: at(225),
      ttlSeconds: 300,
      outcome: "pending",
      confidence: "predicted",
      resumeOffsetSeconds: null,
      resumeEventIndex: null,
      resumeInteractionId: null,
      resumeSource: null,
      prefixTokens: 65_580,
      interactionNanoAiu: null,
      observedResume: null,
      prefixChanges: [],
    },
  ],
  observedTtls: [{ model: "claude-opus-5.5", ttlSeconds: 300, count: 2 }],
  summary: {
    resumedWindows: 2,
    agentResumes: 0,
    warm: 1,
    expired: 1,
    modelChanged: 0,
    noCache: 0,
    unknown: 0,
    likelyBreaks: 0,
    resentPrefixTokens: 121_900,
    medianIdleSeconds: 351,
  },
};

export const heroIncidents = [
  {
    eventType: "compaction",
    sourceEventType: "session.compaction_complete",
    timestamp: heroTurns[8].endTimestamp,
    severity: "info",
    summary: "Compaction: 183,000 → 30,500 tokens (checkpoint 1)",
    detailJson: { preCompactionTokens: 183_000, postCompactionTokens: 30_500 },
  },
];

const file = (path, sizeBytes, fileType) => ({
  path,
  name: path.split("/").pop(),
  sizeBytes,
  isDirectory: false,
  fileType,
});
const dir = (path) => ({
  path,
  name: path.split("/").pop(),
  sizeBytes: 0,
  isDirectory: true,
  fileType: "binary",
});

export const heroFiles = [
  dir("checkpoints"),
  file("checkpoints/001-provider-flag-and-checkout-ui-implemented.md", 1_284, "markdown"),
  file("checkpoints/index.md", 212, "markdown"),
  dir("files"),
  file("files/review-notes.md", 2_045, "markdown"),
  file("events.jsonl", 2_318_402, "jsonl"),
  file("plan.md", heroPlan.content.length, "markdown"),
  file("session.db", 49_152, "sqlite"),
  file("workspace.yaml", 418, "yaml"),
];
