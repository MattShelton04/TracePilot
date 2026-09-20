/** Agents explorer IPC wrappers. */

import type {
  AgentCatalog,
  AgentCreateScope,
  AgentDefinitionDetail,
  AgentFields,
  AgentUsageDetail,
  AgentUsageSummary,
  AgentWriteResult,
  SubagentOverride,
  SubagentSettings,
} from "@tracepilot/types";
import { createInvoke } from "./invoke.js";

const invoke = createInvoke("Agents", async (cmd, args) => {
  const { agentsMock } = await import("./mock/agents.js");
  return agentsMock(cmd, args);
});

/** Date range (`YYYY-MM-DD`, inclusive) and repository filter for usage. */
export interface AgentUsageFilter {
  fromDate?: string | null;
  toDate?: string | null;
  repo?: string | null;
}

// -- Definitions --

export async function agentsList(repoRoot?: string): Promise<AgentCatalog> {
  return invoke<AgentCatalog>("agents_list", { repoRoot: repoRoot ?? null });
}

export async function agentsGet(path: string): Promise<AgentDefinitionDetail> {
  return invoke<AgentDefinitionDetail>("agents_get", { path });
}

/** The file content a structured save would write (for diff previews). */
export async function agentsPreview(
  path: string,
  fields: AgentFields,
  body: string,
): Promise<string> {
  return invoke<string>("agents_preview", { path, fields, body });
}

export async function agentsSave(
  path: string,
  fields: AgentFields,
  body: string,
): Promise<AgentWriteResult> {
  return invoke<AgentWriteResult>("agents_save", { path, fields, body });
}

export async function agentsSaveRaw(path: string, content: string): Promise<AgentWriteResult> {
  return invoke<AgentWriteResult>("agents_save_raw", { path, content });
}

export async function agentsCreate(
  scope: AgentCreateScope,
  name: string,
  description: string,
  repoRoot?: string | null,
): Promise<AgentWriteResult> {
  return invoke<AgentWriteResult>("agents_create", {
    scope,
    repoRoot: repoRoot ?? null,
    name,
    description,
  });
}

export async function agentsDelete(path: string): Promise<AgentWriteResult> {
  return invoke<AgentWriteResult>("agents_delete", { path });
}

// -- /subagents settings --

/** Set, or with `null` reset, an agent's `/subagents` override. */
export async function agentsSetOverride(
  agentType: string,
  value: SubagentOverride | null,
): Promise<SubagentSettings> {
  return invoke<SubagentSettings>("agents_set_override", { agentType, value });
}

export async function agentsSetDisabled(
  agentType: string,
  disabled: boolean,
): Promise<SubagentSettings> {
  return invoke<SubagentSettings>("agents_set_disabled", { agentType, disabled });
}

// -- Usage --

export async function agentsUsageSummary(
  filter: AgentUsageFilter = {},
): Promise<AgentUsageSummary> {
  return invoke<AgentUsageSummary>("agents_usage_summary", {
    fromDate: filter.fromDate ?? null,
    toDate: filter.toDate ?? null,
    repo: filter.repo ?? null,
  });
}

export async function agentsUsageDetail(
  agentName: string,
  filter: AgentUsageFilter = {},
): Promise<AgentUsageDetail> {
  return invoke<AgentUsageDetail>("agents_usage_detail", {
    agentName,
    fromDate: filter.fromDate ?? null,
    toDate: filter.toDate ?? null,
    repo: filter.repo ?? null,
  });
}
