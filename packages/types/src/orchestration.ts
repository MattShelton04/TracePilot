// ─── Orchestration Types ──────────────────────────────────────────
// Types for worktree management, session launching, config injection,
// version management, and session templates.

// ─── Worktree Types ───────────────────────────────────────────────

export interface WorktreeInfo {
  path: string;
  branch: string;
  headCommit: string;
  isMainWorktree: boolean;
  isBare: boolean;
  diskUsageBytes?: number;
  status: 'active' | 'stale';
  isLocked: boolean;
  lockedReason?: string;
  linkedSessionId?: string;
  createdAt?: string;
  repoRoot: string;
}

export interface WorktreeDetails {
  path: string;
  uncommittedCount: number;
  ahead: number;
  behind: number;
}

export interface CreateWorktreeRequest {
  repoPath: string;
  branch: string;
  baseBranch?: string;
  targetDir?: string;
}

export interface PruneResult {
  prunedCount: number;
  messages: string[];
}

// ─── Repository Registry Types ────────────────────────────────────

export interface RegisteredRepo {
  path: string;
  name: string;
  addedAt: string;
  lastUsedAt?: string;
  source: 'manual' | 'session-discovery';
  favourite?: boolean;
}

// ─── Launcher Types ───────────────────────────────────────────────

export interface LaunchConfig {
  repoPath: string;
  branch?: string;
  baseBranch?: string;
  model?: string;
  prompt?: string;
  headless: boolean;
  reasoningEffort?: string;
  customInstructions?: string;
  envVars: Record<string, string>;
  createWorktree: boolean;
  autoApprove: boolean;
  /** CLI command to use (e.g. "copilot", "gh copilot-cli"). Defaults to "copilot". */
  cliCommand?: string;
}

export interface LaunchedSession {
  pid: number;
  worktreePath?: string;
  command: string;
  launchedAt: string;
}

export interface ModelInfo {
  id: string;
  name: string;
  tier: string;
}

// ─── Config Injector Types ────────────────────────────────────────

export interface AgentDefinition {
  name: string;
  filePath: string;
  model: string;
  description: string;
  tools: string[];
  promptExcerpt: string;
  rawYaml: string;
}

export interface CopilotConfig {
  model?: string;
  reasoningEffort?: string;
  trustedFolders: string[];
  raw: Record<string, unknown>;
}

export interface BackupEntry {
  id: string;
  label: string;
  sourcePath: string;
  backupPath: string;
  createdAt: string;
  sizeBytes: number;
}

export interface ConfigDiff {
  fileName: string;
  diffText: string;
  hasChanges: boolean;
}

export interface BackupDiffPreview {
  backupContent: string;
  currentContent: string;
}

// ─── Version Management Types ─────────────────────────────────────

export interface CopilotVersion {
  version: string;
  path: string;
  isActive: boolean;
  isComplete: boolean;
  modifiedAt: string;
  hasCustomizations: boolean;
  lockCount: number;
}

export interface MigrationDiff {
  fileName: string;
  agentName: string;
  fromVersion: string;
  toVersion: string;
  diff: string;
  hasConflicts: boolean;
}

// ─── Template Types ───────────────────────────────────────────────

export interface SessionTemplate {
  id: string;
  name: string;
  description: string;
  category: string;
  config: LaunchConfig;
  tags: string[];
  createdAt: string;
  usageCount: number;
  /** Optional emoji/icon for display. Falls back to extracting from name if absent. */
  icon?: string;
}

// ─── Active Session Discovery Types ───────────────────────────────

export interface ActiveSessionInfo {
  sessionId: string;
  pid: number;
  cwd?: string;
  branch?: string;
  repository?: string;
  startedAt?: string;
  copilotVersion?: string;
}

// ─── System Dependencies ──────────────────────────────────────────

export interface SystemDependencies {
  gitAvailable: boolean;
  gitVersion?: string;
  copilotAvailable: boolean;
  copilotVersion?: string;
  copilotHomeExists: boolean;
}
