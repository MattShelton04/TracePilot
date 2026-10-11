import type { ContextTimeline, PromptCacheTimeline } from "@tracepilot/types";

const MINUTE_MS = 60_000;
const mockIso = (offsetMinutes: number) =>
  new Date(Date.now() + offsetMinutes * MINUTE_MS).toISOString();

/** One recorded request total with its estimated layers (system, messages, tool I/O). */
const claudePoint = (
  turn: number,
  [system, messages, toolIo]: [number, number, number],
  cacheWrite: number,
) => {
  const total = system + messages + toolIo;
  return {
    turn,
    phase: "turn" as const,
    timestamp: null,
    systemTokens: system,
    toolDefinitionTokens: 0,
    conversationTokens: messages + toolIo,
    contextChangeTokens: null,
    totalTokens: total,
    totalOnly: true,
    messageTokens: messages,
    toolIoTokens: toolIo,
    cacheReadTokens: total - cacheWrite,
    cacheWriteTokens: cacheWrite,
    source: "observed" as const,
  };
};

/** Claude records inclusive input per model call; the layers within each total are inferred. */
export const MOCK_CLAUDE_CONTEXT_TIMELINE: ContextTimeline = {
  turnCount: 5,
  observedPointCount: 5,
  estimatedPointCount: 0,
  compactionStartCount: 0,
  compactionCompleteCount: 0,
  pairedCompactionCount: 0,
  reportedTokenLimit: null,
  methodology:
    "Main-agent model calls record inclusive input tokens: uncached input plus cache reads and writes. Each turn's last call is an observed total; its layers are estimates. System & tools is the first request's input beyond the conversation it sent (system prompt, tool definitions and persistent instructions), held for the session. The rest of each total is conversation, split into messages and tool calls & results by the share of each in the main-agent transcript text sent so far (ceil UTF-8 bytes / 4), reset to the summary at each compaction. Text the transcript does not record, such as injected reminders and re-attached files, is spread across the two conversation shares. Output tokens and subagent calls are excluded. Expiry and cache reuse are separate from context size.",
  events: [
    {
      turn: 0,
      timestamp: null,
      kind: "userMessage",
      label: "User message",
      preview: "Review indexing retries.",
    },
  ],
  points: (
    [
      [14_200, 1_900, 2_300],
      [14_200, 3_400, 13_600],
      [14_200, 4_100, 26_600],
      [14_200, 5_800, 32_300],
      [14_200, 6_700, 40_900],
    ] as const
  ).map((layers, turn) => claudePoint(turn, [...layers], 1_200 + turn * 400)),
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
