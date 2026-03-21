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

export type ConfigTab = 'agents' | 'global' | 'versions' | 'backups';

export const useConfigInjectorStore = defineStore('configInjector', () => {
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
  const successMessage = ref<string | null>(null);

  const hasCustomizations = computed(() => versions.value.some((v) => v.hasCustomizations));
  const activeVersionStr = computed(() => activeVersion.value?.version ?? 'unknown');

  async function initialize() {
    loading.value = true;
    error.value = null;
    try {
      const [agentsData, config, versionsData, active, backupsData] = await Promise.all([
        getAgentDefinitions(),
        getCopilotConfig(),
        discoverCopilotVersions(),
        getActiveCopilotVersion(),
        listConfigBackups(),
      ]);
      agents.value = agentsData;
      copilotConfig.value = config;
      versions.value = versionsData;
      activeVersion.value = active;
      backups.value = backupsData;
    } catch (e) {
      error.value = String(e);
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
      successMessage.value = `Saved ${selectedAgent.value.name} agent`;
      // Reload agents to reflect changes
      agents.value = await getAgentDefinitions();
      setTimeout(() => { successMessage.value = null; }, 3000);
      return true;
    } catch (e) {
      error.value = String(e);
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
      successMessage.value = 'Global config saved';
      setTimeout(() => { successMessage.value = null; }, 3000);
      return true;
    } catch (e) {
      error.value = String(e);
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
        successMessage.value = 'Backup created';
        setTimeout(() => { successMessage.value = null; }, 3000);
      }
      return true;
    } catch (e) {
      if (!silent) error.value = String(e);
      return false;
    }
  }

  async function restoreBackup(backupPath: string, restoreTo: string): Promise<boolean> {
    try {
      await restoreBackupApi(backupPath, restoreTo);
      successMessage.value = 'Backup restored';
      await initialize(); // Reload everything
      setTimeout(() => { successMessage.value = null; }, 3000);
      return true;
    } catch (e) {
      error.value = String(e);
      return false;
    }
  }

  async function deleteBackup(backupPath: string): Promise<boolean> {
    try {
      await deleteBackupApi(backupPath);
      backups.value = await listConfigBackups();
      successMessage.value = 'Backup deleted';
      setTimeout(() => { successMessage.value = null; }, 3000);
      return true;
    } catch (e) {
      error.value = String(e);
      return false;
    }
  }

  async function loadMigrationDiffs(from: string, to: string) {
    try {
      migrationDiffs.value = await getMigrationDiffs(from, to);
    } catch (e) {
      error.value = String(e);
    }
  }

  async function migrateAgent(fileName: string, from: string, to: string): Promise<boolean> {
    try {
      await migrateAgentApi(fileName, from, to);
      successMessage.value = `Migrated ${fileName}`;
      setTimeout(() => { successMessage.value = null; }, 3000);
      return true;
    } catch (e) {
      error.value = String(e);
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
    successMessage,
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
