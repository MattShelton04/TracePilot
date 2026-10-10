import {
  DEFAULT_SESSION_SOURCE,
  type SessionDetail,
  type SessionListItem,
  type SessionSource,
  type SourceCapabilities,
  sourceCapabilities,
} from "@tracepilot/types";
import { type ComputedRef, computed } from "vue";
import { useSessionsStore } from "@/stores/sessions";

/**
 * A session's source from data already loaded: the detail's, then the
 * matching list item's while the detail loads, then Copilot when loaded data
 * describes the session without one. `undefined` when nothing loaded
 * describes it.
 */
export function knownSessionSource(
  sessionId: string | null | undefined,
  detail: Pick<SessionDetail, "id" | "source"> | null | undefined,
  sessions: readonly Pick<SessionListItem, "id" | "source">[],
): SessionSource | undefined {
  if (!sessionId) return undefined;
  const ownDetail = detail?.id === sessionId ? detail : undefined;
  if (ownDetail?.source) return ownDetail.source;
  const item = sessions.find((s) => s.id === sessionId);
  if (item?.source) return item.source;
  return ownDetail || item ? DEFAULT_SESSION_SOURCE : undefined;
}

/** The open session's source and capabilities, resolved as {@link knownSessionSource}. */
export function useSessionSource(
  sessionId: () => string | null | undefined,
  detail: () => Pick<SessionDetail, "id" | "source"> | null | undefined,
): { source: ComputedRef<SessionSource>; capabilities: ComputedRef<SourceCapabilities> } {
  const sessions = useSessionsStore();
  const source = computed(
    () => knownSessionSource(sessionId(), detail(), sessions.sessions) ?? DEFAULT_SESSION_SOURCE,
  );
  return { source, capabilities: computed(() => sourceCapabilities(source.value)) };
}
