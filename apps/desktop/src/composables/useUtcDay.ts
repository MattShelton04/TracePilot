import { getCurrentScope, onScopeDispose, type Ref, ref } from "vue";
import { todayUtc } from "@/utils/analyticsDashboard";

/**
 * Today's UTC date (`YYYY-MM-DD`) as a ref that turns over at UTC midnight,
 * so date ranges ending today move with the calendar while the app stays
 * open. One timer, set for the next midnight, updates it; so does the window
 * regaining focus or visibility, which covers a machine that slept through
 * midnight and ran no timers. Listening stops with the calling scope.
 */
export function useUtcDay(): Readonly<Ref<string>> {
  const day = ref(todayUtc());
  let timer: ReturnType<typeof setTimeout> | undefined;

  function sync() {
    const now = new Date();
    day.value = todayUtc(now);
    clearTimeout(timer);
    const midnight = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1);
    timer = setTimeout(sync, midnight - now.getTime());
  }
  const onVisibility = () => {
    if (document.visibilityState === "visible") sync();
  };

  sync();
  const hasWindow = typeof window !== "undefined";
  if (hasWindow) {
    window.addEventListener("focus", sync);
    document.addEventListener("visibilitychange", onVisibility);
  }
  if (getCurrentScope()) {
    onScopeDispose(() => {
      clearTimeout(timer);
      if (!hasWindow) return;
      window.removeEventListener("focus", sync);
      document.removeEventListener("visibilitychange", onVisibility);
    });
  }
  return day;
}
