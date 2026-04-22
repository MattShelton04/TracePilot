// ─── Session Event Payload Types ──────────────────────────────────
// Discriminated-union narrowing for `SessionEvent.data`.
//
// `SessionEvent.data` is wire-typed as `Record<string, unknown>`
// because the upstream Copilot CLI can (and does) emit arbitrary
// JSON objects per `eventType`. In practice, the subset of event
// types TracePilot consumes has a stable shape. The types below
// document those shapes and the `narrowSessionEvent` helper maps
// a raw `SessionEvent` to a tagged union keyed on `kind`
// (= `eventType`) so consumers can use exhaustive `switch`
// statements rather than hand-rolled `isRecord` / `readString`
// guards on `event.data`.
//
// Runtime behaviour is preserved: malformed fields (wrong JSON
// type) are coerced to safe defaults the same way the previous
// ad-hoc guards did.

import type { SessionEvent } from "./conversation.js";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

/** Payload for `tool.execution_start`. */
export interface ToolExecutionStartPayload {
  kind: "tool.execution_start";
  toolName: string;
  /** Raw tool arguments (object or `{}` when absent / malformed). */
  arguments: Record<string, unknown>;
}

/** Payload for `subagent.started`. */
export interface SubagentStartedPayload {
  kind: "subagent.started";
  agentName: string;
}

/** Payload for `subagent.completed`. */
export interface SubagentCompletedPayload {
  kind: "subagent.completed";
  agentName: string;
}

/** Payload for `subagent.failed`. */
export interface SubagentFailedPayload {
  kind: "subagent.failed";
  agentName: string;
  error: string;
}

/** Payload for `assistant.message`. */
export interface AssistantMessagePayload {
  kind: "assistant.message";
  content: string;
}

/** Catch-all for event types TracePilot does not currently narrow. */
export interface UnknownSessionEventPayload {
  kind: "unknown";
  eventType: string;
}

/**
 * Discriminated union over the `SessionEvent` data shapes TracePilot
 * narrows. Prefer `switch (payload.kind) { ... }` for exhaustive handling.
 */
export type NarrowedSessionEventPayload =
  | ToolExecutionStartPayload
  | SubagentStartedPayload
  | SubagentCompletedPayload
  | SubagentFailedPayload
  | AssistantMessagePayload
  | UnknownSessionEventPayload;

/**
 * Narrow a raw `SessionEvent` to a tagged payload. Malformed fields
 * coerce to safe defaults (`""` for strings, `{}` for records) so the
 * narrowing never throws and runtime behaviour matches the legacy
 * `isRecord(data) ? data : {}` pattern.
 */
export function narrowSessionEvent(event: SessionEvent): NarrowedSessionEventPayload {
  const data = isRecord(event.data) ? event.data : {};

  switch (event.eventType) {
    case "tool.execution_start":
      return {
        kind: "tool.execution_start",
        toolName: readString(data.toolName) || "unknown",
        arguments: isRecord(data.arguments) ? data.arguments : {},
      };
    case "subagent.started":
      return { kind: "subagent.started", agentName: readString(data.agentName) };
    case "subagent.completed":
      return { kind: "subagent.completed", agentName: readString(data.agentName) };
    case "subagent.failed":
      return {
        kind: "subagent.failed",
        agentName: readString(data.agentName),
        error: readString(data.error),
      };
    case "assistant.message":
      return { kind: "assistant.message", content: readString(data.content) };
    default:
      return { kind: "unknown", eventType: event.eventType };
  }
}
