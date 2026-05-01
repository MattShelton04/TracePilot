import { setupPinia } from "@tracepilot/test-utils";
import type { RegisteredRepo, WorktreeInfo } from "@tracepilot/types";
import { flushPromises } from "@vue/test-utils";
import { afterEach, beforeEach, vi } from "vitest";

export { createDeferred } from "@tracepilot/test-utils";
export { flushPromises };

const hoistedMocks = vi.hoisted(() => ({
  listWorktrees: vi.fn(),
  createWorktree: vi.fn(),
  removeWorktree: vi.fn(),
  pruneWorktrees: vi.fn(),
  listBranches: vi.fn(),
  getWorktreeDiskUsage: vi.fn(),
  lockWorktree: vi.fn(),
  unlockWorktree: vi.fn(),
  getWorktreeDetails: vi.fn(),
  listRegisteredRepos: vi.fn(),
  addRegisteredRepo: vi.fn(),
  removeRegisteredRepo: vi.fn(),
  discoverReposFromSessions: vi.fn(),
  toggleRepoFavourite: vi.fn(),
  logWarn: vi.fn(),
}));

export const mocks = hoistedMocks;

vi.mock("@tracepilot/client", () => ({
  listWorktrees: (...args: unknown[]) => hoistedMocks.listWorktrees(...args),
  createWorktree: (...args: unknown[]) => hoistedMocks.createWorktree(...args),
  removeWorktree: (...args: unknown[]) => hoistedMocks.removeWorktree(...args),
  pruneWorktrees: (...args: unknown[]) => hoistedMocks.pruneWorktrees(...args),
  listBranches: (...args: unknown[]) => hoistedMocks.listBranches(...args),
  getWorktreeDiskUsage: (...args: unknown[]) => hoistedMocks.getWorktreeDiskUsage(...args),
  lockWorktree: (...args: unknown[]) => hoistedMocks.lockWorktree(...args),
  unlockWorktree: (...args: unknown[]) => hoistedMocks.unlockWorktree(...args),
  getWorktreeDetails: (...args: unknown[]) => hoistedMocks.getWorktreeDetails(...args),
  listRegisteredRepos: (...args: unknown[]) => hoistedMocks.listRegisteredRepos(...args),
  addRegisteredRepo: (...args: unknown[]) => hoistedMocks.addRegisteredRepo(...args),
  removeRegisteredRepo: (...args: unknown[]) => hoistedMocks.removeRegisteredRepo(...args),
  discoverReposFromSessions: (...args: unknown[]) =>
    hoistedMocks.discoverReposFromSessions(...args),
  toggleRepoFavourite: (...args: unknown[]) => hoistedMocks.toggleRepoFavourite(...args),
}));

vi.mock("@/utils/logger", () => ({
  logWarn: (...args: unknown[]) => hoistedMocks.logWarn(...args),
}));

export const REPO_PATH = "/home/user/repos/TracePilot";

export const FIXTURE_MAIN_WT: WorktreeInfo = {
  path: REPO_PATH,
  branch: "main",
  headCommit: "c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4",
  isMainWorktree: true,
  isBare: false,
  status: "active",
  isLocked: false,
  repoRoot: REPO_PATH,
  diskUsageBytes: 1024 * 1024 * 100,
};

export const FIXTURE_FEATURE_WT: WorktreeInfo = {
  path: `${REPO_PATH}/.worktrees/feature-a`,
  branch: "feature-a",
  headCommit: "a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2",
  isMainWorktree: false,
  isBare: false,
  status: "active",
  isLocked: false,
  repoRoot: REPO_PATH,
  createdAt: "2026-03-27T10:00:00Z",
};

export const FIXTURE_STALE_WT: WorktreeInfo = {
  path: `${REPO_PATH}/.worktrees/feature-b`,
  branch: "feature-b",
  headCommit: "b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3",
  isMainWorktree: false,
  isBare: false,
  status: "stale",
  isLocked: true,
  lockedReason: "CI running",
  repoRoot: REPO_PATH,
  createdAt: "2026-03-26T10:00:00Z",
};

export const ALL_WORKTREES: WorktreeInfo[] = [
  FIXTURE_MAIN_WT,
  FIXTURE_FEATURE_WT,
  FIXTURE_STALE_WT,
];

export const FIXTURE_REPO: RegisteredRepo = {
  path: REPO_PATH,
  name: "TracePilot",
  addedAt: "2026-03-20T10:00:00Z",
  source: "manual",
  favourite: true,
};

export const FIXTURE_REPO_2: RegisteredRepo = {
  path: "/home/user/repos/OtherProject",
  name: "OtherProject",
  addedAt: "2026-03-22T14:00:00Z",
  source: "session-discovery",
  favourite: false,
};

function allMocks() {
  return Object.values(mocks);
}

export function setupWorktreesStoreTest() {
  beforeEach(() => {
    setupPinia();
    for (const mock of allMocks()) mock.mockReset();
    // Default: disk usage resolves immediately
    hoistedMocks.getWorktreeDiskUsage.mockResolvedValue(0);
  });

  afterEach(async () => {
    // Drain fire-and-forget hydration promises to prevent cross-test leaks
    await flushPromises();
  });
}

export function freshAllWorktrees() {
  return ALL_WORKTREES.map((w) => ({ ...w }));
}
