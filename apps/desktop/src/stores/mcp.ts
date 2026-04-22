import {
  mcpAddServer,
  mcpCheckHealth,
  mcpCheckServerHealth,
  mcpComputeDiff,
  mcpImportFromFile,
  mcpImportFromGitHub,
  mcpListServers,
  mcpRemoveServer,
  mcpToggleServer,
  mcpUpdateServer,
} from "@tracepilot/client";
import type {
  McpConfigDiff,
  McpHealthResultCached,
  McpImportResult,
  McpServerConfig,
  McpServerDetail,
  McpSummary,
} from "@tracepilot/types";
import { runAction, runMutation, useAsyncGuard } from "@tracepilot/ui";
import { defineStore } from "pinia";
import { computed, ref } from "vue";

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
      list = list.filter((s) => filterTags.value.some((tag) => s.config.tags?.includes(tag)));
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
    await runAction({
      loading,
      error,
      guard: loadGuard,
      action: () => mcpListServers(),
      onSuccess: (entries) => {
        const map = new Map<string, McpServerDetail>();
        for (const [name, config] of Object.entries(entries)) {
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
      },
    });
  }

  async function addServer(name: string, config: McpServerConfig): Promise<boolean> {
    const ok = await runMutation(error, async () => {
      await mcpAddServer(name, config);
      servers.value.set(name, {
        name,
        config,
        tools: [],
        totalTokens: 0,
      });
      return true as const;
    });
    return ok ?? false;
  }

  async function updateServer(name: string, config: McpServerConfig): Promise<boolean> {
    const ok = await runMutation(error, async () => {
      await mcpUpdateServer(name, config);
      const existing = servers.value.get(name);
      servers.value.set(name, {
        name,
        config,
        health: existing?.health,
        tools: existing?.tools ?? [],
        totalTokens: existing?.totalTokens ?? 0,
      });
      return true as const;
    });
    return ok ?? false;
  }

  async function removeServer(name: string): Promise<boolean> {
    const ok = await runMutation(error, async () => {
      await mcpRemoveServer(name);
      servers.value.delete(name);
      healthResults.value.delete(name);
      if (selectedServer.value === name) {
        selectedServer.value = null;
      }
      return true as const;
    });
    return ok ?? false;
  }

  async function toggleServer(name: string): Promise<boolean> {
    const result = await runMutation(error, async () => {
      const newEnabled = await mcpToggleServer(name);
      const existing = servers.value.get(name);
      if (existing) {
        servers.value.set(name, {
          ...existing,
          config: { ...existing.config, enabled: newEnabled },
        });
      }
      return newEnabled;
    });
    return result ?? false;
  }

  async function checkHealth(): Promise<void> {
    await runMutation(error, async () => {
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
    });
  }

  async function checkServerHealth(name: string): Promise<McpHealthResultCached | null> {
    return runMutation(error, async () => {
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
    });
  }

  async function importFromFile(path: string): Promise<McpImportResult | null> {
    return runMutation(error, async () => {
      const result = await mcpImportFromFile(path);
      // Persist each imported server into the config
      for (const [name, config] of Object.entries(result.servers)) {
        await mcpAddServer(name, config);
      }
      await loadServers();
      return result;
    });
  }

  async function importFromGitHub(
    owner: string,
    repo: string,
    path?: string,
    gitRef?: string,
  ): Promise<McpImportResult | null> {
    return runMutation(error, () => mcpImportFromGitHub(owner, repo, path, gitRef));
  }

  async function computeDiff(
    incoming: Record<string, McpServerConfig>,
  ): Promise<McpConfigDiff | null> {
    return runMutation(error, () => mcpComputeDiff(incoming));
  }

  function getServerDetail(name: string): McpServerDetail | undefined {
    return servers.value.get(name);
  }

  function clearError() {
    error.value = null;
  }

  function setSearchQuery(q: string) {
    searchQuery.value = q;
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
    clearError,
    setSearchQuery,
  };
});
