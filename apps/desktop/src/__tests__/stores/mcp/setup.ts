import { setupPinia } from "@tracepilot/test-utils";
import type {
  McpConfigDiff,
  McpHealthResult,
  McpHealthResultCached,
  McpImportResult,
  McpServerConfig,
  McpServerDetail,
  McpTool,
} from "@tracepilot/types";
import { flushPromises } from "@vue/test-utils";
import { afterEach, beforeEach, vi } from "vitest";
import type { useMcpStore } from "../../../stores/mcp";

export { createDeferred } from "@tracepilot/test-utils";

const hoistedMocks = vi.hoisted(() => ({
  mcpListServers: vi.fn(),
  mcpGetServer: vi.fn(),
  mcpAddServer: vi.fn(),
  mcpUpdateServer: vi.fn(),
  mcpRemoveServer: vi.fn(),
  mcpToggleServer: vi.fn(),
  mcpCheckHealth: vi.fn(),
  mcpCheckServerHealth: vi.fn(),
  mcpImportFromFile: vi.fn(),
  mcpImportFromGitHub: vi.fn(),
  mcpComputeDiff: vi.fn(),
  logWarn: vi.fn(),
}));

export const mocks = hoistedMocks;

vi.mock("@tracepilot/client", () => ({
  mcpListServers: (...args: unknown[]) => hoistedMocks.mcpListServers(...args),
  mcpGetServer: (...args: unknown[]) => hoistedMocks.mcpGetServer(...args),
  mcpAddServer: (...args: unknown[]) => hoistedMocks.mcpAddServer(...args),
  mcpUpdateServer: (...args: unknown[]) => hoistedMocks.mcpUpdateServer(...args),
  mcpRemoveServer: (...args: unknown[]) => hoistedMocks.mcpRemoveServer(...args),
  mcpToggleServer: (...args: unknown[]) => hoistedMocks.mcpToggleServer(...args),
  mcpCheckHealth: (...args: unknown[]) => hoistedMocks.mcpCheckHealth(...args),
  mcpCheckServerHealth: (...args: unknown[]) => hoistedMocks.mcpCheckServerHealth(...args),
  mcpImportFromFile: (...args: unknown[]) => hoistedMocks.mcpImportFromFile(...args),
  mcpImportFromGitHub: (...args: unknown[]) => hoistedMocks.mcpImportFromGitHub(...args),
  mcpComputeDiff: (...args: unknown[]) => hoistedMocks.mcpComputeDiff(...args),
}));

vi.mock("@/utils/logger", () => ({
  logWarn: (...args: unknown[]) => hoistedMocks.logWarn(...args),
}));

vi.mock("@tracepilot/ui", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@tracepilot/ui")>();
  return {
    ...actual,
    toErrorMessage: (e: unknown) => (e instanceof Error ? e.message : String(e)),
  };
});

export const FIXTURE_CONFIG: McpServerConfig = {
  command: "npx",
  args: ["-y", "@modelcontextprotocol/server-filesystem"],
  type: "stdio",
  enabled: true,
  description: "Filesystem server",
  tags: ["filesystem", "core"],
};

export const FIXTURE_CONFIG_B: McpServerConfig = {
  command: "npx",
  args: ["-y", "@modelcontextprotocol/server-github"],
  type: "stdio",
  enabled: false,
  description: "GitHub server",
  tags: ["github", "api"],
};

export const FIXTURE_HEALTH: McpHealthResult = {
  serverName: "filesystem",
  status: "healthy",
  latencyMs: 42,
  checkedAt: "2026-04-01T00:00:00Z",
};

export const FIXTURE_TOOL: McpTool = {
  name: "read_file",
  description: "Read a file from the filesystem",
  estimatedTokens: 150,
};

export const FIXTURE_TOOL_B: McpTool = {
  name: "write_file",
  description: "Write a file to the filesystem",
  estimatedTokens: 200,
};

export const FIXTURE_CACHED: McpHealthResultCached = {
  result: FIXTURE_HEALTH,
  tools: [FIXTURE_TOOL, FIXTURE_TOOL_B],
};

export const FIXTURE_IMPORT_RESULT: McpImportResult = {
  servers: { filesystem: FIXTURE_CONFIG },
  warnings: ["Duplicate key ignored"],
  sourceLabel: "mcp.json",
};

export const FIXTURE_DIFF: McpConfigDiff = {
  entries: [{ serverName: "filesystem", changeType: "added", incoming: FIXTURE_CONFIG }],
  addedCount: 1,
  removedCount: 0,
  modifiedCount: 0,
  unchangedCount: 0,
};

function allMocks() {
  return Object.values(hoistedMocks);
}

/** Helper to seed the store with servers for tests that need pre-existing data. */
export function seedStore(store: ReturnType<typeof useMcpStore>) {
  const serverA: McpServerDetail = {
    name: "filesystem",
    config: FIXTURE_CONFIG,
    health: FIXTURE_HEALTH,
    tools: [FIXTURE_TOOL, FIXTURE_TOOL_B],
    totalTokens: 350,
  };
  const serverB: McpServerDetail = {
    name: "github",
    config: FIXTURE_CONFIG_B,
    tools: [],
    totalTokens: 0,
  };
  store.servers = new Map([
    ["filesystem", serverA],
    ["github", serverB],
  ]);
}

export function setupMcpStoreTest() {
  beforeEach(() => {
    setupPinia();
    for (const mock of allMocks()) mock.mockReset();
  });

  afterEach(async () => {
    await flushPromises();
  });
}
