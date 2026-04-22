import {
  getCurrentScope,
  onScopeDispose,
  type Ref,
  shallowRef,
  type WatchOptionsBase,
  watch,
} from "vue";

/**
 * Options for {@link useLocalStorage}.
 */
export interface UseLocalStorageOptions<T> {
  /** Storage backend. Defaults to `localStorage`. */
  storage?: Storage;
  /** Custom read/write serializer. Defaults to JSON. */
  serializer?: {
    read: (raw: string) => T;
    write: (value: T) => string;
  };
  /** Invoked when a stored value fails to parse. Defaults to silent. */
  onParseError?: (e: unknown) => void;
  /** Sync the ref across browser tabs via the `storage` event. Defaults to `true`. */
  syncAcrossTabs?: boolean;
  /** Watcher flush timing for persistence writes. Defaults to `"pre"`. */
  flush?: WatchOptionsBase["flush"];
}

function defaultSerializer<T>(): NonNullable<UseLocalStorageOptions<T>["serializer"]> {
  return {
    read: (raw: string) => JSON.parse(raw) as T,
    write: (value: T) => JSON.stringify(value),
  };
}

function resolveStorage(override?: Storage): Storage | null {
  if (override) return override;
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

/**
 * Reactive `localStorage`-backed `Ref<T>` with cross-tab sync.
 *
 * - JSON-serialised by default; override via `options.serializer`.
 * - Invalid / missing entries fall back to `defaultValue` (and invoke
 *   `onParseError` if provided).
 * - When `syncAcrossTabs` is enabled (default), the ref updates when other
 *   browser tabs mutate the same key via the `storage` event. The listener is
 *   registered synchronously and torn down via `onScopeDispose` so it never
 *   outlives its owning component / effect scope.
 * - Uses {@link shallowRef} — the value is replaced wholesale on write, so
 *   deep reactivity is unnecessary. Mutate objects by reassignment:
 *   `state.value = { ...state.value, foo: 1 }`.
 *
 * Gracefully tolerates SSR / environments without `window`.
 */
export function useLocalStorage<T>(
  key: string,
  defaultValue: T,
  options: UseLocalStorageOptions<T> = {},
): Ref<T> {
  const storage = resolveStorage(options.storage);
  const serializer = options.serializer ?? defaultSerializer<T>();
  const syncAcrossTabs = options.syncAcrossTabs ?? true;
  const flush = options.flush ?? "pre";

  function read(): T {
    if (!storage) return defaultValue;
    try {
      const raw = storage.getItem(key);
      if (raw === null) return defaultValue;
      return serializer.read(raw);
    } catch (e) {
      options.onParseError?.(e);
      return defaultValue;
    }
  }

  const state = shallowRef(read()) as Ref<T>;

  let writing = false;

  if (storage) {
    watch(
      state,
      (value) => {
        writing = true;
        try {
          storage.setItem(key, serializer.write(value));
        } catch {
          // Quota exceeded or storage unavailable — best effort.
        } finally {
          writing = false;
        }
      },
      { flush },
    );
  }

  if (syncAcrossTabs && typeof window !== "undefined") {
    const onStorage = (e: StorageEvent) => {
      if (writing) return;
      if (e.storageArea && storage && e.storageArea !== storage) return;
      if (e.key !== null && e.key !== key) return;
      state.value = read();
    };
    window.addEventListener("storage", onStorage);
    if (getCurrentScope()) {
      onScopeDispose(() => {
        window.removeEventListener("storage", onStorage);
      });
    }
  }

  return state;
}
