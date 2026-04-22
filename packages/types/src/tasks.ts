// ─── Task System Types ───────────────────────────────────────────
//
// TypeScript equivalents of Rust types from:
// - tracepilot-orchestrator/src/task_db/types.rs
// - tracepilot-orchestrator/src/presets/types.rs

// ─── Task Status & Lifecycle ──────────────────────────────────────

export type TaskStatus =
  | "pending"
  | "claimed"
  | "in_progress"
  | "done"
  | "failed"
  | "cancelled"
  | "expired"
  | "dead_letter";

export type JobStatus = "pending" | "running" | "completed" | "failed" | "cancelled";

export const TERMINAL_TASK_STATUSES: TaskStatus[] = [
  "done",
  "failed",
  "cancelled",
  "expired",
  "dead_letter",
];

export function isTerminalStatus(status: TaskStatus): boolean {
  return TERMINAL_TASK_STATUSES.includes(status);
}

// ─── Task & Job ───────────────────────────────────────────────────

export interface Task {
  id: string;
  jobId: string | null;
  taskType: string;
  presetId: string;
  status: TaskStatus;
  priority: string;
  inputParams: Record<string, unknown>;
  contextHash: string | null;
  attemptCount: number;
  maxRetries: number;
  orchestratorSessionId: string | null;
  resultSummary: string | null;
  resultParsed: Record<string, unknown> | null;
  schemaValid: boolean | null;
  errorMessage: string | null;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
  claimedAt: string | null;
  startedAt: string | null;
}

export interface Job {
  id: string;
  name: string;
  presetId: string | null;
  status: JobStatus;
  taskCount: number;
  tasksCompleted: number;
  tasksFailed: number;
  createdAt: string;
  completedAt: string | null;
  orchestratorSessionId: string | null;
}

export interface NewTask {
  taskType: string;
  presetId: string;
  priority?: string;
  inputParams: Record<string, unknown>;
  maxRetries?: number;
}

export interface TaskFilter {
  status?: TaskStatus;
  taskType?: string;
  jobId?: string;
  presetId?: string;
  limit?: number;
  offset?: number;
}

export interface TaskStats {
  total: number;
  pending: number;
  inProgress: number;
  done: number;
  failed: number;
  cancelled: number;
}

export interface TaskResult {
  taskId: string;
  status: TaskStatus;
  resultSummary: string | null;
  resultParsed: Record<string, unknown> | null;
  schemaValid: boolean;
  errorMessage: string | null;
}

// ─── Task Presets ─────────────────────────────────────────────────

export interface TaskPreset {
  id: string;
  name: string;
  taskType: string;
  description: string;
  version: number;
  prompt: PresetPrompt;
  context: PresetContext;
  output: PresetOutput;
  execution: PresetExecution;
  tags: string[];
  enabled: boolean;
  builtin: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface PresetPrompt {
  system: string;
  user: string;
  variables: PromptVariable[];
}

export interface PromptVariable {
  name: string;
  type: VariableType;
  required: boolean;
  description: string;
  default: string | null;
}

export type VariableType =
  | "string"
  | "number"
  | "boolean"
  | "session_ref"
  | "session_list"
  | "date";

export interface PresetContext {
  sources: ContextSource[];
  maxChars: number;
  format: ContextFormat;
}

export interface ContextSource {
  id: string;
  type: ContextSourceType;
  label: string | null;
  required: boolean;
  config: Record<string, unknown>;
}

export type ContextSourceType =
  | "session_export"
  | "session_analytics"
  | "session_health"
  | "session_todos"
  | "recent_sessions"
  | "multi_session_digest";

export type ContextFormat = "markdown" | "json";

export interface PresetOutput {
  schema: Record<string, unknown>;
  format: OutputFormat;
  validation: ValidationMode;
}

export type OutputFormat = "json" | "markdown" | "text";
export type ValidationMode = "warn" | "strict" | "none";

export interface PresetExecution {
  modelOverride: string | null;
  timeoutSeconds: number;
  maxRetries: number;
  priority: string;
}

// ─── Orchestrator Types ───────────────────────────────────────────

export type OrchestratorState = "idle" | "starting" | "running" | "stopping" | "error";

export interface OrchestratorStatus {
  state: OrchestratorState;
  pid: number | null;
  sessionId: string | null;
  launchedAt: string | null;
  taskCount: number;
  tasksCompleted: number;
  tasksFailed: number;
  lastHeartbeat: string | null;
  restartCount: number;
  error: string | null;
}

export interface OrchestratorHandle {
  pid: number;
  sessionUuid: string | null;
  manifestPath: string;
  jobsDir: string;
  launchedAt: string;
}

// ─── Orchestrator Config ──────────────────────────────────────────

export interface OrchestratorTaskConfig {
  orchestratorModel: string;
  subagentModel: string;
  maxParallelTasks: number;
  pollIntervalSeconds: number;
  maxEmptyPolls: number;
  maxCycles: number;
  autoStart: boolean;
}

export const DEFAULT_ORCHESTRATOR_CONFIG: OrchestratorTaskConfig = {
  orchestratorModel: "claude-sonnet-4.6",
  subagentModel: "claude-haiku-4.5",
  maxParallelTasks: 3,
  pollIntervalSeconds: 30,
  maxEmptyPolls: 10,
  maxCycles: 100,
  autoStart: false,
};

// ─── Tauri Event Payloads ─────────────────────────────────────────

export interface TaskCompletedEvent {
  taskId: string;
  status: TaskStatus;
  resultSummary: string | null;
}

export interface TaskSubagentEvent {
  taskId: string;
  agentName: string;
  status: "spawning" | "running" | "completed" | "failed";
}

export interface OrchestratorEvent {
  state: OrchestratorState;
  message: string;
}

// ─── Health Check ─────────────────────────────────────────────────

export type OrchestratorHealth = "healthy" | "stale" | "stopped" | "unknown";

export interface HealthCheckResult {
  health: OrchestratorHealth;
  heartbeatAgeSecs: number | null;
  lastCycle: number | null;
  activeTasks: string[];
  needsRestart: boolean;
  /** Session UUID of the orchestrator (discovered after launch). */
  sessionUuid: string | null;
  /** Full path to the orchestrator's session directory. */
  sessionPath: string | null;
}

// ─── Attribution ──────────────────────────────────────────────────

export type SubagentStatus = "spawning" | "running" | "completed" | "failed";

export interface TrackedSubagent {
  taskId: string;
  agentName: string;
  status: SubagentStatus;
  startedAt: string | null;
  completedAt: string | null;
  error: string | null;
}

export interface AttributionSnapshot {
  subagents: TrackedSubagent[];
  eventsScanned: number;
}
