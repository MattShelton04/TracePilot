/** Skills management type definitions. */

/** Skill scope — where the skill is stored/active. */
export type SkillScope = "global" | "repository" | "builtin";
export type SkillDisabledReason = "user" | "repository";

/** Parsed SKILL.md frontmatter. */
export interface SkillFrontmatter {
  name: string;
  description: string;
  /** Hint shown for arguments accepted by an explicitly invoked skill. */
  "argument-hint"?: string;
  /** Tools the skill may use, in Copilot's supported expression format. */
  "allowed-tools"?: string | string[];
  /** Whether the user may explicitly invoke the skill. Defaults to true. */
  "user-invocable"?: boolean;
  /** Prevent automatic model invocation while retaining explicit invocation. */
  "disable-model-invocation"?: boolean;
  resource_globs?: string[];
  auto_attach?: boolean;
}

/** Complete skill data (frontmatter + body + metadata). */
export interface Skill {
  frontmatter: SkillFrontmatter;
  body: string;
  rawContent: string;
  scope: SkillScope;
  directory: string;
  /** Estimated tokens for frontmatter loaded during skill discovery. */
  frontmatterTokens: number;
  /** Estimated tokens for instructions loaded when the skill is invoked. */
  instructionTokens: number;
  enabled: boolean;
  disabledReason?: SkillDisabledReason;
  modifiedAt?: string;
}

/** Summary info for listing skills. */
export interface SkillSummary {
  name: string;
  description: string;
  scope: SkillScope;
  directory: string;
  frontmatterTokens: number;
  instructionTokens: number;
  enabled: boolean;
  disabledReason?: SkillDisabledReason;
  hasAssets: boolean;
  assetCount: number;
}

export interface SkillDiagnostic {
  path: string;
  message: string;
  severity: "warning" | "error";
}

export interface SkillDiscoveryResult {
  skills: SkillSummary[];
  diagnostics: SkillDiagnostic[];
}

/** Project skill encountered in recent CLI sessions. */
export interface EncounteredSkillSummary {
  name: string;
  description: string;
  directory: string;
  frontmatterTokens: number;
  instructionTokens: number;
  sourcePath: string;
  invocationCount: number;
}

/** An asset file in a skill directory. */
export type SkillAsset = import("./files.js").FileEntry;

/** Frontmatter token budget summary across all skills. */
export interface SkillTokenBudget {
  totalSkills: number;
  enabledSkills: number;
  totalTokens: number;
  enabledTokens: number;
  skills: SkillTokenEntry[];
}

/** Per-skill token entry. */
export interface SkillTokenEntry {
  name: string;
  tokens: number;
  enabled: boolean;
}

/** Result of a skill import operation. */
export interface SkillImportResult {
  skillName: string;
  destination: string;
  warnings: string[];
  filesCopied: number;
}

export interface SkillImportItemResult {
  source: string;
  result?: SkillImportResult;
  error?: string;
}

export interface SkillBatchImportResult {
  items: SkillImportItemResult[];
  succeeded: number;
  failed: number;
  filesCopied: number;
  warnings: string[];
}

/** GitHub auth status info. */
export interface GhAuthInfo {
  authenticated: boolean;
  username?: string;
}

/** Preview information for a skill found in a GitHub repository. */
export interface GitHubSkillPreview {
  path: string;
  name: string;
  description: string;
  fileCount: number;
  valid?: boolean;
  diagnostic?: string;
}

/** Preview information for a skill found within a local directory. */
export interface LocalSkillPreview {
  path: string;
  name: string;
  description: string;
  fileCount: number;
  valid?: boolean;
  diagnostic?: string;
}

/** Result of scanning a single repository for skills. */
export interface RepoSkillsResult {
  repoPath: string;
  repoName: string;
  skills: LocalSkillPreview[];
}
