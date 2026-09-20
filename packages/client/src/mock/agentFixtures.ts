import type {
  AgentCatalog,
  AgentDefinitionSummary,
  AgentFields,
  AgentUsageStats,
  SubagentSettings,
} from "@tracepilot/types";

export function agentFields(overrides: Partial<AgentFields> = {}): AgentFields {
  return {
    name: null,
    displayName: null,
    description: null,
    models: [],
    modelPolicy: null,
    reasoningEffort: null,
    contextTier: null,
    tools: null,
    includeCustomInstructions: null,
    deferredToolLoading: null,
    disableModelInvocation: null,
    userInvocable: null,
    infer: null,
    ...overrides,
  };
}

export function agentDefinition(
  name: string,
  overrides: Partial<AgentDefinitionSummary> = {},
): AgentDefinitionSummary {
  return {
    id: `/defs/${name}.agent.md`,
    name,
    fileStem: name,
    displayName: null,
    description: `${name} agent`,
    scope: "personal",
    format: "markdown",
    path: `/defs/${name}.agent.md`,
    sourceLabel: "Personal",
    repoRoot: null,
    fields: agentFields({ name }),
    hasMcpServers: false,
    readOnlyReason: null,
    modifiedAt: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

export function agentUsage(
  name: string,
  overrides: Partial<AgentUsageStats> = {},
): AgentUsageStats {
  const dist = { count: 0, min: null, p25: null, p50: null, p75: null, p90: null, max: null };
  return {
    name,
    agentType: name,
    displayName: null,
    description: null,
    runs: 10,
    sessions: 3,
    completed: 10,
    failed: 0,
    cancelled: 0,
    incomplete: 0,
    durationMs: { ...dist },
    totalTokens: { ...dist },
    toolCalls: { ...dist },
    previousMedianDurationMs: null,
    runsWithCredits: 0,
    ownNanoAiu: null,
    firstUsed: "2026-09-01T00:00:00Z",
    lastUsed: "2026-09-18T00:00:00Z",
    topModels: [],
    mismatchRuns: 0,
    runsWithConfiguration: 0,
    maxDepth: 0,
    peakSiblings: 1,
    followUps: 0,
    multiTurnRuns: 0,
    dailyRuns: [],
    ...overrides,
  };
}

export function agentSettings(overrides: Partial<SubagentSettings> = {}): SubagentSettings {
  return {
    settingsPath: "/home/.copilot/settings.json",
    overrides: {},
    disabled: [],
    maxConcurrency: null,
    maxDepth: null,
    sessionModel: "gpt-5.6-luna",
    sessionEffort: "high",
    shapeError: null,
    raw: null,
    ...overrides,
  };
}

export function agentCatalog(
  definitions: AgentDefinitionSummary[],
  settingsOverrides: Partial<SubagentSettings> = {},
): AgentCatalog {
  return {
    definitions,
    diagnostics: [],
    settings: agentSettings(settingsOverrides),
    cliVersion: "1.0.79",
    personalDir: "/home/.copilot/agents",
    repoRoots: [],
  };
}
