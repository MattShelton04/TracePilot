// Session agent directory, provided once per session view and consumed by
// deeply nested renderers (tool results, activity streams) to turn raw agent
// IDs into named, coloured, clickable agent references.
//
// Hosts provide the directory (and optionally the communication log), and
// views that can show an agent (the conversation's subagent panel, the agent
// tree) re-provide it with an `openAgent` handler. Consumers degrade to raw
// IDs when nothing is provided.

import { computed, type InjectionKey, inject, provide, type Ref } from "vue";
import {
  type AgentCommunication,
  type AgentDirectory,
  type AgentDirectoryEntry,
  MAIN_AGENT_KEY,
} from "../utils/agentComms";

export interface AgentDirectoryContext {
  directory: Readonly<Ref<AgentDirectory | null>>;
  /** Session communication log, when the host builds one. */
  communications?: Readonly<Ref<readonly AgentCommunication[]>>;
  /** Opens the view's detail for an agent, keyed by directory key. */
  openAgent?: (key: string) => void;
}

const AGENT_DIRECTORY_KEY: InjectionKey<AgentDirectoryContext> = Symbol("agentDirectory");

export function provideAgentDirectory(context: AgentDirectoryContext): void {
  provide(AGENT_DIRECTORY_KEY, context);
}

/** Re-provide the inherited directory with a view-specific open handler. */
export function provideAgentOpener(openAgent: (key: string) => void): void {
  const inherited = inject(AGENT_DIRECTORY_KEY, null);
  if (inherited) provide(AGENT_DIRECTORY_KEY, { ...inherited, openAgent });
}

export function useAgentDirectory() {
  const context = inject(AGENT_DIRECTORY_KEY, null);
  const directory = computed(() => context?.directory.value ?? null);
  const communications = computed(() => context?.communications?.value ?? []);
  const byToolCall = computed(() => {
    const map = new Map<string, AgentCommunication>();
    for (const c of communications.value) {
      if (c.toolCallId) map.set(c.toolCallId, c);
    }
    return map;
  });

  function resolve(identifier: string | undefined | null): AgentDirectoryEntry | undefined {
    return directory.value?.resolve(identifier);
  }

  function canOpen(key: string | undefined): boolean {
    return !!key && key !== MAIN_AGENT_KEY && !!context?.openAgent && !!directory.value?.get(key);
  }

  function open(key: string): void {
    if (canOpen(key)) context?.openAgent?.(key);
  }

  /** The exchange a tool call carried (launch, message or read), if known. */
  function communicationFor(toolCallId: string | undefined): AgentCommunication | undefined {
    return toolCallId ? byToolCall.value.get(toolCallId) : undefined;
  }

  return { directory, communications, resolve, canOpen, open, communicationFor };
}
