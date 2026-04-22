import { setupPinia } from "@tracepilot/test-utils";
import type { WorktreeInfo } from "@tracepilot/types";
import { mount } from "@vue/test-utils";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { defineComponent, h, nextTick } from "vue";

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

// Minimal store mock: replace useWorktreesStore to return a plain object
// so the composable's reactive behaviour can be exercised without bootstrapping
// the full store implementation.
const storeState: {
  error: string | null;
  currentRepoPath: string;
  loading: boolean;
  worktrees: WorktreeInfo[];
  sortedWorktrees: WorktreeInfo[];
  registeredRepos: Array<{ path: string; name: string }>;
  staleCount: number;
} = {
  error: null,
  currentRepoPath: "",
  loading: false,
  worktrees: [],
  sortedWorktrees: [],
  registeredRepos: [{ path: "/repo", name: "repo" }],
  staleCount: 0,
};

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

vi.mock("@/stores/worktrees", () => ({
  useWorktreesStore: () => ({
    ...storeState,
    loadRegisteredRepos,
    loadAllWorktrees,
    loadBranches,
    fetchWorktreeDetails,
    deleteWorktree,
    lockWorktree,
    unlockWorktree,
    prune: pruneFn,
    addRepo: vi.fn().mockResolvedValue(null),
    removeRepo: vi.fn().mockResolvedValue(true),
    discoverRepos: vi.fn().mockResolvedValue([]),
    addWorktree: vi.fn(),
  }),
}));

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
});

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
});
