// ─── Prompt-cache insights ───────────────────────────────────────
// Mirrors `tracepilot_core::prompt_cache` (per session) and
// `tracepilot_core::analytics::PromptCacheAnalytics` (cross-session).

/**
 * How much a cache-timing claim can be trusted.
 * - `predicted`: expiry recorded by Copilot CLI in a usage checkpoint.
 * - `estimated`: idle gap plus a TTL observed in other sessions.
 * - `unavailable`: no TTL source, so nothing is claimed.
 */
export type CacheConfidence = "predicted" | "estimated" | "unavailable";

/**
 * What happened to the prompt cache across one idle window.
 * `pending` means no reply yet and no shutdown: a live countdown for a
 * running session, otherwise a reply that never came.
 */
export type CacheWindowOutcome =
  | "warm"
  | "expired"
  | "modelChanged"
  | "noCache"
  | "pending"
  | "sessionEnded"
  | "unknown";

export type PrefixChangeKind =
  | "model"
  | "effort"
  | "tools"
  | "toolDefinition"
  | "systemPrompt"
  | "history"
  | "cacheConfig";

/** A prompt-prefix change that would break the cache (a likely cause, not proof). */
export interface PrefixChange {
  kind: PrefixChangeKind;
  summary: string;
  details: string[];
}

/** The period between the agent going idle and the next main-agent request. */
export interface CacheWindow {
  index: number;
  idleStart: string;
  resumeAt: string | null;
  idleSeconds: number | null;
  model: string | null;
  expiresAt: string | null;
  ttlSeconds: number | null;
  outcome: CacheWindowOutcome;
  confidence: CacheConfidence;
  /** `resumeAt - expiresAt` in seconds; negative means before the expiry. */
  resumeOffsetSeconds: number | null;
  /**
   * Event index of the resuming prompt (matches `ConversationTurn.eventIndex`),
   * or of the `assistant.turn_start` when the agent woke itself.
   */
  resumeEventIndex: number | null;
  resumeInteractionId: string | null;
  /** Set when the resume was not typed by the user (e.g. `"system"`, `"agent"`). */
  resumeSource: string | null;
  /** Cacheable prefix tokens before idling (re-sent after an expiry). */
  prefixTokens: number | null;
  /** Usage of the interaction that followed the resume, in nano AI units. */
  interactionNanoAiu: number | null;
  prefixChanges: PrefixChange[];
}

export interface ObservedCacheTtl {
  model: string;
  ttlSeconds: number;
  count: number;
}

export interface PromptCacheSummary {
  /** Windows ended by a prompt; agent wakes are counted in `agentResumes`. */
  resumedWindows: number;
  agentResumes: number;
  warm: number;
  expired: number;
  modelChanged: number;
  noCache: number;
  unknown: number;
  likelyBreaks: number;
  resentPrefixTokens: number;
  medianIdleSeconds: number | null;
}

/** `checkpoints` (CLI 1.0.75+), `turnGaps` (older logs) or `none`. */
export type PromptCacheSource = "checkpoints" | "turnGaps" | "none";

export interface PromptCacheTimeline {
  source: PromptCacheSource;
  checkpointCount: number;
  baselineCount: number;
  malformedEntryCount: number;
  windows: CacheWindow[];
  observedTtls: ObservedCacheTtl[];
  summary: PromptCacheSummary;
}

/**
 * Whether a recorded observation lines up with a window's prediction.
 *
 * `agrees` is consistency, not proof: zero recorded cache reads support "no
 * reuse was recorded", never "the whole prefix had expired".
 */
export type CacheComparison = "agrees" | "differs" | "notComparable";

/**
 * What the request that resumed a window actually recorded, from the optional
 * Copilot session store.
 *
 * This sits *beside* the window's `confidence` and `outcome`, which are
 * unchanged. An expiry prediction and an observed reuse count answer
 * different questions, and a later request reusing some tokens is not
 * evidence that the earlier prediction was wrong — the prefix may have been
 * rebuilt, or only part of it may have survived.
 */
export interface CacheObservation {
  /** The `CacheWindow.index` this belongs to. */
  windowIndex: number;
  /** Source row identity. Not a provider request ID. */
  sourceRowId: number;
  model: string;
  recordedAt: string | null;
  /** `null` means the counter was absent, not that there was no reuse. */
  cacheReadTokens: number | null;
  cacheWriteTokens: number | null;
  inputTokens: number | null;
  /**
   * Never `exact`: no identifier links a window and a request, so the pair is
   * matched on order, interval and model, and only when unambiguous.
   */
  attribution: "exact" | "validated" | "ambiguous" | "unavailable";
  comparison: CacheComparison;
}

export interface PromptCacheResponse {
  timeline: PromptCacheTimeline;
  /**
   * Recorded reuse for the requests that resumed each window. Empty is the
   * normal state: it means no reliable association was found, not that no
   * reuse happened.
   */
  observations: CacheObservation[];
  eventsFileSize: number;
  eventsFileMtime?: number | null;
}

export interface PrefixChangeCount {
  kind: PrefixChangeKind | string;
  count: number;
}

export interface ModelCacheTtl {
  model: string;
  ttlSeconds: number;
  observations: number;
}

export interface ModelTokens {
  model: string;
  tokens: number;
}

/** Cross-session prompt-cache timing (predicted windows only). */
export interface PromptCacheAnalytics {
  sessionsWithPredicted: number;
  resumedWindows: number;
  warmResumes: number;
  resumesAfterExpiry: number;
  medianIdleSeconds: number | null;
  resentPrefixTokens: number;
  /** `resentPrefixTokens` split by model, descending, so the UI can price it. */
  resentPrefixTokensByModel: ModelTokens[];
  topChangeKinds: PrefixChangeCount[];
  observedTtls: ModelCacheTtl[];
}
