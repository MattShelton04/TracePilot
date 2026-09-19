/**
 * Pure helpers for prompt-cache insights: labels, live countdown state and
 * matching idle windows to conversation turns.
 *
 * Copy rules (see docs/features/prompt-cache-insights-plan.md §4): talk about
 * tokens re-sent, never "wasted"; always carry the confidence level.
 */
import type {
  CacheConfidence,
  CacheWindow,
  CacheWindowOutcome,
  ConversationTurn,
  PrefixChangeKind,
  PromptCacheTimeline,
} from "@tracepilot/types";
import { formatNumber } from "@tracepilot/types";

/** `CacheWindow.resumeSource` when the agent woke itself without a prompt. */
export const AGENT_RESUME_SOURCE = "agent";

/** Below this much remaining time the live chip switches to "expiring". */
export const EXPIRING_THRESHOLD_MS = 5 * 60_000;

export const CONFIDENCE_LABELS: Record<CacheConfidence, string> = {
  predicted: "Predicted by Copilot CLI",
  estimated: "Estimated",
  unavailable: "Unavailable",
};

export const CONFIDENCE_EXPLANATIONS: Record<CacheConfidence, string> = {
  predicted:
    "Copilot CLI records when it expects the provider cache to expire. The provider does not confirm individual cache hits in the session log.",
  estimated:
    "No expiry was recorded for this window. It is estimated from the idle gap and the TTL most often observed for the model in other sessions.",
  unavailable: "No TTL is known for this model, so no cache timing is claimed.",
};

export const OUTCOME_LABELS: Record<CacheWindowOutcome, string> = {
  warm: "Warm",
  expired: "Expired",
  modelChanged: "Model changed",
  noCache: "No prompt cache",
  pending: "No reply yet",
  sessionEnded: "Session ended",
  unknown: "Unknown",
};

export const CHANGE_KIND_LABELS: Record<PrefixChangeKind, string> = {
  model: "Model switch",
  effort: "Reasoning effort",
  tools: "Tools added or removed",
  toolDefinition: "Tool definition",
  systemPrompt: "System prompt",
  history: "History rewrite",
  cacheConfig: "Cache configuration",
};

export type LiveCacheState = "warm" | "expiring" | "expired";

export interface LiveCacheStatus {
  state: LiveCacheState;
  /** Milliseconds until expiry (negative once expired). */
  remainingMs: number;
}

/** A compact human duration: `45s`, `17m`, `1h 5m`, `2d 3h`. */
export function formatIdle(seconds: number | null | undefined): string {
  if (seconds == null || !Number.isFinite(seconds) || seconds < 0) return "—";
  const s = Math.round(seconds);
  if (s < 60) return `${s}s`;
  const minutes = Math.floor(s / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return minutes % 60 ? `${hours}h ${minutes % 60}m` : `${hours}h`;
  const days = Math.floor(hours / 24);
  return hours % 24 ? `${days}d ${hours % 24}h` : `${days}d`;
}

/** Countdown text: `17:42`, or `1:02:05` above an hour. */
export function formatCountdown(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = String(total % 60).padStart(2, "0");
  return hours > 0
    ? `${hours}:${String(minutes).padStart(2, "0")}:${seconds}`
    : `${minutes}:${seconds}`;
}

/** Approximate token count for copy: "about 54k tokens". */
export function formatApproxTokens(tokens: number | null | undefined): string {
  if (tokens == null) return "—";
  return `about ${formatNumber(tokens)} tokens`;
}

/**
 * The window a live countdown can be shown for: the latest window, still
 * waiting for a reply, with an expiry predicted by the CLI. Estimated values
 * are never shown as a live countdown.
 */
export function findLiveWindow(timeline: PromptCacheTimeline | null | undefined) {
  const last = timeline?.windows.at(-1);
  if (
    !last ||
    last.outcome !== "pending" ||
    last.confidence !== "predicted" ||
    !last.expiresAt ||
    last.ttlSeconds === 0
  ) {
    return null;
  }
  return last;
}

export function liveCacheStatus(expiresAt: string, nowMs: number): LiveCacheStatus | null {
  const expiresMs = Date.parse(expiresAt);
  if (Number.isNaN(expiresMs)) return null;
  const remainingMs = expiresMs - nowMs;
  const state: LiveCacheState =
    remainingMs <= 0 ? "expired" : remainingMs <= EXPIRING_THRESHOLD_MS ? "expiring" : "warm";
  return { state, remainingMs };
}

/** Windows worth marking in the conversation: resumed, with a timing claim. */
export function isMarkableWindow(window: CacheWindow): boolean {
  return (
    window.resumeAt != null && window.confidence !== "unavailable" && window.outcome !== "unknown"
  );
}

/**
 * Map each markable window to the conversation turn it resumed. Prompts match
 * by event index, then interaction id, then start time. An agent wake has no
 * prompt and shares the interaction id of an earlier prompt, so it matches by
 * the start time of the turn it began only.
 */
export function mapWindowsToTurns(
  windows: readonly CacheWindow[],
  turns: readonly ConversationTurn[],
): Map<number, CacheWindow> {
  const byEventIndex = new Map<number, ConversationTurn>();
  const byInteraction = new Map<string, ConversationTurn>();
  const byTimestamp = new Map<number, ConversationTurn>();
  for (const turn of turns) {
    if (turn.eventIndex != null) byEventIndex.set(turn.eventIndex, turn);
    if (turn.interactionId && !byInteraction.has(turn.interactionId)) {
      byInteraction.set(turn.interactionId, turn);
    }
    const started = turn.timestamp ? Date.parse(turn.timestamp) : Number.NaN;
    if (!Number.isNaN(started)) byTimestamp.set(started, turn);
  }

  const result = new Map<number, CacheWindow>();
  for (const window of windows) {
    if (!isMarkableWindow(window)) continue;
    const byTime = window.resumeAt ? byTimestamp.get(Date.parse(window.resumeAt)) : undefined;
    const turn =
      window.resumeSource === AGENT_RESUME_SOURCE
        ? byTime
        : ((window.resumeEventIndex != null
            ? byEventIndex.get(window.resumeEventIndex)
            : undefined) ??
          (window.resumeInteractionId
            ? byInteraction.get(window.resumeInteractionId)
            : undefined) ??
          byTime);
    if (turn && !result.has(turn.turnIndex)) result.set(turn.turnIndex, window);
  }
  return result;
}

/** One-line description of a resumed window, e.g. for a conversation divider. */
export function describeResume(window: CacheWindow): string {
  const idle = `idle ${formatIdle(window.idleSeconds)}`;
  const offset = window.resumeOffsetSeconds;
  const who =
    window.resumeSource === AGENT_RESUME_SOURCE
      ? "the agent resumed"
      : window.resumeSource
        ? "the session resumed"
        : "this reply";
  switch (window.outcome) {
    case "warm":
      if (offset == null) return `${idle} · cache warm`;
      return -offset < 60
        ? `${idle} · cache warm, under a minute before expiry`
        : `${idle} · cache warm, ${formatIdle(-offset)} before expiry`;
    case "expired":
      return offset != null
        ? `${idle} · cache expired ${formatIdle(offset)} before ${who}`
        : `${idle} · cache expired`;
    case "modelChanged":
      return `${idle} · model changed, cache not reusable`;
    case "noCache":
      return `${idle} · no prompt cache for this model`;
    default:
      return idle;
  }
}

/** Short chip label for a resumed window. */
export function resumeChipLabel(window: CacheWindow): string {
  if (window.outcome === "warm") {
    return window.prefixChanges.length > 0 ? "Likely cache break" : "Warm resume";
  }
  if (window.outcome === "expired" || window.outcome === "modelChanged") return "Cold resume";
  return OUTCOME_LABELS[window.outcome];
}

/**
 * Idle time as a fraction of the time the cache had left at idle start.
 * The CLI measures expiry from the start of the last request, so the TTL
 * alone would overstate it; `null` when either end is unknown.
 */
export function idleFractionOfTtl(window: CacheWindow): number | null {
  if (window.idleSeconds == null) return null;
  const budgetSeconds =
    window.expiresAt != null
      ? (Date.parse(window.expiresAt) - Date.parse(window.idleStart)) / 1000
      : window.ttlSeconds;
  if (budgetSeconds == null || !Number.isFinite(budgetSeconds) || budgetSeconds <= 0) return null;
  return window.idleSeconds / budgetSeconds;
}

/** Tooltip text with the model, TTL, confidence and any prefix changes. */
export function describeWindowDetail(window: CacheWindow): string {
  const parts: string[] = [];
  if (window.model) parts.push(window.model);
  if (window.ttlSeconds) parts.push(`TTL ${formatIdle(window.ttlSeconds)}`);
  parts.push(CONFIDENCE_LABELS[window.confidence]);
  if (window.prefixTokens != null && window.outcome !== "warm") {
    parts.push(`${formatApproxTokens(window.prefixTokens)} re-sent without cache`);
  }
  for (const change of window.prefixChanges) {
    parts.push(`Likely cache break: ${change.summary}`);
  }
  return parts.join(" · ");
}
