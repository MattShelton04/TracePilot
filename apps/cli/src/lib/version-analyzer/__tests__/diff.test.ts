import { describe, expect, it } from "vitest";
import { diffVersions, WATCHED_EVENT_TYPES } from "../diff.js";
import type { CopilotVersion, EventTypeInfo } from "../types.js";

function event(name: string, props: string[] = []): EventTypeInfo {
  return {
    name,
    properties: props.map((prop) => ({ name: prop, type: { kind: "string" }, required: false })),
    requiredFields: [],
    ephemeral: "never",
  };
}

function version(version: string, eventTypes: EventTypeInfo[]): CopilotVersion {
  return { version, path: `/fake/${version}`, eventTypes, rpcMethods: [], agents: [] };
}

describe("watched internal events", () => {
  it("flags schema changes to the events behind prompt-cache insights", () => {
    const before = version("1.0.83", [
      event("user.message", ["content"]),
      event("session.usage_checkpoint", ["totalNanoAiu", "modelCacheState"]),
      event("assistant.usage", ["cacheReadTokens"]),
    ]);
    const after = version("1.0.84", [
      event("user.message", ["content", "source"]),
      event("session.usage_checkpoint", ["totalNanoAiu", "modelCacheStates"]),
      event("prompt_cache_break", ["primaryReason"]),
    ]);

    const diff = diffVersions(before, after);

    expect(diff.watchedChanges).toEqual([
      {
        eventType: "prompt_cache_break",
        change: "added",
        reason: WATCHED_EVENT_TYPES.prompt_cache_break,
      },
      {
        eventType: "assistant.usage",
        change: "removed",
        reason: WATCHED_EVENT_TYPES["assistant.usage"],
      },
      {
        eventType: "session.usage_checkpoint",
        change: "modified",
        reason: WATCHED_EVENT_TYPES["session.usage_checkpoint"],
      },
    ]);
  });

  it("stays quiet when only unwatched events change", () => {
    const before = version("1.0.83", [event("user.message", ["content"])]);
    const after = version("1.0.84", [event("user.message", ["content", "source"])]);
    expect(diffVersions(before, after).watchedChanges).toEqual([]);
  });
});
