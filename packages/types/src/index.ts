// ── analytics.js ───────────────────────────────────────────────────
export type {
  AnalyticsData,
  ApiDurationStats,
  CacheStats,
  CodeImpactData,
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
  DEFAULT_COST_PER_PREMIUM_REQUEST,
  DEFAULT_FEATURES,
  DEFAULT_UI_SCALE,
} from "./defaults.js";
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
// ── export.js ──────────────────────────────────────────────────────
export {
  ALL_SECTION_IDS,
  SECTION_LABELS,
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
export type { ModelDefinition, ModelTier } from "./models.js";
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
// ── paths.js ────────────────────────────────────────────────────────
export {
  COPILOT_HOME_PLACEHOLDER,
  COPILOT_SESSION_STATE_DIR_PLACEHOLDER,
  DEFAULT_GH_COMMAND,
  DEFAULT_GIT_COMMAND,
  deriveIndexDbPath,
  deriveSessionStateDir,
  TRACEPILOT_BACKUPS_PLACEHOLDER,
  TRACEPILOT_HOME_PLACEHOLDER,
  TRACEPILOT_INDEX_DB_PLACEHOLDER,
} from "./paths.js";
export type {
  CostBreakdownStatus,
  PricingComparisonBreakdown,
  PricingKind,
  PricingLookupOptions,
  PricingProvider,
  PricingRateMode,
  PricingRegistryEntry,
  PricingStatus,
  PricingUnit,
  TokenCostBreakdown,
  TokenRateSet,
  TokenUsageForCost,
} from "./pricing.js";
// ── pricing.js ──────────────────────────────────────────────────────
export {
  AI_CREDIT_USD,
  calculateMetricsTokenCost,
  calculateObservedAiuCost,
  calculatePricingComparison,
  calculateTokenCost,
  GITHUB_ANNUAL_LEGACY_MULTIPLIERS,
  GITHUB_COPILOT_USAGE_PRICING,
  GITHUB_USAGE_BILLING_EFFECTIVE_FROM,
  modelPriceEntriesToPricingRegistry,
  modelPriceEntryToPricingEntry,
  NANO_AIU_PER_AI_CREDIT,
  normalizeModelName,
  PRICING_REGISTRY,
  PRICING_REGISTRY_VERSION,
  PROVIDER_WHOLESALE_PRICING,
  resolvePricingEntry,
  sumTokenCosts,
} from "./pricing.js";

// ── replay.js ──────────────────────────────────────────────────────
export type { ReplayState, ReplayStep } from "./replay.js";

// ── sdk.js ─────────────────────────────────────────────────────────
export type {
  BridgeAuthStatus,
  BridgeConnectConfig,
  BridgeConnectionState,
  BridgeEvent,
  BridgeHydrationSnapshot,
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
  PendingRequestSummary,
  SessionLiveState,
  SessionRuntimeStatus,
  ToolProgressSummary,
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
  ModelMetricDetail,
  SessionDbColumn,
  SessionDbIndex,
  SessionDbTable,
  SessionDetail,
  SessionFileEntry,
  SessionFileType,
  SessionIncident,
  SessionListItem,
  SessionPlan,
  SessionSegment,
  ShutdownMetrics,
  TodoDep,
  TodoItem,
  TodoStatus,
  TodosResponse,
} from "./session.js";
export type {
  AssistantMessagePayload,
  NarrowedSessionEventPayload,
  SubagentCompletedPayload,
  SubagentFailedPayload,
  SubagentStartedPayload,
  ToolExecutionStartPayload,
  UnknownSessionEventPayload,
} from "./session-event-payloads.js";
// ── session-event-payloads.js ──────────────────────────────────────
export { narrowSessionEvent } from "./session-event-payloads.js";
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
export type { ToolArgs } from "./tool-args.js";
// ── tool-args.js ───────────────────────────────────────────────────
export { getToolArgs, toolArgString } from "./tool-args.js";
export type { RichRenderableToolName, ToolRenderingPreferences } from "./tool-rendering.js";
// ── tool-rendering.js ──────────────────────────────────────────────
export { DEFAULT_TOOL_RENDERING_PREFS } from "./tool-rendering.js";

// ── utils/formatters.js ────────────────────────────────────────────
export {
  formatBytes,
  formatCleanFloat,
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
