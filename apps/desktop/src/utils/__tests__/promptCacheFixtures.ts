/** Builders for prompt-cache test data. */
import type { CacheWindow, PromptCacheTimeline } from "@tracepilot/types";

export function makeWindow(overrides: Partial<CacheWindow> = {}): CacheWindow {
  return {
    index: 0,
    idleStart: "2026-09-12T00:00:00.000Z",
    resumeAt: "2026-09-12T00:10:00.000Z",
    idleSeconds: 600,
    model: "gpt-5.6-luna",
    expiresAt: "2026-09-12T00:30:00.000Z",
    ttlSeconds: 1800,
    outcome: "warm",
    confidence: "predicted",
    resumeOffsetSeconds: -1200,
    resumeEventIndex: 12,
    resumeInteractionId: "i2",
    resumeSource: null,
    prefixTokens: 54_000,
    interactionNanoAiu: 1_000_000_000,
    observedResume: null,
    prefixChanges: [],
    ...overrides,
  };
}

export function makeTimeline(
  windows: CacheWindow[],
  overrides: Partial<PromptCacheTimeline> = {},
): PromptCacheTimeline {
  return {
    source: "checkpoints",
    checkpointCount: windows.length,
    baselineCount: 0,
    malformedEntryCount: 0,
    windows,
    observedTtls: [],
    summary: {
      resumedWindows: 0,
      agentResumes: 0,
      warm: 0,
      expired: 0,
      modelChanged: 0,
      noCache: 0,
      unknown: 0,
      likelyBreaks: 0,
      resentPrefixTokens: 0,
      medianIdleSeconds: null,
    },
    ...overrides,
  };
}
