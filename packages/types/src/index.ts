// ── analytics.js ───────────────────────────────────────────────────
export type {
  AnalyticsData,
  ApiDurationStats,
  CacheStats,
  CodeImpactData,
  HealthDistribution,
  HealthScoringData,
  ProductivityMetrics,
  ToolAnalysisData,
  ToolUsageEntry,
} from "./analytics.js";

// ── config.js ──────────────────────────────────────────────────────
export type {
  ModelPriceEntry,
  ReleaseManifestEntry,
  TracePilotConfig,
} from "./config.js";

// ── conversation.js ────────────────────────────────────────────────
export type {
  AttributedMessage,
  ConversationTurn,
  EventsResponse,
  FreshnessResponse,
  SessionEvent,
  SessionEventSeverity,
  TurnSessionEvent,
  TurnsResponse,
  TurnToolCall,
} from "./conversation.js";

// ── defaults.js ────────────────────────────────────────────────────
export {
  CONFIG_VERSION,
  createDefaultConfig,
  DEFAULT_ALERT_COOLDOWN_SECONDS,
  DEFAULT_AUTO_REFRESH_INTERVAL_SECONDS,
  DEFAULT_CLI_COMMAND,
  DEFAULT_CONTENT_MAX_WIDTH,
  DEFAULT_CONTEXT_BUDGET_TOKENS,
  DEFAULT_COST_PER_PREMIUM_REQUEST,
  DEFAULT_FEATURES,
  DEFAULT_HEARTBEAT_STALE_MULTIPLIER,
  DEFAULT_MAX_CONCURRENT_TASKS,
  DEFAULT_MAX_RETRIES,
  DEFAULT_ORCHESTRATOR_MODEL,
  DEFAULT_POLL_INTERVAL_SECONDS,
  DEFAULT_SUBAGENT_MODEL,
  DEFAULT_UI_SCALE,
} from "./defaults.js";

// ── export.js ──────────────────────────────────────────────────────
export {
  ALL_SECTION_IDS,
  SECTION_LABELS,
} from "./export.js";
export type {
  ComparisonResult,
  ConflictStrategy,
  ContentDetailOptions,
  ExportConfig,
  ExportFormat,
  ExportPreviewRequest,
  ExportPreviewResult,
  ExportResult,
  ImportConfig,
  ImportIssue,
  ImportPreviewResult,
  ImportResult,
  ImportSessionPreview,
  RedactionOptions,
  SectionId,
  SessionSectionsInfo,
} from "./export.js";

// ── files.js ───────────────────────────────────────────────────────
export type { FileEntry } from "./files.js";

// ── known-events.js ────────────────────────────────────────────────
export { TRACEPILOT_KNOWN_EVENTS, type TracePilotKnownEvent } from "./known-events.js";

// ── mcp.js ─────────────────────────────────────────────────────────
export type {
  McpConfigDiff,
  McpDiffAction,
  McpDiffChangeType,
  McpDiffEntry,
  McpDiffSelection,
  McpHealthResult,
  McpHealthResultCached,
  McpHealthStatus,
  McpImportResult,
  McpServerConfig,
  McpServerDetail,
  McpSummary,
  McpTool,
  McpTransport,
} from "./mcp.js";

// ── models.js ──────────────────────────────────────────────────────
export {
  DEFAULT_FAVOURITE_MODELS,
  DEFAULT_MODEL_ID,
  DEFAULT_PREMIUM_MODEL_ID,
  getAllModelIds,
  getDefaultWholesalePrices,
  getModelById,
  getModelsByTier,
  getModelTier,
  getTierLabel,
  MODEL_REGISTRY,
} from "./models.js";
export type { ModelDefinition, ModelTier } from "./models.js";

// ── orchestration.js ───────────────────────────────────────────────
export type {
  ActiveSessionInfo,
  AgentDefinition,
  BackupDiffPreview,
  BackupEntry,
  ConfigDiff,
  CopilotConfig,
  CopilotVersion,
  CreateWorktreeRequest,
  LaunchConfig,
  LaunchedSession,
  MigrationDiff,
  ModelInfo,
  PruneResult,
  RegisteredRepo,
  SessionTemplate,
  SystemDependencies,
  WorktreeDetails,
  WorktreeInfo,
} from "./orchestration.js";

// ── replay.js ──────────────────────────────────────────────────────
export type { ReplayState, ReplayStep } from "./replay.js";

// ── sdk.js ─────────────────────────────────────────────────────────
export type {
  BridgeAuthStatus,
  BridgeConnectConfig,
  BridgeConnectionState,
  BridgeEvent,
  BridgeMessagePayload,
  BridgeMetricsSnapshot,
  BridgeModelInfo,
  BridgeQuota,
  BridgeQuotaSnapshot,
  BridgeSessionConfig,
  BridgeSessionInfo,
  BridgeSessionMode,
  BridgeStatus,
  DetectedUiServer,
} from "./sdk.js";

// ── search.js ──────────────────────────────────────────────────────
export type {
  ContextSnippet,
  FtsHealthInfo,
  IndexingProgressPayload,
  SearchContentType,
  SearchFacetsResponse,
  SearchFilters,
  SearchIndexingProgress,
  SearchResult,
  SearchResultsResponse,
  SearchStatsResponse,
} from "./search.js";

// ── session.js ─────────────────────────────────────────────────────
export type {
  CheckpointEntry,
  CodeChanges,
  HealthFlag,
  ModelMetricDetail,
  SessionDbTable,
  SessionDetail,
  SessionFileEntry,
  SessionFileType,
  SessionHealth,
  SessionIncident,
  SessionListItem,
  SessionPlan,
  SessionSegment,
  ShutdownMetrics,
  TodoDep,
  TodoItem,
  TodosResponse,
  TodoStatus,
} from "./session.js";

// ── skills.js ──────────────────────────────────────────────────────
export type {
  GhAuthInfo,
  GitHubSkillPreview,
  LocalSkillPreview,
  RepoSkillsResult,
  Skill,
  SkillAsset,
  SkillFrontmatter,
  SkillImportResult,
  SkillScope,
  SkillSummary,
  SkillTokenBudget,
  SkillTokenEntry,
} from "./skills.js";

// ── tasks.js ───────────────────────────────────────────────────────
export {
  DEFAULT_ORCHESTRATOR_CONFIG,
  isTerminalStatus,
  TERMINAL_TASK_STATUSES,
} from "./tasks.js";
export type {
  AttributionSnapshot,
  ContextFormat,
  ContextSource,
  ContextSourceType,
  HealthCheckResult,
  Job,
  JobStatus,
  NewTask,
  OrchestratorEvent,
  OrchestratorHandle,
  OrchestratorHealth,
  OrchestratorState,
  OrchestratorStatus,
  OrchestratorTaskConfig,
  OutputFormat,
  PresetContext,
  PresetExecution,
  PresetOutput,
  PresetPrompt,
  PromptVariable,
  SubagentStatus,
  Task,
  TaskCompletedEvent,
  TaskFilter,
  TaskPreset,
  TaskResult,
  TaskStats,
  TaskStatus,
  TaskSubagentEvent,
  TrackedSubagent,
  ValidationMode,
  VariableType,
} from "./tasks.js";

// ── tool-args.js ───────────────────────────────────────────────────
export { getToolArgs, toolArgString } from "./tool-args.js";
export type { ToolArgs } from "./tool-args.js";

// ── tool-rendering.js ──────────────────────────────────────────────
export { DEFAULT_TOOL_RENDERING_PREFS } from "./tool-rendering.js";
export type { RichRenderableToolName, ToolRenderingPreferences } from "./tool-rendering.js";

// ── utils/formatters.js ────────────────────────────────────────────
export {
  formatBytes,
  formatClockTime,
  formatCost,
  formatDate,
  formatDateMedium,
  formatDateShort,
  formatDuration,
  formatLiveDuration,
  formatNumber,
  formatNumberFull,
  formatPercent,
  formatRate,
  formatRelativeTime,
  formatShortDate,
  formatTime,
  formatTokens,
  toErrorMessage,
  truncateText,
} from "./utils/formatters.js";
