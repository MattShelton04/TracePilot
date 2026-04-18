import { ftsHealth, ftsIntegrityCheck, ftsOptimize } from "@tracepilot/client";
import type { FtsHealthInfo } from "@tracepilot/client";
import { toErrorMessage, useAsyncGuard } from "@tracepilot/ui";
import { ref } from "vue";

/**
 * FTS maintenance slice — health info, integrity check, optimize.
 *
 * Guards prevent stale async responses and deduplicate concurrent requests.
 */
export function createMaintenanceSlice() {
  const healthInfo = ref<FtsHealthInfo | null>(null);
  const healthLoading = ref(false);
  const maintenanceMessage = ref<string | null>(null);

  const healthGuard = useAsyncGuard();
  const integrityCheckGuard = useAsyncGuard();
  const optimizeGuard = useAsyncGuard();

  /** Timestamp of the last completed health fetch — prevents redundant checks on re-navigation. */
  let healthLastFetchedAt = 0;
  const HEALTH_CACHE_TTL_MS = 30_000;

  /** Fetch FTS health info. Skips if a fresh result exists unless `force` is true. */
  async function fetchHealth(force = false) {
    if (!force && Date.now() - healthLastFetchedAt < HEALTH_CACHE_TTL_MS) return;
    const token = healthGuard.start();
    healthLoading.value = true;
    try {
      const result = await ftsHealth();
      if (!healthGuard.isValid(token)) return;
      healthInfo.value = result;
      healthLastFetchedAt = Date.now();
    } catch (_e) {
      if (!healthGuard.isValid(token)) return;
      healthInfo.value = null;
    } finally {
      if (healthGuard.isValid(token)) healthLoading.value = false;
    }
  }

  async function runIntegrityCheck() {
    const token = integrityCheckGuard.start();
    maintenanceMessage.value = null;
    try {
      const result = await ftsIntegrityCheck();
      if (!integrityCheckGuard.isValid(token)) return;
      maintenanceMessage.value = result;
    } catch (e) {
      if (!integrityCheckGuard.isValid(token)) return;
      maintenanceMessage.value = `Error: ${toErrorMessage(e)}`;
    }
  }

  async function runOptimize() {
    const token = optimizeGuard.start();
    maintenanceMessage.value = null;
    try {
      const result = await ftsOptimize();
      if (!optimizeGuard.isValid(token)) return;
      maintenanceMessage.value = result;
      await fetchHealth(true); // force-refresh health after optimize
    } catch (e) {
      if (!optimizeGuard.isValid(token)) return;
      maintenanceMessage.value = `Error: ${toErrorMessage(e)}`;
    }
  }

  return {
    healthInfo,
    healthLoading,
    maintenanceMessage,
    fetchHealth,
    runIntegrityCheck,
    runOptimize,
  };
}

export type MaintenanceSlice = ReturnType<typeof createMaintenanceSlice>;
