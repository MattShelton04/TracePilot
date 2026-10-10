import { modelDisplayName } from "@tracepilot/types";
import { useSessionDetailContext } from "@/composables/useSessionDetailContext";
import { useSessionSource } from "@/composables/useSessionSource";

/**
 * Names a model recorded in the open session the way cards and Analytics do
 * (`claude-opus-5-5` → `claude-opus-5.5` for Claude Code). Display only:
 * show the recorded id as the tooltip.
 */
export function useSessionModelName(): (model: string) => string {
  const store = useSessionDetailContext();
  const { source } = useSessionSource(
    () => store.sessionId,
    () => store.detail,
  );
  return (model) => modelDisplayName(model, source.value);
}
