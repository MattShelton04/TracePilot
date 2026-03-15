import { describe, it, expect, beforeEach } from "vitest";
import { setActivePinia, createPinia } from "pinia";
import { useSessionsStore } from "../../stores/sessions";

describe("useSessionsStore", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  it("initializes with empty sessions", () => {
    const store = useSessionsStore();
    expect(store.sessions).toEqual([]);
    expect(store.loading).toBe(false);
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
});
