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
  };
  logging: {
    level: string;
  };
}

/** Result from validating a session directory */
export interface ValidateSessionDirResult {
  valid: boolean;
  sessionCount: number;
  error?: string;
}

// ─── Update & Git Types ───────────────────────────────────────────

/** Result from checking for a newer TracePilot release. */
export interface UpdateCheckResult {
  currentVersion: string;
  latestVersion: string | null;
  hasUpdate: boolean;
  releaseUrl: string | null;
  publishedAt: string | null;
}

/** Git metadata for the running TracePilot instance. */
export interface GitInfo {
  commitHash: string | null;
  branch: string | null;
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
