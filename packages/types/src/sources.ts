// ─── Session Sources ──────────────────────────────────────────────
// Which tool wrote a session, and what TracePilot can do with it. Mirrors
// `SessionSource` and `SourceCapabilities` in
// `crates/tracepilot-core/src/provider/types.rs`; replace these with the
// generated types once an IPC command carries them.

/** Which tool wrote a session. */
export type SessionSource = "copilot" | "claudeCode";

/** Every source, in display order. */
export const SESSION_SOURCES: readonly SessionSource[] = ["copilot", "claudeCode"];

/** The source the backend assumes when a DTO predates the `source` field. */
export const DEFAULT_SESSION_SOURCE: SessionSource = "copilot";

/** What a source supports. Gates tabs, actions and cost KPIs. */
export interface SourceCapabilities {
  canResume: boolean;
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
}

const SOURCE_CAPABILITIES: Record<SessionSource, SourceCapabilities> = {
  copilot: {
    canResume: true,
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
  },
  claudeCode: {
    canResume: false,
    canLaunch: false,
    canSteer: false,
    hasAic: false,
    hasPremiumRequests: false,
    hasContextBreakdown: false,
    hasTodos: false,
    hasCheckpoints: false,
    hasPlan: false,
    hasExplorer: false,
    hasHiddenRoles: false,
    hasBackgroundTasks: true,
  },
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

/** Display name for a source; also the main agent's label in a conversation. */
export function sourceLabel(source: SessionSource | null | undefined): string {
  return SOURCE_LABELS[resolveSessionSource(source)];
}

/** True for sessions that are not from Copilot, which get a source badge. */
export function isNonCopilotSource(source: SessionSource | null | undefined): boolean {
  return resolveSessionSource(source) !== "copilot";
}
