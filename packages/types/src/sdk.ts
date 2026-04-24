/**
 * Copilot SDK bridge types.
 *
 * Mirrors the Rust `bridge::*` types defined in
 * `crates/tracepilot-orchestrator/src/bridge/mod.rs`.
 */

// ─── Connection State ─────────────────────────────────────────────

export type BridgeConnectionState = "disconnected" | "connecting" | "connected" | "error";

// ─── Session Mode ─────────────────────────────────────────────────

export type BridgeSessionMode = "interactive" | "plan" | "autopilot";

// ─── Event Types ──────────────────────────────────────────────────

export interface BridgeEvent {
  sessionId: string;
  eventType: string;
  timestamp: string;
  id: string | null;
  parentId: string | null;
  ephemeral: boolean;
  data: unknown;
}

// ─── Status / Info Types ──────────────────────────────────────────

export interface BridgeStatus {
  state: BridgeConnectionState;
  /** Always `true` — the Copilot SDK is now compiled into every build (ADR-0007). Retained for wire-format stability. */
  sdkAvailable: boolean;
  /** Mirrors the runtime `FeaturesConfig.copilot_sdk` preference. When `false`, bridge start paths refuse with `DisabledByPreference`. */
  enabledByPreference: boolean;
  cliVersion: string | null;
  protocolVersion: number | null;
  activeSessions: number;
  error: string | null;
  /** "stdio" when SDK spawns a private subprocess, "tcp" when connected to --ui-server. */
  connectionMode: string | null;
}

export interface BridgeAuthStatus {
  isAuthenticated: boolean;
  authType: string | null;
  host: string | null;
  login: string | null;
  statusMessage: string | null;
}

export interface BridgeQuotaSnapshot {
  quotaType: string;
  limit: number | null;
  used: number | null;
  remaining: number | null;
  resetsAt: string | null;
}

export interface BridgeQuota {
  quotas: BridgeQuotaSnapshot[];
}

/**
 * Point-in-time broadcast-channel counters from the orchestrator bridge.
 *
 * All values are cumulative (monotonic) for the lifetime of the bridge
 * manager — diff two snapshots to derive rates. Wire-format is camelCase
 * (serde `rename_all = "camelCase"`).
 */
export interface BridgeMetricsSnapshot {
  eventsForwarded: number;
  eventsDroppedDueToLag: number;
  lagOccurrences: number;
}

export interface BridgeSessionInfo {
  sessionId: string;
  model: string | null;
  workingDirectory: string | null;
  mode: BridgeSessionMode | null;
  isActive: boolean;
  /** If the SDK could not resume this session, the reason is stored here. */
  resumeError: string | null;
  /** Whether the session was flagged as "remote" by the CLI. */
  isRemote: boolean;
}

export interface BridgeModelInfo {
  id: string;
  name: string | null;
}

// ─── Configuration ────────────────────────────────────────────────

export interface BridgeConnectConfig {
  cliUrl?: string;
  cwd?: string;
  logLevel?: string;
  githubToken?: string;
}

export interface BridgeSessionConfig {
  model?: string;
  workingDirectory?: string;
  systemMessage?: string;
  reasoningEffort?: string;
  agent?: string;
}

export interface BridgeMessagePayload {
  prompt: string;
  mode?: string;
}

// ─── UI Server Detection ──────────────────────────────────────────

/** A detected `copilot --ui-server` process with its listening address. */
export interface DetectedUiServer {
  pid: number;
  port: number;
  /** e.g. "127.0.0.1:60381" — ready to use as `cliUrl`. */
  address: string;
}
