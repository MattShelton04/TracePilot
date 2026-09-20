import { runAction, useAsyncGuard } from "@tracepilot/ui";
import { type Ref, ref, type ShallowRef, shallowRef } from "vue";
import { logWarn } from "@/utils/logger";
import { rangeBounds, USAGE_RANGES, type UsageRange } from "@/utils/usage/range";

const DEFAULT_RANGE: UsageRange = "all";

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
  loadUsage: () => Promise<void>;
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

  async function loadUsage() {
    usage.value = null;
    await runAction({
      loading: usageLoading,
      error: usageError,
      guard,
      action: () => query(rangeBounds(range.value)),
      onSuccess: (result) => {
        usage.value = result;
      },
    });
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
