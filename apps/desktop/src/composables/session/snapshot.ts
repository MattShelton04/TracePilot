/**
 * Snapshot helpers that bridge the live session-detail composable state with
 * the on-demand {@link CachedSession} records stored in the LRU cache.
 */

import type { getSessionTurns } from "@tracepilot/client";
import type { SessionDetail } from "@tracepilot/types";
import type { Ref } from "vue";
import type { CachedSession } from "./cache";
import { buildEventsFingerprint } from "./sessionFingerprint";
import type { SessionSections } from "./useSessionSections";
import type { SessionTurnsRefresh } from "./useSessionTurnsRefresh";

export interface SnapshotContext {
  detail: Ref<SessionDetail | null>;
  loaded: Ref<Set<string>>;
  turnsRefresh: SessionTurnsRefresh;
  sections: SessionSections;
}

export function buildCachedSessionSnapshot(
  ctx: SnapshotContext,
  currentDetail: SessionDetail,
): CachedSession {
  return {
    detail: currentDetail,
    turns: ctx.turnsRefresh.turns.value,
    eventsFingerprint: ctx.turnsRefresh.getEventsFingerprint(),
    checkpoints: ctx.sections.checkpointsSection.data.value,
    plan: ctx.sections.planSection.data.value,
    shutdownMetrics: ctx.sections.metricsSection.data.value,
    incidents: ctx.sections.incidentsSection.data.value,
    todos: ctx.sections.todosSection.data.value,
    loadedSections: new Set(ctx.loaded.value),
  } satisfies CachedSession;
}

export function buildPrefetchedCachedSession(
  detailResult: SessionDetail,
  turnsResult: Awaited<ReturnType<typeof getSessionTurns>>,
): CachedSession {
  return {
    detail: detailResult,
    turns: turnsResult.turns,
    eventsFingerprint: buildEventsFingerprint(
      turnsResult.eventsFileSize,
      turnsResult.eventsFileMtime ?? null,
    ),
    checkpoints: [],
    plan: null,
    shutdownMetrics: null,
    incidents: [],
    todos: null,
    loadedSections: new Set(["detail", "turns"]),
  } satisfies CachedSession;
}

export function restoreFromCachedSession(ctx: SnapshotContext, cached: CachedSession) {
  ctx.detail.value = cached.detail;
  ctx.turnsRefresh.replaceTurns(cached.turns);
  ctx.turnsRefresh.setEventsFingerprint(cached.eventsFingerprint);
  ctx.sections.checkpointsSection.data.value = cached.checkpoints;
  ctx.sections.planSection.data.value = cached.plan;
  ctx.sections.metricsSection.data.value = cached.shutdownMetrics;
  ctx.sections.incidentsSection.data.value = cached.incidents;
  ctx.sections.todosSection.data.value = cached.todos;
  ctx.loaded.value = new Set(cached.loadedSections);
}
