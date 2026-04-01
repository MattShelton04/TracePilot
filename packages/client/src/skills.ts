/** Skills client IPC wrappers. */

import type {
  GhAuthInfo,
  GitHubSkillPreview,
  LocalSkillPreview,
  RepoSkillsResult,
  Skill,
  SkillAsset,
  SkillFrontmatter,
  SkillImportResult,
  SkillSummary,
} from "@tracepilot/types";
import { invokePlugin, isTauri } from "./invoke.js";

async function invoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  if (isTauri()) {
    return invokePlugin<T>(cmd, args);
  }
  console.warn(`[TracePilot] Not in Tauri — no mock for Skills "${cmd}"`);
  throw new Error(`No mock data for Skills command: ${cmd}`);
}

// -- Discovery --

export async function skillsListAll(repoRoot?: string): Promise<SkillSummary[]> {
  return invoke<SkillSummary[]>("skills_list_all", {
    repoRoot: repoRoot ?? null,
  });
}

export async function skillsGetSkill(skillDir: string): Promise<Skill> {
  return invoke<Skill>("skills_get_skill", { skillDir });
}

// -- CRUD --

export async function skillsCreate(
  name: string,
  description: string,
  body: string,
): Promise<string> {
  return invoke<string>("skills_create", { name, description, body });
}

export async function skillsUpdate(
  skillDir: string,
  frontmatter: SkillFrontmatter,
  body: string,
): Promise<void> {
  return invoke<void>("skills_update", { skillDir, frontmatter, body });
}

export async function skillsUpdateRaw(skillDir: string, rawContent: string): Promise<void> {
  return invoke<void>("skills_update_raw", { skillDir, rawContent });
}

export async function skillsDelete(skillDir: string): Promise<void> {
  return invoke<void>("skills_delete", { skillDir });
}

export async function skillsRename(skillDir: string, newName: string): Promise<string> {
  return invoke<string>("skills_rename", { skillDir, newName });
}

export async function skillsDuplicate(skillDir: string, newName: string): Promise<string> {
  return invoke<string>("skills_duplicate", { skillDir, newName });
}

// -- Assets --

export async function skillsListAssets(skillDir: string): Promise<SkillAsset[]> {
  return invoke<SkillAsset[]>("skills_list_assets", { skillDir });
}

export async function skillsAddAsset(
  skillDir: string,
  assetName: string,
  content: number[],
): Promise<void> {
  return invoke<void>("skills_add_asset", { skillDir, assetName, content });
}

export async function skillsCopyAssetFrom(
  skillDir: string,
  assetName: string,
  sourcePath: string,
): Promise<void> {
  return invoke<void>("skills_copy_asset_from", {
    skillDir,
    assetName,
    sourcePath,
  });
}

export async function skillsRemoveAsset(skillDir: string, assetName: string): Promise<void> {
  return invoke<void>("skills_remove_asset", { skillDir, assetName });
}

export async function skillsReadAsset(skillDir: string, assetName: string): Promise<string> {
  return invoke<string>("skills_read_asset", { skillDir, assetName });
}

// -- Import --

export async function skillsImportLocal(
  sourceDir: string,
  scope?: string,
  repoRoot?: string,
): Promise<SkillImportResult> {
  return invoke<SkillImportResult>("skills_import_local", {
    sourceDir,
    scope: scope ?? null,
    repoRoot: repoRoot ?? null,
  });
}

export async function skillsImportFile(
  filePath: string,
  scope?: string,
  repoRoot?: string,
): Promise<SkillImportResult> {
  return invoke<SkillImportResult>("skills_import_file", {
    filePath,
    scope: scope ?? null,
    repoRoot: repoRoot ?? null,
  });
}

export async function skillsImportGitHub(
  owner: string,
  repo: string,
  skillPath?: string,
  gitRef?: string,
  scope?: string,
  repoRoot?: string,
): Promise<SkillImportResult> {
  return invoke<SkillImportResult>("skills_import_github", {
    owner,
    repo,
    skillPath: skillPath ?? null,
    gitRef: gitRef ?? null,
    scope: scope ?? null,
    repoRoot: repoRoot ?? null,
  });
}

// -- GitHub auth --

export async function skillsGhAuthStatus(): Promise<GhAuthInfo> {
  return invoke<GhAuthInfo>("skills_gh_auth_status");
}

// -- GitHub discovery --

export async function skillsDiscoverGitHub(
  owner: string,
  repo: string,
  path?: string,
  gitRef?: string,
): Promise<GitHubSkillPreview[]> {
  return invoke<GitHubSkillPreview[]>("skills_discover_github", {
    owner,
    repo,
    path: path ?? null,
    gitRef: gitRef ?? null,
  });
}

export async function skillsImportGitHubSkill(
  owner: string,
  repo: string,
  skillPath: string,
  gitRef?: string,
  scope?: string,
  repoRoot?: string,
): Promise<SkillImportResult> {
  return invoke<SkillImportResult>("skills_import_github_skill", {
    owner,
    repo,
    skillPath,
    gitRef: gitRef ?? null,
    scope: scope ?? null,
    repoRoot: repoRoot ?? null,
  });
}

export async function skillsDiscoverLocal(dir: string): Promise<LocalSkillPreview[]> {
  return invoke<LocalSkillPreview[]>("skills_discover_local", { dir });
}

export async function skillsDiscoverRepos(repos: [string, string][]): Promise<RepoSkillsResult[]> {
  return invoke<RepoSkillsResult[]>("skills_discover_repos", { repos });
}
