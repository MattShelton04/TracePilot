// biome-ignore-all assist/source/organizeImports: setup must register mocks before the store import.
import type { McpHealthResultCached } from "@tracepilot/types";
import { describe, expect, it } from "vitest";
import {
  FIXTURE_CACHED,
  FIXTURE_CONFIG,
  FIXTURE_CONFIG_B,
  FIXTURE_HEALTH,
  mocks,
  seedStore,
  setupMcpStoreTest,
} from "./setup";
import { useMcpStore } from "../../../stores/mcp";

setupMcpStoreTest();

describe("useMcpStore", () => {
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
      mocks.mcpAddServer.mockResolvedValue(undefined);
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
      mocks.mcpRemoveServer.mockResolvedValue(undefined);
      const store = useMcpStore();
      seedStore(store);

      await store.removeServer("filesystem");

      expect(store.sortedServers.find((s) => s.name === "filesystem")).toBeUndefined();
      expect(store.filteredServers).toHaveLength(1);
      expect(store.filteredServers[0].name).toBe("github");
    });

    it("getServerDetail and serverList update after checkServerHealth() without force-reassignment", async () => {
      mocks.mcpCheckServerHealth.mockResolvedValue(FIXTURE_CACHED);
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
      expect(store.serverList.find((s) => s.name === "filesystem")?.health?.status).toBe("healthy");
    });

    it("sortedServers updates after toggleServer() modifying a nested config property", async () => {
      mocks.mcpToggleServer.mockResolvedValue(false);
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
        github: {
          result: { ...FIXTURE_HEALTH, serverName: "github", status: "unreachable" },
          tools: [],
        },
      };
      mocks.mcpCheckHealth.mockResolvedValue(multiHealthResults);
      const store = useMcpStore();
      // Seed without health data
      store.servers.set("filesystem", {
        name: "filesystem",
        config: FIXTURE_CONFIG,
        tools: [],
        totalTokens: 0,
      });
      store.servers.set("github", {
        name: "github",
        config: FIXTURE_CONFIG_B,
        tools: [],
        totalTokens: 0,
      });

      await store.checkHealth();

      // Both servers should have health data after the loop-based bulk update
      expect(store.serverList.find((s) => s.name === "filesystem")?.health?.status).toBe("healthy");
      expect(store.serverList.find((s) => s.name === "github")?.health?.status).toBe("unreachable");
      expect(store.summary.healthyServers).toBe(1);
    });
  });
});
