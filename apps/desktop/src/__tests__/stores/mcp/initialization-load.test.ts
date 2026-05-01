// biome-ignore-all assist/source/organizeImports: setup must register mocks before the store import.
import { flushPromises } from "@vue/test-utils";
import { describe, expect, it } from "vitest";
import type { McpServerConfig } from "@tracepilot/types";
import {
  createDeferred,
  FIXTURE_CACHED,
  FIXTURE_CONFIG,
  FIXTURE_CONFIG_B,
  FIXTURE_HEALTH,
  FIXTURE_TOOL,
  FIXTURE_TOOL_B,
  mocks,
  setupMcpStoreTest,
} from "./setup";
import { useMcpStore } from "../../../stores/mcp";

setupMcpStoreTest();

describe("useMcpStore", () => {
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
      mocks.mcpListServers.mockResolvedValue({
        filesystem: FIXTURE_CONFIG,
        github: FIXTURE_CONFIG_B,
      });
      const store = useMcpStore();

      await store.loadServers();

      expect(store.servers.size).toBe(2);
      expect(store.servers.get("filesystem")?.config).toEqual(FIXTURE_CONFIG);
      expect(store.servers.get("github")?.config).toEqual(FIXTURE_CONFIG_B);
      expect(store.loading).toBe(false);
      expect(store.error).toBeNull();
    });

    it("sets loading to true during fetch", async () => {
      mocks.mcpListServers.mockResolvedValue({});
      const store = useMcpStore();

      const promise = store.loadServers();
      expect(store.loading).toBe(true);
      await promise;
      expect(store.loading).toBe(false);
    });

    it("merges cached health results into new server entries", async () => {
      mocks.mcpListServers.mockResolvedValue({ filesystem: FIXTURE_CONFIG });
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
      mocks.mcpListServers.mockRejectedValue(new Error("network error"));
      const store = useMcpStore();

      await store.loadServers();

      expect(store.error).toBe("network error");
      expect(store.loading).toBe(false);
    });

    it("discards stale response when newer load is in progress", async () => {
      const firstDeferred = createDeferred<Record<string, McpServerConfig>>();
      mocks.mcpListServers
        .mockReturnValueOnce(firstDeferred.promise)
        .mockResolvedValueOnce({ github: FIXTURE_CONFIG_B });

      const store = useMcpStore();

      const call1 = store.loadServers();
      const call2 = store.loadServers(); // invalidates first call's token

      // Resolve second call first
      await call2;
      await flushPromises();
      expect(store.servers.size).toBe(1);
      expect(store.servers.has("github")).toBe(true);

      // Now resolve first call — should be discarded
      firstDeferred.resolve({ filesystem: FIXTURE_CONFIG });
      await call1;
      await flushPromises();
      // Servers should still be from call2 (stale result discarded)
      expect(store.servers.size).toBe(1);
      expect(store.servers.has("github")).toBe(true);
    });

    it("clears error before loading", async () => {
      mocks.mcpListServers.mockResolvedValue({});
      const store = useMcpStore();
      store.error = "previous error";

      await store.loadServers();

      expect(store.error).toBeNull();
    });

    it("new servers default to empty tools and zero tokens when no cached health", async () => {
      mocks.mcpListServers.mockResolvedValue({ filesystem: FIXTURE_CONFIG });
      const store = useMcpStore();

      await store.loadServers();

      const detail = store.servers.get("filesystem");
      expect(detail?.tools).toEqual([]);
      expect(detail?.totalTokens).toBe(0);
      expect(detail?.health).toBeUndefined();
    });
  });
});
