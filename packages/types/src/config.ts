// ─── Configuration Types ──────────────────────────────────────────
// Application configuration shape (persisted in config.toml), model
// pricing entries, session directory validation, update checks, git
// metadata, and release manifest entries.
//
// Note: default values for these types live in `defaults.ts`.

/** Per-model wholesale pricing entry */
export interface ModelPriceEntry {
  model: string;
  inputPerM: number;
  cachedInputPerM: number;
  outputPerM: number;
  /** Premium request multiplier (e.g. 1x, 3x, 0.33x). 0 = free tier. */
  premiumRequests: number;
}

/** TracePilot application configuration — persisted in config.toml */
export interface TracePilotConfig {
  version: number;
  paths: {
    sessionStateDir: string;
    indexDbPath: string;
  };
  general: {
    autoIndexOnLaunch: boolean;
    cliCommand: string;
    /** True once the first full indexing run completes. If false, setup restarts. */
    setupComplete: boolean;
  };
  ui: {
    theme: string;
    hideEmptySessions: boolean;
    autoRefreshEnabled: boolean;
    autoRefreshIntervalSeconds: number;
    checkForUpdates: boolean;
    favouriteModels: string[];
    recentRepoPaths: string[];
    /** Max width for page content area in px. 0 = full width (no cap). Default: 1200. */
    contentMaxWidth: number;
    /** Global UI scale factor (0.8 – 1.3). Default: 1.0. */
    uiScale: number;
  };
  pricing: {
    costPerPremiumRequest: number;
    models: ModelPriceEntry[];
  };
  toolRendering: {
    enabled: boolean;
    toolOverrides: Record<string, boolean>;
  };
  features: {
    exportView: boolean;
    healthScoring: boolean;
    sessionReplay: boolean;
    renderMarkdown: boolean;
    mcpServers: boolean;
    skills: boolean;
    aiTasks: boolean;
    copilotSdk: boolean;
  };
  logging: {
    level: string;
  };
  tasks: {
    /** Whether the AI task system is enabled. */
    enabled: boolean;
    /** Model used for the orchestrator session (polling root agent). */
    orchestratorModel: string;
    /** Default model for subagent task execution. */
    defaultSubagentModel: string;
    /** How often the orchestrator polls for new tasks (seconds). */
    pollIntervalSeconds: number;
    /** Maximum number of concurrent subagent tasks. */
    maxConcurrentTasks: number;
    /** Multiplier for poll interval to detect stale heartbeats. */
    heartbeatStaleMultiplier: number;
    /** Max consecutive crash restarts before circuit-breaking. */
    maxRetries: number;
    /** Whether to auto-start the orchestrator on app launch. */
    autoStartOrchestrator: boolean;
    /** Approximate token budget for context assembly per task. */
    contextBudgetTokens: number;
  };
  alerts: {
    /** Master switch for the alerting system. */
    enabled: boolean;
    /** Which sessions to monitor: 'monitored' = open tabs/views only, 'all' = all running. */
    scope: "monitored" | "all";
    /** Show native OS toast notifications. */
    nativeNotifications: boolean;
    /** Flash the taskbar icon when an alert fires. */
    taskbarFlash: boolean;
    /** Play a sound when an alert fires. */
    soundEnabled: boolean;
    /** Alert when a session agent finishes (completes or errors out). */
    onSessionEnd: boolean;
    /** Alert when a session prompts the user via ask_user. */
    onAskUser: boolean;
    /** Alert when a session encounters an error. */
    onSessionError: boolean;
    /** Minimum seconds between alerts for the same session to prevent spam. */
    cooldownSeconds: number;
  };
}

/** A single entry in the release manifest used by the What's New modal. */
export interface ReleaseManifestEntry {
  version: string;
  date: string;
  notes: {
    added: string[];
    changed: string[];
    fixed: string[];
  };
  requiresReindex?: boolean;
}
