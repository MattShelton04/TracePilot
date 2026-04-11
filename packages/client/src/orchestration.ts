// ─── Orchestration Client Functions ───────────────────────────────
// Client wrappers for all orchestration Tauri commands with mock fallbacks.

import type {
  AgentDefinition,
  BackupDiffPreview,
  BackupEntry,
  ConfigDiff,
  CopilotConfig,
  CopilotVersion,
  CreateWorktreeRequest,
  LaunchConfig,
  LaunchedSession,
  MigrationDiff,
  ModelInfo,
  PruneResult,
  RegisteredRepo,
  SessionTemplate,
  SystemDependencies,
  WorktreeDetails,
  WorktreeInfo,
} from "@tracepilot/types";

import { createInvoke } from "./invoke.js";

const invoke = createInvoke("Orchestration", getMockData);

// ─── System ───────────────────────────────────────────────────────

export async function checkSystemDeps(): Promise<SystemDependencies> {
  return invoke<SystemDependencies>("check_system_deps");
}

// ─── Worktree Commands ────────────────────────────────────────────

export async function listWorktrees(repoPath: string): Promise<WorktreeInfo[]> {
  return invoke<WorktreeInfo[]>("list_worktrees", { repoPath });
}

export async function createWorktree(request: CreateWorktreeRequest): Promise<WorktreeInfo> {
  return invoke<WorktreeInfo>("create_worktree", { request });
}

export async function removeWorktree(
  repoPath: string,
  worktreePath: string,
  force: boolean,
): Promise<void> {
  return invoke<void>("remove_worktree", { repoPath, worktreePath, force });
}

export async function pruneWorktrees(repoPath: string): Promise<PruneResult> {
  return invoke<PruneResult>("prune_worktrees", { repoPath });
}

export async function listBranches(repoPath: string): Promise<string[]> {
  return invoke<string[]>("list_branches", { repoPath });
}

export async function getWorktreeDiskUsage(path: string): Promise<number> {
  return invoke<number>("get_worktree_disk_usage", { path });
}

export async function isGitRepo(path: string): Promise<boolean> {
  return invoke<boolean>("is_git_repo", { path });
}

export async function lockWorktree(
  repoPath: string,
  worktreePath: string,
  reason?: string,
): Promise<void> {
  return invoke<void>("lock_worktree", { repoPath, worktreePath, reason: reason ?? null });
}

export async function unlockWorktree(repoPath: string, worktreePath: string): Promise<void> {
  return invoke<void>("unlock_worktree", { repoPath, worktreePath });
}

export async function getWorktreeDetails(worktreePath: string): Promise<WorktreeDetails> {
  return invoke<WorktreeDetails>("get_worktree_details", { worktreePath });
}

export async function getDefaultBranch(repoPath: string): Promise<string> {
  return invoke<string>("get_default_branch", { repoPath });
}

export async function fetchRemote(repoPath: string, branch?: string): Promise<string> {
  return invoke<string>("fetch_remote", { repoPath, branch: branch ?? null });
}

// ─── Repository Registry Commands ─────────────────────────────────

export async function listRegisteredRepos(): Promise<RegisteredRepo[]> {
  return invoke<RegisteredRepo[]>("list_registered_repos");
}

export async function addRegisteredRepo(path: string): Promise<RegisteredRepo> {
  return invoke<RegisteredRepo>("add_registered_repo", { path });
}

export async function removeRegisteredRepo(path: string): Promise<void> {
  return invoke<void>("remove_registered_repo", { path });
}

export async function toggleRepoFavourite(path: string): Promise<boolean> {
  return invoke<boolean>("toggle_repo_favourite", { path });
}

export async function discoverReposFromSessions(): Promise<RegisteredRepo[]> {
  return invoke<RegisteredRepo[]>("discover_repos_from_sessions");
}

// ─── Launcher Commands ────────────────────────────────────────────

export async function launchSession(config: LaunchConfig): Promise<LaunchedSession> {
  return invoke<LaunchedSession>("launch_session", { config });
}

export async function getAvailableModels(): Promise<ModelInfo[]> {
  return invoke<ModelInfo[]>("get_available_models");
}

export async function openInExplorer(path: string): Promise<void> {
  return invoke<void>("open_in_explorer", { path });
}

export async function openInTerminal(path: string): Promise<void> {
  return invoke<void>("open_in_terminal", { path });
}

// ─── Config Injector Commands ─────────────────────────────────────

export async function getAgentDefinitions(version?: string): Promise<AgentDefinition[]> {
  return invoke<AgentDefinition[]>("get_agent_definitions", { version: version ?? null });
}

export async function saveAgentDefinition(filePath: string, yamlContent: string): Promise<void> {
  return invoke<void>("save_agent_definition", { filePath, yamlContent });
}

export async function getCopilotConfig(): Promise<CopilotConfig> {
  return invoke<CopilotConfig>("get_copilot_config");
}

export async function saveCopilotConfig(config: Record<string, unknown>): Promise<void> {
  return invoke<void>("save_copilot_config", { config });
}

export async function createConfigBackup(filePath: string, label: string): Promise<BackupEntry> {
  return invoke<BackupEntry>("create_config_backup", { filePath, label });
}

export async function listConfigBackups(): Promise<BackupEntry[]> {
  return invoke<BackupEntry[]>("list_config_backups");
}

export async function restoreConfigBackup(backupPath: string, restoreTo: string): Promise<void> {
  return invoke<void>("restore_config_backup", { backupPath, restoreTo });
}

export async function deleteConfigBackup(backupPath: string): Promise<void> {
  return invoke<void>("delete_config_backup", { backupPath });
}

export async function previewBackupRestore(
  backupPath: string,
  sourcePath: string,
): Promise<BackupDiffPreview> {
  return invoke<BackupDiffPreview>("preview_backup_restore", { backupPath, sourcePath });
}

export async function diffConfigFiles(oldPath: string, newPath: string): Promise<ConfigDiff> {
  return invoke<ConfigDiff>("diff_config_files", { oldPath, newPath });
}

// ─── Version Manager Commands ─────────────────────────────────────

export async function discoverCopilotVersions(): Promise<CopilotVersion[]> {
  return invoke<CopilotVersion[]>("discover_copilot_versions");
}

export async function getActiveCopilotVersion(): Promise<CopilotVersion> {
  return invoke<CopilotVersion>("get_active_copilot_version");
}

export async function getMigrationDiffs(
  fromVersion: string,
  toVersion: string,
): Promise<MigrationDiff[]> {
  return invoke<MigrationDiff[]>("get_migration_diffs", { fromVersion, toVersion });
}

export async function migrateAgentDefinition(
  fileName: string,
  fromVersion: string,
  toVersion: string,
): Promise<void> {
  return invoke<void>("migrate_agent_definition", { fileName, fromVersion, toVersion });
}

// ─── Template Commands ────────────────────────────────────────────

export async function listSessionTemplates(): Promise<SessionTemplate[]> {
  return invoke<SessionTemplate[]>("list_session_templates");
}

export async function saveSessionTemplate(template: SessionTemplate): Promise<void> {
  return invoke<void>("save_session_template", { template });
}

export async function deleteSessionTemplate(id: string): Promise<void> {
  return invoke<void>("delete_session_template", { id });
}

export async function restoreDefaultTemplates(): Promise<void> {
  return invoke<void>("restore_default_templates");
}

export async function incrementTemplateUsage(id: string): Promise<void> {
  return invoke<void>("increment_template_usage", { id });
}

// ─── Mock Data ────────────────────────────────────────────────────
//
// Mocks live in `./mock/orchestration.ts`.  When adding a new command,
// register the TypeScript wrapper above AND add a mock entry there.

// Lazy-load mocks to avoid pulling them into production builds.
let mocksModule: typeof import("./mock/orchestration.js") | undefined;

async function getMockData<T>(cmd: string, _args?: Record<string, unknown>): Promise<T> {
  if (!mocksModule) {
    mocksModule = await import("./mock/orchestration.js");
  }
  const mocks = mocksModule.ORCHESTRATION_MOCK_DATA;
  return (mocks[cmd] ?? null) as T;
}
