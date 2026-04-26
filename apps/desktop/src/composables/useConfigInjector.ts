import { previewBackupRestore } from "@tracepilot/client";
import type { AgentDefinition } from "@tracepilot/types";
import { DEFAULT_PREMIUM_MODEL_ID } from "@tracepilot/types";
import { normalizePath, useToast } from "@tracepilot/ui";
import { computed, type InjectionKey, inject, onMounted, reactive, ref, watch } from "vue";
import { useConfigInjectorStore } from "@/stores/configInjector";

export interface DiffLine {
  text: string;
  changed: boolean;
}

export interface BackupDiffData {
  left: DiffLine[];
  right: DiffLine[];
}

export const TOOLS_COLLAPSE_LIMIT = 5;

/**
 * Central state + action coordinator for the ConfigInjectorView shell.
 * Owns all local UI state (edit buffers, per-agent model map, diff previews,
 * confirm/delete flags) and wraps store actions exposed to the children.
 */
export function useConfigInjector() {
  const store = useConfigInjectorStore();
  const toast = useToast();

  // ── Agent Tools Expand State ──────────────────────────────────────────────
  const expandedTools = reactive<Record<string, boolean>>({});

  function visibleTools(agent: AgentDefinition): string[] {
    if (!agent.tools?.length) return [];
    if (expandedTools[agent.filePath] || agent.tools.length <= TOOLS_COLLAPSE_LIMIT) {
      return agent.tools;
    }
    return agent.tools.slice(0, TOOLS_COLLAPSE_LIMIT);
  }

  function hiddenToolCount(agent: AgentDefinition): number {
    if (!agent.tools?.length || agent.tools.length <= TOOLS_COLLAPSE_LIMIT) return 0;
    return agent.tools.length - TOOLS_COLLAPSE_LIMIT;
  }

  // ── Auto-save Indicator ───────────────────────────────────────────────────
  const autoSavedAgent = ref<string | null>(null);
  let autoSaveTimer: ReturnType<typeof setTimeout> | null = null;

  function flashAutoSaved(filePath: string) {
    autoSavedAgent.value = filePath;
    if (autoSaveTimer) clearTimeout(autoSaveTimer);
    autoSaveTimer = setTimeout(() => {
      autoSavedAgent.value = null;
    }, 2000);
  }

  // ── Agent Model State ─────────────────────────────────────────────────────
  const agentModels = ref<Record<string, string>>({});

  watch(
    () => store.agents,
    (agents) => {
      const map: Record<string, string> = {};
      for (const a of agents) map[a.filePath] = a.model;
      agentModels.value = map;
    },
    { immediate: true },
  );

  async function handleModelChange(agent: AgentDefinition, newModel: string) {
    store.selectAgent(agent);
    const updatedYaml = agent.rawYaml.replace(/^(\s*model:\s*).+$/m, `$1${newModel}`);
    if (updatedYaml === agent.rawYaml) {
      store.editingYaml = `${agent.rawYaml.trimEnd()}\nmodel: ${newModel}\n`;
    } else {
      store.editingYaml = updatedYaml;
    }
    const saved = await store.saveAgent();
    if (saved !== false) {
      flashAutoSaved(agent.filePath);
    }
  }

  function onAgentModelSelect(agent: AgentDefinition) {
    const newModel = agentModels.value[agent.filePath];
    if (newModel && newModel !== agent.model) {
      handleModelChange(agent, newModel);
    }
  }

  async function upgradeAgent(agent: AgentDefinition) {
    agentModels.value[agent.filePath] = DEFAULT_PREMIUM_MODEL_ID;
    await handleModelChange(agent, DEFAULT_PREMIUM_MODEL_ID);
  }

  const batchUpgrading = ref(false);

  async function upgradeAllToOpus() {
    batchUpgrading.value = true;
    try {
      const toUpgrade = store.agents.filter((a) => a.model !== DEFAULT_PREMIUM_MODEL_ID);
      for (const agent of toUpgrade) {
        agentModels.value[agent.filePath] = DEFAULT_PREMIUM_MODEL_ID;
        await handleModelChange(agent, DEFAULT_PREMIUM_MODEL_ID);
      }
    } finally {
      batchUpgrading.value = false;
    }
  }

  async function resetAllDefaults() {
    await store.initialize();
    const map: Record<string, string> = {};
    for (const a of store.agents) map[a.filePath] = a.model;
    agentModels.value = map;
    syncGlobalFields();
  }

  // ── Global Config ─────────────────────────────────────────────────────────
  const editModel = ref("");
  const editReasoningEffort = ref("");
  const editShowReasoning = ref(false);
  const editRenderMarkdown = ref(true);
  const editTrustedFolders = ref<string[]>([]);
  const newFolder = ref("");

  function syncGlobalFields() {
    if (store.copilotConfig) {
      editModel.value = store.copilotConfig.model ?? "";
      editReasoningEffort.value = store.copilotConfig.reasoningEffort ?? "";
      editTrustedFolders.value = [...(store.copilotConfig.trustedFolders ?? [])];
      // Prefer typed fields; fall back to `raw` for older backend versions.
      const raw = store.copilotConfig.raw ?? {};
      editShowReasoning.value = store.copilotConfig.showReasoning ?? Boolean(raw.showReasoning);
      editRenderMarkdown.value = store.copilotConfig.renderMarkdown ?? raw.renderMarkdown !== false;
    }
  }

  function addFolder() {
    const folder = newFolder.value.trim();
    if (folder && !editTrustedFolders.value.includes(folder)) {
      editTrustedFolders.value.push(folder);
      newFolder.value = "";
    }
  }

  function removeFolder(index: number) {
    editTrustedFolders.value.splice(index, 1);
  }
  const configDiffLines = computed<BackupDiffData>(() => {
    if (!store.copilotConfig) return { left: [], right: [] };
    const current = {
      model: store.copilotConfig.model ?? "",
      reasoningEffort: store.copilotConfig.reasoningEffort ?? "",
      trustedFolders: store.copilotConfig.trustedFolders ?? [],
    };
    const modified = {
      model: editModel.value,
      reasoningEffort: editReasoningEffort.value,
      trustedFolders: editTrustedFolders.value,
    };
    const curLines = JSON.stringify(current, null, 2).split("\n");
    const modLines = JSON.stringify(modified, null, 2).split("\n");
    const maxLen = Math.max(curLines.length, modLines.length);
    const left: DiffLine[] = [];
    const right: DiffLine[] = [];
    for (let i = 0; i < maxLen; i++) {
      const cl = curLines[i] ?? "";
      const ml = modLines[i] ?? "";
      const changed = cl !== ml;
      left.push({ text: cl, changed });
      right.push({ text: ml, changed });
    }
    return { left, right };
  });

  const hasConfigChanges = computed(() => configDiffLines.value.left.some((l) => l.changed));

  /**
   * Surfaces backend-reported parse failures of `~/.copilot/{config,settings}.json`.
   * When set, the UI should show a banner and gate destructive operations.
   */
  const configParseError = computed(() => store.copilotConfig?.parseError ?? null);
  const configSettingsPath = computed(() => store.copilotConfig?.settingsPath ?? "");

  function handleSaveGlobalConfig() {
    if (configParseError.value) return;
    store.saveGlobalConfig({
      model: editModel.value,
      reasoningEffort: editReasoningEffort.value,
      showReasoning: editShowReasoning.value,
      renderMarkdown: editRenderMarkdown.value,
      trustedFolders: editTrustedFolders.value,
    });
  }

  // ── Versions / Migration ──────────────────────────────────────────────────
  const migrationFrom = ref("");
  const migrationTo = ref("");

  async function handleLoadDiffs() {
    if (migrationFrom.value && migrationTo.value) {
      await store.loadMigrationDiffs(migrationFrom.value, migrationTo.value);
    }
  }

  function handleMigrateAgent(fileName: string) {
    store.migrateAgent(fileName, migrationFrom.value, migrationTo.value);
  }

  // ── Backups ───────────────────────────────────────────────────────────────
  const newBackupPath = ref("");
  const newBackupLabel = ref("");

  const backupableFiles = computed(() => {
    const files: { label: string; path: string }[] = [];
    if (store.activeVersion?.path) {
      const parts = normalizePath(store.activeVersion.path).split("/");
      const copilotHome = parts.slice(0, -3).join(parts[0].includes(":") ? "\\" : "/");
      if (copilotHome) {
        const sep = store.activeVersion.path.includes("\\") ? "\\" : "/";
        files.push({
          label: "📋 Global Config (config.json)",
          path: `${copilotHome}${sep}config.json`,
        });
        files.push({
          label: "⚙️ User Settings (settings.json)",
          path: `${copilotHome}${sep}settings.json`,
        });
      }
    }
    for (const agent of store.agents) {
      files.push({ label: `🤖 ${agent.name} agent`, path: agent.filePath });
    }
    return files;
  });

  async function handleCreateBackup() {
    if (newBackupPath.value.trim()) {
      const label = (newBackupLabel.value.trim() || "manual").replace(/\s+/g, "-").toLowerCase();
      await store.createBackup(newBackupPath.value.trim(), label);
      newBackupPath.value = "";
      newBackupLabel.value = "";
    }
  }

  const batchBackingUp = ref(false);

  async function handleBackupAllAgents() {
    if (!store.agents.length || batchBackingUp.value) return;
    batchBackingUp.value = true;
    let succeeded = 0;
    let failed = 0;
    try {
      for (const agent of store.agents) {
        try {
          const ok = await store.createBackup(agent.filePath, "batch", true);
          if (ok) succeeded++;
          else failed++;
        } catch {
          failed++;
        }
      }
      const message = failed
        ? `Backed up ${succeeded} agents, ${failed} failed`
        : `Backed up all ${succeeded} agents`;
      toast.success(message);
    } finally {
      batchBackingUp.value = false;
    }
  }

  function backupEmoji(path: string): string {
    if (path.includes("agent") || path.endsWith(".md")) return "🤖";
    return "📋";
  }
  function formatBackupLabel(backup: {
    label: string;
    backupPath: string;
    sourcePath: string;
  }): string {
    const label = backup.label || "";
    const fileName = backup.backupPath.split(/[/\\]/).pop() || "Unknown";
    const stemMatch = fileName.match(/^(.+?)(?:-(?:batch|manual|pre-migrate-\S+))?-\d{8}-/);
    const stem = stemMatch?.[1] || fileName.replace(/-\d{8}-.*$/, "");
    const prefix = stem.replace(/\./g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
    if (label === "batch") return `${prefix} (batch)`;
    if (label === "manual") return `${prefix} (manual)`;
    if (label.startsWith("pre-migrate")) return `${prefix} (pre-migrate)`;
    if (label && label !== fileName) return `${prefix} — ${label}`;
    return prefix;
  }

  const confirmingDeleteBackupId = ref<string | null>(null);

  async function toggleDeleteBackup(backup: { id: string; backupPath: string }) {
    if (confirmingDeleteBackupId.value === backup.id) {
      await store.deleteBackup(backup.backupPath);
      confirmingDeleteBackupId.value = null;
    } else {
      confirmingDeleteBackupId.value = backup.id;
    }
  }

  // ── Backup Diff Preview ───────────────────────────────────────────────────
  const previewingBackupId = ref<string | null>(null);
  const backupDiffLoading = ref(false);
  const backupDiffData = ref<BackupDiffData | null>(null);

  async function toggleBackupPreview(backup: {
    id: string;
    backupPath: string;
    sourcePath: string;
  }) {
    if (previewingBackupId.value === backup.id) {
      previewingBackupId.value = null;
      backupDiffData.value = null;
      return;
    }
    previewingBackupId.value = backup.id;
    backupDiffLoading.value = true;
    backupDiffData.value = null;
    try {
      const result = await previewBackupRestore(backup.backupPath, backup.sourcePath);
      const curLines = result.currentContent.split("\n");
      const bkpLines = result.backupContent.split("\n");
      const maxLen = Math.max(curLines.length, bkpLines.length);
      const left: DiffLine[] = [];
      const right: DiffLine[] = [];
      for (let i = 0; i < maxLen; i++) {
        const cl = curLines[i] ?? "";
        const bl = bkpLines[i] ?? "";
        const changed = cl !== bl;
        left.push({ text: cl, changed });
        right.push({ text: bl, changed });
      }
      backupDiffData.value = { left, right };
    } catch (e) {
      toast.error(`Failed to load preview: ${e}`);
      previewingBackupId.value = null;
    } finally {
      backupDiffLoading.value = false;
    }
  }

  // ── Init ──────────────────────────────────────────────────────────────────
  onMounted(() => {
    store.initialize().then(() => syncGlobalFields());
  });

  return {
    store,
    // agent tools
    expandedTools,
    visibleTools,
    hiddenToolCount,
    // auto-save
    autoSavedAgent,
    // agent model state
    agentModels,
    onAgentModelSelect,
    upgradeAgent,
    batchUpgrading,
    upgradeAllToOpus,
    resetAllDefaults,
    // global config
    editModel,
    editReasoningEffort,
    editShowReasoning,
    editRenderMarkdown,
    editTrustedFolders,
    newFolder,
    syncGlobalFields,
    addFolder,
    removeFolder,
    configDiffLines,
    hasConfigChanges,
    configParseError,
    configSettingsPath,
    handleSaveGlobalConfig,
    // migration
    migrationFrom,
    migrationTo,
    handleLoadDiffs,
    handleMigrateAgent,
    // backups
    newBackupPath,
    newBackupLabel,
    backupableFiles,
    handleCreateBackup,
    batchBackingUp,
    handleBackupAllAgents,
    backupEmoji,
    formatBackupLabel,
    confirmingDeleteBackupId,
    toggleDeleteBackup,
    previewingBackupId,
    backupDiffLoading,
    backupDiffData,
    toggleBackupPreview,
  };
}

export type UseConfigInjectorReturn = ReturnType<typeof useConfigInjector>;

export const ConfigInjectorKey: InjectionKey<UseConfigInjectorReturn> =
  Symbol("ConfigInjectorContext");

export function useConfigInjectorContext(): UseConfigInjectorReturn {
  const ctx = inject(ConfigInjectorKey);
  if (!ctx) {
    throw new Error("useConfigInjectorContext must be used within a ConfigInjectorView shell");
  }
  return ctx;
}
