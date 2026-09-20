/**
 * Cross-session skill usage, mirroring `tracepilot_core::analytics::skills`.
 *
 * Two token figures appear here and mean different things:
 * - **listing cost** — the frontmatter an enabled skill adds to every turn
 *   whether or not it is ever used. It comes from the installed
 *   `SkillSummary`, not from usage.
 * - **injected cost** — what one invocation actually put into the context.
 *   That is `medianContentTokens`.
 *
 * Fields the CLI only started recording in later versions carry their own
 * denominator. Anything it did not record is reported as unknown; it is never
 * folded into one of the known buckets.
 */

export interface SkillLabelCount {
  label: string;
  uses: number;
}

export interface SkillDayCount {
  date: string;
  uses: number;
}

/**
 * One directory a skill was loaded from, with how often.
 *
 * A single name can resolve to several directories — the same project skill
 * in more than one clone, or a personal copy shadowing a project one — so the
 * directory, not the name, is what identifies an installed skill.
 */
export interface SkillPathCount {
  /** The path as last recorded, for display. */
  path: string;
  /** Case-folded directory with `/` separators, for matching. */
  directory: string;
  uses: number;
}

/** Aggregate usage for one skill name (case-insensitive). */
export interface SkillUsageStats {
  /** Most recently seen spelling of the name. */
  name: string;
  normalizedName: string;
  /**
   * Latest description the CLI recorded, which is all a skill that is no
   * longer installed has.
   */
  description: string | null;
  uses: number;
  sessions: number;
  repositories: number;
  firstUsed: string | null;
  lastUsed: string | null;
  /** Before CLI 1.0.49 no trigger was recorded, so it counts as unknown. */
  userInvoked: number;
  agentInvoked: number;
  unknownTrigger: number;
  mainAgentUses: number;
  subagentUses: number;
  /**
   * Invocations known only from a `skill` tool call, with no event behind
   * them: no path, fingerprint or token estimate.
   */
  fallbackUses: number;
  /** Median tokens one invocation injected, over `usesWithContent`. */
  medianContentTokens: number | null;
  usesWithContent: number;
  /** Fingerprint of the most recently invoked content, for drift. */
  latestContentSha256: string | null;
  /** More than one means the skill changed while it was in use. */
  contentVersions: number;
  paths: SkillPathCount[];
  topModels: SkillLabelCount[];
  topRepositories: SkillLabelCount[];
  dailyUses: SkillDayCount[];
  pluginName: string | null;
  /** `event.source` as last recorded, e.g. `project`, `personal-copilot`. */
  source: string | null;
}

export interface SkillUsageSummary {
  totalUses: number;
  /** Sessions in range that recorded at least one skill invocation. */
  totalSessions: number;
  unknownTriggerUses: number;
  fallbackUses: number;
  skills: SkillUsageStats[];
}

export type SkillInvocationOrigin = "event" | "tool_call_fallback";

/** One invocation, for the Recent uses list and its deep link. */
export interface SkillInvocationRecord {
  sessionId: string;
  sessionSummary: string | null;
  repository: string | null;
  turnIndex: number;
  eventIndex: number;
  timestamp: string | null;
  skillName: string;
  path: string | null;
  trigger: string | null;
  /** `null` for the main agent. */
  agentName: string | null;
  model: string | null;
  contentTokens: number | null;
  contentSha256: string | null;
  origin: SkillInvocationOrigin;
}

export interface SkillUsageDetail {
  stats: SkillUsageStats;
  /** Main agent vs. each subagent that invoked it. */
  invokedBy: SkillLabelCount[];
  models: SkillLabelCount[];
  repositories: SkillLabelCount[];
  recentInvocations: SkillInvocationRecord[];
}
