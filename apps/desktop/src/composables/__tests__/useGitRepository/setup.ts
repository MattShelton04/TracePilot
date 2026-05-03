import type {
  fetchRemote as fetchRemoteCommand,
  getDefaultBranch as getDefaultBranchCommand,
} from "@tracepilot/client";
import { beforeEach, vi } from "vitest";
import type { logWarn as logWarnFunction } from "@/utils/logger";

const mocks = vi.hoisted(() => ({
  getDefaultBranch: vi.fn<typeof getDefaultBranchCommand>(),
  fetchRemote: vi.fn<typeof fetchRemoteCommand>(),
  logWarn: vi.fn<typeof logWarnFunction>(),
}));

vi.mock("@tracepilot/client", () => ({
  getDefaultBranch: mocks.getDefaultBranch,
  fetchRemote: mocks.fetchRemote,
}));

vi.mock("@tracepilot/ui", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@tracepilot/ui")>();
  return {
    ...actual,
    pathBasename: vi.fn((path: string) => path.split("/").pop() || path.split("\\").pop() || ""),
    pathDirname: vi.fn((path: string) => {
      const parts = path.split("/");
      if (parts.length > 1) return parts.slice(0, -1).join("/");
      const winParts = path.split("\\");
      if (winParts.length > 1) return winParts.slice(0, -1).join("\\");
      return "";
    }),
    sanitizeBranchForPath: vi.fn((branch: string) => branch.replace(/[/\\:*?"<>|#]/g, "-")),
  };
});

vi.mock("@/utils/logger", () => ({
  logWarn: mocks.logWarn,
}));

export const client = {
  getDefaultBranch: mocks.getDefaultBranch,
  fetchRemote: mocks.fetchRemote,
};

export const logger = {
  logWarn: mocks.logWarn,
};

export function setupUseGitRepositoryTest(): void {
  beforeEach(() => {
    vi.clearAllMocks();
    client.getDefaultBranch.mockResolvedValue("main");
    client.fetchRemote.mockResolvedValue("");
  });
}
