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
import { toErrorMessage } from "@tracepilot/ui";
import { defineStore } from "pinia";
import { computed, ref } from "vue";
import { useAsyncGuard } from "@/composables/useAsyncGuard";
import { useToastStore } from "@/stores/toast";
import { aggregateSettledErrors } from "@/utils/settleErrors";
import { allSettledRecord } from "@/utils/settledRecord";

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
    saving.value = true;
    error.value = null;
    try {
      await saveAgentApi(selectedAgent.value.filePath, editingYaml.value);
      toastStore.success(`Saved ${selectedAgent.value.name} agent`);
      // Reload agents to reflect changes
      agents.value = await getAgentDefinitions();
      return true;
    } catch (e) {
      error.value = toErrorMessage(e);
      return false;
    } finally {
      saving.value = false;
    }
  }

  async function saveGlobalConfig(config: Record<string, unknown>): Promise<boolean> {
    saving.value = true;
    error.value = null;
    try {
      await saveCopilotApi(config);
      copilotConfig.value = await getCopilotConfig();
      toastStore.success("Global config saved");
      return true;
    } catch (e) {
      error.value = toErrorMessage(e);
      return false;
    } finally {
      saving.value = false;
    }
  }

  async function createBackup(filePath: string, label: string, silent = false): Promise<boolean> {
    try {
      await createBackupApi(filePath, label);
      backups.value = await listConfigBackups();
      if (!silent) {
        toastStore.success("Backup created");
      }
      return true;
    } catch (e) {
      if (!silent) error.value = toErrorMessage(e);
      return false;
    }
  }

  async function restoreBackup(backupPath: string, restoreTo: string): Promise<boolean> {
    try {
      await restoreBackupApi(backupPath, restoreTo);
      toastStore.success("Backup restored");
      await initialize(); // Reload everything
      return true;
    } catch (e) {
      error.value = toErrorMessage(e);
      return false;
    }
  }

  async function deleteBackup(backupPath: string): Promise<boolean> {
    try {
      await deleteBackupApi(backupPath);
      backups.value = await listConfigBackups();
      toastStore.success("Backup deleted");
      return true;
    } catch (e) {
      error.value = toErrorMessage(e);
      return false;
    }
  }

  async function loadMigrationDiffs(from: string, to: string) {
    const token = migrationGuard.start();
    error.value = null;
    try {
      const diffs = await getMigrationDiffs(from, to);
      if (!migrationGuard.isValid(token)) return;
      migrationDiffs.value = diffs;
    } catch (e) {
      if (!migrationGuard.isValid(token)) return;
      error.value = toErrorMessage(e);
    }
  }

  async function migrateAgent(fileName: string, from: string, to: string): Promise<boolean> {
    try {
      await migrateAgentApi(fileName, from, to);
      toastStore.success(`Migrated ${fileName}`);
      return true;
    } catch (e) {
      error.value = toErrorMessage(e);
      return false;
    }
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
  };
});
