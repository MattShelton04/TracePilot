import {
  agentsCreate,
  agentsDelete,
  agentsSetDisabled,
  agentsSetOverride,
} from "@tracepilot/client";
import type {
  AgentCatalog,
  AgentCreateScope,
  SubagentOverride,
  SubagentSettings,
} from "@tracepilot/types";
import { runMutation } from "@tracepilot/ui";
import type { Ref, ShallowRef } from "vue";

interface AgentMutationContext {
  catalog: ShallowRef<AgentCatalog | null>;
  error: Ref<string | null>;
  loadCatalog: () => Promise<void>;
}

/** File and settings mutations; each refreshes the affected catalog state. */
export function createAgentMutations({ catalog, error, loadCatalog }: AgentMutationContext) {
  function applySettings(settings: SubagentSettings) {
    if (catalog.value) catalog.value = { ...catalog.value, settings };
  }

  /** Create a custom agent from the template; resolves to its path. */
  async function createAgent(
    scope: AgentCreateScope,
    name: string,
    description: string,
    repoRoot?: string | null,
  ): Promise<string | null> {
    return runMutation(error, async () => {
      const result = await agentsCreate(scope, name, description, repoRoot);
      await loadCatalog();
      return result.path;
    });
  }

  async function deleteAgent(path: string): Promise<boolean> {
    return (
      (await runMutation(error, async () => {
        await agentsDelete(path);
        await loadCatalog();
        return true as const;
      })) ?? false
    );
  }

  /** Set, or with `null` reset, the `/subagents` override for an agent. */
  async function setOverride(agentType: string, value: SubagentOverride | null): Promise<boolean> {
    return (
      (await runMutation(error, async () => {
        applySettings(await agentsSetOverride(agentType, value));
        return true as const;
      })) ?? false
    );
  }

  async function setDisabled(agentType: string, disabled: boolean): Promise<boolean> {
    return (
      (await runMutation(error, async () => {
        applySettings(await agentsSetDisabled(agentType, disabled));
        return true as const;
      })) ?? false
    );
  }

  function clearError() {
    error.value = null;
  }

  return { createAgent, deleteAgent, setOverride, setDisabled, clearError };
}
