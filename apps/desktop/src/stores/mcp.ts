import {
  mcpAddServer,
  mcpCheckHealth,
  mcpCheckServerHealth,
  mcpComputeDiff,
  mcpGetServer,
  mcpImportFromFile,
  mcpImportFromGitHub,
  mcpListServers,
  mcpRemoveServer,
  mcpToggleServer,
  mcpUpdateServer,
} from "@tracepilot/client";
import type {
  McpConfigDiff,
  McpHealthResult,
  McpHealthResultCached,
  McpImportResult,
  McpServerConfig,
  McpServerDetail,
  McpSummary,
  McpTool,
} from "@tracepilot/types";
import { toErrorMessage, useAsyncGuard } from "@tracepilot/ui";
import { defineStore } from "pinia";
import { computed, ref } from "vue";
import { logWarn } from "@/utils/logger";

export const useMcpStore = defineStore("mcp", () => {
  // ─── State ────────────────────────────────────────────────────────
  const servers = ref<Map<string, McpServerDetail>>(new Map());
  const healthResults = ref<Map<string, McpHealthResultCached>>(new Map());
  const loading = ref(false);
  const error = ref<string | null>(null);
  const searchQuery = ref("");
  const filterTags = ref<string[]>([]);
  const selectedServer = ref<string | null>(null);

  const loadGuard = useAsyncGuard();

  // ─── Computed ─────────────────────────────────────────────────────

  const serverList = computed<McpServerDetail[]>(() => Array.from(servers.value.values()));

  const sortedServers = computed<McpServerDetail[]>(() =>
    [...serverList.value].sort((a, b) => a.name.localeCompare(b.name)),
  );

  const enabledServers = computed<McpServerDetail[]>(() => serverList.value);

  const filteredServers = computed<McpServerDetail[]>(() => {
    let list = sortedServers.value;

    if (searchQuery.value) {
      const q = searchQuery.value.toLowerCase();
      list = list.filter(
        (s) =>
          s.name.toLowerCase().includes(q) ||
          (s.config.description ?? "").toLowerCase().includes(q),
      );
    }

    if (filterTags.value.length > 0) {
      list = list.filter((s) =>
        filterTags.value.some((tag) => s.config.tags?.includes(tag)),
      );
    }

    return list;
  });

  const summary = computed<McpSummary>(() => {
    const all = serverList.value;
    const healthy = all.filter((s) => s.health?.status === "healthy");
    const totalTools = all.reduce((sum, s) => sum + s.tools.length, 0);
    const totalTokens = all.reduce((sum, s) => sum + s.totalTokens, 0);
    return {
      totalServers: all.length,
      enabledServers: all.length,
      healthyServers: healthy.length,
      totalTools,
      totalTokens,
    };
  });

  const allTags = computed<string[]>(() => {
    const tagSet = new Set<string>();
    for (const s of serverList.value) {
      for (const tag of s.config.tags ?? []) {
        tagSet.add(tag);
      }
    }
    return [...tagSet].sort();
  });

  // ─── Actions ──────────────────────────────────────────────────────

  async function loadServers() {
    const token = loadGuard.start();
    loading.value = true;
    error.value = null;
    try {
      const entries = await mcpListServers();
      if (!loadGuard.isValid(token)) return;

      const map = new Map<string, McpServerDetail>();
      for (const [name, config] of entries) {
        const cached = healthResults.value.get(name);
        map.set(name, {
          name,
          config,
          health: cached?.result,
          tools: cached?.tools ?? [],
          totalTokens: cached?.tools?.reduce((sum, t) => sum + t.estimatedTokens, 0) ?? 0,
        });
      }
      servers.value = map;
    } catch (e) {
      if (!loadGuard.isValid(token)) return;
      error.value = toErrorMessage(e);
    } finally {
      if (loadGuard.isValid(token)) loading.value = false;
    }
  }

  async function addServer(name: string, config: McpServerConfig): Promise<boolean> {
    error.value = null;
    try {
      await mcpAddServer(name, config);
      servers.value.set(name, {
        name,
        config,
        tools: [],
        totalTokens: 0,
      });
      return true;
    } catch (e) {
      error.value = toErrorMessage(e);
      return false;
    }
  }

  async function updateServer(name: string, config: McpServerConfig): Promise<boolean> {
    error.value = null;
    try {
      await mcpUpdateServer(name, config);
      const existing = servers.value.get(name);
      servers.value.set(name, {
        name,
        config,
        health: existing?.health,
        tools: existing?.tools ?? [],
        totalTokens: existing?.totalTokens ?? 0,
      });
      return true;
    } catch (e) {
      error.value = toErrorMessage(e);
      return false;
    }
  }

  async function removeServer(name: string): Promise<boolean> {
    error.value = null;
    try {
      await mcpRemoveServer(name);
      servers.value.delete(name);
      healthResults.value.delete(name);
      if (selectedServer.value === name) {
        selectedServer.value = null;
      }
      return true;
    } catch (e) {
      error.value = toErrorMessage(e);
      return false;
    }
  }

  async function toggleServer(name: string): Promise<boolean> {
    error.value = null;
    try {
      const newEnabled = await mcpToggleServer(name);
      const existing = servers.value.get(name);
      if (existing) {
        servers.value.set(name, {
          ...existing,
          config: { ...existing.config, enabled: newEnabled },
        });
      }
      return newEnabled;
    } catch (e) {
      error.value = toErrorMessage(e);
      return false;
    }
  }

  async function checkHealth(): Promise<void> {
    error.value = null;
    try {
      const results = await mcpCheckHealth();
      for (const [name, cached] of Object.entries(results)) {
        healthResults.value.set(name, cached);
        const existing = servers.value.get(name);
        if (existing) {
          servers.value.set(name, {
            ...existing,
            health: cached.result,
            tools: cached.tools,
            totalTokens: cached.tools.reduce((sum, t) => sum + t.estimatedTokens, 0),
          });
        }
      }
    } catch (e) {
      error.value = toErrorMessage(e);
    }
  }

  async function checkServerHealth(name: string): Promise<McpHealthResultCached | null> {
    error.value = null;
    try {
      const cached = await mcpCheckServerHealth(name);
      healthResults.value.set(name, cached);
      const existing = servers.value.get(name);
      if (existing) {
        servers.value.set(name, {
          ...existing,
          health: cached.result,
          tools: cached.tools,
          totalTokens: cached.tools.reduce((sum, t) => sum + t.estimatedTokens, 0),
        });
      }
      return cached;
    } catch (e) {
      error.value = toErrorMessage(e);
      return null;
    }
  }

  async function importFromFile(path: string): Promise<McpImportResult | null> {
    error.value = null;
    try {
      const result = await mcpImportFromFile(path);
      // Persist each imported server into the config
      for (const [name, config] of Object.entries(result.servers)) {
        await mcpAddServer(name, config);
      }
      await loadServers();
      return result;
    } catch (e) {
      error.value = toErrorMessage(e);
      return null;
    }
  }

  async function importFromGitHub(
    owner: string,
    repo: string,
    path?: string,
    gitRef?: string,
  ): Promise<McpImportResult | null> {
    error.value = null;
    try {
      const result = await mcpImportFromGitHub(owner, repo, path, gitRef);
      return result;
    } catch (e) {
      error.value = toErrorMessage(e);
      return null;
    }
  }

  async function computeDiff(
    incoming: Record<string, McpServerConfig>,
  ): Promise<McpConfigDiff | null> {
    error.value = null;
    try {
      return await mcpComputeDiff(incoming);
    } catch (e) {
      error.value = toErrorMessage(e);
      return null;
    }
  }

  function getServerDetail(name: string): McpServerDetail | undefined {
    return servers.value.get(name);
  }

  return {
    // State
    servers,
    healthResults,
    loading,
    error,
    searchQuery,
    filterTags,
    selectedServer,
    // Computed
    serverList,
    sortedServers,
    enabledServers,
    filteredServers,
    summary,
    allTags,
    // Actions
    loadServers,
    addServer,
    updateServer,
    removeServer,
    toggleServer,
    checkHealth,
    checkServerHealth,
    importFromFile,
    importFromGitHub,
    computeDiff,
    getServerDetail,
  };
});