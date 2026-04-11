import { setupPinia } from "@tracepilot/test-utils";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useSessionsStore } from "../../stores/sessions";

// Mock the client module
const mockListSessions = vi.fn();
const mockReindexSessions = vi.fn();

vi.mock("@tracepilot/client", async () => {
  const { createClientMock } = await import("../mocks/client");
  return createClientMock({
    listSessions: (...args: unknown[]) => mockListSessions(...args),
    reindexSessions: (...args: unknown[]) => mockReindexSessions(...args),
  });
});

const MOCK_SESSION = {
  id: "abc-123",
  summary: "Test Session",
  repository: "org/repo",
  branch: "main",
  hostType: "cli",
  createdAt: "2025-01-01T00:00:00Z",
  updatedAt: "2025-01-02T00:00:00Z",
  eventCount: 10,
  turnCount: 3,
  currentModel: "claude-opus-4.6",
};

describe("useSessionsStore", () => {
  beforeEach(() => {
    setupPinia();
    mockListSessions.mockReset();
    mockReindexSessions.mockReset();
  });

  it("initializes with empty sessions", () => {
    const store = useSessionsStore();
    expect(store.sessions).toEqual([]);
    expect(store.loading).toBe(false);
    expect(store.indexing).toBe(false);
    expect(store.error).toBeNull();
  });

  it("has search query initially empty", () => {
    const store = useSessionsStore();
    expect(store.searchQuery).toBe("");
  });

  it("has filters initially null", () => {
    const store = useSessionsStore();
    expect(store.filterRepo).toBeNull();
    expect(store.filterBranch).toBeNull();
  });

  it("defaults sortBy to updated", () => {
    const store = useSessionsStore();
    expect(store.sortBy).toBe("updated");
  });

  it("computes filtered sessions as empty when no sessions", () => {
    const store = useSessionsStore();
    expect(store.filteredSessions).toEqual([]);
  });

  it("computes repositories as empty when no sessions", () => {
    const store = useSessionsStore();
    expect(store.repositories).toEqual([]);
  });

  it("computes branches as empty when no sessions", () => {
    const store = useSessionsStore();
    expect(store.branches).toEqual([]);
  });

  it("fetchSessions sets loading and populates sessions", async () => {
    mockListSessions.mockResolvedValue([MOCK_SESSION]);
    const store = useSessionsStore();

    const promise = store.fetchSessions();
    expect(store.loading).toBe(true);

    await promise;
    expect(store.loading).toBe(false);
    expect(store.sessions).toHaveLength(1);
    expect(store.sessions[0].id).toBe("abc-123");
  });

  it("fetchSessions handles errors", async () => {
    mockListSessions.mockRejectedValue(new Error("network error"));
    const store = useSessionsStore();

    await store.fetchSessions();
    expect(store.loading).toBe(false);
    expect(store.error).toContain("network error");
    expect(store.sessions).toEqual([]);
  });

  it("reindex sets indexing state and refreshes list", async () => {
    mockReindexSessions.mockResolvedValue([5, 10]);
    mockListSessions.mockResolvedValue([MOCK_SESSION]);
    const store = useSessionsStore();

    const promise = store.reindex();
    expect(store.indexing).toBe(true);

    await promise;
    expect(store.indexing).toBe(false);
    expect(mockReindexSessions).toHaveBeenCalled();
    expect(mockListSessions).toHaveBeenCalled();
    expect(store.sessions).toHaveLength(1);
  });

  it("reindex handles errors", async () => {
    mockReindexSessions.mockRejectedValue(new Error("index failed"));
    const store = useSessionsStore();

    await store.reindex();
    expect(store.indexing).toBe(false);
    expect(store.error).toContain("index failed");
  });

  it("filters sessions by search query", async () => {
    mockListSessions.mockResolvedValue([
      { ...MOCK_SESSION, id: "1", summary: "OAuth Login" },
      { ...MOCK_SESSION, id: "2", summary: "Database Migration" },
    ]);
    const store = useSessionsStore();
    await store.fetchSessions();

    store.searchQuery = "oauth";
    expect(store.filteredSessions).toHaveLength(1);
    expect(store.filteredSessions[0].summary).toBe("OAuth Login");
  });

  it("filters sessions by repo", async () => {
    mockListSessions.mockResolvedValue([
      { ...MOCK_SESSION, id: "1", repository: "org/web" },
      { ...MOCK_SESSION, id: "2", repository: "org/api" },
    ]);
    const store = useSessionsStore();
    await store.fetchSessions();

    store.filterRepo = "org/web";
    expect(store.filteredSessions).toHaveLength(1);
  });

  it("sorts sessions by different options", async () => {
    mockListSessions.mockResolvedValue([
      { ...MOCK_SESSION, id: "1", updatedAt: "2025-01-01T00:00:00Z", eventCount: 5 },
      { ...MOCK_SESSION, id: "2", updatedAt: "2025-01-03T00:00:00Z", eventCount: 20 },
    ]);
    const store = useSessionsStore();
    await store.fetchSessions();

    store.sortBy = "events";
    expect(store.filteredSessions[0].id).toBe("2");

    store.sortBy = "oldest";
    expect(store.filteredSessions[0].id).toBe("1");
  });

  it("computes unique repositories and branches", async () => {
    mockListSessions.mockResolvedValue([
      { ...MOCK_SESSION, id: "1", repository: "org/web", branch: "main" },
      { ...MOCK_SESSION, id: "2", repository: "org/api", branch: "dev" },
      { ...MOCK_SESSION, id: "3", repository: "org/web", branch: "main" },
    ]);
    const store = useSessionsStore();
    await store.fetchSessions();

    expect(store.repositories).toEqual(["org/api", "org/web"]);
    expect(store.branches).toEqual(["dev", "main"]);
  });

  it("ensureIndex silently reindexes and refreshes list", async () => {
    mockReindexSessions.mockResolvedValue([3, 10]);
    mockListSessions.mockResolvedValue([MOCK_SESSION]);
    const store = useSessionsStore();

    await store.ensureIndex();
    expect(mockReindexSessions).toHaveBeenCalled();
    expect(mockListSessions).toHaveBeenCalled();
    expect(store.sessions).toHaveLength(1);
    // ensureIndex should NOT set indexing or loading flags
    expect(store.indexing).toBe(false);
    expect(store.loading).toBe(false);
  });

  it("ensureIndex silently swallows errors", async () => {
    mockReindexSessions.mockRejectedValue(new Error("silent failure"));
    const store = useSessionsStore();

    await store.ensureIndex();
    // Should not set error state — this is a background optimization
    expect(store.error).toBeNull();
    expect(store.indexing).toBe(false);
  });
});
