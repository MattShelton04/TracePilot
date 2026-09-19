/**
 * usePromptCache — prompt-cache insights for the current session.
 *
 * Loads the session's prompt-cache timeline (a standard session-detail
 * section, so live auto-refresh keeps it current) while the
 * `promptCacheInsights` feature is enabled, and maps resumed windows to the
 * conversation turns they started.
 */
import type { CacheWindow } from "@tracepilot/types";
import { useSessionTabLoader } from "@tracepilot/ui";
import { computed } from "vue";
import type { SessionDetailContext } from "@/composables/useSessionDetail";
import { usePreferencesStore } from "@/stores/preferences";
import { mapWindowsToTurns } from "@/utils/promptCache";

export function usePromptCache(store: SessionDetailContext) {
  const prefs = usePreferencesStore();
  const enabled = computed(() => prefs.isFeatureEnabled("promptCacheInsights"));

  useSessionTabLoader(
    () => (enabled.value ? store.sessionId : null),
    () => store.loadPromptCache(),
  );

  const timeline = computed(() => (enabled.value ? store.promptCache : null));

  /** Resumed windows keyed by the `turnIndex` of the turn they started. */
  const windowsByTurn = computed<Map<number, CacheWindow>>(() => {
    // turnsVersion changes when turns are merged in place during live refresh.
    void store.turnsVersion;
    const windows = timeline.value?.windows;
    return windows ? mapWindowsToTurns(windows, store.turns) : new Map();
  });

  function retry() {
    store.loaded.delete("promptCache");
    void store.loadPromptCache();
  }

  return { enabled, timeline, windowsByTurn, retry };
}
