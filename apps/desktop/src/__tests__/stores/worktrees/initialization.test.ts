// biome-ignore assist/source/organizeImports: setup must register mocks before the store import.
import { describe, expect, it } from "vitest";
import { setupWorktreesStoreTest } from "./setup";
import { useWorktreesStore } from "../../../stores/worktrees";

setupWorktreesStoreTest();

describe("useWorktreesStore initialization", () => {
  it("starts with empty worktrees", () => {
    const store = useWorktreesStore();
    expect(store.worktrees).toEqual([]);
  });

  it("starts with empty branches", () => {
    const store = useWorktreesStore();
    expect(store.branches).toEqual([]);
  });

  it("starts with loading false", () => {
    const store = useWorktreesStore();
    expect(store.loading).toBe(false);
  });

  it("starts with no error", () => {
    const store = useWorktreesStore();
    expect(store.error).toBeNull();
  });

  it("starts with empty currentRepoPath", () => {
    const store = useWorktreesStore();
    expect(store.currentRepoPath).toBe("");
  });

  it("starts with empty registeredRepos", () => {
    const store = useWorktreesStore();
    expect(store.registeredRepos).toEqual([]);
  });

  it("defaults sortBy to branch", () => {
    const store = useWorktreesStore();
    expect(store.sortBy).toBe("branch");
  });

  it("defaults sortDirection to asc", () => {
    const store = useWorktreesStore();
    expect(store.sortDirection).toBe("asc");
  });
});
