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
import { createPinia, setActivePinia } from "pinia";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useMcpStore } from "../../stores/mcp";
import { createDeferred } from "../helpers/deferred";

// ── Mock client functions ──────────────────────────────────────
const mockMcpListServers = vi.fn();
const mockMcpGetServer = vi.fn();
const mockMcpAddServer = vi.fn();
const mockMcpUpdateServer = vi.fn();
const mockMcpRemoveServer = vi.fn();
const mockMcpToggleServer = vi.fn();
const mockMcpCheckHealth = vi.fn();
const mockMcpCheckServerHealth = vi.fn();
const mockMcpImportFromFile = vi.fn();
const mockMcpImportFromGitHub = vi.fn();
const mockMcpComputeDiff = vi.fn();

vi.mock("@tracepilot/client", () => ({
  mcpListServers: (...args: unknown[]) => mockMcpListServers(...args),
  mcpGetServer: (...args: unknown[]) => mockMcpGetServer(...args),
  mcpAddServer: (...args: unknown[]) => mockMcpAddServer(...args),
  mcpUpdateServer: (...args: unknown[]) => mockMcpUpdateServer(...args),
  mcpRemoveServer: (...args: unknown[]) => mockMcpRemoveServer(...args),
  mcpToggleServer: (...args: unknown[]) => mockMcpToggleServer(...args),
  mcpCheckHealth: (...args: unknown[]) => mockMcpCheckHealth(...args),
  mcpCheckServerHealth: (...args: unknown[]) => mockMcpCheckServerHealth(...args),
  mcpImportFromFile: (...args: unknown[]) => mockMcpImportFromFile(...args),
  mcpImportFromGitHub: (...args: unknown[]) => mockMcpImportFromGitHub(...args),
  mcpComputeDiff: (...args: unknown[]) => mockMcpComputeDiff(...args),
}));

// ── Mock logger ────────────────────────────────────────────────
const mockLogWarn = vi.fn();
vi.mock("@/utils/logger", () => ({
  logWarn: (...args: unknown[]) => mockLogWarn(...args),
}));

// ── Mock @tracepilot/ui ────────────────────────────────────────
vi.mock("@tracepilot/ui", () => ({
  toErrorMessage: (e: unknown) => (e instanceof Error ? e.message : String(e)),
}));

// ── Fixtures ───────────────────────────────────────────────────
const FIXTURE_CONFIG: McpServerConfig = {
  command: "npx",
  args: ["-y", "@modelcontextprotocol/server-filesystem"],
  type: "stdio",
  enabled: true,
  description: "Filesystem server",
  tags: ["filesystem", "core"],
};

const FIXTURE_CONFIG_B: McpServerConfig = {
  command: "npx",
  args: ["-y", "@modelcontextprotocol/server-github"],
  type: "stdio",
  enabled: false,
  description: "GitHub server",
  tags: ["github", "api"],
};

const FIXTURE_HEALTH: McpHealthResult = {
  serverName: "filesystem",
  status: "healthy",
  latencyMs: 42,
  checkedAt: "2026-04-01T00:00:00Z",
};

const FIXTURE_TOOL: McpTool = {
  name: "read_file",
  description: "Read a file from the filesystem",
  estimatedTokens: 150,
};

const FIXTURE_TOOL_B: McpTool = {
  name: "write_file",
  description: "Write a file to the filesystem",
  estimatedTokens: 200,
};

const FIXTURE_CACHED: McpHealthResultCached = {
  result: FIXTURE_HEALTH,
  tools: [FIXTURE_TOOL, FIXTURE_TOOL_B],
};

const FIXTURE_IMPORT_RESULT: McpImportResult = {
  servers: { filesystem: FIXTURE_CONFIG },
  warnings: ["Duplicate key ignored"],
  sourceLabel: "mcp.json",
};

const FIXTURE_DIFF: McpConfigDiff = {
  entries: [
    {
      serverName: "filesystem",
      changeType: "added",
      incoming: FIXTURE_CONFIG,
    },
  ],
  addedCount: 1,
  removedCount: 0,
  modifiedCount: 0,
  unchangedCount: 0,
};

// ── Helpers ────────────────────────────────────────────────────
function allMocks() {
  return [
    mockMcpListServers,
    mockMcpGetServer,
    mockMcpAddServer,
    mockMcpUpdateServer,
    mockMcpRemoveServer,
    mockMcpToggleServer,
    mockMcpCheckHealth,
    mockMcpCheckServerHealth,
    mockMcpImportFromFile,
    mockMcpImportFromGitHub,
    mockMcpComputeDiff,
    mockLogWarn,
  ];
}

/** Helper to seed the store with servers for tests that need pre-existing data. */
function seedStore(store: ReturnType<typeof useMcpStore>) {
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

// ════════════════════════════════════════════════════════════════
// Tests
// ════════════════════════════════════════════════════════════════
describe("useMcpStore", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    for (const mock of allMocks()) mock.mockReset();
  });

  afterEach(async () => {
    await flushPromises();
  });

  // ── Initialization ─────────────────────────────────────────
  describe("initialization", () => {
    it("starts with empty servers map", () => {
      const store = useMcpStore();
      expect(store.servers.size).toBe(0);
    });

    it("starts with empty healthResults map", () => {
      const store = useMcpStore();
      expect(store.healthResults.size).toBe(0);
    });

    it("starts with loading false", () => {
      const store = useMcpStore();
      expect(store.loading).toBe(false);
    });

    it("starts with no error", () => {
      const store = useMcpStore();
      expect(store.error).toBeNull();
    });

    it("starts with empty searchQuery", () => {
      const store = useMcpStore();
      expect(store.searchQuery).toBe("");
    });

    it("starts with empty filterTags", () => {
      const store = useMcpStore();
      expect(store.filterTags).toEqual([]);
    });

    it("starts with no selectedServer", () => {
      const store = useMcpStore();
      expect(store.selectedServer).toBeNull();
    });
  });

  // ── loadServers ────────────────────────────────────────────
  describe("loadServers", () => {
    it("populates servers map on success", async () => {
      mockMcpListServers.mockResolvedValue([
        ["filesystem", FIXTURE_CONFIG],
        ["github", FIXTURE_CONFIG_B],
      ]);
      const store = useMcpStore();

      await store.loadServers();

      expect(store.servers.size).toBe(2);
      expect(store.servers.get("filesystem")?.config).toEqual(FIXTURE_CONFIG);
      expect(store.servers.get("github")?.config).toEqual(FIXTURE_CONFIG_B);
      expect(store.loading).toBe(false);
      expect(store.error).toBeNull();
    });

    it("sets loading to true during fetch", async () => {
      mockMcpListServers.mockResolvedValue([]);
      const store = useMcpStore();

      const promise = store.loadServers();
      expect(store.loading).toBe(true);
      await promise;
      expect(store.loading).toBe(false);
    });

    it("merges cached health results into new server entries", async () => {
      mockMcpListServers.mockResolvedValue([["filesystem", FIXTURE_CONFIG]]);
      const store = useMcpStore();

      // Pre-populate health cache
      store.healthResults = new Map([["filesystem", FIXTURE_CACHED]]);

      await store.loadServers();

      const detail = store.servers.get("filesystem");
      expect(detail?.health).toEqual(FIXTURE_HEALTH);
      expect(detail?.tools).toEqual([FIXTURE_TOOL, FIXTURE_TOOL_B]);
      expect(detail?.totalTokens).toBe(350);
    });

    it("sets error on failure", async () => {
      mockMcpListServers.mockRejectedValue(new Error("network error"));
      const store = useMcpStore();

      await store.loadServers();

      expect(store.error).toBe("network error");
      expect(store.loading).toBe(false);
    });

    it("discards stale response when newer load is in progress", async () => {
      const firstDeferred = createDeferred<[string, McpServerConfig][]>();
      mockMcpListServers
        .mockReturnValueOnce(firstDeferred.promise)
        .mockResolvedValueOnce([["github", FIXTURE_CONFIG_B]]);

      const store = useMcpStore();

      const call1 = store.loadServers();
      const call2 = store.loadServers(); // invalidates first call's token

      // Resolve second call first
      await call2;
      await flushPromises();
      expect(store.servers.size).toBe(1);
      expect(store.servers.has("github")).toBe(true);

      // Now resolve first call — should be discarded
      firstDeferred.resolve([["filesystem", FIXTURE_CONFIG]]);
      await call1;
      await flushPromises();
      // Servers should still be from call2 (stale result discarded)
      expect(store.servers.size).toBe(1);
      expect(store.servers.has("github")).toBe(true);
    });

    it("clears error before loading", async () => {
      mockMcpListServers.mockResolvedValue([]);
      const store = useMcpStore();
      store.error = "previous error";

      await store.loadServers();

      expect(store.error).toBeNull();
    });

    it("new servers default to empty tools and zero tokens when no cached health", async () => {
      mockMcpListServers.mockResolvedValue([["filesystem", FIXTURE_CONFIG]]);
      const store = useMcpStore();

      await store.loadServers();

      const detail = store.servers.get("filesystem");
      expect(detail?.tools).toEqual([]);
      expect(detail?.totalTokens).toBe(0);
      expect(detail?.health).toBeUndefined();
    });
  });

  // ── addServer ──────────────────────────────────────────────
  describe("addServer", () => {
    it("adds server to map and returns true on success", async () => {
      mockMcpAddServer.mockResolvedValue(undefined);
      const store = useMcpStore();

      const result = await store.addServer("filesystem", FIXTURE_CONFIG);

      expect(result).toBe(true);
      expect(store.servers.size).toBe(1);
      expect(store.servers.get("filesystem")?.config).toEqual(FIXTURE_CONFIG);
      expect(store.servers.get("filesystem")?.tools).toEqual([]);
      expect(store.servers.get("filesystem")?.totalTokens).toBe(0);
    });

    it("returns false and sets error on failure", async () => {
      mockMcpAddServer.mockRejectedValue(new Error("duplicate name"));
      const store = useMcpStore();

      const result = await store.addServer("filesystem", FIXTURE_CONFIG);

      expect(result).toBe(false);
      expect(store.error).toBe("duplicate name");
      expect(store.servers.size).toBe(0);
    });

    it("clears previous error before adding", async () => {
      mockMcpAddServer.mockResolvedValue(undefined);
      const store = useMcpStore();
      store.error = "old error";

      await store.addServer("filesystem", FIXTURE_CONFIG);

      expect(store.error).toBeNull();
    });

    it("calls mcpAddServer with correct arguments", async () => {
      mockMcpAddServer.mockResolvedValue(undefined);
      const store = useMcpStore();

      await store.addServer("filesystem", FIXTURE_CONFIG);

      expect(mockMcpAddServer).toHaveBeenCalledWith("filesystem", FIXTURE_CONFIG);
    });
  });

  // ── updateServer ───────────────────────────────────────────
  describe("updateServer", () => {
    it("updates config and preserves health/tools on success", async () => {
      mockMcpUpdateServer.mockResolvedValue(undefined);
      const store = useMcpStore();
      seedStore(store);

      const updatedConfig: McpServerConfig = {
        ...FIXTURE_CONFIG,
        description: "Updated description",
      };

      const result = await store.updateServer("filesystem", updatedConfig);

      expect(result).toBe(true);
      const detail = store.servers.get("filesystem");
      expect(detail?.config.description).toBe("Updated description");
      // Health and tools should be preserved from the existing entry
      expect(detail?.health).toEqual(FIXTURE_HEALTH);
      expect(detail?.tools).toEqual([FIXTURE_TOOL, FIXTURE_TOOL_B]);
      expect(detail?.totalTokens).toBe(350);
    });

    it("returns false and sets error on failure", async () => {
      mockMcpUpdateServer.mockRejectedValue(new Error("server not found"));
      const store = useMcpStore();

      const result = await store.updateServer("missing", FIXTURE_CONFIG);

      expect(result).toBe(false);
      expect(store.error).toBe("server not found");
    });

    it("handles update for server without prior health data", async () => {
      mockMcpUpdateServer.mockResolvedValue(undefined);
      const store = useMcpStore();
      // Seed a server with no health
      store.servers = new Map([
        ["new-server", { name: "new-server", config: FIXTURE_CONFIG, tools: [], totalTokens: 0 }],
      ]);

      const result = await store.updateServer("new-server", FIXTURE_CONFIG_B);

      expect(result).toBe(true);
      const detail = store.servers.get("new-server");
      expect(detail?.config).toEqual(FIXTURE_CONFIG_B);
      expect(detail?.health).toBeUndefined();
      expect(detail?.tools).toEqual([]);
      expect(detail?.totalTokens).toBe(0);
    });
  });

  // ── removeServer ───────────────────────────────────────────
  describe("removeServer", () => {
    it("removes server from map and health cache on success", async () => {
      mockMcpRemoveServer.mockResolvedValue(FIXTURE_CONFIG);
      const store = useMcpStore();
      seedStore(store);
      store.healthResults = new Map([["filesystem", FIXTURE_CACHED]]);

      const result = await store.removeServer("filesystem");

      expect(result).toBe(true);
      expect(store.servers.has("filesystem")).toBe(false);
      expect(store.healthResults.has("filesystem")).toBe(false);
      expect(store.servers.size).toBe(1); // "github" remains
    });

    it("clears selectedServer if the removed server was selected", async () => {
      mockMcpRemoveServer.mockResolvedValue(FIXTURE_CONFIG);
      const store = useMcpStore();
      seedStore(store);
      store.selectedServer = "filesystem";

      await store.removeServer("filesystem");

      expect(store.selectedServer).toBeNull();
    });

    it("does not clear selectedServer if a different server was removed", async () => {
      mockMcpRemoveServer.mockResolvedValue(FIXTURE_CONFIG_B);
      const store = useMcpStore();
      seedStore(store);
      store.selectedServer = "filesystem";

      await store.removeServer("github");

      expect(store.selectedServer).toBe("filesystem");
    });

    it("returns false and sets error on failure", async () => {
      mockMcpRemoveServer.mockRejectedValue(new Error("permission denied"));
      const store = useMcpStore();

      const result = await store.removeServer("filesystem");

      expect(result).toBe(false);
      expect(store.error).toBe("permission denied");
    });
  });

  // ── toggleServer ───────────────────────────────────────────
  describe("toggleServer", () => {
    it("flips enabled state on success", async () => {
      mockMcpToggleServer.mockResolvedValue(false); // was enabled, now disabled
      const store = useMcpStore();
      seedStore(store);

      const result = await store.toggleServer("filesystem");

      expect(result).toBe(false);
      expect(store.servers.get("filesystem")?.config.enabled).toBe(false);
    });

    it("enables a disabled server", async () => {
      mockMcpToggleServer.mockResolvedValue(true);
      const store = useMcpStore();
      seedStore(store);

      const result = await store.toggleServer("github");

      expect(result).toBe(true);
      expect(store.servers.get("github")?.config.enabled).toBe(true);
    });

    it("returns false and sets error on failure", async () => {
      mockMcpToggleServer.mockRejectedValue(new Error("toggle failed"));
      const store = useMcpStore();

      const result = await store.toggleServer("filesystem");

      expect(result).toBe(false);
      expect(store.error).toBe("toggle failed");
    });

    it("does not modify server map if server doesn't exist in local state", async () => {
      mockMcpToggleServer.mockResolvedValue(true);
      const store = useMcpStore();

      await store.toggleServer("nonexistent");

      expect(store.servers.size).toBe(0);
    });
  });

  // ── checkHealth ────────────────────────────────────────────
  describe("checkHealth", () => {
    it("populates healthResults and updates servers on success", async () => {
      mockMcpCheckHealth.mockResolvedValue({
        filesystem: FIXTURE_CACHED,
      });
      const store = useMcpStore();
      seedStore(store);

      await store.checkHealth();

      // healthResults updated
      expect(store.healthResults.get("filesystem")).toEqual(FIXTURE_CACHED);
      // Server detail updated with health and tools
      const detail = store.servers.get("filesystem");
      expect(detail?.health).toEqual(FIXTURE_HEALTH);
      expect(detail?.tools).toEqual([FIXTURE_TOOL, FIXTURE_TOOL_B]);
      expect(detail?.totalTokens).toBe(350);
    });

    it("sets error on failure", async () => {
      mockMcpCheckHealth.mockRejectedValue(new Error("health check failed"));
      const store = useMcpStore();

      await store.checkHealth();

      expect(store.error).toBe("health check failed");
    });

    it("does not update server that is not in local servers map", async () => {
      mockMcpCheckHealth.mockResolvedValue({
        unknown_server: FIXTURE_CACHED,
      });
      const store = useMcpStore();

      await store.checkHealth();

      // healthResults is populated, but no server detail is created
      expect(store.healthResults.get("unknown_server")).toEqual(FIXTURE_CACHED);
      expect(store.servers.has("unknown_server")).toBe(false);
    });
  });

  // ── checkServerHealth ──────────────────────────────────────
  describe("checkServerHealth", () => {
    it("returns cached result and updates server on success", async () => {
      mockMcpCheckServerHealth.mockResolvedValue(FIXTURE_CACHED);
      const store = useMcpStore();
      seedStore(store);

      const result = await store.checkServerHealth("filesystem");

      expect(result).toEqual(FIXTURE_CACHED);
      expect(store.healthResults.get("filesystem")).toEqual(FIXTURE_CACHED);
      const detail = store.servers.get("filesystem");
      expect(detail?.health).toEqual(FIXTURE_HEALTH);
      expect(detail?.tools).toEqual([FIXTURE_TOOL, FIXTURE_TOOL_B]);
      expect(detail?.totalTokens).toBe(350);
    });

    it("returns null and sets error on failure", async () => {
      mockMcpCheckServerHealth.mockRejectedValue(new Error("timeout"));
      const store = useMcpStore();

      const result = await store.checkServerHealth("filesystem");

      expect(result).toBeNull();
      expect(store.error).toBe("timeout");
    });

    it("does not update server map entry if server is not in local state", async () => {
      mockMcpCheckServerHealth.mockResolvedValue(FIXTURE_CACHED);
      const store = useMcpStore();

      const result = await store.checkServerHealth("nonexistent");

      expect(result).toEqual(FIXTURE_CACHED);
      // healthResults updated
      expect(store.healthResults.get("nonexistent")).toEqual(FIXTURE_CACHED);
      // but no server entry created
      expect(store.servers.has("nonexistent")).toBe(false);
    });
  });

  // ── importFromFile ─────────────────────────────────────────
  describe("importFromFile", () => {
    it("returns import result on success", async () => {
      mockMcpImportFromFile.mockResolvedValue(FIXTURE_IMPORT_RESULT);
      mockMcpAddServer.mockResolvedValue(undefined);
      mockMcpListServers.mockResolvedValue([]);
      const store = useMcpStore();

      const result = await store.importFromFile("/path/to/mcp.json");

      expect(result).toEqual(FIXTURE_IMPORT_RESULT);
      expect(mockMcpImportFromFile).toHaveBeenCalledWith("/path/to/mcp.json");
      expect(store.error).toBeNull();
    });

    it("returns null and sets error on failure", async () => {
      mockMcpImportFromFile.mockRejectedValue(new Error("file not found"));
      const store = useMcpStore();

      const result = await store.importFromFile("/bad/path.json");

      expect(result).toBeNull();
      expect(store.error).toBe("file not found");
    });
  });

  // ── importFromGitHub ───────────────────────────────────────
  describe("importFromGitHub", () => {
    it("returns import result on success", async () => {
      mockMcpImportFromGitHub.mockResolvedValue(FIXTURE_IMPORT_RESULT);
      const store = useMcpStore();

      const result = await store.importFromGitHub("owner", "repo", "path/mcp.json", "main");

      expect(result).toEqual(FIXTURE_IMPORT_RESULT);
      expect(mockMcpImportFromGitHub).toHaveBeenCalledWith(
        "owner",
        "repo",
        "path/mcp.json",
        "main",
      );
      expect(store.error).toBeNull();
    });

    it("returns null and sets error on failure", async () => {
      mockMcpImportFromGitHub.mockRejectedValue(new Error("repo not found"));
      const store = useMcpStore();

      const result = await store.importFromGitHub("owner", "missing-repo");

      expect(result).toBeNull();
      expect(store.error).toBe("repo not found");
    });

    it("passes optional args correctly", async () => {
      mockMcpImportFromGitHub.mockResolvedValue(FIXTURE_IMPORT_RESULT);
      const store = useMcpStore();

      await store.importFromGitHub("owner", "repo");

      expect(mockMcpImportFromGitHub).toHaveBeenCalledWith("owner", "repo", undefined, undefined);
    });
  });

  // ── computeDiff ────────────────────────────────────────────
  describe("computeDiff", () => {
    it("returns diff result on success", async () => {
      mockMcpComputeDiff.mockResolvedValue(FIXTURE_DIFF);
      const store = useMcpStore();

      const incoming = { filesystem: FIXTURE_CONFIG };
      const result = await store.computeDiff(incoming);

      expect(result).toEqual(FIXTURE_DIFF);
      expect(mockMcpComputeDiff).toHaveBeenCalledWith(incoming);
      expect(store.error).toBeNull();
    });

    it("returns null and sets error on failure", async () => {
      mockMcpComputeDiff.mockRejectedValue(new Error("diff error"));
      const store = useMcpStore();

      const result = await store.computeDiff({});

      expect(result).toBeNull();
      expect(store.error).toBe("diff error");
    });
  });

  // ── filteredServers (computed) ─────────────────────────────
  describe("filteredServers", () => {
    it("returns all servers sorted by name when no filter is applied", () => {
      const store = useMcpStore();
      seedStore(store);

      expect(store.filteredServers).toHaveLength(2);
      // Sorted alphabetically: "filesystem" before "github"
      expect(store.filteredServers[0].name).toBe("filesystem");
      expect(store.filteredServers[1].name).toBe("github");
    });

    it("filters by searchQuery on name", () => {
      const store = useMcpStore();
      seedStore(store);
      store.searchQuery = "git";

      expect(store.filteredServers).toHaveLength(1);
      expect(store.filteredServers[0].name).toBe("github");
    });

    it("filters by searchQuery on description (case-insensitive)", () => {
      const store = useMcpStore();
      seedStore(store);
      store.searchQuery = "FILESYSTEM";

      expect(store.filteredServers).toHaveLength(1);
      expect(store.filteredServers[0].name).toBe("filesystem");
    });

    it("filters by tags", () => {
      const store = useMcpStore();
      seedStore(store);
      store.filterTags = ["api"];

      expect(store.filteredServers).toHaveLength(1);
      expect(store.filteredServers[0].name).toBe("github");
    });

    it("combines searchQuery and filterTags", () => {
      const store = useMcpStore();
      seedStore(store);
      store.searchQuery = "server";
      store.filterTags = ["core"];

      // "filesystem" matches both: description contains "server" and has tag "core"
      // "github" matches "server" in description but doesn't have "core" tag
      expect(store.filteredServers).toHaveLength(1);
      expect(store.filteredServers[0].name).toBe("filesystem");
    });

    it("returns empty array when nothing matches", () => {
      const store = useMcpStore();
      seedStore(store);
      store.searchQuery = "nonexistent";

      expect(store.filteredServers).toHaveLength(0);
    });
  });

  // ── summary (computed) ─────────────────────────────────────
  describe("summary", () => {
    it("computes correct summary from servers", () => {
      const store = useMcpStore();
      seedStore(store);

      const s = store.summary;
      expect(s.totalServers).toBe(2);
      expect(s.enabledServers).toBe(2); // all configured servers are treated as enabled in the UI
      expect(s.healthyServers).toBe(1); // only "filesystem" has healthy status
      expect(s.totalTools).toBe(2); // filesystem has 2 tools, github has 0
      expect(s.totalTokens).toBe(350); // 150 + 200
    });

    it("returns zero counts when no servers exist", () => {
      const store = useMcpStore();

      const s = store.summary;
      expect(s.totalServers).toBe(0);
      expect(s.enabledServers).toBe(0);
      expect(s.healthyServers).toBe(0);
      expect(s.totalTools).toBe(0);
      expect(s.totalTokens).toBe(0);
    });
  });

  // ── allTags (computed) ─────────────────────────────────────
  describe("allTags", () => {
    it("collects unique tags from all servers, sorted alphabetically", () => {
      const store = useMcpStore();
      seedStore(store);

      expect(store.allTags).toEqual(["api", "core", "filesystem", "github"]);
    });

    it("returns empty array when no servers exist", () => {
      const store = useMcpStore();
      expect(store.allTags).toEqual([]);
    });

    it("handles servers with no tags", () => {
      const store = useMcpStore();
      const configNoTags: McpServerConfig = { ...FIXTURE_CONFIG, tags: undefined };
      store.servers = new Map([
        ["no-tags", { name: "no-tags", config: configNoTags, tools: [], totalTokens: 0 }],
      ]);

      expect(store.allTags).toEqual([]);
    });
  });

  // ── getServerDetail ────────────────────────────────────────
  describe("getServerDetail", () => {
    it("returns detail for existing server", () => {
      const store = useMcpStore();
      seedStore(store);

      const detail = store.getServerDetail("filesystem");
      expect(detail?.name).toBe("filesystem");
      expect(detail?.config).toEqual(FIXTURE_CONFIG);
    });

    it("returns undefined for non-existent server", () => {
      const store = useMcpStore();
      expect(store.getServerDetail("missing")).toBeUndefined();
    });
  });

  // ── enabledServers (computed) ──────────────────────────────
  describe("enabledServers", () => {
    it("returns all configured servers for the current UI model", () => {
      const store = useMcpStore();
      seedStore(store);

      expect(store.enabledServers).toHaveLength(2);
      expect(store.enabledServers[0].name).toBe("filesystem");
      expect(store.enabledServers[1].name).toBe("github");
    });
  });

  // ── sortedServers (computed) ───────────────────────────────
  describe("sortedServers", () => {
    it("returns servers sorted alphabetically by name", () => {
      const store = useMcpStore();
      seedStore(store);

      expect(store.sortedServers[0].name).toBe("filesystem");
      expect(store.sortedServers[1].name).toBe("github");
    });
  });

  // ── Map mutation reactivity ────────────────────────────────
  // These tests verify that Vue 3's reactive Map proxy tracks .set() / .delete()
  // calls natively, so computed properties derived from servers.value.values()
  // update correctly without any force-reassignment workaround.
  describe("Map mutation reactivity", () => {
    it("computed properties react to direct Map.set() without force-reassignment", () => {
      const store = useMcpStore();
      expect(store.serverList).toHaveLength(0);

      store.servers.set("alpha", {
        name: "alpha",
        config: FIXTURE_CONFIG,
        tools: [],
        totalTokens: 0,
      });

      // serverList, sortedServers, and filteredServers should all update without any
      // servers.value = new Map(servers.value) reassignment
      expect(store.serverList).toHaveLength(1);
      expect(store.filteredServers[0].name).toBe("alpha");
      expect(store.sortedServers[0].name).toBe("alpha");
    });

    it("computed properties react to direct Map.delete() without force-reassignment", () => {
      const store = useMcpStore();
      seedStore(store);
      expect(store.serverList).toHaveLength(2);

      store.servers.delete("filesystem");

      expect(store.serverList).toHaveLength(1);
      expect(store.sortedServers[0].name).toBe("github");
      expect(store.filteredServers.find((s) => s.name === "filesystem")).toBeUndefined();
    });

    it("filteredServers updates after addServer() without force-reassignment", async () => {
      mockMcpAddServer.mockResolvedValue(undefined);
      const store = useMcpStore();
      seedStore(store);

      await store.addServer("newserver", {
        ...FIXTURE_CONFIG,
        description: "New test server",
        tags: ["new"],
      });

      expect(store.filteredServers.some((s) => s.name === "newserver")).toBe(true);
      expect(store.sortedServers.find((s) => s.name === "newserver")).toBeDefined();
    });

    it("sortedServers updates after removeServer() without force-reassignment", async () => {
      mockMcpRemoveServer.mockResolvedValue(undefined);
      const store = useMcpStore();
      seedStore(store);

      await store.removeServer("filesystem");

      expect(store.sortedServers.find((s) => s.name === "filesystem")).toBeUndefined();
      expect(store.filteredServers).toHaveLength(1);
      expect(store.filteredServers[0].name).toBe("github");
    });

    it("getServerDetail and serverList update after checkServerHealth() without force-reassignment", async () => {
      mockMcpCheckServerHealth.mockResolvedValue(FIXTURE_CACHED);
      const store = useMcpStore();
      seedStore(store);

      // filesystem initially has health from seedStore, clear it to verify the update
      store.servers.set("filesystem", {
        name: "filesystem",
        config: FIXTURE_CONFIG,
        tools: [],
        totalTokens: 0,
      });
      expect(store.getServerDetail("filesystem")?.health).toBeUndefined();

      await store.checkServerHealth("filesystem");

      // serverList derived computed should reflect the new health/tools data
      const updated = store.getServerDetail("filesystem");
      expect(updated?.health?.status).toBe("healthy");
      expect(updated?.tools).toHaveLength(2);
      expect(updated?.totalTokens).toBe(350);
      // serverList is derived from the same reactive Map
      expect(store.serverList.find((s) => s.name === "filesystem")?.health?.status).toBe(
        "healthy",
      );
    });

    it("sortedServers updates after toggleServer() modifying a nested config property", async () => {
      mockMcpToggleServer.mockResolvedValue(false);
      const store = useMcpStore();
      seedStore(store);

      expect(store.sortedServers.find((s) => s.name === "filesystem")?.config.enabled).toBe(true);

      await store.toggleServer("filesystem");

      expect(store.sortedServers.find((s) => s.name === "filesystem")?.config.enabled).toBe(false);
      // Other server is unaffected
      expect(store.sortedServers.find((s) => s.name === "github")?.config.enabled).toBe(false);
    });

    it("serverList updates for all servers after checkHealth() bulk-updates via loop", async () => {
      const multiHealthResults: Record<string, McpHealthResultCached> = {
        filesystem: FIXTURE_CACHED,
        github: { result: { ...FIXTURE_HEALTH, serverName: "github", status: "unhealthy" }, tools: [] },
      };
      mockMcpCheckHealth.mockResolvedValue(multiHealthResults);
      const store = useMcpStore();
      // Seed without health data
      store.servers.set("filesystem", { name: "filesystem", config: FIXTURE_CONFIG, tools: [], totalTokens: 0 });
      store.servers.set("github", { name: "github", config: FIXTURE_CONFIG_B, tools: [], totalTokens: 0 });

      await store.checkHealth();

      // Both servers should have health data after the loop-based bulk update
      expect(store.serverList.find((s) => s.name === "filesystem")?.health?.status).toBe("healthy");
      expect(store.serverList.find((s) => s.name === "github")?.health?.status).toBe("unhealthy");
      expect(store.summary.healthyServers).toBe(1);
    });
  });
});
