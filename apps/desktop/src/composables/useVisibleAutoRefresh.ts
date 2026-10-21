import { useAutoRefresh } from "@tracepilot/ui";
import { computed, type InjectionKey, inject, type Ref, ref, watch } from "vue";
import { usePreferencesStore } from "@/stores/preferences";

/**
 * Whether the session detail around a sub-tab is on screen. A session tab in
 * the background (and the routed detail under an open tab) stays mounted, so
 * its sub-tabs read this to pause their own refreshing. Provided by
 * SessionDetailPanel; absent, a sub-tab counts as visible.
 */
export const SESSION_VIEW_VISIBLE_KEY: InjectionKey<Readonly<Ref<boolean>>> =
  Symbol("sessionViewVisible");

/**
 * How often a hidden session detail re-checks a running session, so its
 * tab's live dot clears once the session ends. Nothing else reloads hidden.
 */
export const HIDDEN_LIVENESS_POLL_MS = 30_000;

export function useSessionViewVisible(): Readonly<Ref<boolean>> {
  return inject(SESSION_VIEW_VISIBLE_KEY, ref(true));
}

export interface UseVisibleAutoRefreshOptions {
  onRefresh: () => Promise<void> | void;
  /** Whether the view is on screen; auto-refresh runs only while it is. */
  visible: () => boolean;
}

/**
 * The auto-refresh preference for a view that can stay mounted while hidden
 * (the session list under an open session tab, a background tab's Explorer).
 * It ticks only while the view shows, and refreshes once when the view comes
 * back, so it doesn't sit on what it showed before it was hidden.
 */
export function useVisibleAutoRefresh(options: UseVisibleAutoRefreshOptions) {
  const prefs = usePreferencesStore();
  const visible = computed(options.visible);
  const autoRefresh = useAutoRefresh({
    onRefresh: options.onRefresh,
    enabled: computed(() => prefs.autoRefreshEnabled && visible.value),
    intervalSeconds: computed(() => prefs.autoRefreshIntervalSeconds),
  });

  watch(visible, async (shown, wasShown) => {
    if (!shown || wasShown || !prefs.autoRefreshEnabled) return;
    try {
      await autoRefresh.refresh();
    } catch {
      // As on a timer tick: onRefresh reports its own errors.
    }
  });

  return autoRefresh;
}
