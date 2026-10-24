/**
 * useFocusRequests — cross-tab navigation requests for a session detail
 * instance: the checkpoint or conversation turn another tab asked to show.
 * Extracted from useSessionDetail.
 */
import { ref } from "vue";

export function useFocusRequests() {
  const pendingCheckpointFocus = ref<number | null>(null);
  const pendingConversationFocus = ref<{
    turnIndex: number;
    eventIndex: number | null;
    requestId: number;
  } | null>(null);
  let conversationFocusRequestId = 0;

  function focusCheckpoint(checkpointNumber: number | null) {
    pendingCheckpointFocus.value = checkpointNumber;
  }

  function focusConversation(turnIndex: number, eventIndex: number | null = null) {
    conversationFocusRequestId += 1;
    pendingConversationFocus.value = {
      turnIndex,
      eventIndex,
      requestId: conversationFocusRequestId,
    };
  }

  return { pendingCheckpointFocus, pendingConversationFocus, focusCheckpoint, focusConversation };
}
