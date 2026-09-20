import { skillsUsageSummary } from "@tracepilot/client";
import type { SkillUsageSummary } from "@tracepilot/types";
import { runAction, useAsyncGuard } from "@tracepilot/ui";
import { type Ref, ref, type ShallowRef, shallowRef } from "vue";
import { STORAGE_KEYS } from "@/config/storageKeys";
import { logWarn } from "@/utils/logger";
import { rangeBounds, USAGE_RANGES, type UsageRange } from "@/utils/usage/range";

const DEFAULT_RANGE: UsageRange = "90d";

/**
 * The chosen range is remembered because a corpus whose skill use predates
 * the default window would otherwise look empty on every visit.
 */
function storedRange(): UsageRange {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.skillsUsageRange);
    const match = USAGE_RANGES.find((option) => option.value === raw);
    return match ? match.value : DEFAULT_RANGE;
  } catch (error) {
    logWarn("[skills] Could not read the stored usage range", error);
    return DEFAULT_RANGE;
  }
}

export interface SkillsUsageSlice {
  usage: ShallowRef<SkillUsageSummary | null>;
  range: Ref<UsageRange>;
  usageLoading: Ref<boolean>;
  usageError: Ref<string | null>;
  loadUsage: () => Promise<void>;
  setRange: (next: UsageRange) => Promise<void>;
}

/**
 * Cross-session usage for the selected range.
 *
 * Loaded independently of the catalog, so a missing or still-building index
 * never hides the skills that are installed — the manager simply shows no
 * usage figures until the index catches up.
 */
export function createSkillsUsageSlice(): SkillsUsageSlice {
  const usage = shallowRef<SkillUsageSummary | null>(null);
  const range = ref<UsageRange>(storedRange());
  const usageLoading = ref(false);
  const usageError = ref<string | null>(null);
  const guard = useAsyncGuard();

  async function loadUsage() {
    await runAction({
      loading: usageLoading,
      error: usageError,
      guard,
      action: () => skillsUsageSummary(rangeBounds(range.value)),
      onSuccess: (result) => {
        usage.value = result;
      },
    });
  }

  async function setRange(next: UsageRange) {
    if (range.value === next) return;
    range.value = next;
    try {
      localStorage.setItem(STORAGE_KEYS.skillsUsageRange, next);
    } catch (error) {
      logWarn("[skills] Could not persist the usage range", error);
    }
    await loadUsage();
  }

  return { usage, range, usageLoading, usageError, loadUsage, setRange };
}
