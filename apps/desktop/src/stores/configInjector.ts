import { defineStore } from 'pinia';
import { ref, computed } from 'vue';
import type {
  AgentDefinition,
  BackupEntry,
  CopilotConfig,
  CopilotVersion,
  MigrationDiff,
} from '@tracepilot/types';
import {
  getAgentDefinitions,
  saveAgentDefinition as saveAgentApi,
  getCopilotConfig,
  saveCopilotConfig as saveCopilotApi,
  createConfigBackup as createBackupApi,
  deleteConfigBackup as deleteBackupApi,
  listConfigBackups,
  restoreConfigBackup as restoreBackupApi,
  discoverCopilotVersions,
  getActiveCopilotVersion,
  getMigrationDiffs,
  migrateAgentDefinition as migrateAgentApi,
} from '@tracepilot/client';
import { toErrorMessage } from '@tracepilot/ui';
import { useToastStore } from '@/stores/toast';

export type ConfigTab = 'agents' | 'global' | 'versions' | 'backups';

export const useConfigInjectorStore = defineStore('configInjector', () => {
  const toastStore = useToastStore();

  const activeTab = ref<ConfigTab>('agents');
  const agents = ref<AgentDefinition[]>([]);
  const copilotConfig = ref<CopilotConfig | null>(null);
  const versions = ref<CopilotVersion[]>([]);
  const activeVersion = ref<CopilotVersion | null>(null);
  const backups = ref<BackupEntry[]>([]);
  const migrationDiffs = ref<MigrationDiff[]>([]);
  const selectedAgent = ref<AgentDefinition | null>(null);
  const editingYaml = ref('');
  const loading = ref(false);
  const saving = ref(false);
  const error = ref<string | null>(null);

  const hasCustomizations = computed(() => versions.value.some((v) => v.hasCustomizations));
  const activeVersionStr = computed(() => activeVersion.value?.version ?? 'unknown');

  async function initialize() {
    loading.value = true;
    error.value = null;
    try {
      const [agentsRes, configRes, versionsRes, activeRes, backupsRes] = await Promise.allSettled([
        getAgentDefinitions(),
        getCopilotConfig(),
        discoverCopilotVersions(),
        getActiveCopilotVersion(),
        listConfigBackups(),
      ]);
      if (agentsRes.status === 'fulfilled') agents.value = agentsRes.value;
      if (configRes.status === 'fulfilled') copilotConfig.value = configRes.value;
      if (versionsRes.status === 'fulfilled') versions.value = versionsRes.value;
      if (activeRes.status === 'fulfilled') activeVersion.value = activeRes.value;
      if (backupsRes.status === 'fulfilled') backups.value = backupsRes.value;

      const failures = [agentsRes, configRes, versionsRes, activeRes, backupsRes]
        .filter((r): r is PromiseRejectedResult => r.status === 'rejected');
      if (failures.length > 0) {
        error.value = failures.map((f) => toErrorMessage(f.reason)).join('; ');
      }
    } catch (e) {
      error.value = toErrorMessage(e);
    } finally {
      loading.value = false;
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
      toastStore.success('Global config saved');
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
        toastStore.success('Backup created');
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
      toastStore.success('Backup restored');
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
      toastStore.success('Backup deleted');
      return true;
    } catch (e) {
      error.value = toErrorMessage(e);
      return false;
    }
  }

  async function loadMigrationDiffs(from: string, to: string) {
    try {
      migrationDiffs.value = await getMigrationDiffs(from, to);
    } catch (e) {
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
