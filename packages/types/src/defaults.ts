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
export const CONFIG_VERSION = 8;

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

/** Default alert cooldown in seconds. */
export const DEFAULT_ALERT_COOLDOWN_SECONDS = 20;

/**
 * Default feature flag values — single source of truth for TypeScript.
 * MUST match `crates/tracepilot-tauri-bindings/src/config.rs` FeaturesConfig::default().
 */
export const DEFAULT_FEATURES: TracePilotConfig["features"] = {
  exportView: true,
  sessionReplay: false,
  renderMarkdown: true,
  mcpServers: true,
  skills: true,
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
    alerts: Partial<TracePilotConfig["alerts"]>;
  }>,
): TracePilotConfig {
  return {
    version: CONFIG_VERSION,
    paths: {
      copilotHome: "",
      tracepilotHome: "",
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
