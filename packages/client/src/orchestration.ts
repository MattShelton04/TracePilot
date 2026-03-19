// ─── Orchestration Client Functions ───────────────────────────────
// Client wrappers for all orchestration Tauri commands with mock fallbacks.

import type {
  AgentDefinition,
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
  SessionTemplate,
  SystemDependencies,
  WorktreeInfo,
} from '@tracepilot/types';

function isTauri(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}

async function invoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  if (isTauri()) {
    const { invoke: tauriInvoke } = await import('@tauri-apps/api/core');
    return tauriInvoke<T>(`plugin:tracepilot|${cmd}`, args);
  }
  console.warn(`[TracePilot] Not in Tauri — returning mock data for "${cmd}"`);
  return getMockData<T>(cmd);
}

// ─── System ───────────────────────────────────────────────────────

export async function checkSystemDeps(): Promise<SystemDependencies> {
  return invoke<SystemDependencies>('check_system_deps');
}

// ─── Worktree Commands ────────────────────────────────────────────

export async function listWorktrees(repoPath: string): Promise<WorktreeInfo[]> {
  return invoke<WorktreeInfo[]>('list_worktrees', { repoPath });
}

export async function createWorktree(request: CreateWorktreeRequest): Promise<WorktreeInfo> {
  return invoke<WorktreeInfo>('create_worktree', { request });
}

export async function removeWorktree(
  repoPath: string,
  worktreePath: string,
  force: boolean,
): Promise<void> {
  return invoke<void>('remove_worktree', { repoPath, worktreePath, force });
}

export async function pruneWorktrees(repoPath: string): Promise<PruneResult> {
  return invoke<PruneResult>('prune_worktrees', { repoPath });
}

export async function listBranches(repoPath: string): Promise<string[]> {
  return invoke<string[]>('list_branches', { repoPath });
}

export async function getWorktreeDiskUsage(path: string): Promise<number> {
  return invoke<number>('get_worktree_disk_usage', { path });
}

// ─── Launcher Commands ────────────────────────────────────────────

export async function launchSession(config: LaunchConfig): Promise<LaunchedSession> {
  return invoke<LaunchedSession>('launch_session', { config });
}

export async function getAvailableModels(): Promise<ModelInfo[]> {
  return invoke<ModelInfo[]>('get_available_models');
}

// ─── Config Injector Commands ─────────────────────────────────────

export async function getAgentDefinitions(version?: string): Promise<AgentDefinition[]> {
  return invoke<AgentDefinition[]>('get_agent_definitions', { version: version ?? null });
}

export async function saveAgentDefinition(filePath: string, yamlContent: string): Promise<void> {
  return invoke<void>('save_agent_definition', { filePath, yamlContent });
}

export async function getCopilotConfig(): Promise<CopilotConfig> {
  return invoke<CopilotConfig>('get_copilot_config');
}

export async function saveCopilotConfig(config: Record<string, unknown>): Promise<void> {
  return invoke<void>('save_copilot_config', { config });
}

export async function createConfigBackup(filePath: string, label: string): Promise<BackupEntry> {
  return invoke<BackupEntry>('create_config_backup', { filePath, label });
}

export async function listConfigBackups(): Promise<BackupEntry[]> {
  return invoke<BackupEntry[]>('list_config_backups');
}

export async function restoreConfigBackup(backupPath: string, restoreTo: string): Promise<void> {
  return invoke<void>('restore_config_backup', { backupPath, restoreTo });
}

export async function diffConfigFiles(oldPath: string, newPath: string): Promise<ConfigDiff> {
  return invoke<ConfigDiff>('diff_config_files', { oldPath, newPath });
}

// ─── Version Manager Commands ─────────────────────────────────────

export async function discoverCopilotVersions(): Promise<CopilotVersion[]> {
  return invoke<CopilotVersion[]>('discover_copilot_versions');
}

export async function getActiveCopilotVersion(): Promise<CopilotVersion> {
  return invoke<CopilotVersion>('get_active_copilot_version');
}

export async function getMigrationDiffs(
  fromVersion: string,
  toVersion: string,
): Promise<MigrationDiff[]> {
  return invoke<MigrationDiff[]>('get_migration_diffs', { fromVersion, toVersion });
}

export async function migrateAgentDefinition(
  fileName: string,
  fromVersion: string,
  toVersion: string,
): Promise<void> {
  return invoke<void>('migrate_agent_definition', { fileName, fromVersion, toVersion });
}

// ─── Template Commands ────────────────────────────────────────────

export async function listSessionTemplates(): Promise<SessionTemplate[]> {
  return invoke<SessionTemplate[]>('list_session_templates');
}

export async function saveSessionTemplate(template: SessionTemplate): Promise<void> {
  return invoke<void>('save_session_template', { template });
}

export async function deleteSessionTemplate(id: string): Promise<void> {
  return invoke<void>('delete_session_template', { id });
}

// ─── Mock Data ────────────────────────────────────────────────────

function getMockData<T>(cmd: string): T {
  const mocks: Record<string, unknown> = {
    check_system_deps: {
      gitAvailable: true,
      gitVersion: 'git version 2.45.0',
      copilotAvailable: true,
      copilotVersion: '1.0.9',
      copilotHomeExists: true,
    } satisfies SystemDependencies,

    list_worktrees: [
      {
        path: 'C:\\git\\MyProject',
        branch: 'main',
        headCommit: 'abc1234',
        isMainWorktree: true,
        isBare: false,
        diskUsageBytes: 52428800,
        status: 'active',
        createdAt: '2025-01-15T10:00:00Z',
      },
      {
        path: 'C:\\git\\MyProject-feature-auth',
        branch: 'feature/auth',
        headCommit: 'def5678',
        isMainWorktree: false,
        isBare: false,
        diskUsageBytes: 1048576,
        status: 'active',
        linkedSessionId: 'session-abc-123',
        createdAt: '2025-01-16T14:30:00Z',
      },
    ] satisfies WorktreeInfo[],

    create_worktree: {
      path: 'C:\\git\\MyProject-new-branch',
      branch: 'feature/new',
      headCommit: 'aaa1111',
      isMainWorktree: false,
      isBare: false,
      status: 'active',
      createdAt: new Date().toISOString(),
    } satisfies WorktreeInfo,

    prune_worktrees: { prunedCount: 0, messages: [] } satisfies PruneResult,

    list_branches: ['main', 'develop', 'feature/auth', 'feature/ui', 'fix/bug-123'],

    get_worktree_disk_usage: 52428800,

    launch_session: {
      pid: 12345,
      command: 'copilot --model claude-opus-4.6',
      launchedAt: new Date().toISOString(),
    } satisfies LaunchedSession,

    get_available_models: [
      { id: 'claude-sonnet-4.6', name: 'Claude Sonnet 4.6', tier: 'standard' },
      { id: 'claude-opus-4.6', name: 'Claude Opus 4.6', tier: 'premium' },
      { id: 'gpt-5.4', name: 'GPT-5.4', tier: 'standard' },
      { id: 'claude-haiku-4.5', name: 'Claude Haiku 4.5', tier: 'fast/cheap' },
    ] satisfies ModelInfo[],

    get_agent_definitions: [
      {
        name: 'task',
        filePath: 'C:\\Users\\mattt\\.copilot\\pkg\\universal\\1.0.9\\definitions\\task.agent.yaml',
        model: 'claude-sonnet-4',
        description: 'Agent for executing commands',
        tools: ['bash', 'grep', 'glob', 'view', 'edit', 'create'],
        promptExcerpt: 'Agent for executing commands with verbose output...',
        rawYaml: 'name: task\nmodel: claude-sonnet-4\n',
      },
      {
        name: 'explore',
        filePath:
          'C:\\Users\\mattt\\.copilot\\pkg\\universal\\1.0.9\\definitions\\explore.agent.yaml',
        model: 'claude-haiku-4.5',
        description: 'Fast agent for exploring codebases',
        tools: ['grep', 'glob', 'view', 'bash'],
        promptExcerpt: 'Fast agent specialized for exploring codebases...',
        rawYaml: 'name: explore\nmodel: claude-haiku-4.5\n',
      },
    ] satisfies AgentDefinition[],

    get_copilot_config: {
      model: 'claude-sonnet-4.6',
      reasoningEffort: undefined,
      trustedFolders: ['C:\\git'],
      raw: { model: 'claude-sonnet-4.6', trustedFolders: ['C:\\git'] },
    } satisfies CopilotConfig,

    list_config_backups: [
      {
        id: 'bk-1',
        label: 'pre-inject-2025-01-15',
        sourcePath: 'C:\\Users\\mattt\\.copilot\\config.json',
        backupPath: 'C:\\Users\\mattt\\.copilot\\tracepilot\\backups\\config.json-pre-inject',
        createdAt: '2025-01-15T10:00:00Z',
        sizeBytes: 256,
      },
    ] satisfies BackupEntry[],

    discover_copilot_versions: [
      {
        version: '1.0.9',
        path: 'C:\\Users\\mattt\\.copilot\\pkg\\universal\\1.0.9',
        isActive: true,
        isComplete: true,
        modifiedAt: '2025-01-16T00:00:00Z',
        hasCustomizations: false,
        lockCount: 1,
      },
      {
        version: '1.0.8',
        path: 'C:\\Users\\mattt\\.copilot\\pkg\\universal\\1.0.8',
        isActive: false,
        isComplete: true,
        modifiedAt: '2025-01-10T00:00:00Z',
        hasCustomizations: true,
        lockCount: 0,
      },
    ] satisfies CopilotVersion[],

    get_active_copilot_version: {
      version: '1.0.9',
      path: 'C:\\Users\\mattt\\.copilot\\pkg\\universal\\1.0.9',
      isActive: true,
      isComplete: true,
      modifiedAt: '2025-01-16T00:00:00Z',
      hasCustomizations: false,
      lockCount: 1,
    } satisfies CopilotVersion,

    get_migration_diffs: [] satisfies MigrationDiff[],

    list_session_templates: [
      {
        id: 'default-bugfix',
        name: 'Bug Fix',
        description: 'Quick bug fix session',
        category: 'Development',
        config: {
          repoPath: '',
          headless: false,
          envVars: {},
          createWorktree: true,
          autoApprove: true,
          model: 'claude-sonnet-4.6',
          branch: 'fix/',
        },
        tags: ['bugfix', 'quick'],
        createdAt: '2025-01-01T00:00:00Z',
        usageCount: 12,
      },
      {
        id: 'default-feature',
        name: 'Feature Dev',
        description: 'Full feature development',
        category: 'Development',
        config: {
          repoPath: '',
          headless: false,
          envVars: {},
          createWorktree: true,
          autoApprove: false,
          model: 'claude-opus-4.6',
          branch: 'feature/',
        },
        tags: ['feature', 'premium'],
        createdAt: '2025-01-01T00:00:00Z',
        usageCount: 5,
      },
    ] satisfies SessionTemplate[],

    // Write operations return void
    remove_worktree: undefined,
    save_agent_definition: undefined,
    save_copilot_config: undefined,
    create_config_backup: {
      id: 'bk-new',
      label: 'manual-backup',
      sourcePath: '',
      backupPath: '',
      createdAt: new Date().toISOString(),
      sizeBytes: 256,
    } satisfies BackupEntry,
    restore_config_backup: undefined,
    diff_config_files: { fileName: 'test.yaml', diffText: '', hasChanges: false } satisfies ConfigDiff,
    migrate_agent_definition: undefined,
    save_session_template: undefined,
    delete_session_template: undefined,
  };

  return (mocks[cmd] ?? null) as T;
}
