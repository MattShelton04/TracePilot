import type {
  AttributionSnapshot,
  HealthCheckResult,
  Job,
  NewTask,
  OrchestratorHandle,
  Task,
  TaskFilter,
  TaskPreset,
  TaskStats,
} from "@tracepilot/types";

import { invoke } from "./internal/core.js";
import { toRustOptional } from "./internal/optional.js";

// ─── Task System ──────────────────────────────────────────────────

/** Create a new task. */
export async function taskCreate(
  taskType: string,
  presetId: string,
  inputParams: Record<string, unknown> = {},
  priority?: string,
  maxRetries?: number,
): Promise<Task> {
  return invoke<Task>("task_create", {
    taskType,
    presetId,
    inputParams,
    priority,
    maxRetries,
  });
}

/** Create a batch of tasks as a job. */
export async function taskCreateBatch(
  tasks: NewTask[],
  jobName: string,
  presetId?: string,
): Promise<Job> {
  return invoke<Job>("task_create_batch", { tasks, jobName, presetId });
}

/** Get a single task by ID. */
export async function taskGet(id: string): Promise<Task> {
  return invoke<Task>("task_get", { id });
}

/** List tasks with optional filtering. */
export async function taskList(filter?: TaskFilter): Promise<Task[]> {
  return invoke<Task[]>("task_list", { filter });
}

/** Cancel a task. */
export async function taskCancel(id: string): Promise<void> {
  return invoke<void>("task_cancel", { id });
}

/** Retry a failed task. */
export async function taskRetry(id: string): Promise<void> {
  return invoke<void>("task_retry", { id });
}

/** Delete a task permanently. */
export async function taskDelete(id: string): Promise<void> {
  return invoke<void>("task_delete", { id });
}

/** Get aggregate task statistics. */
export async function taskStats(): Promise<TaskStats> {
  return invoke<TaskStats>("task_stats");
}

/** List jobs with optional limit. */
export async function taskListJobs(limit?: number): Promise<Job[]> {
  return invoke<Job[]>("task_list_jobs", { limit });
}

/** Cancel all pending tasks in a job. */
export async function taskCancelJob(jobId: string): Promise<void> {
  return invoke<void>("task_cancel_job", { jobId });
}

/** List all task presets. */
export async function taskListPresets(): Promise<TaskPreset[]> {
  return invoke<TaskPreset[]>("task_list_presets");
}

/** Get a single task preset by ID. */
export async function taskGetPreset(id: string): Promise<TaskPreset> {
  return invoke<TaskPreset>("task_get_preset", { id });
}

/** Save (create or update) a task preset. */
export async function taskSavePreset(preset: TaskPreset): Promise<void> {
  return invoke<void>("task_save_preset", { preset });
}

/** Delete a task preset. */
export async function taskDeletePreset(id: string): Promise<void> {
  return invoke<void>("task_delete_preset", { id });
}

/** Check orchestrator health status. */
export async function taskOrchestratorHealth(): Promise<HealthCheckResult> {
  return invoke<HealthCheckResult>("task_orchestrator_health");
}

/** Start the orchestrator. Optionally override the model. */
export async function taskOrchestratorStart(model?: string): Promise<OrchestratorHandle> {
  return invoke<OrchestratorHandle>("task_orchestrator_start", { model: toRustOptional(model) });
}

/** Stop the running orchestrator gracefully via manifest shutdown flag. */
export async function taskOrchestratorStop(): Promise<void> {
  return invoke<void>("task_orchestrator_stop");
}

/** Scan jobs directory and ingest completed task results into the DB. Returns count ingested. */
export async function taskIngestResults(): Promise<number> {
  return invoke<number>("task_ingest_results");
}

/** Get subagent attribution for an orchestrator session. */
export async function taskAttribution(sessionPath: string): Promise<AttributionSnapshot> {
  return invoke<AttributionSnapshot>("task_attribution", { sessionPath });
}
