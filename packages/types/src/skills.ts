/** Skills management type definitions. */

/** Skill scope — where the skill is stored/active. */
export type SkillScope = "global" | "repository";

/** Parsed SKILL.md frontmatter. */
export interface SkillFrontmatter {
  name: string;
  description: string;
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
  estimatedTokens: number;
  enabled: boolean;
  modifiedAt?: string;
}

/** Summary info for listing skills. */
export interface SkillSummary {
  name: string;
  description: string;
  scope: SkillScope;
  directory: string;
  estimatedTokens: number;
  enabled: boolean;
  hasAssets: boolean;
  assetCount: number;
}

/** An asset file in a skill directory. */
export type SkillAsset = import("./files.js").FileEntry;

/** Token budget summary across all skills. */
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
}

/** Preview information for a skill found within a local directory. */
export interface LocalSkillPreview {
  path: string;
  name: string;
  description: string;
  fileCount: number;
}

/** Result of scanning a single repository for skills. */
export interface RepoSkillsResult {
  repoPath: string;
  repoName: string;
  skills: LocalSkillPreview[];
}
