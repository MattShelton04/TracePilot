import { type AsyncGuard, type AsyncGuardToken, toErrorMessage } from "@tracepilot/ui";
import { type Ref, ref } from "vue";
import { logError, logWarn } from "@/utils/logger";

export interface AsyncSectionState<T> {
  data: Ref<T>;
  error: Ref<string | null>;
}

export interface AsyncSectionDefinition<T> {
  key: string;
  section: AsyncSectionState<T>;
  load: () => Promise<void>;
  clearError: () => void;
  resetData: () => void;
  buildRefresh: (id: string, token: AsyncGuardToken) => Promise<void>;
}

interface BuildSectionLoaderOptions<T> {
  key: string;
  sessionId: Ref<string | null>;
  loaded: Ref<Set<string>>;
  guard: AsyncGuard;
  errorRef: Ref<string | null>;
  fetchFn: (id: string) => Promise<T>;
  onResult: (result: T) => void;
  logPrefix: string;
  logLevel?: "error" | "warn";
}

interface BuildSectionRefreshOptions<T> {
  key: string;
  guard: AsyncGuard;
  errorRef: Ref<string | null>;
  fetchFn: (id: string) => Promise<T>;
  onResult: (result: T) => void;
  logPrefix: string;
  logLevel?: "error" | "warn";
}

interface DefineAsyncSectionOptions<T> {
  key: string;
  section: AsyncSectionState<T>;
  defaultValue: () => T;
  fetchFn: (id: string) => Promise<T>;
  sessionId: Ref<string | null>;
  loaded: Ref<Set<string>>;
  guard: AsyncGuard;
  logPrefix: string;
  logLevel?: "error" | "warn";
}

function getLogFunction(level: "error" | "warn" | undefined) {
  return level === "warn" ? logWarn : logError;
}

export function createAsyncSection<T>(initialData: T): AsyncSectionState<T> {
  return {
    data: ref<T>(initialData) as Ref<T>,
    error: ref<string | null>(null),
  };
}

export function buildSectionLoader<T>(opts: BuildSectionLoaderOptions<T>) {
  return async () => {
    const id = opts.sessionId.value;
    if (!id || opts.loaded.value.has(opts.key)) return;

    const token = opts.guard.current();
    opts.errorRef.value = null;

    try {
      const result = await opts.fetchFn(id);
      if (!opts.guard.isValid(token)) return;
      opts.onResult(result);
      opts.loaded.value.add(opts.key);
    } catch (e) {
      if (!opts.guard.isValid(token)) return;
      opts.errorRef.value = toErrorMessage(e);
      getLogFunction(opts.logLevel)(`${opts.logPrefix} Failed to load ${opts.key}:`, e);
    }
  };
}

async function buildSectionRefreshPromise<T>(
  cfg: BuildSectionRefreshOptions<T>,
  id: string,
  token: AsyncGuardToken,
): Promise<void> {
  try {
    const result = await cfg.fetchFn(id);
    if (!cfg.guard.isValid(token)) return;
    cfg.onResult(result);
    cfg.errorRef.value = null;
  } catch (e) {
    if (!cfg.guard.isValid(token)) return;
    cfg.errorRef.value = toErrorMessage(e);
    getLogFunction(cfg.logLevel)(`${cfg.logPrefix} Failed to refresh ${cfg.key}:`, e);
  }
}

export function defineAsyncSection<T>(
  config: DefineAsyncSectionOptions<T>,
): AsyncSectionDefinition<T> {
  return {
    key: config.key,
    section: config.section,
    load: buildSectionLoader({
      key: config.key,
      sessionId: config.sessionId,
      loaded: config.loaded,
      guard: config.guard,
      errorRef: config.section.error,
      fetchFn: config.fetchFn,
      onResult: (result) => {
        config.section.data.value = result;
      },
      logPrefix: config.logPrefix,
      logLevel: config.logLevel,
    }),
    clearError: () => {
      config.section.error.value = null;
    },
    resetData: () => {
      config.section.data.value = config.defaultValue();
    },
    buildRefresh: (id, token) =>
      buildSectionRefreshPromise(
        {
          key: config.key,
          guard: config.guard,
          errorRef: config.section.error,
          fetchFn: config.fetchFn,
          onResult: (result) => {
            config.section.data.value = result;
          },
          logPrefix: config.logPrefix,
          logLevel: config.logLevel,
        },
        id,
        token,
      ),
  };
}
