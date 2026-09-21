/**
 * useSessionSections — owns the standard async sections (todos, checkpoints,
 * plan, shutdown metrics, incidents, prompt cache) for a session detail instance.
 *
 * Extracted from useSessionDetail. Returns the data refs, error refs,
 * per-section load functions, and helpers for clearing/resetting and
 * refreshing loaded sections in bulk.
 */
import {
  getSessionCheckpoints,
  getSessionIncidents,
  getSessionPlan,
  getSessionPromptCache,
  getSessionTodos,
  getShutdownMetrics,
} from "@tracepilot/client";
import type {
  CacheObservation,
  CheckpointEntry,
  PromptCacheTimeline,
  SessionIncident,
  SessionPlan,
  ShutdownMetrics,
  TodosResponse,
} from "@tracepilot/types";
import type { AsyncGuard, AsyncGuardToken } from "@tracepilot/ui";
import { type Ref, ref } from "vue";
import {
  type AsyncSectionDefinition,
  createAsyncSection,
  defineAsyncSection,
} from "@/stores/helpers/asyncSections";

export interface UseSessionSectionsOptions {
  sessionId: Ref<string | null>;
  loaded: Ref<Set<string>>;
  guard: AsyncGuard;
  logPrefix?: string;
}

export function useSessionSections(opts: UseSessionSectionsOptions) {
  const logPrefix = opts.logPrefix ?? "[sessionDetail]";

  const todosSection = createAsyncSection<TodosResponse | null>(null);
  const checkpointsSection = createAsyncSection<CheckpointEntry[]>([]);
  const planSection = createAsyncSection<SessionPlan | null>(null);
  const metricsSection = createAsyncSection<ShutdownMetrics | null>(null);
  const incidentsSection = createAsyncSection<SessionIncident[]>([]);
  const promptCacheSection = createAsyncSection<PromptCacheTimeline | null>(null);
  /**
   * Recorded reuse for the requests that resumed each idle window. It rides
   * along on the prompt-cache read rather than costing a second one, but it
   * is kept apart from the timeline because it is a different claim: an
   * expiry prediction and an observed cache-read count answer different
   * questions and neither rewrites the other.
   */
  const promptCacheObservations = ref<CacheObservation[]>([]);

  const todosDef = defineAsyncSection({
    key: "todos",
    section: todosSection,
    defaultValue: () => null,
    fetchFn: (id) => getSessionTodos(id),
    sessionId: opts.sessionId,
    loaded: opts.loaded,
    guard: opts.guard,
    logPrefix,
  });

  const checkpointsDef = defineAsyncSection({
    key: "checkpoints",
    section: checkpointsSection,
    defaultValue: (): CheckpointEntry[] => [],
    fetchFn: (id) => getSessionCheckpoints(id),
    sessionId: opts.sessionId,
    loaded: opts.loaded,
    guard: opts.guard,
    logPrefix,
  });

  const planDef = defineAsyncSection({
    key: "plan",
    section: planSection,
    defaultValue: () => null,
    fetchFn: (id) => getSessionPlan(id),
    sessionId: opts.sessionId,
    loaded: opts.loaded,
    guard: opts.guard,
    logPrefix,
  });

  const metricsDef = defineAsyncSection({
    key: "metrics",
    section: metricsSection,
    defaultValue: () => null,
    fetchFn: (id) => getShutdownMetrics(id),
    sessionId: opts.sessionId,
    loaded: opts.loaded,
    guard: opts.guard,
    logPrefix,
  });

  const incidentsDef = defineAsyncSection({
    key: "incidents",
    section: incidentsSection,
    defaultValue: (): SessionIncident[] => [],
    fetchFn: (id) => getSessionIncidents(id),
    sessionId: opts.sessionId,
    loaded: opts.loaded,
    guard: opts.guard,
    logPrefix,
    logLevel: "warn",
  });

  const promptCacheDef = defineAsyncSection({
    key: "promptCache",
    section: promptCacheSection,
    defaultValue: () => null,
    fetchFn: async (id) => {
      const response = await getSessionPromptCache(id);
      // The section machinery drops results for a session the user has since
      // left; this ref has to drop them too or it would describe another one.
      if (opts.sessionId.value === id) promptCacheObservations.value = response.observations ?? [];
      return response.timeline;
    },
    sessionId: opts.sessionId,
    loaded: opts.loaded,
    guard: opts.guard,
    logPrefix,
    logLevel: "warn",
  });

  const standardSections: AsyncSectionDefinition<unknown>[] = [
    todosDef as AsyncSectionDefinition<unknown>,
    checkpointsDef as AsyncSectionDefinition<unknown>,
    planDef as AsyncSectionDefinition<unknown>,
    metricsDef as AsyncSectionDefinition<unknown>,
    incidentsDef as AsyncSectionDefinition<unknown>,
    promptCacheDef as AsyncSectionDefinition<unknown>,
  ];

  function clearErrors() {
    for (const sec of standardSections) {
      sec.clearError();
    }
  }

  function resetData() {
    for (const sec of standardSections) {
      sec.resetData();
    }
    promptCacheObservations.value = [];
  }

  function refreshLoaded(id: string, token: AsyncGuardToken): Promise<void>[] {
    const promises: Promise<void>[] = [];
    for (const sec of standardSections) {
      if (opts.loaded.value.has(sec.key)) {
        promises.push(sec.buildRefresh(id, token));
      }
    }
    return promises;
  }

  return {
    todosSection,
    checkpointsSection,
    planSection,
    metricsSection,
    incidentsSection,
    promptCacheSection,
    promptCacheObservations,
    todosDef,
    checkpointsDef,
    planDef,
    metricsDef,
    incidentsDef,
    promptCacheDef,
    standardSections,
    clearErrors,
    resetData,
    refreshLoaded,
  };
}

export type SessionSections = ReturnType<typeof useSessionSections>;
