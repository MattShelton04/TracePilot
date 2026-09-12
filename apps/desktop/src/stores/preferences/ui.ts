/**
 * UI preferences slice.
 *
 * Owns theme, layout, and general-UX refs + the DOM side-effect helpers
 * (`applyTheme` / `applyContentMaxWidth` / `applyUiScale`). Kept pure aside
 * from `localStorage` access for theme write-through cache / ephemeral refs.
 */

import {
  DEFAULT_AUTO_REFRESH_INTERVAL_SECONDS,
  DEFAULT_CLI_COMMAND,
  DEFAULT_CONTENT_MAX_WIDTH,
  DEFAULT_FAVOURITE_MODELS,
  DEFAULT_SESSION_CACHE_SIZE,
  DEFAULT_UI_SCALE,
} from "@tracepilot/types";
import { normalizePath } from "@tracepilot/ui";
import { ref, watch } from "vue";
import { STORAGE_KEYS } from "@/config/storageKeys";

export type ThemeOption = "dark" | "light";

export const BASE_FONT_SIZE_PX = 16;
export const MIN_CONTENT_MAX_WIDTH = 400;
// Matches the backend's u32 setting; zero is the Full preset.
export const MAX_CONTENT_MAX_WIDTH = 4_294_967_295;

export function normalizeContentMaxWidth(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_CONTENT_MAX_WIDTH;
  if (value === 0) return 0;
  return Math.max(MIN_CONTENT_MAX_WIDTH, Math.min(MAX_CONTENT_MAX_WIDTH, Math.round(value)));
}

const VALID_THEMES: ThemeOption[] = ["dark", "light"];

export function applyTheme(theme: ThemeOption) {
  document.documentElement.setAttribute("data-theme", theme);
  // Write-through cache for instant theme on next launch (no flash)
  localStorage.setItem(STORAGE_KEYS.theme, theme);
}

export function applyContentMaxWidth(value: number) {
  // 0 means no limit (full width)
  const normalized = normalizeContentMaxWidth(value);
  const cssVal = normalized === 0 ? "none" : `${normalized}px`;
  document.documentElement.style.setProperty("--content-max-width", cssVal);
}

export function applyUiScale(scale: number) {
  // Clamp to safe range to avoid breaking layouts (0.8x to 1.3x)
  const clamped = Math.max(0.8, Math.min(1.3, scale));
  // Scaling root font-size adjusts all rem-based sizes uniformly
  document.documentElement.style.fontSize = `${BASE_FONT_SIZE_PX * clamped}px`;
}

export function createUiSlice() {
  // Initialize theme from write-through cache to match main.ts (prevents flash)
  const cachedTheme = localStorage.getItem(STORAGE_KEYS.theme);
  const theme = ref<ThemeOption>(
    VALID_THEMES.includes(cachedTheme as ThemeOption) ? (cachedTheme as ThemeOption) : "dark",
  );
  const sessionStateDir = ref("");
  const hideEmptySessions = ref(true);
  const cliCommand = ref(DEFAULT_CLI_COMMAND);
  const autoRefreshEnabled = ref(false);
  const autoRefreshIntervalSeconds = ref(DEFAULT_AUTO_REFRESH_INTERVAL_SECONDS);
  const checkForUpdates = ref(true);
  const favouriteModels = ref<string[]>([...DEFAULT_FAVOURITE_MODELS]);
  const recentRepoPaths = ref<string[]>([]);
  const contentMaxWidth = ref(DEFAULT_CONTENT_MAX_WIDTH);
  watch(
    contentMaxWidth,
    (value) => {
      const normalized = normalizeContentMaxWidth(value);
      if (value !== normalized) contentMaxWidth.value = normalized;
    },
    { flush: "sync" },
  );
  const uiScale = ref(DEFAULT_UI_SCALE);
  const logLevel = ref("info");
  const sessionCacheSize = ref(DEFAULT_SESSION_CACHE_SIZE);

  // Ephemeral state — stays in localStorage only
  const lastViewedSession = ref<string | null>(localStorage.getItem(STORAGE_KEYS.lastSession));
  const lastSeenVersion = ref<string | null>(localStorage.getItem(STORAGE_KEYS.lastSeenVersion));

  /** Add a repo path to recents (max 10, deduped, most recent first). */
  function addRecentRepoPath(path: string) {
    const normalized = normalizePath(path);
    recentRepoPaths.value = [
      normalized,
      ...recentRepoPaths.value.filter((p) => p !== normalized),
    ].slice(0, 10);
  }

  return {
    theme,
    sessionStateDir,
    hideEmptySessions,
    cliCommand,
    autoRefreshEnabled,
    autoRefreshIntervalSeconds,
    checkForUpdates,
    favouriteModels,
    recentRepoPaths,
    contentMaxWidth,
    uiScale,
    logLevel,
    sessionCacheSize,
    lastViewedSession,
    lastSeenVersion,
    addRecentRepoPath,
  };
}

export type UiSlice = ReturnType<typeof createUiSlice>;
