import { toRaw } from "vue";

/** A session detail instance's pending "Show in conversation" request. */
interface ConversationFocusSource {
  pendingConversationFocus: { requestId: number } | null;
}

/** Per session detail instance: the last conversation focus request already shown. */
const revealed = new WeakMap<object, number>();

/**
 * The store keeps its last "Show in conversation" request after the
 * conversation has scrolled to it. Once shown, it must not pull a remounted
 * Conversation tab back to that turn, nor stop the tab returning to where the
 * user was reading. A new request (a new `requestId`) is unrevealed again.
 */
export function hasUnrevealedConversationFocus(store: ConversationFocusSource): boolean {
  const pending = store.pendingConversationFocus;
  return pending != null && revealed.get(toRaw(store)) !== pending.requestId;
}

export function isConversationFocusRevealed(
  store: ConversationFocusSource,
  requestId: number,
): boolean {
  return revealed.get(toRaw(store)) === requestId;
}

export function markConversationFocusRevealed(store: ConversationFocusSource, requestId: number) {
  revealed.set(toRaw(store), requestId);
}
