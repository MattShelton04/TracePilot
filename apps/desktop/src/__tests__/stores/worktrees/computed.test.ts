// biome-ignore assist/source/organizeImports: setup must register mocks before the store import.
import { describe, expect, it } from "vitest";
import {
  FIXTURE_FEATURE_WT,
  FIXTURE_MAIN_WT,
  FIXTURE_STALE_WT,
  freshAllWorktrees,
  setupWorktreesStoreTest,
} from "./setup";
import { useWorktreesStore } from "../../../stores/worktrees";

setupWorktreesStoreTest();

describe("useWorktreesStore computed properties", () => {
  it("mainWorktree returns the main worktree", () => {
    const store = useWorktreesStore();
    store.worktrees = freshAllWorktrees();

    expect(store.mainWorktree?.branch).toBe("main");
    expect(store.mainWorktree?.isMainWorktree).toBe(true);
  });

  it("mainWorktree is undefined when no main worktree exists", () => {
    const store = useWorktreesStore();
    store.worktrees = [{ ...FIXTURE_FEATURE_WT }];

    expect(store.mainWorktree).toBeUndefined();
  });

  it("secondaryWorktrees excludes main worktree", () => {
    const store = useWorktreesStore();
    store.worktrees = freshAllWorktrees();

    expect(store.secondaryWorktrees).toHaveLength(2);
    expect(store.secondaryWorktrees.every((w) => !w.isMainWorktree)).toBe(true);
  });

  it("worktreeCount returns total count", () => {
    const store = useWorktreesStore();
    store.worktrees = freshAllWorktrees();

    expect(store.worktreeCount).toBe(3);
  });

  it("activeCount counts active worktrees", () => {
    const store = useWorktreesStore();
    store.worktrees = freshAllWorktrees();

    // FIXTURE_MAIN_WT (active) + FIXTURE_FEATURE_WT (active)
    expect(store.activeCount).toBe(2);
  });

  it("staleCount counts stale worktrees", () => {
    const store = useWorktreesStore();
    store.worktrees = freshAllWorktrees();

    // FIXTURE_STALE_WT (stale)
    expect(store.staleCount).toBe(1);
  });

  it("lockedCount counts locked worktrees", () => {
    const store = useWorktreesStore();
    store.worktrees = freshAllWorktrees();

    // FIXTURE_STALE_WT (locked)
    expect(store.lockedCount).toBe(1);
  });

  it("sortedWorktrees sorts by branch ascending by default", () => {
    const store = useWorktreesStore();
    store.worktrees = freshAllWorktrees();

    const sorted = store.sortedWorktrees;
    const branches = sorted.map((w) => w.branch);
    expect(branches).toEqual(["feature-a", "feature-b", "main"]);
  });

  it("sortedWorktrees respects sortDirection", () => {
    const store = useWorktreesStore();
    store.worktrees = freshAllWorktrees();
    store.sortDirection = "desc";

    const branches = store.sortedWorktrees.map((w) => w.branch);
    expect(branches).toEqual(["main", "feature-b", "feature-a"]);
  });

  it("sortedWorktrees can sort by status", () => {
    const store = useWorktreesStore();
    store.worktrees = freshAllWorktrees();
    store.sortBy = "status";

    const statuses = store.sortedWorktrees.map((w) => w.status);
    expect(statuses).toEqual(["active", "active", "stale"]);
  });

  it("sortedWorktrees can sort by diskUsageBytes", () => {
    const store = useWorktreesStore();
    store.worktrees = [
      { ...FIXTURE_FEATURE_WT, diskUsageBytes: 500 },
      { ...FIXTURE_MAIN_WT, diskUsageBytes: 1000 },
      { ...FIXTURE_STALE_WT, diskUsageBytes: undefined },
    ];
    store.sortBy = "diskUsageBytes";

    const sizes = store.sortedWorktrees.map((w) => w.diskUsageBytes ?? 0);
    expect(sizes).toEqual([0, 500, 1000]);
  });
});

describe("useWorktreesStore setSortBy", () => {
  it("sets new sort field with asc direction", () => {
    const store = useWorktreesStore();
    store.setSortBy("status");

    expect(store.sortBy).toBe("status");
    expect(store.sortDirection).toBe("asc");
  });

  it("toggles direction when clicking same field", () => {
    const store = useWorktreesStore();
    expect(store.sortBy).toBe("branch");
    expect(store.sortDirection).toBe("asc");

    store.setSortBy("branch");
    expect(store.sortDirection).toBe("desc");

    store.setSortBy("branch");
    expect(store.sortDirection).toBe("asc");
  });

  it("resets direction when switching fields", () => {
    const store = useWorktreesStore();
    store.setSortBy("branch"); // toggle to desc
    expect(store.sortDirection).toBe("desc");

    store.setSortBy("status"); // switch field → resets to asc
    expect(store.sortDirection).toBe("asc");
  });
});
