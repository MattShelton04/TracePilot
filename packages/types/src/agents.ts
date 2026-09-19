// ─── Agents explorer ─────────────────────────────────────────────
// Definitions and settings mirror `tracepilot_orchestrator::agents`;
// usage mirrors `tracepilot_core::analytics::agents`.

/** Where a definition comes from. */
export type AgentScope = "builtin" | "personal" | "project" | "plugin";

/** Built-in `*.agent.yaml`, or `*.agent.md` with YAML frontmatter. */
export type AgentFormat = "yaml" | "markdown";

/**
 * Editable definition fields. `null` means the key is absent; a save only
 * rewrites keys that changed, preserving comments and unknown keys.
 */
export interface AgentFields {
  name: string | null;
  displayName: string | null;
  description: string | null;
  /** Ordered model preferences (a single `model:` string, or fallbacks). */
  models: string[];
  /** `model-policy`, e.g. `required` (never fall back). */
  modelPolicy: string | null;
  reasoningEffort: string | null;
  contextTier: string | null;
  /** `null` = key absent: the agent gets every tool. */
  tools: string[] | null;
  includeCustomInstructions: boolean | null;
  deferredToolLoading: boolean | null;
  disableModelInvocation: boolean | null;
  userInvocable: boolean | null;
  infer: boolean | null;
}

export interface AgentOtherField {
  key: string;
  value: string;
}

export interface AgentDiagnostic {
  path: string;
  message: string;
  severity: "error" | "warning" | "info";
}

export interface AgentDefinitionSummary {
  /** The file path. */
  id: string;
  /** Name the CLI dispatches by (frontmatter `name`, else the file stem). */
  name: string;
  fileStem: string;
  displayName: string | null;
  description: string;
  scope: AgentScope;
  format: AgentFormat;
  path: string;
  sourceLabel: string;
  repoRoot: string | null;
  fields: AgentFields;
  hasMcpServers: boolean;
  readOnlyReason: string | null;
  modifiedAt: string | null;
}

export interface AgentDefinitionDetail {
  summary: AgentDefinitionSummary;
  rawContent: string;
  /** The prompt: Markdown body or the YAML `prompt` value. */
  body: string;
  otherFields: AgentOtherField[];
  mcpServers: unknown | null;
  diagnostics: AgentDiagnostic[];
}

/** `subagents.agents.<agentType>` in settings.json (`/subagents`). */
export interface SubagentOverride {
  /** A model ID or `inherit` (the session model). */
  model: string | null;
  effortLevel: string | null;
  /** `inherit` | `default` | `long_context` */
  contextTier: string | null;
  /** Other keys kept as-is (e.g. `autoInvoke`). */
  otherKeys?: string[];
}

export interface SubagentSettings {
  settingsPath: string;
  overrides: Record<string, SubagentOverride>;
  disabled: string[];
  maxConcurrency: number | null;
  maxDepth: number | null;
  sessionModel: string | null;
  sessionEffort: string | null;
  /** Set when settings.json has an unexpected shape: overrides are read-only. */
  shapeError: string | null;
  raw: unknown | null;
}

export interface AgentCatalog {
  definitions: AgentDefinitionSummary[];
  diagnostics: AgentDiagnostic[];
  settings: SubagentSettings;
  /** CLI version whose built-in definitions were read. */
  cliVersion: string | null;
  personalDir: string;
  repoRoots: string[];
}

export type AgentCreateScope = "personal" | "project";

export interface AgentWriteResult {
  path: string;
  backupPath: string | null;
}

// ─── Usage ───────────────────────────────────────────────────────

/** Percentiles over runs that reported a value; `count` is the denominator. */
export interface MetricDistribution {
  count: number;
  min: number | null;
  p25: number | null;
  p50: number | null;
  p75: number | null;
  p90: number | null;
  max: number | null;
}

export interface AgentLabelCount {
  label: string;
  runs: number;
}

export interface AgentBucketCount {
  value: number;
  runs: number;
}

export interface AgentDayCount {
  date: string;
  runs: number;
}

export interface AgentUsageStats {
  name: string;
  agentType: string | null;
  displayName: string | null;
  description: string | null;
  runs: number;
  sessions: number;
  completed: number;
  failed: number;
  cancelled: number;
  incomplete: number;
  durationMs: MetricDistribution;
  /** Can include descendants: never sum across a hierarchy. */
  totalTokens: MetricDistribution;
  toolCalls: MetricDistribution;
  /** Median duration over the equally long window before the range. */
  previousMedianDurationMs: number | null;
  runsWithCredits: number;
  ownNanoAiu: number | null;
  firstUsed: string | null;
  lastUsed: string | null;
  topModels: AgentLabelCount[];
  mismatchRuns: number;
  runsWithConfiguration: number;
  maxDepth: number;
  peakSiblings: number;
  followUps: number;
  multiTurnRuns: number;
  dailyRuns: AgentDayCount[];
}

export interface AgentSelectionStats {
  name: string;
  displayName: string | null;
  sessions: number;
  lastSelected: string | null;
}

export interface AgentUsageSummary {
  totalRuns: number;
  totalSessions: number;
  failedRuns: number;
  cancelledRuns: number;
  incompleteRuns: number;
  maxDepth: number;
  peakParallelism: number;
  runsWithCredits: number;
  totalOwnNanoAiu: number;
  agents: AgentUsageStats[];
  mainAgentSelections: AgentSelectionStats[];
}

export interface AgentDayOutcomes {
  date: string;
  completed: number;
  failed: number;
  cancelled: number;
  incomplete: number;
}

export interface AgentDispatchCount {
  configuredModel: string | null;
  firstDispatchedModel: string | null;
  actualModel: string | null;
  overrideReason: string | null;
  runs: number;
}

export interface AgentParentCount {
  /** `null` for the main agent. */
  parent: string | null;
  runs: number;
}

export interface AgentFailureReason {
  reason: string;
  example: string;
  runs: number;
  lastSeen: string | null;
}

export type AgentRunOutcome = "completed" | "failed" | "cancelled" | "incomplete";

export interface AgentRunRecord {
  sessionId: string;
  sessionSummary: string | null;
  repository: string | null;
  runKey: string;
  toolCallId: string | null;
  displayName: string | null;
  description: string | null;
  startedAt: string | null;
  outcome: AgentRunOutcome;
  errorText: string | null;
  model: string | null;
  durationMs: number | null;
  totalTokens: number | null;
  totalToolCalls: number | null;
  ownNanoAiu: number | null;
  depth: number;
  parentAgentName: string | null;
  turnIndex: number;
  eventIndex: number | null;
}

export interface AgentUsageDetail {
  stats: AgentUsageStats;
  outcomesByDay: AgentDayOutcomes[];
  dispatch: AgentDispatchCount[];
  invokedBy: AgentParentCount[];
  depths: AgentBucketCount[];
  parallelism: AgentBucketCount[];
  failureReasons: AgentFailureReason[];
  executionModes: AgentLabelCount[];
  repositories: AgentLabelCount[];
  recentRuns: AgentRunRecord[];
}
