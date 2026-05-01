import { setupPinia } from "@tracepilot/test-utils";
import type {
  CopilotVersion,
  RegisteredRepo,
  SessionListItem,
  SystemDependencies,
  WorktreeInfo,
} from "@tracepilot/types";
import { beforeEach, vi } from "vitest";

const clientMocks = vi.hoisted(() => ({
  mockCheckSystemDeps: vi.fn(),
  mockListSessions: vi.fn(),
  mockDiscoverCopilotVersions: vi.fn(),
  mockGetActiveCopilotVersion: vi.fn(),
  mockListWorktrees: vi.fn(),
  mockListRegisteredRepos: vi.fn(),
  mockGetWorktreeDiskUsage: vi.fn(),
  mockLogWarn: vi.fn(),
}));

export const {
  mockCheckSystemDeps,
  mockListSessions,
  mockDiscoverCopilotVersions,
  mockGetActiveCopilotVersion,
  mockListWorktrees,
  mockListRegisteredRepos,
  mockGetWorktreeDiskUsage,
  mockLogWarn,
} = clientMocks;

vi.mock("@tracepilot/client", async () => {
  const { createClientMock } = await import("../../mocks/client");
  return createClientMock({
    checkSystemDeps: (...args: unknown[]) => mockCheckSystemDeps(...args),
    listSessions: (...args: unknown[]) => mockListSessions(...args),
    discoverCopilotVersions: (...args: unknown[]) => mockDiscoverCopilotVersions(...args),
    getActiveCopilotVersion: (...args: unknown[]) => mockGetActiveCopilotVersion(...args),
    listWorktrees: (...args: unknown[]) => mockListWorktrees(...args),
    listRegisteredRepos: (...args: unknown[]) => mockListRegisteredRepos(...args),
    getWorktreeDiskUsage: (...args: unknown[]) => mockGetWorktreeDiskUsage(...args),
  });
});

vi.mock("@/utils/logger", () => ({
  logWarn: (...args: unknown[]) => mockLogWarn(...args),
}));

export const FIXTURE_SYSTEM_DEPS: SystemDependencies = {
  gitAvailable: true,
  gitVersion: "2.45.0",
  copilotAvailable: true,
  copilotVersion: "1.0.9",
  copilotHomeExists: true,
};

export const FIXTURE_ACTIVE_VERSION: CopilotVersion = {
  version: "1.0.9",
  path: "/home/user/.copilot/versions/1.0.9",
  isActive: true,
  isComplete: true,
  modifiedAt: "2026-03-28T10:00:00Z",
  hasCustomizations: false,
  lockCount: 0,
};

export const FIXTURE_VERSIONS: CopilotVersion[] = [
  FIXTURE_ACTIVE_VERSION,
  {
    version: "1.0.8",
    path: "/home/user/.copilot/versions/1.0.8",
    isActive: false,
    isComplete: true,
    modifiedAt: "2026-03-27T10:00:00Z",
    hasCustomizations: true,
    lockCount: 1,
  },
];

export const FIXTURE_SESSIONS: SessionListItem[] = [
  {
    id: "session-1",
    repository: "TracePilot",
    branch: "main",
    createdAt: "2026-03-28T10:00:00Z",
    updatedAt: "2026-03-28T10:30:00Z",
    isRunning: true,
    eventCount: 50,
    turnCount: 8,
  },
  {
    id: "session-2",
    repository: "MyProject",
    branch: "feature/test",
    createdAt: "2026-03-28T09:00:00Z",
    updatedAt: "2026-03-28T09:45:00Z",
    isRunning: false,
    eventCount: 120,
    turnCount: 15,
  },
  {
    id: "session-3",
    repository: "AnotherRepo",
    branch: "develop",
    createdAt: "2026-03-28T08:00:00Z",
    updatedAt: "2026-03-28T08:20:00Z",
    isRunning: false,
    eventCount: 30,
    turnCount: 4,
  },
];

export const FIXTURE_WORKTREES: WorktreeInfo[] = [
  {
    path: "/home/user/repos/TracePilot/.worktrees/feature-a",
    branch: "feature-a",
    headCommit: "a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2",
    isMainWorktree: false,
    isBare: false,
    status: "active",
    repoRoot: "/home/user/repos/TracePilot",
    diskUsageBytes: 1024 * 1024 * 50, // 50MB
    isLocked: false,
    createdAt: "2026-03-27T10:00:00Z",
  },
  {
    path: "/home/user/repos/TracePilot/.worktrees/feature-b",
    branch: "feature-b",
    headCommit: "b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3",
    isMainWorktree: false,
    isBare: false,
    status: "stale",
    repoRoot: "/home/user/repos/TracePilot",
    diskUsageBytes: 1024 * 1024 * 30, // 30MB
    isLocked: false,
    createdAt: "2026-03-26T10:00:00Z",
  },
  {
    path: "/home/user/repos/TracePilot",
    branch: "main",
    headCommit: "c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4",
    isMainWorktree: true,
    isBare: false,
    status: "active",
    repoRoot: "/home/user/repos/TracePilot",
    diskUsageBytes: 1024 * 1024 * 100, // 100MB
    isLocked: false,
  },
];

export const FIXTURE_REPOS: RegisteredRepo[] = [
  {
    path: "/home/user/repos/TracePilot",
    name: "TracePilot",
    addedAt: "2026-03-20T10:00:00Z",
    source: "manual",
    favourite: true,
  },
  {
    path: "/home/user/repos/MyProject",
    name: "MyProject",
    addedAt: "2026-03-22T14:00:00Z",
    source: "session-discovery",
    favourite: false,
  },
];

beforeEach(() => {
  setupPinia();
  vi.clearAllMocks();

  // Default: all succeed with empty/default data
  mockCheckSystemDeps.mockResolvedValue(FIXTURE_SYSTEM_DEPS);
  mockListSessions.mockResolvedValue([]);
  mockDiscoverCopilotVersions.mockResolvedValue([]);
  mockGetActiveCopilotVersion.mockResolvedValue(null);
  mockListWorktrees.mockResolvedValue([]);
  mockListRegisteredRepos.mockResolvedValue([]);
  mockGetWorktreeDiskUsage.mockImplementation((path: string) => {
    const worktree = FIXTURE_WORKTREES.find((wt) => wt.path === path);
    return Promise.resolve(worktree?.diskUsageBytes ?? 0);
  });
});
