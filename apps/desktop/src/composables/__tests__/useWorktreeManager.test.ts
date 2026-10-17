import { setupPinia } from "@tracepilot/test-utils";
import type { WorktreeInfo } from "@tracepilot/types";
import { mount } from "@vue/test-utils";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { defineComponent, h, nextTick, reactive } from "vue";

const toastSuccess = vi.fn();
const toastError = vi.fn();
const confirmMock = vi.fn().mockResolvedValue({ confirmed: false, checked: false });
const pushMock = vi.fn();

vi.mock("vue-router", () => ({
  useRouter: () => ({ push: pushMock }),
}));

vi.mock("@tracepilot/ui", async () => {
  const actual = await vi.importActual<Record<string, unknown>>("@tracepilot/ui");
  return {
    ...actual,
    useToast: () => ({
      success: toastSuccess,
      error: toastError,
      info: vi.fn(),
      warn: vi.fn(),
      show: vi.fn(),
      dismiss: vi.fn(),
    }),
    useConfirmDialog: () => ({ confirm: confirmMock }),
  };
});

vi.mock("@tracepilot/client", () => ({
  openInExplorer: vi.fn(),
  openInTerminal: vi.fn(),
}));

vi.mock("@/composables/useBrowseDirectory", () => ({
  browseForDirectory: vi.fn().mockResolvedValue(null),
}));

// Minimal store mock: one shared reactive object stands in for the Pinia store
// so the composable reads the same `error`/`worktrees` the actions mutate.
const loadRegisteredRepos = vi.fn().mockResolvedValue(undefined);
const loadAllWorktrees = vi.fn().mockResolvedValue(undefined);
const loadBranches = vi.fn().mockResolvedValue(undefined);
const fetchWorktreeDetails = vi
  .fn()
  .mockResolvedValue({ uncommittedCount: 0, ahead: 0, behind: 0 });
const deleteWorktree = vi.fn().mockResolvedValue(true);
const lockWorktree = vi.fn().mockResolvedValue(true);
const unlockWorktree = vi.fn().mockResolvedValue(true);
const pruneFn = vi.fn().mockResolvedValue({ prunedCount: 0 });
const removeRepo = vi.fn().mockResolvedValue(true);
const discoverRepos = vi.fn().mockResolvedValue([]);

const storeState = reactive({
  error: null as string | null,
  currentRepoPath: "",
  loading: false,
  worktrees: [] as WorktreeInfo[],
  sortedWorktrees: [] as WorktreeInfo[],
  registeredRepos: [{ path: "/repo", name: "repo" }] as Array<{ path: string; name: string }>,
  staleCount: 0,
  loadRegisteredRepos,
  loadAllWorktrees,
  loadBranches,
  fetchWorktreeDetails,
  deleteWorktree,
  lockWorktree,
  unlockWorktree,
  prune: pruneFn,
  addRepo: vi.fn().mockResolvedValue(null),
  removeRepo,
  discoverRepos,
  addWorktree: vi.fn(),
});

vi.mock("@/stores/worktrees", () => ({
  useWorktreesStore: () => storeState,
}));

import { openInExplorer, openInTerminal } from "@tracepilot/client";
import { useWorktreeManager } from "../useWorktreeManager";

function harness() {
  let api!: ReturnType<typeof useWorktreeManager>;
  const Cmp = defineComponent({
    setup() {
      api = useWorktreeManager();
      return () => h("div");
    },
  });
  const wrapper = mount(Cmp);
  return {
    wrapper,
    get api() {
      return api;
    },
  };
}

function makeWt(overrides: Partial<WorktreeInfo> = {}): WorktreeInfo {
  return {
    path: "/repo/wt-a",
    branch: "feature/a",
    repoRoot: "/repo",
    status: "active",
    isMainWorktree: false,
    isLocked: false,
    lockedReason: undefined,
    linkedSessionId: undefined,
    diskUsageBytes: 1000,
    createdAt: "2026-01-01T00:00:00Z",
    ...overrides,
  } as WorktreeInfo;
}

beforeEach(() => {
  setupPinia();
  toastSuccess.mockClear();
  toastError.mockClear();
  confirmMock.mockReset().mockResolvedValue({ confirmed: false, checked: false });
  pushMock.mockClear();
  storeState.error = null;
  storeState.worktrees = [];
  storeState.sortedWorktrees = [];
  storeState.staleCount = 0;
  storeState.registeredRepos = [{ path: "/repo", name: "repo" }];
  deleteWorktree.mockReset().mockResolvedValue(true);
  lockWorktree.mockReset().mockResolvedValue(true);
  unlockWorktree.mockReset().mockResolvedValue(true);
  pruneFn.mockReset().mockResolvedValue({ prunedCount: 0 });
  removeRepo.mockReset().mockResolvedValue(true);
  discoverRepos.mockReset().mockResolvedValue([]);
  loadAllWorktrees.mockClear();
  vi.mocked(openInExplorer).mockReset();
  vi.mocked(openInTerminal).mockReset();
});

/** Makes a store action fail the way runMutation does: set error, return falsy. */
function failWith(message: string, value: unknown = false) {
  return async () => {
    storeState.error = message;
    return value;
  };
}

describe("useWorktreeManager", () => {
  it("toggles selection: selecting the same worktree twice clears it", async () => {
    const { api } = harness();
    const wt = makeWt();
    await api.selectWorktree(wt);
    expect(api.selectedWorktree.value?.path).toBe(wt.path);
    await api.selectWorktree(wt);
    expect(api.selectedWorktree.value).toBeNull();
    expect(api.worktreeDetails.value).toBeNull();
  });

  it("filters worktrees by searchQuery", async () => {
    storeState.sortedWorktrees = [
      makeWt({ path: "/repo/a", branch: "alpha" }),
      makeWt({ path: "/repo/b", branch: "beta" }),
    ];
    const { api } = harness();
    api.searchQuery.value = "alp";
    await nextTick();
    expect(api.filteredWorktrees.value.map((w) => w.branch)).toEqual(["alpha"]);
  });

  it("does not delete when confirm returns false", async () => {
    const { api } = harness();
    await api.confirmDelete(makeWt());
    expect(deleteWorktree).not.toHaveBeenCalled();
  });

  it("opens create modal and clears store error", () => {
    const { api } = harness();
    storeState.error = "old error";
    api.openCreateModal();
    expect(api.showCreateModal.value).toBe(true);
  });

  it("navigateToLauncher pushes router path with repo/branch query", () => {
    const { api } = harness();
    const wt = makeWt();
    api.navigateToLauncher(wt);
    expect(pushMock).toHaveBeenCalledWith({
      path: "/orchestration/launcher",
      query: { repoPath: wt.path, branch: wt.branch },
    });
  });

  describe("stale clean-up", () => {
    const repos = [
      { path: "/repo", name: "repo" },
      { path: "/other", name: "other" },
    ];
    const staleHere = makeWt({ path: "/repo/gone-1", branch: "gone-1", status: "stale" });
    const staleHere2 = makeWt({ path: "/repo/gone-2", branch: "gone-2", status: "stale" });
    const staleLocked = makeWt({
      path: "/repo/gone-locked",
      branch: "gone-locked",
      status: "stale",
      isLocked: true,
    });
    const staleElsewhere = makeWt({
      path: "/other/gone",
      branch: "gone-other",
      repoRoot: "/other",
      status: "stale",
    });

    beforeEach(() => {
      storeState.registeredRepos = repos;
      storeState.worktrees = [makeWt(), staleHere, staleHere2, staleLocked, staleElsewhere];
      storeState.staleCount = 4;
    });

    it("counts only stale worktrees in the selected repo", async () => {
      const { api } = harness();
      await api.handleSelectRepo("/repo");
      expect(api.staleInScope.value.map((w) => w.path)).toEqual([
        staleHere.path,
        staleHere2.path,
        staleLocked.path,
      ]);
      expect(api.cleanableStale.value.map((w) => w.path)).toEqual([
        staleHere.path,
        staleHere2.path,
      ]);
    });

    it("asks before removing anything and does nothing when cancelled", async () => {
      const { api } = harness();
      await api.handleCleanStale();
      expect(confirmMock).toHaveBeenCalledTimes(1);
      expect(deleteWorktree).not.toHaveBeenCalled();
    });

    it("removes only the selected repo's unlocked stale worktrees", async () => {
      confirmMock.mockResolvedValue({ confirmed: true, checked: false });
      const { api } = harness();
      await api.handleSelectRepo("/repo");
      await api.handleCleanStale();

      const message = confirmMock.mock.calls[0][0].message as string;
      expect(message).toContain("2 stale worktrees in repo");
      expect(message).toContain("1 locked");
      expect(deleteWorktree.mock.calls.map((c) => c[0])).toEqual([staleHere.path, staleHere2.path]);
      expect(toastSuccess).toHaveBeenCalledWith("Removed 2 stale worktrees");
    });

    it("reports removed and failed counts with the first error", async () => {
      confirmMock.mockResolvedValue({ confirmed: true, checked: false });
      deleteWorktree
        .mockImplementationOnce(failWith("fatal: cannot remove gone-1"))
        .mockResolvedValueOnce(true)
        .mockResolvedValueOnce(true);
      const { api } = harness();
      await api.handleCleanStale();

      expect(deleteWorktree).toHaveBeenCalledTimes(3);
      expect(toastSuccess).not.toHaveBeenCalled();
      expect(toastError).toHaveBeenCalledTimes(1);
      const text = toastError.mock.calls[0][0] as string;
      expect(text).toContain("Removed 2 of 3 stale worktrees");
      expect(text).toContain("gone-1: fatal: cannot remove gone-1");
      expect(api.cleaningStale.value).toBe(false);
    });
  });

  describe("error feedback", () => {
    it("shows the IPC error message when Open Folder fails", async () => {
      vi.mocked(openInExplorer).mockRejectedValue({ code: "IO", message: "path not found" });
      const { api } = harness();
      await api.handleOpenExplorer("/missing");
      expect(toastError).toHaveBeenCalledWith("Failed to open folder: path not found");
    });

    it("shows the IPC error message when Open Terminal fails", async () => {
      vi.mocked(openInTerminal).mockRejectedValue({ code: "IO", message: "path not found" });
      const { api } = harness();
      await api.handleOpenTerminal("/missing");
      expect(toastError).toHaveBeenCalledWith("Failed to open terminal: path not found");
    });

    it("reports a discovery failure instead of saying nothing was found", async () => {
      discoverRepos.mockImplementation(failWith("index unavailable", []));
      const { api } = harness();
      await api.handleDiscoverRepos();
      expect(toastSuccess).not.toHaveBeenCalled();
      expect(toastError).toHaveBeenCalledWith("Failed to discover repositories: index unavailable");
    });

    it("reports a failed repository removal", async () => {
      removeRepo.mockImplementation(failWith("config locked"));
      const { api } = harness();
      await api.handleRemoveRepo("/repo");
      expect(toastSuccess).not.toHaveBeenCalled();
      expect(toastError).toHaveBeenCalledWith("Failed to remove repository: config locked");
    });

    it("reports failed lock and unlock", async () => {
      lockWorktree.mockImplementation(failWith("already locked"));
      unlockWorktree.mockImplementation(failWith("not locked"));
      const { api } = harness();
      await api.handleLockInline(makeWt());
      await api.handleUnlock(makeWt({ isLocked: true }));
      expect(toastError).toHaveBeenCalledWith("Failed to lock worktree: already locked");
      expect(toastError).toHaveBeenCalledWith("Failed to unlock worktree: not locked");
    });

    it("reports a failed prune for one repo", async () => {
      pruneFn.mockImplementation(failWith("not a git repository", null));
      const { api } = harness();
      await api.handleSelectRepo("/repo");
      await api.handlePrune();
      expect(api.pruneMessage.value).toBeNull();
      expect(toastError).toHaveBeenCalledWith("Prune failed: not a git repository");
    });

    it("reports per-repo prune failures and reloads every repo afterwards", async () => {
      storeState.registeredRepos = [
        { path: "/repo", name: "repo" },
        { path: "/other", name: "other" },
      ];
      pruneFn
        .mockResolvedValueOnce({ prunedCount: 2, messages: [] })
        .mockImplementationOnce(failWith("not a git repository", null));
      const { api } = harness();
      await nextTick();
      loadAllWorktrees.mockClear();
      await api.handlePrune();
      expect(api.pruneMessage.value).toBe("Pruned 2 stale worktree(s) across all repos.");
      expect(toastError).toHaveBeenCalledWith(
        "Prune failed for 1 of 2 repositories — other: not a git repository",
      );
      expect(loadAllWorktrees).toHaveBeenCalledTimes(1);
    });
  });
});
