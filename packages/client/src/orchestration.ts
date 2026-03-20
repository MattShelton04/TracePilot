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
  RegisteredRepo,
  SessionTemplate,
  SystemDependencies,
  WorktreeDetails,
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

export async function isGitRepo(path: string): Promise<boolean> {
  return invoke<boolean>('is_git_repo', { path });
}

export async function lockWorktree(
  repoPath: string,
  worktreePath: string,
  reason?: string,
): Promise<void> {
  return invoke<void>('lock_worktree', { repoPath, worktreePath, reason: reason ?? null });
}

export async function unlockWorktree(repoPath: string, worktreePath: string): Promise<void> {
  return invoke<void>('unlock_worktree', { repoPath, worktreePath });
}

export async function getWorktreeDetails(worktreePath: string): Promise<WorktreeDetails> {
  return invoke<WorktreeDetails>('get_worktree_details', { worktreePath });
}

export async function getDefaultBranch(repoPath: string): Promise<string> {
  return invoke<string>('get_default_branch', { repoPath });
}

export async function fetchRemote(repoPath: string, branch?: string): Promise<string> {
  return invoke<string>('fetch_remote', { repoPath, branch: branch ?? null });
}

// ─── Repository Registry Commands ─────────────────────────────────

export async function listRegisteredRepos(): Promise<RegisteredRepo[]> {
  return invoke<RegisteredRepo[]>('list_registered_repos');
}

export async function addRegisteredRepo(path: string): Promise<RegisteredRepo> {
  return invoke<RegisteredRepo>('add_registered_repo', { path });
}

export async function removeRegisteredRepo(path: string): Promise<void> {
  return invoke<void>('remove_registered_repo', { path });
}

export async function discoverReposFromSessions(): Promise<RegisteredRepo[]> {
  return invoke<RegisteredRepo[]>('discover_repos_from_sessions');
}

// ─── Launcher Commands ────────────────────────────────────────────

export async function launchSession(config: LaunchConfig): Promise<LaunchedSession> {
  return invoke<LaunchedSession>('launch_session', { config });
}

export async function getAvailableModels(): Promise<ModelInfo[]> {
  return invoke<ModelInfo[]>('get_available_models');
}

export async function openInExplorer(path: string): Promise<void> {
  return invoke<void>('open_in_explorer', { path });
}

export async function openInTerminal(path: string): Promise<void> {
  return invoke<void>('open_in_terminal', { path });
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
      gitVersion: '2.45.0',
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
        diskUsageBytes: 524288000,
        status: 'active',
        isLocked: false,
        createdAt: '2025-01-10T10:00:00Z',
        repoRoot: 'C:\\git\\MyProject',
      },
      {
        path: 'C:\\git\\MyProject-feature-auth',
        branch: 'feature/auth',
        headCommit: 'def5678',
        isMainWorktree: false,
        isBare: false,
        diskUsageBytes: 104857600,
        status: 'active',
        isLocked: false,
        linkedSessionId: 'session-abc-123',
        createdAt: '2025-01-16T14:30:00Z',
        repoRoot: 'C:\\git\\MyProject',
      },
      {
        path: 'C:\\git\\MyProject-feature-ui',
        branch: 'feature/ui-redesign',
        headCommit: 'bbb2222',
        isMainWorktree: false,
        isBare: false,
        diskUsageBytes: 89128960,
        status: 'active',
        isLocked: true,
        lockedReason: 'In use by CI pipeline',
        linkedSessionId: 'session-def-456',
        createdAt: '2025-01-17T09:15:00Z',
        repoRoot: 'C:\\git\\MyProject',
      },
      {
        path: 'C:\\git\\MyProject-fix-bug-123',
        branch: 'fix/bug-123',
        headCommit: 'ccc3333',
        isMainWorktree: false,
        isBare: false,
        diskUsageBytes: 52428800,
        status: 'stale',
        isLocked: false,
        createdAt: '2025-01-12T16:45:00Z',
        repoRoot: 'C:\\git\\MyProject',
      },
      {
        path: 'C:\\git\\MyProject-hotfix-perf',
        branch: 'hotfix/perf',
        headCommit: 'ddd4444',
        isMainWorktree: false,
        isBare: false,
        diskUsageBytes: 41943040,
        status: 'stale',
        isLocked: false,
        createdAt: '2025-01-11T11:00:00Z',
        repoRoot: 'C:\\git\\MyProject',
      },
      {
        path: 'C:\\git\\MyProject-test-e2e',
        branch: 'test/e2e-suite',
        headCommit: 'fff6666',
        isMainWorktree: false,
        isBare: false,
        diskUsageBytes: 31457280,
        status: 'active',
        isLocked: false,
        createdAt: '2025-01-18T13:00:00Z',
        repoRoot: 'C:\\git\\MyProject',
      },
    ] satisfies WorktreeInfo[],

    create_worktree: {
      path: 'C:\\git\\MyProject-new-branch',
      branch: 'feature/new',
      headCommit: 'aaa1111',
      isMainWorktree: false,
      isBare: false,
      status: 'active',
      isLocked: false,
      createdAt: new Date().toISOString(),
      repoRoot: 'C:\\git\\MyProject',
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

    open_in_explorer: undefined,
    open_in_terminal: undefined,
    get_default_branch: 'main',
    fetch_remote: '',

    get_agent_definitions: [
      {
        name: 'explore',
        filePath: 'C:\\Users\\mattt\\.copilot\\pkg\\universal\\1.0.9\\definitions\\explore.agent.yaml',
        model: 'claude-haiku-4.5',
        description: 'Fast agent specialized for exploring codebases and answering questions about code.',
        tools: ['grep', 'glob', 'view', 'bash'],
        promptExcerpt: 'Fast agent specialized for exploring codebases...',
        rawYaml: 'name: explore\nmodel: claude-haiku-4.5\ndescription: Fast agent specialized for exploring codebases\n',
      },
      {
        name: 'task',
        filePath: 'C:\\Users\\mattt\\.copilot\\pkg\\universal\\1.0.9\\definitions\\task.agent.yaml',
        model: 'claude-haiku-4.5',
        description: 'Agent for executing commands with verbose output (tests, builds, lints).',
        tools: ['bash', 'grep', 'glob', 'view', 'edit', 'create'],
        promptExcerpt: 'Agent for executing commands with verbose output...',
        rawYaml: 'name: task\nmodel: claude-haiku-4.5\ndescription: Agent for executing commands\n',
      },
      {
        name: 'code-review',
        filePath: 'C:\\Users\\mattt\\.copilot\\pkg\\universal\\1.0.9\\definitions\\code-review.agent.yaml',
        model: 'claude-sonnet-4.6',
        description: 'Agent for reviewing code changes with extremely high signal-to-noise ratio.',
        tools: ['bash', 'grep', 'glob', 'view'],
        promptExcerpt: 'Agent for reviewing code changes...',
        rawYaml: 'name: code-review\nmodel: claude-sonnet-4.6\ndescription: Agent for reviewing code changes\n',
      },
      {
        name: 'research',
        filePath: 'C:\\Users\\mattt\\.copilot\\pkg\\universal\\1.0.9\\definitions\\research.agent.yaml',
        model: 'claude-sonnet-4.6',
        description: 'Deep research agent for complex multi-step analysis and investigation.',
        tools: ['bash', 'grep', 'glob', 'view', 'web_search', 'web_fetch'],
        promptExcerpt: 'Deep research agent for complex multi-step analysis...',
        rawYaml: 'name: research\nmodel: claude-sonnet-4.6\ndescription: Deep research agent\n',
      },
      {
        name: 'configure-copilot',
        filePath: 'C:\\Users\\mattt\\.copilot\\pkg\\universal\\1.0.9\\definitions\\configure-copilot.agent.yaml',
        model: 'claude-sonnet-4.6',
        description: 'System agent for configuring Copilot CLI settings and preferences.',
        tools: ['bash', 'view', 'edit'],
        promptExcerpt: 'System agent for configuring Copilot CLI...',
        rawYaml: 'name: configure-copilot\nmodel: claude-sonnet-4.6\ndescription: System configuration agent\n',
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
        name: '🐛 Bug Fix',
        description: 'Quick bug fix session with auto-approve',
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
        name: '🚀 Feature Build',
        description: 'Full feature development with premium model',
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
        usageCount: 8,
      },
      {
        id: 'default-review',
        name: '🔍 Code Review',
        description: 'Thorough code review and analysis',
        category: 'Quality',
        config: {
          repoPath: '',
          headless: false,
          envVars: {},
          createWorktree: false,
          autoApprove: false,
          model: 'claude-sonnet-4.6',
        },
        tags: ['review', 'quality'],
        createdAt: '2025-01-01T00:00:00Z',
        usageCount: 15,
      },
      {
        id: 'default-refactor',
        name: '♻️ Refactor',
        description: 'Code refactoring and cleanup',
        category: 'Development',
        config: {
          repoPath: '',
          headless: false,
          envVars: {},
          createWorktree: true,
          autoApprove: false,
          model: 'claude-sonnet-4.6',
        },
        tags: ['refactor', 'cleanup'],
        createdAt: '2025-01-01T00:00:00Z',
        usageCount: 6,
      },
      {
        id: 'default-test',
        name: '🧪 Test Writing',
        description: 'Generate comprehensive test coverage',
        category: 'Quality',
        config: {
          repoPath: '',
          headless: false,
          envVars: {},
          createWorktree: true,
          autoApprove: true,
          model: 'claude-sonnet-4.6',
        },
        tags: ['testing', 'coverage'],
        createdAt: '2025-01-01T00:00:00Z',
        usageCount: 10,
      },
      {
        id: 'default-docs',
        name: '📝 Documentation',
        description: 'Documentation generation and updates',
        category: 'Documentation',
        config: {
          repoPath: '',
          headless: false,
          envVars: {},
          createWorktree: false,
          autoApprove: true,
          model: 'claude-haiku-4.5',
        },
        tags: ['docs', 'fast'],
        createdAt: '2025-01-01T00:00:00Z',
        usageCount: 4,
      },
      {
        id: 'default-quickfix',
        name: '⚡ Quick Fix',
        description: 'Rapid one-shot fix with fast model',
        category: 'Development',
        config: {
          repoPath: '',
          headless: true,
          envVars: {},
          createWorktree: false,
          autoApprove: true,
          model: 'claude-haiku-4.5',
        },
        tags: ['quick', 'fast'],
        createdAt: '2025-01-01T00:00:00Z',
        usageCount: 20,
      },
      {
        id: 'default-deps',
        name: '📦 Dependency Update',
        description: 'Update and audit project dependencies',
        category: 'Maintenance',
        config: {
          repoPath: '',
          headless: false,
          envVars: {},
          createWorktree: true,
          autoApprove: false,
          model: 'claude-sonnet-4.6',
        },
        tags: ['deps', 'maintenance'],
        createdAt: '2025-01-01T00:00:00Z',
        usageCount: 3,
      },
      {
        id: 'default-comprehensive-review',
        name: '🧠 Comprehensive Review (Multi-Agent)',
        description: 'Review session with multi-agent insight.',
        category: 'Quality',
        config: {
          repoPath: '',
          headless: false,
          envVars: {},
          createWorktree: false,
          autoApprove: false,
          model: 'claude-opus-4.6',
          prompt: 'Please spin up Opus 4.6, GPT 5.4, Codex 5.3, and Gemini Subagents to review the changes in this branch (git diff). Consolidate and validate their findings, and provide a summary.',
        },
        tags: ['review', 'multi-agent', 'premium'],
        createdAt: '2025-01-01T00:00:00Z',
        usageCount: 5,
      },
    ] satisfies SessionTemplate[],

    // Write operations return void
    remove_worktree: undefined,
    is_git_repo: true,
    lock_worktree: undefined,
    unlock_worktree: undefined,
    get_worktree_details: {
      path: 'C:\\git\\MyProject-feature-auth',
      uncommittedCount: 3,
      ahead: 2,
      behind: 0,
    } satisfies WorktreeDetails,

    // Repository registry
    list_registered_repos: [
      {
        path: 'C:\\git\\MyProject',
        name: 'MyProject',
        addedAt: '2025-01-10T10:00:00Z',
        lastUsedAt: '2025-01-18T14:00:00Z',
        source: 'manual',
      },
      {
        path: 'C:\\git\\AnotherRepo',
        name: 'AnotherRepo',
        addedAt: '2025-01-12T08:00:00Z',
        source: 'session-discovery',
      },
    ] satisfies RegisteredRepo[],
    add_registered_repo: {
      path: 'C:\\git\\NewRepo',
      name: 'NewRepo',
      addedAt: new Date().toISOString(),
      source: 'manual',
    } satisfies RegisteredRepo,
    remove_registered_repo: undefined,
    discover_repos_from_sessions: [] satisfies RegisteredRepo[],

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
