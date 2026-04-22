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
import { runAction, runMutation, toErrorMessage, useAsyncGuard } from "@tracepilot/ui";
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
  const error = ref<string | null>(null);
  const initGuard = useAsyncGuard();
  const migrationGuard = useAsyncGuard();

  const hasCustomizations = computed(() => versions.value.some((v) => v.hasCustomizations));
  const activeVersionStr = computed(() => activeVersion.value?.version ?? "unknown");

  async function initialize() {
    const token = initGuard.start();
    loading.value = true;
    error.value = null;
    try {
      const settled = await allSettledRecord({
        agents: getAgentDefinitions(),
        config: getCopilotConfig(),
        versions: discoverCopilotVersions(),
        active: getActiveCopilotVersion(),
        backups: listConfigBackups(),
      });
      if (!initGuard.isValid(token)) return;

      if (settled.agents.status === "fulfilled") agents.value = settled.agents.value;
      if (settled.config.status === "fulfilled") copilotConfig.value = settled.config.value;
      if (settled.versions.status === "fulfilled") versions.value = settled.versions.value;
      if (settled.active.status === "fulfilled") activeVersion.value = settled.active.value;
      if (settled.backups.status === "fulfilled") backups.value = settled.backups.value;

      error.value = aggregateSettledErrors(Object.values(settled));
    } catch (e) {
      if (!initGuard.isValid(token)) return;
      error.value = toErrorMessage(e);
    } finally {
      if (initGuard.isValid(token)) {
        loading.value = false;
      }
    }
  }

  function selectAgent(agent: AgentDefinition) {
    selectedAgent.value = agent;
    editingYaml.value = agent.rawYaml;
  }

  async function saveAgent(): Promise<boolean> {
    if (!selectedAgent.value) return false;
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
    const ok = await runMutation(error, async () => {
      await restoreBackupApi(backupPath, restoreTo);
      toastStore.success("Backup restored");
      await initialize(); // Reload everything
      return true as const;
    });
    return ok ?? false;
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
