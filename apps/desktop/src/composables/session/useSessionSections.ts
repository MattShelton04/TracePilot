/**
 * useSessionSections — owns the standard async sections (todos, checkpoints,
 * plan, file history, shutdown metrics, incidents, prompt
 * cache) for a session detail instance.
 *
 * Extracted from useSessionDetail. Returns the data refs, error refs,
 * per-section load functions, and helpers for clearing/resetting and
 * refreshing loaded sections in bulk.
 */
import {
  type FileCheckpoint,
  getSessionCheckpoints,
  getSessionFileHistory,
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

/**
 * Sections derived from the session's source files, which a running
 * session's poll skips while their version is unchanged. Claude Code's plan
 * file changes only through a tool call that also writes the transcript.
 * The poll never runs for Copilot, whose plan and todos live elsewhere.
 */
export const SOURCE_SECTION_KEYS: ReadonlySet<string> = new Set([
  "fileHistory",
  "metrics",
  "plan",
  "promptCache",
]);

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
  const fileHistorySection = createAsyncSection<FileCheckpoint[]>([]);
  // These large snapshots are replaced wholesale on load/refresh. Avoid deep
  // proxies for thousands of cache windows, segment records and file paths.
  const metricsSection = createAsyncSection<ShutdownMetrics | null>(null, { shallow: true });
  const incidentsSection = createAsyncSection<SessionIncident[]>([]);
  const promptCacheSection = createAsyncSection<PromptCacheTimeline | null>(null, {
    shallow: true,
  });

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

  const fileHistoryDef = defineAsyncSection({
    key: "fileHistory",
    section: fileHistorySection,
    defaultValue: (): FileCheckpoint[] => [],
    fetchFn: (id) => getSessionFileHistory(id),
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
    fileHistoryDef as AsyncSectionDefinition<unknown>,
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

  /**
   * Refresh every loaded section except the source sections in `skip`
   * (already fresh at the source's current version); todos, checkpoints
   * and incidents come from elsewhere and always reload.
   */
  function refreshLoaded(
    id: string,
    token: AsyncGuardToken,
    skip: ReadonlySet<string> = new Set(),
  ): { key: string; done: Promise<void> }[] {
    const refreshes: { key: string; done: Promise<void> }[] = [];
    for (const sec of standardSections) {
      if (skip.has(sec.key) && SOURCE_SECTION_KEYS.has(sec.key)) continue;
      if (opts.loaded.value.has(sec.key)) {
        refreshes.push({ key: sec.key, done: sec.buildRefresh(id, token) });
      }
    }
    return refreshes;
  }

  /** Whether the section's last load or refresh failed. */
  function hasError(key: string): boolean {
    return standardSections.some((sec) => sec.key === key && sec.section.error.value !== null);
  }

  return {
    todosSection,
    checkpointsSection,
    planSection,
    fileHistorySection,
    metricsSection,
    incidentsSection,
    promptCacheSection,
    todosDef,
    checkpointsDef,
    planDef,
    fileHistoryDef,
    metricsDef,
    incidentsDef,
    promptCacheDef,
    standardSections,
    clearErrors,
    resetData,
    refreshLoaded,
    hasError,
  };
}

export type SessionSections = ReturnType<typeof useSessionSections>;
