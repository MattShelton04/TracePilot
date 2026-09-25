import type { ConversationTurn } from "@tracepilot/types";
import {
  buildAgentCommunications,
  buildAgentDirectory,
  provideAgentDirectory,
} from "@tracepilot/ui";
import { computed } from "vue";

interface AgentDirectorySource {
  readonly turns: ConversationTurn[];
  readonly sessionId: string | null;
}

/**
 * Builds the session's agent directory and communication log from its turns
 * and provides them to descendant renderers. Call once in each session view
 * that renders agent activity; views that can show an agent add an opener
 * with `provideAgentOpener`.
 */
export function provideSessionAgentDirectory(source: AgentDirectorySource) {
  const directory = computed(() =>
    buildAgentDirectory(source.turns, { sessionId: source.sessionId ?? undefined }),
  );
  const communications = computed(() => buildAgentCommunications(source.turns, directory.value));
  provideAgentDirectory({ directory, communications });
  return { directory, communications };
}
