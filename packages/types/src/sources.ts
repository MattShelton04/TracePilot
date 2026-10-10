// ─── Session Sources ──────────────────────────────────────────────
// Which tool wrote a session, and what TracePilot can do with it. Mirrors
// `SessionSource` and `SourceCapabilities` in
// `crates/tracepilot-core/src/provider/types.rs`; replace these with the
// generated types once an IPC command carries them.

import { DEFAULT_CLAUDE_CLI_COMMAND, DEFAULT_CLI_COMMAND } from "./defaults.js";

/** Which tool wrote a session. */
export type SessionSource = "copilot" | "claudeCode";

/** Every source, in display order. */
export const SESSION_SOURCES: readonly SessionSource[] = ["copilot", "claudeCode"];

/** The source the backend assumes when a DTO predates the `source` field. */
export const DEFAULT_SESSION_SOURCE: SessionSource = "copilot";

/** What a source supports. Gates tabs, actions and cost KPIs. */
export interface SourceCapabilities {
  /**
   * TracePilot drives the source's CLI against the session (exact context
   * capture). Implies {@link canResumeInTerminal}.
   */
  canResume: boolean;
  /**
   * The session can be resumed in a new terminal (Resume in Terminal). The
   * user can also copy the command; see {@link resumeCommand}.
   */
  canResumeInTerminal: boolean;
  canLaunch: boolean;
  canSteer: boolean;
  hasAic: boolean;
  hasPremiumRequests: boolean;
  hasContextBreakdown: boolean;
  hasTodos: boolean;
  hasCheckpoints: boolean;
  hasPlan: boolean;
  hasExplorer: boolean;
  hasHiddenRoles: boolean;
  /** The source records background subagents and shells. */
  hasBackgroundTasks: boolean;
  /** The source backs up files before changing them (read-only rewind points). */
  hasFileHistory: boolean;
}

const SOURCE_CAPABILITIES: Record<SessionSource, SourceCapabilities> = {
  copilot: {
    canResume: true,
    canResumeInTerminal: true,
    canLaunch: true,
    canSteer: true,
    hasAic: true,
    hasPremiumRequests: true,
    hasContextBreakdown: true,
    hasTodos: true,
    hasCheckpoints: true,
    hasPlan: true,
    hasExplorer: true,
    hasHiddenRoles: false,
    hasBackgroundTasks: false,
    hasFileHistory: false,
  },
  claudeCode: {
    canResume: false,
    canResumeInTerminal: true,
    canLaunch: false,
    canSteer: false,
    hasAic: false,
    hasPremiumRequests: false,
    hasContextBreakdown: false,
    hasTodos: false,
    hasCheckpoints: false,
    hasPlan: true,
    hasExplorer: true,
    hasHiddenRoles: false,
    hasBackgroundTasks: true,
    hasFileHistory: true,
  },
};

/**
 * How a user resumes a source's session in their own terminal, as
 * `<cli> --resume <id>`, with the CLI used when none is configured. A `null`
 * entry means the source has no such command. Mirrors the Rust resume launch
 * for display; the backend builds the command it runs itself.
 */
const RESUME_CLI: Record<SessionSource, { defaultCli: string } | null> = {
  copilot: { defaultCli: DEFAULT_CLI_COMMAND },
  claudeCode: { defaultCli: DEFAULT_CLAUDE_CLI_COMMAND },
};

const SOURCE_LABELS: Record<SessionSource, string> = {
  copilot: "Copilot",
  claudeCode: "Claude Code",
};

/** The session's source, treating a missing field as Copilot. */
export function resolveSessionSource(source: SessionSource | null | undefined): SessionSource {
  return source ?? DEFAULT_SESSION_SOURCE;
}

/** Static capabilities for a source. A missing source means Copilot. */
export function sourceCapabilities(source: SessionSource | null | undefined): SourceCapabilities {
  return SOURCE_CAPABILITIES[resolveSessionSource(source)];
}

/**
 * The command a user copies to resume a session in their own terminal, or
 * `null` when the source has none. `configuredCli` holds each source's CLI
 * command setting; a missing or blank one uses the source's default.
 */
export function resumeCommand(
  source: SessionSource | null | undefined,
  sessionId: string,
  configuredCli: Partial<Record<SessionSource, string>>,
): string | null {
  const resolved = resolveSessionSource(source);
  const cli = RESUME_CLI[resolved];
  if (!cli) return null;
  return `${configuredCli[resolved]?.trim() || cli.defaultCli} --resume ${sessionId}`;
}

/** Display name for a source; also the main agent's label in a conversation. */
export function sourceLabel(source: SessionSource | null | undefined): string {
  return SOURCE_LABELS[resolveSessionSource(source)];
}

/** True for sessions that are not from Copilot, which get a source badge. */
export function isNonCopilotSource(source: SessionSource | null | undefined): boolean {
  return resolveSessionSource(source) !== "copilot";
}

/** What a running session's process is doing. Mirrors `RunStatus`. */
export type RunStatus = "busy" | "waiting";

/** Whether a live process owns a session. Mirrors `Liveness`. */
export type SessionLiveness =
  | { state: "running"; pid: number | null; status: RunStatus | null }
  | { state: "idle" }
  | { state: "unknown" };

/**
 * The running badge for a source that reports what its process is doing.
 * `null` when it does not, so callers keep their generic badge.
 */
export function runStatusBadge(
  status: RunStatus | null | undefined,
  source: SessionSource | null | undefined,
): { label: string; title: string } | null {
  if (status === "busy") return { label: "Busy", title: `${sourceLabel(source)} is working` };
  if (status === "waiting") {
    return { label: "Waiting", title: `${sourceLabel(source)} is waiting for input` };
  }
  return null;
}
