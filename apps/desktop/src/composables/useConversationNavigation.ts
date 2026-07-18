/**
 * Cross-tab conversation navigation used by context analytics and other
 * session-detail surfaces. Targets use the same zero-based turn/event indexes
 * as Search deep links.
 */
import type { InjectionKey } from "vue";
import { inject } from "vue";

export interface ConversationNavigationTarget {
  turnIndex: number;
  eventIndex?: number | null;
}

export type NavigateToConversation = (target: ConversationNavigationTarget) => void;

export const NAVIGATE_CONVERSATION_KEY: InjectionKey<NavigateToConversation> =
  Symbol("navigateToConversation");

export function useConversationNavigation(): NavigateToConversation {
  return inject(NAVIGATE_CONVERSATION_KEY, () => {});
}
