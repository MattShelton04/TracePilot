import { setupPinia } from "@tracepilot/test-utils";
import type { SessionListItem } from "@tracepilot/types";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { nextTick } from "vue";
import { STORAGE_KEYS } from "../../config/storageKeys";
import { useSessionsStore } from "../../stores/sessions";
import { readSessionListPreferences } from "../../stores/sessions/listPreferences";

vi.mock("@tracepilot/client", async () => {
  const { createClientMock } = await import("../mocks/client");
  return createClientMock({});
});

function session(
  id: string,
  repository: string | null,
  source: SessionListItem["source"],
): SessionListItem {
  return { id, repository, source, turnCount: 2 } as SessionListItem;
}

/** A fresh Pinia, as after an app restart; localStorage survives. */
function restart() {
  setupPinia();
  return useSessionsStore();
}

describe("session list preference persistence", () => {
  beforeEach(() => {
    localStorage.clear();
    setupPinia();
  });

  it("restores the sort, repository and source after a restart, but not the search text", async () => {
    const store = useSessionsStore();
    store.setSortBy("oldest");
    store.setFilterSource("claudeCode");
    store.filterRepo = "org/app";
    store.searchQuery = "flaky test";
    await nextTick();

    const restored = restart();

    expect(restored.sortBy).toBe("oldest");
    expect(restored.filterRepo).toBe("org/app");
    expect(restored.filterSource).toBe("claudeCode");
    expect(restored.searchQuery).toBe("");
  });

  it("forgets filters cleared before the restart", async () => {
    const store = useSessionsStore();
    store.filterRepo = "org/app";
    store.setFilterSource("copilot");
    await nextTick();
    store.filterRepo = null;
    store.filterSource = null;
    await nextTick();

    const restored = restart();

    expect(restored.filterRepo).toBeNull();
    expect(restored.filterSource).toBeNull();
  });

  it("falls back to defaults for unreadable or invalid stored choices", () => {
    localStorage.setItem(STORAGE_KEYS.sessionListPreferences, "{not json");
    const broken = restart();
    expect(broken.sortBy).toBe("updated");
    expect(broken.filterRepo).toBeNull();
    expect(broken.filterSource).toBeNull();

    expect(
      readSessionListPreferences(JSON.stringify({ sortBy: "name", repo: 5, source: "codex" })),
    ).toEqual({ sortBy: "updated", repo: null, source: null });
    expect(readSessionListPreferences("null")).toEqual({
      sortBy: "updated",
      repo: null,
      source: null,
    });
  });

  it("keeps a remembered repository and source until the list is known, then drops missing ones", () => {
    localStorage.setItem(
      STORAGE_KEYS.sessionListPreferences,
      JSON.stringify({ sortBy: "turns", repo: "org/gone", source: "claudeCode" }),
    );
    const store = restart();
    expect(store.filterRepo).toBe("org/gone");
    expect(store.filterSource).toBe("claudeCode");

    store.sessions = [session("1", "org/app", "copilot")];

    expect(store.filterRepo).toBeNull();
    expect(store.filterSource).toBeNull();
    expect(store.sortBy).toBe("turns");
    expect(store.filteredSessions.map((s) => s.id)).toEqual(["1"]);
  });

  it("waits past an empty first list before dropping remembered filters", () => {
    localStorage.setItem(
      STORAGE_KEYS.sessionListPreferences,
      JSON.stringify({ repo: "org/app", source: "copilot" }),
    );
    const store = restart();

    store.sessions = [];
    expect(store.filterRepo).toBe("org/app");
    expect(store.filterSource).toBe("copilot");

    store.sessions = [session("1", "org/app", "copilot")];
    expect(store.filterRepo).toBe("org/app");
    expect(store.filterSource).toBe("copilot");
  });

  it("drops a remembered repository the remembered source has no sessions for", () => {
    localStorage.setItem(
      STORAGE_KEYS.sessionListPreferences,
      JSON.stringify({ repo: "org/web", source: "claudeCode" }),
    );
    const store = restart();

    store.sessions = [session("1", "org/web", "copilot"), session("2", "org/api", "claudeCode")];

    expect(store.filterSource).toBe("claudeCode");
    expect(store.filterRepo).toBeNull();
    expect(store.filteredSessions.map((s) => s.id)).toEqual(["2"]);
  });

  it("keeps remembered filters the loaded list still has, including folder-only projects", () => {
    localStorage.setItem(
      STORAGE_KEYS.sessionListPreferences,
      JSON.stringify({ repo: "project:harbor", source: "claudeCode" }),
    );
    const store = restart();

    store.sessions = [
      { ...session("1", null, "claudeCode"), cwd: "C:\\synthetic\\harbor" },
      session("2", "org/app", "copilot"),
    ];

    expect(store.filterRepo).toBe("project:harbor");
    expect(store.filterSource).toBe("claudeCode");
    expect(store.filteredSessions.map((s) => s.id)).toEqual(["1"]);
  });
});
