/**
 * Default TracePilot configuration factory.
 *
 * Provides a single source of truth for the default config structure so that
 * the setup wizard, mock client, and preferences store all derive their
 * defaults from the same place.
 */

import type { TracePilotConfig } from "./config.js";
import { DEFAULT_FAVOURITE_MODELS } from "./models.js";

/** Current config schema version. */
export const CONFIG_VERSION = 5;

/** Default cost per premium request (USD). */
export const DEFAULT_COST_PER_PREMIUM_REQUEST = 0.04;

/** Default CLI command name. */
export const DEFAULT_CLI_COMMAND = "copilot";

/** Default auto-refresh interval in seconds. */
export const DEFAULT_AUTO_REFRESH_INTERVAL_SECONDS = 5;

/** Default content max-width in px. 0 means full width (no cap). */
export const DEFAULT_CONTENT_MAX_WIDTH = 1600;

/** Default UI scale factor. */
export const DEFAULT_UI_SCALE = 1.0;

/** Default orchestrator model (cheap for polling loop). */
export const DEFAULT_ORCHESTRATOR_MODEL = "claude-haiku-4.5";

/** Default subagent model for task execution. */
export const DEFAULT_SUBAGENT_MODEL = "claude-sonnet-4.6";

/** Default poll interval in seconds. */
export const DEFAULT_POLL_INTERVAL_SECONDS = 30;

/** Default max concurrent subagent tasks. */
export const DEFAULT_MAX_CONCURRENT_TASKS = 3;

/** Default heartbeat stale multiplier. */
export const DEFAULT_HEARTBEAT_STALE_MULTIPLIER = 3;

/** Default max orchestrator restart retries. */
export const DEFAULT_MAX_RETRIES = 3;

/** Default context budget in tokens per task. */
export const DEFAULT_CONTEXT_BUDGET_TOKENS = 50_000;

/** Default alert cooldown in seconds. */
export const DEFAULT_ALERT_COOLDOWN_SECONDS = 20;

/**
 * Default feature flag values — single source of truth for TypeScript.
 * MUST match `crates/tracepilot-tauri-bindings/src/config.rs` FeaturesConfig::default().
 */
export const DEFAULT_FEATURES: TracePilotConfig["features"] = {
  exportView: false,
  healthScoring: false,
  sessionReplay: false,
  renderMarkdown: true,
  mcpServers: true,
  skills: true,
  aiTasks: false,
  copilotSdk: false,
};

/**
 * Build a default TracePilotConfig, optionally overriding specific fields.
 *
 * Deep-merges top-level sections so callers can override individual fields
 * without specifying every property:
 *
 * ```ts
 * createDefaultConfig({
 *   paths: { sessionStateDir: '/custom/path', indexDbPath: '/custom/db' },
 *   general: { autoIndexOnLaunch: false },
 * })
 * ```
 */
export function createDefaultConfig(
  overrides?: Partial<{
    paths: Partial<TracePilotConfig["paths"]>;
    general: Partial<TracePilotConfig["general"]>;
    ui: Partial<TracePilotConfig["ui"]>;
    pricing: Partial<TracePilotConfig["pricing"]>;
    toolRendering: Partial<TracePilotConfig["toolRendering"]>;
    features: Partial<TracePilotConfig["features"]>;
    logging: Partial<TracePilotConfig["logging"]>;
    tasks: Partial<TracePilotConfig["tasks"]>;
    alerts: Partial<TracePilotConfig["alerts"]>;
  }>,
): TracePilotConfig {
  return {
    version: CONFIG_VERSION,
    paths: {
      sessionStateDir: "",
      indexDbPath: "",
      ...overrides?.paths,
    },
    general: {
      autoIndexOnLaunch: true,
      cliCommand: DEFAULT_CLI_COMMAND,
      setupComplete: false,
      ...overrides?.general,
    },
    ui: {
      theme: "dark",
      hideEmptySessions: true,
      autoRefreshEnabled: false,
      autoRefreshIntervalSeconds: DEFAULT_AUTO_REFRESH_INTERVAL_SECONDS,
      checkForUpdates: true,
      favouriteModels: [...DEFAULT_FAVOURITE_MODELS],
      recentRepoPaths: [],
      contentMaxWidth: DEFAULT_CONTENT_MAX_WIDTH,
      uiScale: DEFAULT_UI_SCALE,
      ...overrides?.ui,
    },
    pricing: {
      costPerPremiumRequest: DEFAULT_COST_PER_PREMIUM_REQUEST,
      ...overrides?.pricing,
      models: overrides?.pricing?.models ?? [],
    },
    toolRendering: {
      enabled: true,
      toolOverrides: {},
      ...overrides?.toolRendering,
    },
    features: {
      ...DEFAULT_FEATURES,
      ...overrides?.features,
    },
    logging: {
      level: "info",
      ...overrides?.logging,
    },
    tasks: {
      enabled: false,
      orchestratorModel: DEFAULT_ORCHESTRATOR_MODEL,
      defaultSubagentModel: DEFAULT_SUBAGENT_MODEL,
      pollIntervalSeconds: DEFAULT_POLL_INTERVAL_SECONDS,
      maxConcurrentTasks: DEFAULT_MAX_CONCURRENT_TASKS,
      heartbeatStaleMultiplier: DEFAULT_HEARTBEAT_STALE_MULTIPLIER,
      maxRetries: DEFAULT_MAX_RETRIES,
      autoStartOrchestrator: false,
      contextBudgetTokens: DEFAULT_CONTEXT_BUDGET_TOKENS,
      ...overrides?.tasks,
    },
    alerts: {
      enabled: false,
      scope: "monitored" as const,
      nativeNotifications: true,
      taskbarFlash: true,
      soundEnabled: false,
      onSessionEnd: true,
      onAskUser: true,
      onSessionError: false,
      cooldownSeconds: DEFAULT_ALERT_COOLDOWN_SECONDS,
      ...overrides?.alerts,
    },
  };
}
