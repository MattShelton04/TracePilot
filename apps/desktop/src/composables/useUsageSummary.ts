import { runAction, useAsyncGuard } from "@tracepilot/ui";
import { type Ref, ref, type ShallowRef, shallowRef } from "vue";
import { logWarn } from "@/utils/logger";
import { rangeBounds, USAGE_RANGES, type UsageRange } from "@/utils/usage/range";

const DEFAULT_RANGE: UsageRange = "all";
const CACHE_TTL_MS = 60_000;

/** Remember explicit choices; a fresh catalog includes the whole corpus. */
function storedRange(storageKey: string): UsageRange {
  try {
    const raw = localStorage.getItem(storageKey);
    const match = USAGE_RANGES.find((option) => option.value === raw);
    return match ? match.value : DEFAULT_RANGE;
  } catch (error) {
    logWarn("[usage] Could not read the stored usage range", error);
    return DEFAULT_RANGE;
  }
}

export interface UsageSummarySlice<T> {
  usage: ShallowRef<T | null>;
  range: Ref<UsageRange>;
  usageLoading: Ref<boolean>;
  usageError: Ref<string | null>;
  loadUsage: (force?: boolean) => Promise<void>;
  setRange: (next: UsageRange) => Promise<void>;
}

/** Usage loads independently of definitions and rejects superseded responses. */
export function createUsageSummary<T>(
  query: (bounds: ReturnType<typeof rangeBounds>) => Promise<T>,
  storageKey: string,
): UsageSummarySlice<T> {
  const usage = shallowRef<T | null>(null);
  const range = ref<UsageRange>(storedRange(storageKey));
  const usageLoading = ref(false);
  const usageError = ref<string | null>(null);
  const guard = useAsyncGuard();
  let loadedRange: UsageRange | null = null;
  let loadedAt = 0;
  let pending: { range: UsageRange; promise: Promise<void> } | null = null;

  async function loadUsage(force = false) {
    const requestedRange = range.value;
    if (pending?.range === requestedRange) return pending.promise;
    if (!force && loadedRange === requestedRange && Date.now() - loadedAt < CACHE_TTL_MS) return;
    // A refresh must not blank the grid. A different range must never show
    // the previous window's totals, including when its request fails.
    if (loadedRange !== requestedRange) {
      usage.value = null;
      loadedRange = null;
    }
    const promise = runAction({
      loading: usageLoading,
      error: usageError,
      guard,
      action: () => query(rangeBounds(requestedRange)),
      onSuccess: (result) => {
        usage.value = result;
        loadedRange = requestedRange;
        loadedAt = Date.now();
      },
    });
    pending = { range: requestedRange, promise };
    await promise;
    if (pending?.promise === promise) pending = null;
  }

  async function setRange(next: UsageRange) {
    if (range.value === next) return;
    range.value = next;
    try {
      localStorage.setItem(storageKey, next);
    } catch (error) {
      logWarn("[usage] Could not persist the usage range", error);
    }
    await loadUsage();
  }

  return { usage, range, usageLoading, usageError, loadUsage, setRange };
}
