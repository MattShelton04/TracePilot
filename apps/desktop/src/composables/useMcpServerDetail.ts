import type { McpServerConfig, McpServerDetail } from "@tracepilot/types";
import { useToast } from "@tracepilot/ui";
import {
  computed,
  inject,
  type InjectionKey,
  onMounted,
  ref,
} from "vue";
import { useRoute, useRouter } from "vue-router";
import { ROUTE_NAMES } from "@/config/routes";
import { useMcpStore } from "@/stores/mcp";

/**
 * Central state + action coordinator for `McpServerDetailView`.
 *
 * Owns the route-derived server lookup, health/edit/reveal UI state, and the
 * action handlers (save, delete, export JSON, test connection) shared across
 * the extracted child components via `provide`/`inject`
 * (`McpServerDetailKey` + `useMcpServerDetailContext`).
 */
export function useMcpServerDetail() {
  const route = useRoute();
  const router = useRouter();
  const store = useMcpStore();
  const { success: toastSuccess, error: toastError } = useToast();

  const serverName = computed(() => route.params.name as string);
  const saving = ref(false);
  const deleting = ref(false);
  const healthChecking = ref(false);
  const toolSearch = ref("");
  const revealedKeys = ref(new Set<string>());
  const expandedTools = ref(new Set<string>());

  const editing = ref(false);
  const editName = ref("");
  const editConfig = ref<McpServerConfig>({} as McpServerConfig);

  const server = computed<McpServerDetail | undefined>(() =>
    store.getServerDetail(serverName.value),
  );

  const healthStatus = computed(() => server.value?.health?.status ?? ("unknown" as const));

  const statusText = computed(() => {
    const s = server.value?.health?.status;
    if (s === "healthy") return "Connected";
    if (s === "unreachable") return "Error";
    if (s === "degraded") return "Degraded";
    return "Unknown";
  });

  const statusColor = computed(() => {
    const s = server.value?.health?.status;
    if (s === "healthy") return "success";
    if (s === "unreachable" || s === "degraded") return "danger";
    return "neutral";
  });

  const statusDotClass = computed(() => {
    const s = server.value?.health?.status;
    if (s === "healthy") return "dot-connected";
    if (s === "unreachable" || s === "degraded") return "dot-error";
    return "";
  });

  const latencyDisplay = computed(() => {
    const ms = server.value?.health?.latencyMs;
    if (ms == null) return null;
    return ms;
  });

  const lastCheckedDisplay = computed(() => {
    const at = server.value?.health?.checkedAt;
    if (!at) return "Never";
    try {
      return new Date(at).toLocaleString();
    } catch {
      return at;
    }
  });

  const transportLabel = computed(() => server.value?.config.type ?? "stdio");

  const iconLetter = computed(() => server.value?.name.charAt(0).toUpperCase() ?? "?");

  const envEntries = computed(() => {
    const env = server.value?.config.env;
    if (!env) return [] as [string, string][];
    return Object.entries(env);
  });

  const configToolFilters = computed(() => server.value?.config.tools ?? []);

  const configHeaders = computed(() => {
    const h = server.value?.config.headers;
    if (!h) return [] as [string, string][];
    return Object.entries(h);
  });

  const filteredTools = computed(() => {
    if (!server.value) return [];
    const tools = server.value.tools;
    if (!toolSearch.value) return tools;
    const q = toolSearch.value.toLowerCase();
    return tools.filter(
      (t) =>
        t.name.toLowerCase().includes(q) ||
        (t.description ?? "").toLowerCase().includes(q),
    );
  });

  const tokensFormatted = computed(() => {
    const t = server.value?.totalTokens ?? 0;
    return t >= 1000 ? `~${(t / 1000).toFixed(1)}k` : `~${t}`;
  });

  onMounted(async () => {
    if (store.serverList.length === 0) {
      await store.loadServers();
    }
  });

  function toggleReveal(key: string) {
    const next = new Set(revealedKeys.value);
    if (next.has(key)) {
      next.delete(key);
    } else {
      next.add(key);
    }
    revealedKeys.value = next;
  }

  function toggleToolExpand(toolName: string) {
    const next = new Set(expandedTools.value);
    if (next.has(toolName)) {
      next.delete(toolName);
    } else {
      next.add(toolName);
    }
    expandedTools.value = next;
  }

  async function handleCheckHealth() {
    healthChecking.value = true;
    await store.checkServerHealth(serverName.value);
    healthChecking.value = false;
  }

  async function handleDelete() {
    deleting.value = true;
    const ok = await store.removeServer(serverName.value);
    deleting.value = false;
    if (ok) {
      toastSuccess(`Server "${serverName.value}" removed`);
      router.push({ name: ROUTE_NAMES.mcpManager });
    } else {
      toastError(store.error ?? "Failed to remove server");
    }
  }

  function handleExportJson() {
    if (!server.value) return;
    const config = { [server.value.name]: server.value.config };
    const json = JSON.stringify({ mcpServers: config }, null, 2);
    navigator.clipboard
      .writeText(json)
      .then(() => toastSuccess("JSON copied to clipboard"))
      .catch(() => toastError("Failed to copy to clipboard"));
  }

  function startEditing() {
    if (!server.value) return;
    editName.value = serverName.value;
    editConfig.value = JSON.parse(JSON.stringify(server.value.config));
    editing.value = true;
  }

  function cancelEditing() {
    editing.value = false;
  }

  function onEditConfigUpdate(config: McpServerConfig) {
    editConfig.value = config;
  }

  async function handleSave() {
    const trimmedName = editName.value.trim();
    if (!trimmedName) {
      toastError("Server name cannot be empty");
      return;
    }

    saving.value = true;
    try {
      const nameChanged = trimmedName !== serverName.value;
      if (nameChanged) {
        // Add new entry first, then remove old — prevents data loss if add fails
        const addOk = await store.addServer(trimmedName, editConfig.value);
        if (!addOk) {
          toastError(store.error ?? "Failed to add renamed server");
          return;
        }
        const removeOk = await store.removeServer(serverName.value);
        if (!removeOk) {
          // Rollback: remove the new entry we just added
          await store.removeServer(trimmedName);
          toastError(store.error ?? "Failed to remove old server entry");
          return;
        }
      } else {
        const ok = await store.updateServer(serverName.value, editConfig.value);
        if (!ok) {
          toastError(store.error ?? "Failed to update server");
          return;
        }
      }
      await store.loadServers();
      editing.value = false;
      toastSuccess(`Server "${trimmedName}" updated`);
      if (nameChanged) {
        router.replace({ name: ROUTE_NAMES.mcpServerDetail, params: { name: trimmedName } });
      }
    } catch (err: unknown) {
      toastError(err instanceof Error ? err.message : "Save failed");
    } finally {
      saving.value = false;
    }
  }

  function goBack() {
    router.push({ name: ROUTE_NAMES.mcpManager });
  }

  return {
    store,
    serverName,
    server,
    saving,
    deleting,
    healthChecking,
    toolSearch,
    revealedKeys,
    expandedTools,
    editing,
    editName,
    editConfig,
    healthStatus,
    statusText,
    statusColor,
    statusDotClass,
    latencyDisplay,
    lastCheckedDisplay,
    transportLabel,
    iconLetter,
    envEntries,
    configToolFilters,
    configHeaders,
    filteredTools,
    tokensFormatted,
    toggleReveal,
    toggleToolExpand,
    handleCheckHealth,
    handleDelete,
    handleExportJson,
    startEditing,
    cancelEditing,
    onEditConfigUpdate,
    handleSave,
    goBack,
  };
}

export type UseMcpServerDetailReturn = ReturnType<typeof useMcpServerDetail>;

export const McpServerDetailKey: InjectionKey<UseMcpServerDetailReturn> = Symbol(
  "McpServerDetailContext",
);

export function useMcpServerDetailContext(): UseMcpServerDetailReturn {
  const ctx = inject(McpServerDetailKey);
  if (!ctx) {
    throw new Error(
      "useMcpServerDetailContext must be used within a McpServerDetailView shell",
    );
  }
  return ctx;
}
