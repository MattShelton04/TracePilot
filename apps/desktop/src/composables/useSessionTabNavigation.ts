/**
 * useSessionTabNavigation — provide/inject key for switching the enclosing
 * session detail to another of its tabs (e.g. Metrics → Context).
 *
 * Tab mode (`SessionDetailTabView`, which also backs pop-out windows) has no
 * route to push, so it provides a callback that changes its sub-tab. Route
 * mode provides nothing; callers then push the tab's route.
 */
import type { InjectionKey } from "vue";
import { inject } from "vue";

/** Callback signature: show the named session tab (a `SESSION_TABS` name). */
export type NavigateToSessionTab = (tab: string) => void;

export const NAVIGATE_SESSION_TAB_KEY: InjectionKey<NavigateToSessionTab> =
  Symbol("navigateToSessionTab");

/** The injected callback, or `null` in route mode. */
export function useSessionTabNavigation(): NavigateToSessionTab | null {
  return inject(NAVIGATE_SESSION_TAB_KEY, null);
}
