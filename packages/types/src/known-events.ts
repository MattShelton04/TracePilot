/**
 * Canonical list of event types TracePilot currently handles with typed parsing.
 *
 * Must stay in sync with KNOWN_EVENT_TYPES in:
 *   crates/tracepilot-core/src/models/event_types.rs
 *
 * Used by the version analyzer to compute coverage against installed Copilot CLI schemas.
 */
export const TRACEPILOT_KNOWN_EVENTS = [
  // Session lifecycle
  "session.start",
  "session.shutdown",
  "session.resume",
  "session.error",
  "session.info",
  "session.model_change",
  "session.context_changed",
  "session.compaction_start",
  "session.compaction_complete",
  "session.plan_changed",
  "session.workspace_file_changed",
  // Conversation
  "user.message",
  "assistant.message",
  "assistant.turn_start",
  "assistant.turn_end",
  // Tool execution
  "tool.execution_start",
  "tool.execution_complete",
  "tool.user_requested",
  // Subagents
  "subagent.started",
  "subagent.completed",
  "subagent.failed",
  // System
  "system.notification",
  "skill.invoked",
  // Control
  "abort",
  // New event types
  "session.truncation",
  "assistant.reasoning",
  "system.message",
  "session.warning",
  "session.mode_changed",
  "session.task_complete",
  "subagent.selected",
  "subagent.deselected",
  "hook.start",
  "hook.end",
  "session.handoff",
  "session.import_legacy",
] as const;

export type TracePilotKnownEvent = (typeof TRACEPILOT_KNOWN_EVENTS)[number];
