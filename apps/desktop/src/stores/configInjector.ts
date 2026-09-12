import {
  createConfigBackup as createBackupApi,
  deleteConfigBackup as deleteBackupApi,
  discoverCopilotVersions,
  getActiveCopilotVersion,
  getAgentDefinitions,
  getCopilotConfig,
  getMigrationDiffs,
  listConfigBackups,
  migrateAgentDefinition as migrateAgentApi,
  restoreConfigBackup as restoreBackupApi,
  saveAgentDefinition as saveAgentApi,
  saveCopilotConfig as saveCopilotApi,
} from "@tracepilot/client";
import type {
  AgentDefinition,
  BackupEntry,
  CopilotConfig,
  CopilotVersion,
  MigrationDiff,
} from "@tracepilot/types";
import { runAction, runMutation, useAsyncGuard } from "@tracepilot/ui";
import { defineStore } from "pinia";
import { computed, ref } from "vue";
import { useToastStore } from "@/stores/toast";
import { allSettledRecord } from "@/utils/settledRecord";
import { aggregateSettledErrors } from "@/utils/settleErrors";

export type ConfigTab = "agents" | "global" | "versions" | "backups";

export const useConfigInjectorStore = defineStore("configInjector", () => {
  const toastStore = useToastStore();

  const activeTab = ref<ConfigTab>("agents");
  const agents = ref<AgentDefinition[]>([]);
  const copilotConfig = ref<CopilotConfig | null>(null);
  const versions = ref<CopilotVersion[]>([]);
  const activeVersion = ref<CopilotVersion | null>(null);
  const backups = ref<BackupEntry[]>([]);
  const migrationDiffs = ref<MigrationDiff[]>([]);
  const selectedAgent = ref<AgentDefinition | null>(null);
  const editingYaml = ref("");
  const loading = ref(false);
  const saving = ref(false);
  const restoring = ref(false);
  const error = ref<string | null>(null);
  const initGuard = useAsyncGuard();
  const migrationGuard = useAsyncGuard();
  let latestInitialization: Promise<boolean> | null = null;

  const hasCustomizations = computed(() => versions.value.some((v) => v.hasCustomizations));
  const activeVersionStr = computed(() => activeVersion.value?.version ?? "unknown");

  async function initialize(): Promise<boolean> {
    let request = loadConfiguration();
    latestInitialization = request;
    let refreshed = await request;
    // A view can remount while Restore is rereading. Follow the newest read so
    // a discarded older response cannot invalidate a fresh configuration.
    while (latestInitialization !== request && latestInitialization) {
      request = latestInitialization;
      refreshed = await request;
    }
    return refreshed;
  }

  async function loadConfiguration() {
    let configRefreshed = false;
    await runAction({
      loading,
      error,
      guard: initGuard,
      action: () =>
        allSettledRecord({
          agents: getAgentDefinitions(),
          config: getCopilotConfig(),
          versions: discoverCopilotVersions(),
          active: getActiveCopilotVersion(),
          backups: listConfigBackups(),
        }),
      onSuccess: (settled) => {
        if (settled.agents.status === "fulfilled") agents.value = settled.agents.value;
        if (settled.config.status === "fulfilled") {
          copilotConfig.value = settled.config.value;
          configRefreshed = true;
        }
        if (settled.versions.status === "fulfilled") versions.value = settled.versions.value;
        if (settled.active.status === "fulfilled") activeVersion.value = settled.active.value;
        if (settled.backups.status === "fulfilled") backups.value = settled.backups.value;

        error.value = aggregateSettledErrors(Object.values(settled));
      },
    });
    return configRefreshed;
  }

  function selectAgent(agent: AgentDefinition) {
    selectedAgent.value = agent;
    editingYaml.value = agent.rawYaml;
  }

  async function saveAgent(): Promise<boolean> {
    if (!selectedAgent.value || saving.value) return false;
    const agent = selectedAgent.value;
    saving.value = true;
    try {
      const ok = await runMutation(error, async () => {
        await saveAgentApi(agent.filePath, editingYaml.value);
        toastStore.success(`Saved ${agent.name} agent`);
        // Reload agents to reflect changes
        agents.value = await getAgentDefinitions();
        return true as const;
      });
      return ok ?? false;
    } finally {
      saving.value = false;
    }
  }

  async function saveGlobalConfig(config: Record<string, unknown>): Promise<boolean> {
    if (saving.value) return false;
    saving.value = true;
    try {
      const ok = await runMutation(error, async () => {
        await saveCopilotApi(config);
        copilotConfig.value = await getCopilotConfig();
        toastStore.success("Global config saved");
        return true as const;
      });
      return ok ?? false;
    } finally {
      saving.value = false;
    }
  }

  async function createBackup(filePath: string, label: string, silent = false): Promise<boolean> {
    // Silent-mode backups (invoked before destructive operations) must not
    // surface errors in the shared `error` ref — use a throwaway ref so the
    // mutation runs through `runMutation` without mutating user-visible state.
    const target = silent ? ref<string | null>(null) : error;
    const ok = await runMutation(target, async () => {
      await createBackupApi(filePath, label);
      backups.value = await listConfigBackups();
      if (!silent) {
        toastStore.success("Backup created");
      }
      return true as const;
    });
    return ok ?? false;
  }

  async function restoreBackup(backupPath: string, restoreTo: string): Promise<boolean> {
    if (saving.value || loading.value) return false;
    saving.value = true;
    restoring.value = true;
    try {
      const ok = await runMutation(error, async () => {
        await restoreBackupApi(backupPath, restoreTo);
        const refreshed = await initialize();
        if (!refreshed || !copilotConfig.value) {
          // The write succeeded, but the previous snapshot no longer represents disk.
          copilotConfig.value = null;
          throw new Error(
            `Backup restored, but configuration refresh failed. Use Reload from Disk before saving. ${error.value ?? ""}`.trim(),
          );
        }
        toastStore.success("Backup restored");
        return true as const;
      });
      return ok ?? false;
    } finally {
      restoring.value = false;
      saving.value = false;
    }
  }

  async function deleteBackup(backupPath: string): Promise<boolean> {
    const ok = await runMutation(error, async () => {
      await deleteBackupApi(backupPath);
      backups.value = await listConfigBackups();
      toastStore.success("Backup deleted");
      return true as const;
    });
    return ok ?? false;
  }

  // Dummy loading ref for runAction calls that don't expose a loading state.
  const migrationLoading = ref(false);

  async function loadMigrationDiffs(from: string, to: string) {
    await runAction({
      loading: migrationLoading,
      error,
      guard: migrationGuard,
      action: () => getMigrationDiffs(from, to),
      onSuccess: (diffs) => {
        migrationDiffs.value = diffs;
      },
    });
  }

  async function migrateAgent(fileName: string, from: string, to: string): Promise<boolean> {
    const ok = await runMutation(error, async () => {
      await migrateAgentApi(fileName, from, to);
      toastStore.success(`Migrated ${fileName}`);
      return true as const;
    });
    return ok ?? false;
  }

  function clearError() {
    error.value = null;
  }

  function setActiveTab(tab: ConfigTab) {
    activeTab.value = tab;
  }

  return {
    activeTab,
    agents,
    copilotConfig,
    versions,
    activeVersion,
    backups,
    migrationDiffs,
    selectedAgent,
    editingYaml,
    loading,
    saving,
    restoring,
    error,
    hasCustomizations,
    activeVersionStr,
    initialize,
    selectAgent,
    saveAgent,
    saveGlobalConfig,
    createBackup,
    restoreBackup,
    deleteBackup,
    loadMigrationDiffs,
    migrateAgent,
    clearError,
    setActiveTab,
  };
});
