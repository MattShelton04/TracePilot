import { setupPinia } from "@tracepilot/test-utils";
import type { SessionListItem } from "@tracepilot/types";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useSessionsStore } from "../../stores/sessions";

const mockListSessions = vi.fn();

vi.mock("@tracepilot/client", async () => {
  const { createClientMock } = await import("../mocks/client");
  return createClientMock({ listSessions: (...args: unknown[]) => mockListSessions(...args) });
});

const MOCK_SESSION: SessionListItem = {
  id: "abc-123",
  eventCount: 10,
  turnCount: 3,
  isRunning: false,
};

describe("applyPullRequestStates", () => {
  beforeEach(() => {
    setupPinia();
    mockListSessions.mockClear();
  });

  const primary = (number: number, state: "open" | "merged" | null, owner = "example") => ({
    host: "github.com",
    owner,
    repo: "orchard",
    number,
    url: `https://github.com/${owner}/orchard/pull/${number}`,
    state,
  });

  it("patches the matching primary pull requests in place of a reload", () => {
    const store = useSessionsStore();
    const untouched = { ...MOCK_SESSION, id: "c" };
    const searchable = [{ owner: "example", repo: "orchard", number: 1, title: "Example" }];
    store.sessions = [
      {
        ...MOCK_SESSION,
        id: "a",
        linkedPullRequests: { count: 2, primary: primary(1, null), pullRequests: searchable },
      },
      {
        ...MOCK_SESSION,
        id: "b",
        linkedPullRequests: { count: 1, primary: primary(1, null), pullRequests: [] },
      },
      untouched,
    ];
    store.applyPullRequestStates([primary(1, "merged", "Example")]);
    expect(store.sessions.map((s) => s.linkedPullRequests?.primary.state ?? null)).toEqual([
      "merged",
      "merged",
      null,
    ]);
    expect(store.sessions[0].linkedPullRequests?.count).toBe(2);
    expect(store.sessions[0].linkedPullRequests?.pullRequests).toBe(searchable);
    expect(store.sessions[2]).toBe(untouched);
    expect(mockListSessions).not.toHaveBeenCalled();
  });

  it("keeps the same list when no state changed", () => {
    const store = useSessionsStore();
    store.sessions = [
      {
        ...MOCK_SESSION,
        id: "a",
        linkedPullRequests: { count: 1, primary: primary(1, "open"), pullRequests: [] },
      },
    ];
    const before = store.sessions;
    store.applyPullRequestStates([primary(1, "open"), primary(2, "merged")]);
    store.applyPullRequestStates([]);
    expect(store.sessions).toBe(before);
  });
});
