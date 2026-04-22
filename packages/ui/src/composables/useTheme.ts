import {
  type ComputedRef,
  computed,
  getCurrentScope,
  onScopeDispose,
  type Ref,
  shallowRef,
  watch,
} from "vue";
import { useLocalStorage } from "./useLocalStorage";

/** Theme preference — `"system"` tracks `prefers-color-scheme`. */
export type ThemePreference = "light" | "dark" | "system";

/** Resolved effective theme — never `"system"`. */
export type EffectiveTheme = "light" | "dark";

/** Options for {@link useTheme}. */
export interface UseThemeOptions {
  /** localStorage key used to persist the preference. Defaults to `"tracepilot-theme"`. */
  storageKey?: string;
  /** Default theme when nothing is persisted. Defaults to `"system"`. */
  defaultTheme?: ThemePreference;
  /**
   * Apply the effective theme to `document.documentElement` via a `data-theme`
   * attribute. Set to `false` to manage the DOM side-effect elsewhere.
   * Defaults to `true`.
   */
  applyToDocument?: boolean;
  /** Attribute name used when `applyToDocument` is true. Defaults to `"data-theme"`. */
  documentAttribute?: string;
}

const VALID: readonly ThemePreference[] = ["light", "dark", "system"] as const;

/** Return value of {@link useTheme}. */
export interface UseThemeReturn {
  /** Current preference, including `"system"`. Mutating this persists to storage. */
  theme: Ref<ThemePreference>;
  /** Resolved theme after applying `prefers-color-scheme` when preference is `"system"`. */
  effectiveTheme: ComputedRef<EffectiveTheme>;
  /** Imperative setter — validates input and persists. */
  setTheme: (value: ThemePreference) => void;
  /** `true` when `theme.value === "system"`. */
  isSystem: ComputedRef<boolean>;
}

/**
 * Reactive theme manager with three-way preference (`light` / `dark` /
 * `system`), `prefers-color-scheme` tracking, and `localStorage` persistence.
 *
 * The `matchMedia` listener is registered synchronously and torn down via
 * {@link onScopeDispose}.
 */
export function useTheme(options: UseThemeOptions = {}): UseThemeReturn {
  const storageKey = options.storageKey ?? "tracepilot-theme";
  const defaultTheme = options.defaultTheme ?? "system";
  const applyToDocument = options.applyToDocument ?? true;
  const docAttribute = options.documentAttribute ?? "data-theme";

  const theme = useLocalStorage<ThemePreference>(storageKey, defaultTheme, {
    serializer: {
      read: (raw) => {
        const parsed = raw.startsWith('"') ? (JSON.parse(raw) as string) : raw;
        return (VALID as readonly string[]).includes(parsed)
          ? (parsed as ThemePreference)
          : defaultTheme;
      },
      write: (value) => JSON.stringify(value),
    },
  });

  const systemPrefersDark = shallowRef(detectSystemPrefersDark());

  if (typeof window !== "undefined" && typeof window.matchMedia === "function") {
    const mql = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = (e: MediaQueryListEvent) => {
      systemPrefersDark.value = e.matches;
    };
    // `addEventListener` preferred; older Safari exposed `addListener`.
    if (typeof mql.addEventListener === "function") {
      mql.addEventListener("change", onChange);
      if (getCurrentScope()) {
        onScopeDispose(() => mql.removeEventListener("change", onChange));
      }
    } else if (typeof (mql as unknown as { addListener?: unknown }).addListener === "function") {
      (
        mql as unknown as { addListener: (cb: (e: MediaQueryListEvent) => void) => void }
      ).addListener(onChange);
      if (getCurrentScope()) {
        onScopeDispose(() => {
          (
            mql as unknown as { removeListener: (cb: (e: MediaQueryListEvent) => void) => void }
          ).removeListener(onChange);
        });
      }
    }
  }

  const effectiveTheme = computed<EffectiveTheme>(() => {
    if (theme.value === "system") return systemPrefersDark.value ? "dark" : "light";
    return theme.value;
  });

  const isSystem = computed(() => theme.value === "system");

  function setTheme(value: ThemePreference) {
    if (!(VALID as readonly string[]).includes(value)) return;
    theme.value = value;
  }

  if (applyToDocument && typeof document !== "undefined") {
    watch(
      effectiveTheme,
      (resolved) => {
        document.documentElement.setAttribute(docAttribute, resolved);
      },
      { immediate: true },
    );
  }

  return { theme, effectiveTheme, setTheme, isSystem };
}

function detectSystemPrefersDark(): boolean {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return false;
  try {
    return window.matchMedia("(prefers-color-scheme: dark)").matches;
  } catch {
    return false;
  }
}
