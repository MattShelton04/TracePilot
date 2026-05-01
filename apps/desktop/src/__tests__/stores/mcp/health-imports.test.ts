// biome-ignore-all assist/source/organizeImports: setup must register mocks before the store import.
import { describe, expect, it } from "vitest";
import {
  FIXTURE_CACHED,
  FIXTURE_CONFIG,
  FIXTURE_DIFF,
  FIXTURE_HEALTH,
  FIXTURE_IMPORT_RESULT,
  FIXTURE_TOOL,
  FIXTURE_TOOL_B,
  mocks,
  seedStore,
  setupMcpStoreTest,
} from "./setup";
import { useMcpStore } from "../../../stores/mcp";

setupMcpStoreTest();

describe("useMcpStore", () => {
  // ── checkHealth ────────────────────────────────────────────
  describe("checkHealth", () => {
    it("populates healthResults and updates servers on success", async () => {
      mocks.mcpCheckHealth.mockResolvedValue({
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
      mocks.mcpCheckHealth.mockRejectedValue(new Error("health check failed"));
      const store = useMcpStore();

      await store.checkHealth();

      expect(store.error).toBe("health check failed");
    });

    it("does not update server that is not in local servers map", async () => {
      mocks.mcpCheckHealth.mockResolvedValue({
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
      mocks.mcpCheckServerHealth.mockResolvedValue(FIXTURE_CACHED);
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
      mocks.mcpCheckServerHealth.mockRejectedValue(new Error("timeout"));
      const store = useMcpStore();

      const result = await store.checkServerHealth("filesystem");

      expect(result).toBeNull();
      expect(store.error).toBe("timeout");
    });

    it("does not update server map entry if server is not in local state", async () => {
      mocks.mcpCheckServerHealth.mockResolvedValue(FIXTURE_CACHED);
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
      mocks.mcpImportFromFile.mockResolvedValue(FIXTURE_IMPORT_RESULT);
      mocks.mcpAddServer.mockResolvedValue(undefined);
      mocks.mcpListServers.mockResolvedValue({});
      const store = useMcpStore();

      const result = await store.importFromFile("/path/to/mcp.json");

      expect(result).toEqual(FIXTURE_IMPORT_RESULT);
      expect(mocks.mcpImportFromFile).toHaveBeenCalledWith("/path/to/mcp.json");
      expect(store.error).toBeNull();
    });

    it("returns null and sets error on failure", async () => {
      mocks.mcpImportFromFile.mockRejectedValue(new Error("file not found"));
      const store = useMcpStore();

      const result = await store.importFromFile("/bad/path.json");

      expect(result).toBeNull();
      expect(store.error).toBe("file not found");
    });
  });

  // ── importFromGitHub ───────────────────────────────────────
  describe("importFromGitHub", () => {
    it("returns import result on success", async () => {
      mocks.mcpImportFromGitHub.mockResolvedValue(FIXTURE_IMPORT_RESULT);
      const store = useMcpStore();

      const result = await store.importFromGitHub("owner", "repo", "path/mcp.json", "main");

      expect(result).toEqual(FIXTURE_IMPORT_RESULT);
      expect(mocks.mcpImportFromGitHub).toHaveBeenCalledWith(
        "owner",
        "repo",
        "path/mcp.json",
        "main",
      );
      expect(store.error).toBeNull();
    });

    it("returns null and sets error on failure", async () => {
      mocks.mcpImportFromGitHub.mockRejectedValue(new Error("repo not found"));
      const store = useMcpStore();

      const result = await store.importFromGitHub("owner", "missing-repo");

      expect(result).toBeNull();
      expect(store.error).toBe("repo not found");
    });

    it("passes optional args correctly", async () => {
      mocks.mcpImportFromGitHub.mockResolvedValue(FIXTURE_IMPORT_RESULT);
      const store = useMcpStore();

      await store.importFromGitHub("owner", "repo");

      expect(mocks.mcpImportFromGitHub).toHaveBeenCalledWith("owner", "repo", undefined, undefined);
    });
  });

  // ── computeDiff ────────────────────────────────────────────
  describe("computeDiff", () => {
    it("returns diff result on success", async () => {
      mocks.mcpComputeDiff.mockResolvedValue(FIXTURE_DIFF);
      const store = useMcpStore();

      const incoming = { filesystem: FIXTURE_CONFIG };
      const result = await store.computeDiff(incoming);

      expect(result).toEqual(FIXTURE_DIFF);
      expect(mocks.mcpComputeDiff).toHaveBeenCalledWith(incoming);
      expect(store.error).toBeNull();
    });

    it("returns null and sets error on failure", async () => {
      mocks.mcpComputeDiff.mockRejectedValue(new Error("diff error"));
      const store = useMcpStore();

      const result = await store.computeDiff({});

      expect(result).toBeNull();
      expect(store.error).toBe("diff error");
    });
  });
});
