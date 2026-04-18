import { type Ref, ref, watch } from "vue";

/**
 * Options for {@link usePersistedRef}.
 */
export interface UsePersistedRefOptions<T> {
  /** Storage backend. Defaults to `localStorage`. */
  storage?: Storage;
  /** Custom read/write serializer. Defaults to JSON. */
  serializer?: {
    read: (raw: string) => T;
    write: (value: T) => string;
  };
  /** Invoked when a stored value fails to parse. Defaults to silent. */
  onParseError?: (e: unknown) => void;
}

function defaultSerializer<T>(): NonNullable<UsePersistedRefOptions<T>["serializer"]> {
  return {
    read: (raw: string) => JSON.parse(raw) as T,
    write: (value: T) => JSON.stringify(value),
  };
}

/**
 * Create a reactive `Ref<T>` that is backed by `localStorage` (or another
 * `Storage` implementation). Changes are written back on any mutation — deep
 * watching is enabled by default so nested object changes are captured.
 *
 * Gracefully tolerates environments without `window` / `localStorage` (SSR).
 *
 * @example
 * ```typescript
 * const prefs = usePersistedRef("tracepilot:prefs", { theme: "dark" });
 * prefs.value.theme = "light"; // automatically persisted
 * ```
 */
export function usePersistedRef<T>(
  key: string,
  defaultValue: T,
  options: UsePersistedRefOptions<T> = {},
): Ref<T> {
  const storage = resolveStorage(options.storage);
  const serializer = options.serializer ?? defaultSerializer<T>();

  let initial = defaultValue;
  if (storage) {
    try {
      const raw = storage.getItem(key);
      if (raw !== null) {
        initial = serializer.read(raw);
      }
    } catch (e) {
      options.onParseError?.(e);
      initial = defaultValue;
    }
  }

  const state = ref(initial) as Ref<T>;

  if (storage) {
    watch(
      state,
      (value) => {
        try {
          storage.setItem(key, serializer.write(value));
        } catch {
          // Quota exceeded or storage unavailable — best effort.
        }
      },
      { deep: true },
    );
  }

  return state;
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
