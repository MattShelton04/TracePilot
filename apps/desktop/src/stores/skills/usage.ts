import { skillsUsageSummary } from "@tracepilot/client";
import type { SkillUsageSummary } from "@tracepilot/types";
import { runAction, useAsyncGuard } from "@tracepilot/ui";
import { type Ref, ref, type ShallowRef, shallowRef } from "vue";
import { rangeBounds, type UsageRange } from "@/utils/usage/range";

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
  const range = ref<UsageRange>("90d");
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
    await loadUsage();
  }

  return { usage, range, usageLoading, usageError, loadUsage, setRange };
}
