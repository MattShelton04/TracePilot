import { getWorktreeDiskUsage } from "@tracepilot/client";
import type { WorktreeInfo } from "@tracepilot/types";
import { logWarn } from "@/utils/logger";
import type { WorktreesContext } from "./context";

/** Max concurrent disk-usage IPC calls during hydration. */
const HYDRATION_CONCURRENCY = 4;

/**
 * Hydrates diskUsageBytes for each worktree in `items`.
 *
 * Processes items in batches to limit concurrent IPC calls. When `guardToken`
 * is provided, results are discarded if the token has become stale.
 */
export async function hydrateDiskUsageBatch(
  context: WorktreesContext,
  items: WorktreeInfo[],
  guardToken?: number,
): Promise<void> {
  const { loadGuard, worktrees } = context;
  for (let i = 0; i < items.length; i += HYDRATION_CONCURRENCY) {
    if (guardToken != null && !loadGuard.isValid(guardToken)) return;
    const batch = items.slice(i, i + HYDRATION_CONCURRENCY);
    await Promise.allSettled(
      batch.map(async (wt) => {
        try {
          const bytes = await getWorktreeDiskUsage(wt.path);
          if (guardToken != null && !loadGuard.isValid(guardToken)) return;
          const idx = worktrees.value.findIndex((w) => w.path === wt.path);
          if (idx >= 0) {
            worktrees.value[idx] = { ...worktrees.value[idx], diskUsageBytes: bytes };
          }
        } catch (e) {
          logWarn("[worktrees] Failed to hydrate disk usage", { path: wt.path, error: e });
        }
      }),
    );
  }
}
