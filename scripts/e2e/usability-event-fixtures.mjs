import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

/**
 * Complete new audit fixtures for the CLI 1.0.83 event reader, which is stricter
 * than TracePilot's tolerant historical reader. The observed resume contract
 * requires UUID envelope IDs, start version/producer, system role and assistant
 * message IDs. Repository host types are github/ado, not the UI's legacy "cli".
 * This copies data in memory; it never migrates existing on-disk sessions.
 */
export function cliCompatibleFixtureEvents(source) {
  const events = structuredClone(source);
  const ids = new Map();
  for (const event of events) {
    assert(typeof event.id === "string" && event.id.length > 0, "Fixture event has no ID");
    assert(!ids.has(event.id), `Duplicate fixture event ID: ${event.id}`);
    ids.set(event.id, randomUUID());
  }
  for (const event of events) {
    if (event.parentId != null) {
      assert(ids.has(event.parentId), `Missing fixture parent: ${event.parentId}`);
      event.parentId = ids.get(event.parentId);
    } else event.parentId = null;
    event.id = ids.get(event.id);
    if (event.type === "session.start") {
      event.data.version ??= 3;
      event.data.producer ??= "audit-fixture";
      if (event.data.context?.hostType === "cli") event.data.context.hostType = "github";
    }
    if (event.type === "system.message") event.data.role ??= "system";
    if (event.type === "assistant.message") event.data.messageId ??= randomUUID();
  }
  return events;
}
