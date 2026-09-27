import type { TurnToolCall } from "@tracepilot/types";
import { computed, inject } from "vue";
import { isToolResultTruncated } from "../utils/toolCallStatus";
import { LIVE_TOOL_PARTIAL_OUTPUT_KEY } from "./liveToolPartialOutput";

/** Shared by conversation cards and waterfall/swimlane details. Empty is a result. */
export function useToolDisplayResult(props: { tc: TurnToolCall; fullResult?: string }) {
  const partials = inject(LIVE_TOOL_PARTIAL_OUTPUT_KEY, null);
  // Native reconstruction omits empty results. Completion itself still
  // supersedes a streamed preview, including when no result text was saved.
  const persisted = computed(
    () => props.fullResult ?? props.tc.resultContent ?? (props.tc.isComplete ? "" : undefined),
  );
  const livePartial = computed(() => {
    if (persisted.value != null || !props.tc.toolCallId) return null;
    return partials?.value.get(props.tc.toolCallId) ?? null;
  });
  const shell = computed(() =>
    ["powershell", "read_powershell", "write_powershell"].includes(props.tc.toolName),
  );
  return {
    displayResult: computed(() => persisted.value ?? livePartial.value ?? ""),
    showResult: computed(() => persisted.value != null || livePartial.value != null || shell.value),
    isStreaming: computed(() => persisted.value == null && props.tc.isComplete === false),
    isTruncated: computed(
      () =>
        props.fullResult == null &&
        !!props.tc.toolCallId &&
        isToolResultTruncated(props.tc.resultContent),
    ),
  };
}
