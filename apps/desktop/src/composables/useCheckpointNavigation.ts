/**
 * useCheckpointNavigation — provide/inject key and helper for navigating
 * from compaction events in the conversation view to the corresponding
 * checkpoint in the overview tab.
 */
import type { InjectionKey } from "vue";
import { inject } from "vue";

/** Callback signature: navigate to the given checkpoint number. */
export type NavigateToCheckpoint = (checkpointNumber: number) => void;

export const NAVIGATE_CHECKPOINT_KEY: InjectionKey<NavigateToCheckpoint> =
  Symbol("navigateToCheckpoint");

/**
 * Returns the injected navigation callback, or a no-op if not provided
 * (e.g. when used outside a tab-mode session detail view).
 */
export function useCheckpointNavigation(): NavigateToCheckpoint {
  return inject(NAVIGATE_CHECKPOINT_KEY, () => {});
}
