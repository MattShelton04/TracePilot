/**
 * useSessionTurnsRefresh — owns turns state, fingerprint tracking, and the
 * load/merge/refresh-with-freshness-probe logic extracted from
 * useSessionDetail.
 */
import { checkSessionFreshness, getSessionTurns } from "@tracepilot/client";
import type { ConversationTurn } from "@tracepilot/types";
import { type AsyncGuard, type AsyncGuardToken, toErrorMessage } from "@tracepilot/ui";
import { type Ref, ref } from "vue";
import { buildSectionLoader } from "@/stores/helpers/asyncSections";
import { logError, logWarn } from "@/utils/logger";
import {
  buildEventsFingerprint,
  computeDeepCompareIndexes,
  type EventsFingerprint,
  isSameEventsFingerprint,
  turnFingerprint,
} from "./sessionFingerprint";

export interface UseSessionTurnsRefreshOptions {
  sessionId: Ref<string | null>;
  loaded: Ref<Set<string>>;
  guard: AsyncGuard;
  logPrefix?: string;
}

export function useSessionTurnsRefresh(opts: UseSessionTurnsRefreshOptions) {
  const logPrefix = opts.logPrefix ?? "[sessionDetail]";

  const turns = ref<ConversationTurn[]>([]);
  const turnsVersion = ref(0);
  const turnsError = ref<string | null>(null);

  let turnFingerprints: string[] = [];
  let deepCompareTurnIndexes = new Set<number>();
  let lastEventsFingerprint: EventsFingerprint = buildEventsFingerprint(0, null);

  function bumpTurnsVersion() {
    turnsVersion.value += 1;
  }

  function replaceTurns(incoming: ConversationTurn[]) {
    const hadData = turns.value.length > 0;
    const hasIncoming = incoming.length > 0;
    turns.value = incoming;
    turnFingerprints = incoming.map(turnFingerprint);
    deepCompareTurnIndexes = computeDeepCompareIndexes(incoming);
    if (hadData || hasIncoming) {
      bumpTurnsVersion();
    }
  }

  function mergeTurns(incoming: ConversationTurn[]) {
    const existing = turns.value;

    if (existing.length === 0 || incoming.length < existing.length) {
      replaceTurns(incoming);
      return;
    }

    const nextFingerprints = [...turnFingerprints];
    let changed = false;
    const overlapLength = Math.min(existing.length, incoming.length);

    const candidateIndexes = new Set<number>([
      Math.max(0, overlapLength - 1),
      ...deepCompareTurnIndexes,
    ]);
    for (const idx of candidateIndexes) {
      if (idx < 0 || idx >= overlapLength) continue;
      const nextFp = turnFingerprint(incoming[idx]);
      nextFingerprints[idx] = nextFp;
      if (turnFingerprints[idx] !== nextFp) {
        existing[idx] = incoming[idx];
        changed = true;
      }
    }

    for (let i = 0; i < overlapLength; i++) {
      if (candidateIndexes.has(i)) continue;
      const current = existing[i];
      const next = incoming[i];
      if (
        current.turnIndex !== next.turnIndex ||
        current.eventIndex !== next.eventIndex ||
        current.turnId !== next.turnId ||
        current.interactionId !== next.interactionId ||
        current.model !== next.model ||
        current.timestamp !== next.timestamp ||
        current.endTimestamp !== next.endTimestamp ||
        current.isComplete !== next.isComplete ||
        current.durationMs !== next.durationMs ||
        current.outputTokens !== next.outputTokens ||
        current.userMessage !== next.userMessage
      ) {
        existing[i] = next;
        nextFingerprints[i] = turnFingerprint(next);
        changed = true;
      }
    }

    for (let i = existing.length; i < incoming.length; i++) {
      existing.push(incoming[i]);
      nextFingerprints[i] = turnFingerprint(incoming[i]);
      changed = true;
    }

    if (turnFingerprints.length !== nextFingerprints.length) {
      changed = true;
    }

    turnFingerprints = nextFingerprints;
    deepCompareTurnIndexes = computeDeepCompareIndexes(incoming);

    if (changed) {
      bumpTurnsVersion();
    }
  }

  const loadTurns = buildSectionLoader({
    key: "turns",
    sessionId: opts.sessionId,
    loaded: opts.loaded,
    guard: opts.guard,
    errorRef: turnsError,
    fetchFn: (id) => getSessionTurns(id),
    onResult: (result) => {
      replaceTurns(result.turns);
      lastEventsFingerprint = buildEventsFingerprint(
        result.eventsFileSize,
        result.eventsFileMtime ?? null,
      );
    },
    logPrefix,
  });

  async function refreshTurns(id: string, token: AsyncGuardToken): Promise<void> {
    try {
      try {
        const freshness = await checkSessionFreshness(id);
        if (!opts.guard.isValid(token)) return;
        const probe = buildEventsFingerprint(
          freshness.eventsFileSize,
          freshness.eventsFileMtime ?? null,
        );
        if (isSameEventsFingerprint(probe, lastEventsFingerprint)) return;
      } catch (e) {
        logWarn(
          `${logPrefix} Freshness check failed, proceeding with full fetch`,
          { sessionId: id },
          e,
        );
      }

      const result = await getSessionTurns(id);
      if (!opts.guard.isValid(token)) return;
      mergeTurns(result.turns);
      turnsError.value = null;
      lastEventsFingerprint = buildEventsFingerprint(
        result.eventsFileSize,
        result.eventsFileMtime ?? null,
      );
    } catch (e) {
      if (!opts.guard.isValid(token)) return;
      turnsError.value = toErrorMessage(e);
      logError(`${logPrefix} Failed to refresh turns:`, e);
    }
  }

  function resetTurns() {
    replaceTurns([]);
    lastEventsFingerprint = buildEventsFingerprint(0, null);
  }

  function clearTurnsError() {
    turnsError.value = null;
  }

  function getEventsFingerprint(): EventsFingerprint {
    return { ...lastEventsFingerprint };
  }

  function setEventsFingerprint(fp: EventsFingerprint) {
    lastEventsFingerprint = { ...fp };
  }

  return {
    turns,
    turnsVersion,
    turnsError,
    replaceTurns,
    mergeTurns,
    loadTurns,
    refreshTurns,
    resetTurns,
    clearTurnsError,
    getEventsFingerprint,
    setEventsFingerprint,
  };
}

export type SessionTurnsRefresh = ReturnType<typeof useSessionTurnsRefresh>;
