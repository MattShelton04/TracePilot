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
  CheckpointEntry,
  PromptCacheTimeline,
  SessionIncident,
  SessionPlan,
  ShutdownMetrics,
  TodosResponse,
} from "@tracepilot/types";
import type { AsyncGuard, AsyncGuardToken } from "@tracepilot/ui";
import type { Ref } from "vue";
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
    fetchFn: async (id) => (await getSessionPromptCache(id)).timeline,
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
