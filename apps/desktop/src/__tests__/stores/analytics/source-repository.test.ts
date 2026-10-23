// biome-ignore-all assist/source/organizeImports: setup must register mocks before the store import.
import type { SessionListItem } from "@tracepilot/types";
import { describe, expect, it } from "vitest";
import "./setup";
import { useAnalyticsStore } from "../../../stores/analytics";
import { useSessionsStore } from "../../../stores/sessions";

const SESSION = {
  summary: "Session",
  branch: "main",
  hostType: "cli",
  createdAt: "2025-01-01T00:00:00Z",
  updatedAt: "2025-01-02T00:00:00Z",
  eventCount: 10,
  turnCount: 3,
} as const;

function loadSessions(sessions: Partial<SessionListItem>[]) {
  useSessionsStore().sessions = sessions.map((s) => ({ ...SESSION, ...s }) as SessionListItem);
}

describe("analytics source and repository filters", () => {
  it("clears a repository with no sessions in the picked source, like the session list", () => {
    loadSessions([
      { id: "1", repository: "org/web", source: "copilot" },
      { id: "2", repository: null, cwd: "/w/Orchard", source: "claudeCode" },
    ]);
    const store = useAnalyticsStore();
    store.setRepo("project:Orchard");

    store.setSource("claudeCode");
    expect(store.selectedRepo).toBe("project:Orchard");

    store.setSource("copilot");
    expect(store.selectedSource).toBe("copilot");
    expect(store.selectedRepo).toBeNull();
  });

  it("keeps a folder filed under its repository whichever source is picked", () => {
    loadSessions([
      { id: "1", repository: "example/orchard", cwd: "C:/x/orchard", source: "copilot" },
      { id: "2", repository: null, cwd: "C:\\x\\orchard", source: "claudeCode" },
    ]);
    const store = useAnalyticsStore();
    store.setRepo("example/orchard");

    store.setSource("claudeCode");
    expect(store.selectedRepo).toBe("example/orchard");
  });

  it("keeps the repository while the session list has not loaded", () => {
    const store = useAnalyticsStore();
    store.setRepo("org/web");

    store.setSource("claudeCode");
    expect(store.selectedRepo).toBe("org/web");
  });
});
