import type { ContextTimeline, PromptCacheTimeline } from "@tracepilot/types";

const MINUTE_MS = 60_000;
const mockIso = (offsetMinutes: number) =>
  new Date(Date.now() + offsetMinutes * MINUTE_MS).toISOString();

/** Claude records inclusive input per model call: total-only context anchors. */
export const MOCK_CLAUDE_CONTEXT_TIMELINE: ContextTimeline = {
  turnCount: 5,
  observedPointCount: 5,
  estimatedPointCount: 0,
  compactionStartCount: 0,
  compactionCompleteCount: 0,
  pairedCompactionCount: 0,
  reportedTokenLimit: null,
  methodology:
    "Main-agent model calls record inclusive input tokens: uncached input plus cache reads and writes. These are observed total-only anchors; system, tool-definition and conversation layers are unknown. Output tokens and subagent calls are excluded. Expiry and cache reuse are separate from context size.",
  events: [
    {
      turn: 0,
      timestamp: null,
      kind: "userMessage",
      label: "User message",
      preview: "Review indexing retries.",
    },
  ],
  points: [18_400, 31_200, 44_900, 52_300, 61_800].map((total, turn) => ({
    turn,
    phase: "turn" as const,
    timestamp: null,
    systemTokens: 0,
    toolDefinitionTokens: 0,
    conversationTokens: 0,
    contextChangeTokens: null,
    totalTokens: total,
    totalOnly: true,
    source: "observed" as const,
  })),
  compactions: [],
  topToolCalls: [],
  toolTypes: [],
};

/** Cache windows timed by recorded model calls; expiry from the recorded 1h tier. */
export const MOCK_CLAUDE_PROMPT_CACHE: PromptCacheTimeline = {
  source: "modelCalls",
  checkpointCount: 0,
  baselineCount: 0,
  malformedEntryCount: 0,
  windows: [
    {
      index: 0,
      idleStart: mockIso(-42),
      resumeAt: mockIso(-30),
      idleSeconds: 720,
      model: "claude-opus-4-6",
      expiresAt: mockIso(18),
      ttlSeconds: 3600,
      outcome: "warm",
      confidence: "observed",
      resumeOffsetSeconds: -2880,
      resumeEventIndex: null,
      resumeInteractionId: null,
      resumeSource: "user",
      prefixTokens: 44_900,
      interactionNanoAiu: null,
      observedResume: { cacheRead: 44_100, cacheWrite: 800, hit: true },
      prefixChanges: [],
    },
    {
      index: 1,
      idleStart: mockIso(-22),
      resumeAt: null,
      idleSeconds: null,
      model: "claude-opus-4-6",
      expiresAt: mockIso(38),
      ttlSeconds: 3600,
      outcome: "pending",
      confidence: "estimated",
      resumeOffsetSeconds: null,
      resumeEventIndex: null,
      resumeInteractionId: null,
      resumeSource: null,
      prefixTokens: 61_800,
      interactionNanoAiu: null,
      observedResume: null,
      prefixChanges: [],
    },
  ],
  observedTtls: [],
  summary: {
    resumedWindows: 1,
    agentResumes: 0,
    warm: 1,
    expired: 0,
    modelChanged: 0,
    noCache: 0,
    unknown: 0,
    likelyBreaks: 0,
    resentPrefixTokens: 0,
    medianIdleSeconds: 720,
  },
};
