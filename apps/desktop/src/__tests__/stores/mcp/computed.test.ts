// biome-ignore-all assist/source/organizeImports: setup must register mocks before the store import.
import type { McpServerConfig } from "@tracepilot/types";
import { describe, expect, it } from "vitest";
import { FIXTURE_CONFIG, seedStore, setupMcpStoreTest } from "./setup";
import { useMcpStore } from "../../../stores/mcp";

setupMcpStoreTest();

describe("useMcpStore", () => {
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
});
