// biome-ignore-all assist/source/organizeImports: setup must register mocks before the store import.
import type { McpServerConfig } from "@tracepilot/types";
import { describe, expect, it } from "vitest";
import {
  FIXTURE_CONFIG,
  FIXTURE_CONFIG_B,
  FIXTURE_CACHED,
  FIXTURE_HEALTH,
  FIXTURE_TOOL,
  FIXTURE_TOOL_B,
  mocks,
  seedStore,
  setupMcpStoreTest,
} from "./setup";
import { useMcpStore } from "../../../stores/mcp";

setupMcpStoreTest();

describe("useMcpStore", () => {
  // ── addServer ──────────────────────────────────────────────
  describe("addServer", () => {
    it("adds server to map and returns true on success", async () => {
      mocks.mcpAddServer.mockResolvedValue(undefined);
      const store = useMcpStore();

      const result = await store.addServer("filesystem", FIXTURE_CONFIG);

      expect(result).toBe(true);
      expect(store.servers.size).toBe(1);
      expect(store.servers.get("filesystem")?.config).toEqual(FIXTURE_CONFIG);
      expect(store.servers.get("filesystem")?.tools).toEqual([]);
      expect(store.servers.get("filesystem")?.totalTokens).toBe(0);
    });

    it("returns false and sets error on failure", async () => {
      mocks.mcpAddServer.mockRejectedValue(new Error("duplicate name"));
      const store = useMcpStore();

      const result = await store.addServer("filesystem", FIXTURE_CONFIG);

      expect(result).toBe(false);
      expect(store.error).toBe("duplicate name");
      expect(store.servers.size).toBe(0);
    });

    it("clears previous error before adding", async () => {
      mocks.mcpAddServer.mockResolvedValue(undefined);
      const store = useMcpStore();
      store.error = "old error";

      await store.addServer("filesystem", FIXTURE_CONFIG);

      expect(store.error).toBeNull();
    });

    it("calls mcpAddServer with correct arguments", async () => {
      mocks.mcpAddServer.mockResolvedValue(undefined);
      const store = useMcpStore();

      await store.addServer("filesystem", FIXTURE_CONFIG);

      expect(mocks.mcpAddServer).toHaveBeenCalledWith("filesystem", FIXTURE_CONFIG);
    });
  });

  // ── updateServer ───────────────────────────────────────────
  describe("updateServer", () => {
    it("updates config and preserves health/tools on success", async () => {
      mocks.mcpUpdateServer.mockResolvedValue(undefined);
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
      mocks.mcpUpdateServer.mockRejectedValue(new Error("server not found"));
      const store = useMcpStore();

      const result = await store.updateServer("missing", FIXTURE_CONFIG);

      expect(result).toBe(false);
      expect(store.error).toBe("server not found");
    });

    it("handles update for server without prior health data", async () => {
      mocks.mcpUpdateServer.mockResolvedValue(undefined);
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
      mocks.mcpRemoveServer.mockResolvedValue(FIXTURE_CONFIG);
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
      mocks.mcpRemoveServer.mockResolvedValue(FIXTURE_CONFIG);
      const store = useMcpStore();
      seedStore(store);
      store.selectedServer = "filesystem";

      await store.removeServer("filesystem");

      expect(store.selectedServer).toBeNull();
    });

    it("does not clear selectedServer if a different server was removed", async () => {
      mocks.mcpRemoveServer.mockResolvedValue(FIXTURE_CONFIG_B);
      const store = useMcpStore();
      seedStore(store);
      store.selectedServer = "filesystem";

      await store.removeServer("github");

      expect(store.selectedServer).toBe("filesystem");
    });

    it("returns false and sets error on failure", async () => {
      mocks.mcpRemoveServer.mockRejectedValue(new Error("permission denied"));
      const store = useMcpStore();

      const result = await store.removeServer("filesystem");

      expect(result).toBe(false);
      expect(store.error).toBe("permission denied");
    });
  });

  // ── toggleServer ───────────────────────────────────────────
  describe("toggleServer", () => {
    it("flips enabled state on success", async () => {
      mocks.mcpToggleServer.mockResolvedValue(false); // was enabled, now disabled
      const store = useMcpStore();
      seedStore(store);

      const result = await store.toggleServer("filesystem");

      expect(result).toBe(false);
      expect(store.servers.get("filesystem")?.config.enabled).toBe(false);
    });

    it("enables a disabled server", async () => {
      mocks.mcpToggleServer.mockResolvedValue(true);
      const store = useMcpStore();
      seedStore(store);

      const result = await store.toggleServer("github");

      expect(result).toBe(true);
      expect(store.servers.get("github")?.config.enabled).toBe(true);
    });

    it("returns false and sets error on failure", async () => {
      mocks.mcpToggleServer.mockRejectedValue(new Error("toggle failed"));
      const store = useMcpStore();

      const result = await store.toggleServer("filesystem");

      expect(result).toBe(false);
      expect(store.error).toBe("toggle failed");
    });

    it("does not modify server map if server doesn't exist in local state", async () => {
      mocks.mcpToggleServer.mockResolvedValue(true);
      const store = useMcpStore();

      await store.toggleServer("nonexistent");

      expect(store.servers.size).toBe(0);
    });
  });
});
