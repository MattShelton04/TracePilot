<script setup lang="ts">
import { ref, reactive, computed, watch, onMounted } from 'vue';
import { useConfigInjectorStore, type ConfigTab } from '@/stores/configInjector';
import { useToast, useDismissable, truncateText, EmptyState, ErrorAlert, LoadingSpinner, shortenPath, normalizePath } from '@tracepilot/ui';
import type { AgentDefinition } from '@tracepilot/types';
import { previewBackupRestore } from '@tracepilot/client';
import {
  MODEL_REGISTRY,
  getModelsByTier,
  getAllModelIds,
  getModelTier,
  getTierLabel,
  DEFAULT_PREMIUM_MODEL_ID,
} from '@tracepilot/types';

const store = useConfigInjectorStore();
const toast = useToast();

// ── Dismissible Warning ─────────────────────────────────────────────────────
const { isDismissed: warningDismissed, dismiss: dismissWarning } = useDismissable('config-injector-warning');

// ── Agent Metadata ──────────────────────────────────────────────────────────
const AGENT_META: Record<string, { emoji: string; colorVar: string; motto: string }> = {
  explore:             { emoji: '🔍', colorVar: '--accent-emphasis',   motto: 'Fast & thorough explorer' },
  task:                { emoji: '⚡', colorVar: '--warning-emphasis',  motto: 'Reliable command runner' },
  'code-review':       { emoji: '📝', colorVar: '--success-emphasis',  motto: 'High signal-to-noise reviewer' },
  research:            { emoji: '🔬', colorVar: '--done-emphasis',     motto: 'Deep analysis specialist' },
  'configure-copilot': { emoji: '⚙️', colorVar: '--neutral-emphasis',  motto: 'System configurator' },
};

function agentMeta(name: string) {
  return AGENT_META[name] ?? { emoji: '🤖', colorVar: '--neutral-emphasis', motto: '' };
}

// ── Available Models (derived from shared registry) ─────────────────────────
const ALL_MODELS = getAllModelIds();
const PREMIUM_MODELS = getModelsByTier('premium').map(m => m.id);
const STANDARD_MODELS = getModelsByTier('standard').map(m => m.id);
const FAST_MODELS = getModelsByTier('fast').map(m => m.id);

function modelTier(model: string): 'premium' | 'standard' | 'fast' {
  return getModelTier(model);
}

function tierLabel(tier: string): string {
  return getTierLabel(tier as 'premium' | 'standard' | 'fast');
}

// ── Tabs ────────────────────────────────────────────────────────────────────
const tabs: { key: ConfigTab; label: string; emoji: string }[] = [
  { key: 'agents',   label: 'Agent Models',  emoji: '🤖' },
  { key: 'global',   label: 'Global Config', emoji: '📋' },
  { key: 'versions', label: 'Environment',   emoji: '🔧' },
  { key: 'backups',  label: 'Backups',       emoji: '💾' },
];

function tabCount(key: ConfigTab): number | null {
  if (key === 'agents') return store.agents.length;
  if (key === 'backups') return store.backups.length;
  return null;
}

// ── Stat Cards (Agents Tab) ─────────────────────────────────────────────────
const uniqueModelCount = computed(() => new Set(store.agents.map(a => a.model)).size);
const premiumAgentCount = computed(() => store.agents.filter(a => PREMIUM_MODELS.includes(a.model)).length);

// ── Agent Tools Expand State ────────────────────────────────────────────────
const TOOLS_COLLAPSE_LIMIT = 5;
const expandedTools = reactive<Record<string, boolean>>({});

function visibleTools(agent: AgentDefinition): string[] {
  if (!agent.tools?.length) return [];
  if (expandedTools[agent.filePath] || agent.tools.length <= TOOLS_COLLAPSE_LIMIT) return agent.tools;
  return agent.tools.slice(0, TOOLS_COLLAPSE_LIMIT);
}

function hiddenToolCount(agent: AgentDefinition): number {
  if (!agent.tools?.length || agent.tools.length <= TOOLS_COLLAPSE_LIMIT) return 0;
  return agent.tools.length - TOOLS_COLLAPSE_LIMIT;
}

// ── Auto-save Indicator ─────────────────────────────────────────────────────
const autoSavedAgent = ref<string | null>(null);
let autoSaveTimer: ReturnType<typeof setTimeout> | null = null;

function flashAutoSaved(filePath: string) {
  autoSavedAgent.value = filePath;
  if (autoSaveTimer) clearTimeout(autoSaveTimer);
  autoSaveTimer = setTimeout(() => { autoSavedAgent.value = null; }, 2000);
}

// ── Agent Model State ───────────────────────────────────────────────────────
const agentModels = ref<Record<string, string>>({});

watch(() => store.agents, (agents) => {
  const map: Record<string, string> = {};
  for (const a of agents) map[a.filePath] = a.model;
  agentModels.value = map;
}, { immediate: true });

async function handleModelChange(agent: AgentDefinition, newModel: string) {
  store.selectAgent(agent);
  const updatedYaml = agent.rawYaml.replace(/^(\s*model:\s*).+$/m, `$1${newModel}`);
  if (updatedYaml === agent.rawYaml) {
    // model: key not found — append it after the first line
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
    const toUpgrade = store.agents.filter(a => a.model !== DEFAULT_PREMIUM_MODEL_ID);
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
  // Force re-sync agentModels from refreshed store data
  const map: Record<string, string> = {};
  for (const a of store.agents) map[a.filePath] = a.model;
  agentModels.value = map;
  syncGlobalFields();
}

// ── Global Config ───────────────────────────────────────────────────────────
const editModel = ref('');
const editReasoningEffort = ref('');
const editShowReasoning = ref(false);
const editRenderMarkdown = ref(true);
const editTrustedFolders = ref<string[]>([]);
const newFolder = ref('');

function syncGlobalFields() {
  if (store.copilotConfig) {
    editModel.value = store.copilotConfig.model ?? '';
    editReasoningEffort.value = store.copilotConfig.reasoningEffort ?? '';
    editTrustedFolders.value = [...(store.copilotConfig.trustedFolders ?? [])];
    const raw = store.copilotConfig.raw ?? {};
    editShowReasoning.value = Boolean(raw.showReasoning);
    editRenderMarkdown.value = raw.renderMarkdown !== false;
  }
}

function addFolder() {
  const folder = newFolder.value.trim();
  if (folder && !editTrustedFolders.value.includes(folder)) {
    editTrustedFolders.value.push(folder);
    newFolder.value = '';
  }
}

function removeFolder(index: number) {
  editTrustedFolders.value.splice(index, 1);
}

const configDiffLines = computed(() => {
  if (!store.copilotConfig) return { left: [] as { text: string; changed: boolean }[], right: [] as { text: string; changed: boolean }[] };
  const current = { model: store.copilotConfig.model ?? '', reasoningEffort: store.copilotConfig.reasoningEffort ?? '', trustedFolders: store.copilotConfig.trustedFolders ?? [] };
  const modified = { model: editModel.value, reasoningEffort: editReasoningEffort.value, trustedFolders: editTrustedFolders.value };
  const curLines = JSON.stringify(current, null, 2).split('\n');
  const modLines = JSON.stringify(modified, null, 2).split('\n');
  const maxLen = Math.max(curLines.length, modLines.length);
  const left: { text: string; changed: boolean }[] = [];
  const right: { text: string; changed: boolean }[] = [];
  for (let i = 0; i < maxLen; i++) {
    const cl = curLines[i] ?? '';
    const ml = modLines[i] ?? '';
    const changed = cl !== ml;
    left.push({ text: cl, changed });
    right.push({ text: ml, changed });
  }
  return { left, right };
});

const hasConfigChanges = computed(() => configDiffLines.value.left.some(l => l.changed));

function handleSaveGlobalConfig() {
  store.saveGlobalConfig({
    model: editModel.value,
    reasoningEffort: editReasoningEffort.value,
    showReasoning: editShowReasoning.value,
    renderMarkdown: editRenderMarkdown.value,
    trustedFolders: editTrustedFolders.value,
  });
}

// ── Versions / Migration ────────────────────────────────────────────────────
const migrationFrom = ref('');
const migrationTo = ref('');

async function handleLoadDiffs() {
  if (migrationFrom.value && migrationTo.value) {
    await store.loadMigrationDiffs(migrationFrom.value, migrationTo.value);
  }
}

function handleMigrateAgent(fileName: string) {
  store.migrateAgent(fileName, migrationFrom.value, migrationTo.value);
}

// ── Backups ─────────────────────────────────────────────────────────────────
const newBackupPath = ref('');
const newBackupLabel = ref('');

const backupableFiles = computed(() => {
  const files: { label: string; path: string }[] = [];
  // Derive copilot home from active version path (~/.copilot/pkg/universal/<ver>)
  if (store.activeVersion?.path) {
    const parts = normalizePath(store.activeVersion.path).split('/');
    // Go up 3 levels: <ver> -> universal -> pkg -> .copilot
    const copilotHome = parts.slice(0, -3).join(parts[0].includes(':') ? '\\' : '/');
    if (copilotHome) {
      const sep = store.activeVersion.path.includes('\\') ? '\\' : '/';
      files.push({ label: '📋 Global Config (config.json)', path: `${copilotHome}${sep}config.json` });
    }
  }
  for (const agent of store.agents) {
    files.push({ label: `🤖 ${agent.name} agent`, path: agent.filePath });
  }
  return files;
});

async function handleCreateBackup() {
  if (newBackupPath.value.trim()) {
    const label = (newBackupLabel.value.trim() || 'manual').replace(/\s+/g, '-').toLowerCase();
    await store.createBackup(newBackupPath.value.trim(), label);
    newBackupPath.value = '';
    newBackupLabel.value = '';
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
        const ok = await store.createBackup(agent.filePath, 'batch', true);
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
  if (path.includes('agent') || path.endsWith('.md')) return '🤖';
  return '📋';
}

function formatBackupLabel(backup: { label: string; backupPath: string; sourcePath: string }): string {
  // Prefer the sidecar label if it's descriptive
  const label = backup.label || '';
  const fileName = backup.backupPath.split(/[/\\]/).pop() || 'Unknown';

  // Extract the agent/file stem from the backup filename (before the label/timestamp)
  // Format: {stem}-{label}-{timestamp} or {stem}-{timestamp}
  const stemMatch = fileName.match(/^(.+?)(?:-(?:batch|manual|pre-migrate-\S+))?-\d{8}-/);
  const stem = stemMatch?.[1] || fileName.replace(/-\d{8}-.*$/, '');

  // Build human-readable name
  const prefix = stem.replace(/\./g, ' ').replace(/\b\w/g, c => c.toUpperCase());
  if (label === 'batch') return `${prefix} (batch)`;
  if (label === 'manual') return `${prefix} (manual)`;
  if (label.startsWith('pre-migrate')) return `${prefix} (pre-migrate)`;
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

// ── Backup Diff Preview ─────────────────────────────────────────────────────
const previewingBackupId = ref<string | null>(null);
const backupDiffLoading = ref(false);
const backupDiffData = ref<{ left: { text: string; changed: boolean }[]; right: { text: string; changed: boolean }[] } | null>(null);

async function toggleBackupPreview(backup: { id: string; backupPath: string; sourcePath: string }) {
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
    const curLines = result.currentContent.split('\n');
    const bkpLines = result.backupContent.split('\n');
    const maxLen = Math.max(curLines.length, bkpLines.length);
    const left: { text: string; changed: boolean }[] = [];
    const right: { text: string; changed: boolean }[] = [];
    for (let i = 0; i < maxLen; i++) {
      const cl = curLines[i] ?? '';
      const bl = bkpLines[i] ?? '';
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

// ── Helpers ─────────────────────────────────────────────────────────────────
import { formatBytes, formatDate } from '@tracepilot/ui';

// ── Init ────────────────────────────────────────────────────────────────────
onMounted(() => {
  store.initialize().then(() => syncGlobalFields());
});
</script>

<template>
  <div class="page-content">
    <div class="page-content-inner">
      <!-- ── Error Banner ── -->
      <ErrorAlert
        v-if="store.error"
        :message="store.error"
        variant="banner"
        dismissible
        @dismiss="store.error = null"
      />

      <!-- ── Breadcrumb ── -->
      <nav class="breadcrumb">
        <span class="breadcrumb-link">Orchestration</span>
        <span class="breadcrumb-sep">›</span>
        <span class="breadcrumb-current">Config Injector</span>
      </nav>

      <!-- ── Page Header ── -->
      <div class="page-header">
        <h1 class="page-title">⚙️ Config Injector</h1>
      </div>

      <!-- ── Warning Banner ── -->
      <Transition name="banner">
        <div v-if="store.hasCustomizations && !warningDismissed" class="warning-banner">
          <span class="warning-banner-text">
            ⚠️ Copilot will overwrite customizations on update. Set
            <code>COPILOT_AUTO_UPDATE=false</code> to prevent.
            We don't recommend disabling auto-update and suggest reinjecting after every update.
          </span>
          <button class="warning-banner-close" title="Dismiss" @click="dismissWarning()">✕</button>
        </div>
      </Transition>

      <!-- ── Tab Navigation ── -->
      <nav class="tab-bar">
        <button
          v-for="tab in tabs"
          :key="tab.key"
          class="tab-btn"
          :class="{ active: store.activeTab === tab.key }"
          @click="store.activeTab = tab.key"
        >
          {{ tab.emoji }} {{ tab.label }}
          <span v-if="tabCount(tab.key) !== null" class="tab-badge">
            {{ tabCount(tab.key) }}
          </span>
        </button>
      </nav>

      <!-- ── Loading State ── -->
      <div v-if="store.loading" class="loading-state">
        <LoadingSpinner size="lg" />
        <span>Loading configuration…</span>
      </div>

      <!-- ════════════════════════════════════════════════════════════════════
           TAB 1: AGENT MODELS
           ════════════════════════════════════════════════════════════════════ -->
      <div v-if="!store.loading && store.activeTab === 'agents'" class="tab-panel">
        <!-- Stat Cards -->
        <div class="stat-grid">
          <div class="stat-card stat-card--accent">
            <span class="stat-value">{{ store.agents.length }}</span>
            <span class="stat-label">Agent Definitions</span>
          </div>
          <div class="stat-card stat-card--done">
            <span class="stat-value">{{ uniqueModelCount }}</span>
            <span class="stat-label">Unique Models Used</span>
          </div>
          <div class="stat-card stat-card--warning">
            <span class="stat-value">{{ premiumAgentCount }}</span>
            <span class="stat-label">Premium Agents</span>
          </div>
          <div class="stat-card stat-card--success">
            <span class="stat-value">{{ ALL_MODELS.length }}</span>
            <span class="stat-label">Models Available</span>
          </div>
        </div>

        <!-- Agent Grid -->
        <div class="agent-grid">
          <div
            v-for="agent in store.agents"
            :key="agent.filePath"
            class="agent-card"
            :style="{ '--agent-accent': `var(${agentMeta(agent.name).colorVar})` }"
          >
            <div class="agent-header">
              <div class="agent-icon">
                {{ agentMeta(agent.name).emoji }}
              </div>
              <div class="agent-info">
                <span class="agent-name">{{ agent.name }}</span>
                <span
                  class="tier-badge"
                  :class="`tier-badge--${modelTier(agentModels[agent.filePath] ?? agent.model)}`"
                >
                  {{ tierLabel(modelTier(agentModels[agent.filePath] ?? agent.model)) }}
                </span>
              </div>
            </div>

            <p class="agent-desc">
              {{ agent.description || agentMeta(agent.name).motto }}
            </p>

            <div v-if="agent.tools?.length" class="agent-tools">
              <span
                v-for="tool in visibleTools(agent)"
                :key="tool"
                class="tool-chip"
                :title="tool.length > 50 ? tool : undefined"
              >{{ truncateText(tool, 50) }}</span>
              <span
                v-if="hiddenToolCount(agent) > 0 && !expandedTools[agent.filePath]"
                class="tool-chip tool-chip--more"
                @click="expandedTools[agent.filePath] = true"
              >
                +{{ hiddenToolCount(agent) }} more
              </span>
              <span
                v-if="expandedTools[agent.filePath] && agent.tools.length > TOOLS_COLLAPSE_LIMIT"
                class="tool-chip tool-chip--more"
                @click="expandedTools[agent.filePath] = false"
              >
                Show less
              </span>
            </div>

            <div class="agent-model-section">
              <select
                v-model="agentModels[agent.filePath]"
                class="form-input model-select"
                @change="onAgentModelSelect(agent)"
              >
                <optgroup label="Premium">
                  <option v-for="m in PREMIUM_MODELS" :key="m" :value="m">{{ m }}</option>
                </optgroup>
                <optgroup label="Standard">
                  <option v-for="m in STANDARD_MODELS" :key="m" :value="m">{{ m }}</option>
                </optgroup>
                <optgroup label="Fast / Cheap">
                  <option v-for="m in FAST_MODELS" :key="m" :value="m">{{ m }}</option>
                </optgroup>
              </select>

              <button
                v-if="modelTier(agentModels[agent.filePath] ?? agent.model) !== 'premium'"
                class="btn-upgrade"
                :disabled="store.saving"
                @click="upgradeAgent(agent)"
              >
                ⬆ Upgrade
              </button>
              <span v-else class="premium-active-badge">✓ Premium</span>
              <Transition name="banner">
                <span v-if="autoSavedAgent === agent.filePath" class="auto-saved-hint">(auto-saved)</span>
              </Transition>
            </div>
          </div>

          <EmptyState v-if="!store.agents.length" compact message="No agent definitions found." />
        </div>

        <!-- Batch Actions -->
        <div v-if="store.agents.length" class="batch-actions">
          <span class="batch-label">Batch action:</span>
          <button
            class="btn-gradient"
            :disabled="store.saving || batchUpgrading"
            @click="upgradeAllToOpus"
          >
            {{ batchUpgrading ? 'Upgrading…' : '⬆ Upgrade All to Opus 4.6' }}
          </button>
          <button
            class="btn btn-sm"
            :disabled="store.saving"
            @click="resetAllDefaults"
          >
            ↩ Reload from Disk
          </button>
        </div>
      </div>

      <!-- ════════════════════════════════════════════════════════════════════
           TAB 2: GLOBAL CONFIG
           ════════════════════════════════════════════════════════════════════ -->
      <div v-if="!store.loading && store.activeTab === 'global'" class="tab-panel">
        <div class="global-layout">
          <!-- Config Form -->
          <div class="config-form">
            <!-- Default Model -->
            <div class="form-group">
              <label class="form-label">Default Model</label>
              <select v-model="editModel" class="form-input">
                <option value="">— select —</option>
                <optgroup label="Premium">
                  <option v-for="m in PREMIUM_MODELS" :key="m" :value="m">{{ m }}</option>
                </optgroup>
                <optgroup label="Standard">
                  <option v-for="m in STANDARD_MODELS" :key="m" :value="m">{{ m }}</option>
                </optgroup>
                <optgroup label="Fast / Cheap">
                  <option v-for="m in FAST_MODELS" :key="m" :value="m">{{ m }}</option>
                </optgroup>
              </select>
            </div>

            <!-- Reasoning Effort -->
            <div class="form-group">
              <label class="form-label">Reasoning Effort</label>
              <div class="toggle-group">
                <button
                  v-for="level in ['low', 'medium', 'high']"
                  :key="level"
                  class="toggle-btn"
                  :class="{ active: editReasoningEffort === level }"
                  @click="editReasoningEffort = level"
                >
                  {{ level.charAt(0).toUpperCase() + level.slice(1) }}
                </button>
              </div>
            </div>

            <!-- Show Reasoning -->
            <div class="switch-row">
              <div>
                <label class="form-label">Show Reasoning</label>
                <span class="form-hint">Controls whether Copilot CLI displays reasoning traces</span>
              </div>
              <button
                class="switch-track"
                :class="{ active: editShowReasoning }"
                role="switch"
                :aria-checked="editShowReasoning"
                @click="editShowReasoning = !editShowReasoning"
              >
                <span class="switch-thumb" />
              </button>
            </div>

            <!-- Render Markdown -->
            <div class="switch-row">
              <div>
                <label class="form-label">Render Markdown</label>
                <span class="form-hint">Controls whether Copilot CLI renders markdown in responses</span>
              </div>
              <button
                class="switch-track"
                :class="{ active: editRenderMarkdown }"
                role="switch"
                :aria-checked="editRenderMarkdown"
                @click="editRenderMarkdown = !editRenderMarkdown"
              >
                <span class="switch-thumb" />
              </button>
            </div>

            <!-- Trusted Folders -->
            <div class="form-group">
              <label class="form-label">Trusted Folders</label>
              <div class="folder-list">
                <div v-for="(folder, i) in editTrustedFolders" :key="i" class="folder-item">
                  <span class="folder-path">{{ folder }}</span>
                  <button class="btn-icon-sm" title="Remove" @click="removeFolder(i)">✕</button>
                </div>
                <EmptyState v-if="!editTrustedFolders.length" compact message="No trusted folders configured." />
              </div>
              <div class="folder-add">
                <input
                  v-model="newFolder"
                  class="form-input"
                  placeholder="Add folder path…"
                  @keyup.enter="addFolder"
                />
                <button class="btn btn-sm" @click="addFolder">Add</button>
              </div>
            </div>

            <!-- Save Button -->
            <button
              class="btn btn-primary"
              :disabled="store.saving || !hasConfigChanges"
              @click="handleSaveGlobalConfig"
            >
              {{ store.saving ? 'Saving…' : '💾 Save Config' }}
            </button>
          </div>

          <!-- Diff Preview -->
          <details v-if="hasConfigChanges" class="diff-preview-details" open>
            <summary class="diff-preview-summary">
              <span>📝 Diff Preview</span>
              <span class="diff-badge">{{ configDiffLines.left.filter(l => l.changed).length + configDiffLines.right.filter(l => l.changed).length }} changes</span>
            </summary>
            <div class="diff-side-by-side diff-side-by-side--compact">
              <div class="diff-panel diff-panel--left">
                <div class="diff-panel-header diff-panel-header--left">← Current</div>
                <pre class="diff-panel-body"><template v-for="(line, i) in configDiffLines.left" :key="i"><span :class="{ 'diff-line--removed': line.changed }">{{ line.text }}{{ '\n' }}</span></template></pre>
              </div>
              <div class="diff-panel diff-panel--right">
                <div class="diff-panel-header diff-panel-header--right">→ Modified</div>
                <pre class="diff-panel-body"><template v-for="(line, i) in configDiffLines.right" :key="i"><span :class="{ 'diff-line--added': line.changed }">{{ line.text }}{{ '\n' }}</span></template></pre>
              </div>
            </div>
          </details>
        </div>
      </div>

      <!-- ════════════════════════════════════════════════════════════════════
           TAB 3: ENVIRONMENT / VERSIONS
           ════════════════════════════════════════════════════════════════════ -->
      <div v-if="!store.loading && store.activeTab === 'versions'" class="tab-panel">
        <!-- Version Grid -->
        <div class="version-grid">
          <div v-for="ver in store.versions" :key="ver.version" class="version-card">
            <div class="version-card-header">
              <span class="version-number">v{{ ver.version }}</span>
              <div class="version-badges">
                <span v-if="ver.isActive" class="badge badge--accent">Active</span>
                <span v-if="ver.isComplete" class="badge badge--success">Complete</span>
              </div>
            </div>
            <div class="version-meta">
              <span v-if="ver.hasCustomizations" class="meta-tag meta-tag--warn">Customized</span>
              <span class="meta-tag">🔒 {{ ver.lockCount ?? 0 }}</span>
            </div>
          </div>
          <EmptyState v-if="!store.versions.length" compact message="No Copilot CLI versions discovered." />
        </div>

        <!-- Migration Panel -->
        <div class="migration-panel">
          <h3 class="section-heading">Migration</h3>
          <p class="migration-guidance">
            Preview differences between agent definitions across versions.
            <span class="migration-from-hint">Red (−) lines</span> show content in the <strong>From</strong> version that differs.
            <span class="migration-to-hint">Green (+) lines</span> show content in the <strong>To</strong> version.
            Clicking <strong>Migrate</strong> copies the From version's definition into the To version's directory
            (a backup is created automatically).
          </p>
          <div class="migration-controls">
            <div class="form-group">
              <label class="form-label migration-label--from">From (v{{ migrationFrom || '?' }})</label>
              <select v-model="migrationFrom" class="form-input">
                <option value="">— source —</option>
                <option v-for="v in store.versions" :key="v.version" :value="v.version">
                  v{{ v.version }}
                </option>
              </select>
            </div>
            <span class="migration-arrow">→</span>
            <div class="form-group">
              <label class="form-label migration-label--to">To (v{{ migrationTo || '?' }})</label>
              <select v-model="migrationTo" class="form-input">
                <option value="">— target —</option>
                <option v-for="v in store.versions" :key="v.version" :value="v.version">
                  v{{ v.version }}
                </option>
              </select>
            </div>
            <button
              class="btn btn-primary btn-sm"
              :disabled="!migrationFrom || !migrationTo || migrationFrom === migrationTo"
              @click="handleLoadDiffs"
            >
              Load Diffs
            </button>
          </div>

          <div v-if="store.migrationDiffs.length" class="diff-results">
            <div v-for="diff in store.migrationDiffs" :key="diff.fileName" class="diff-card">
              <div class="diff-card-header">
                <span class="diff-agent-name">{{ diff.agentName ?? diff.fileName }}</span>
                <span v-if="diff.hasConflicts" class="badge badge--danger">Conflicts</span>
                <button class="btn btn-primary btn-sm" @click="handleMigrateAgent(diff.fileName)">
                  Migrate
                </button>
              </div>
              <pre class="diff-block"><template v-for="(line, i) in (diff.diff ?? '').split('\n')" :key="i"><span :class="{ 'diff-line--added': line.startsWith('+'), 'diff-line--removed': line.startsWith('-') }">{{ line }}{{ '\n' }}</span></template></pre>
            </div>
          </div>
        </div>
      </div>

      <!-- ════════════════════════════════════════════════════════════════════
           TAB 4: BACKUPS
           ════════════════════════════════════════════════════════════════════ -->
      <div v-if="!store.loading && store.activeTab === 'backups'" class="tab-panel">
        <!-- Create Backup Form -->
        <div class="backup-create">
          <h3 class="section-heading">Create Backup</h3>
          <p class="backup-guidance">
            Select a config file to back up. This creates a timestamped copy you can restore later.
            Backups are stored in <code>~/.copilot/tracepilot/backups/</code>.
          </p>
          <div class="backup-form">
            <select v-model="newBackupPath" class="form-input">
              <option value="">— Select file to back up —</option>
              <option v-for="file in backupableFiles" :key="file.path" :value="file.path">
                {{ file.label }}
              </option>
            </select>
            <input v-model="newBackupLabel" class="form-input" placeholder="Label (optional)" />
            <button
              class="btn btn-primary"
              :disabled="!newBackupPath.trim() || store.saving"
              @click="handleCreateBackup"
            >
              {{ store.saving ? 'Creating…' : '💾 Create Backup' }}
            </button>
          </div>
          <div v-if="store.agents.length" class="backup-batch">
            <button
              class="btn btn-sm"
              :disabled="store.saving || batchBackingUp"
              @click="handleBackupAllAgents"
            >
              {{ batchBackingUp ? 'Backing up…' : '📦 Back Up All Agents' }}
            </button>
          </div>
        </div>

        <!-- Backup List -->
        <div v-if="store.backups.length" class="backup-list">
          <h3 class="section-heading">Existing Backups</h3>
          <div v-for="backup in store.backups" :key="backup.id" class="backup-item-wrapper">
            <div class="backup-item">
              <span class="backup-emoji">{{ backupEmoji(backup.sourcePath) }}</span>
              <div class="backup-info">
                <span class="backup-name">{{ formatBackupLabel(backup) }}</span>
                <span class="backup-meta">
                  {{ formatDate(backup.createdAt) }} · {{ formatBytes(backup.sizeBytes) }}
                  <template v-if="backup.sourcePath"> · {{ shortenPath(backup.sourcePath) }}</template>
                </span>
              </div>
              <div class="backup-actions">
                <button
                  class="btn btn-sm"
                  :disabled="!backup.sourcePath || backupDiffLoading"
                  :title="backup.sourcePath ? 'Preview changes before restoring' : 'Source path unknown'"
                  @click="toggleBackupPreview(backup)"
                >
                  {{ previewingBackupId === backup.id ? '✕ Close' : '📝 Preview' }}
                </button>
                <button
                  class="btn btn-sm"
                  :disabled="!backup.sourcePath"
                  :title="backup.sourcePath ? 'Restore to ' + backup.sourcePath : 'Source path unknown — cannot restore'"
                  @click="store.restoreBackup(backup.backupPath, backup.sourcePath)"
                >
                  ↩ Restore
                </button>
                <button
                  class="btn btn-sm"
                  :class="confirmingDeleteBackupId === backup.id ? 'btn-danger' : 'btn-danger-subtle'"
                  :title="confirmingDeleteBackupId === backup.id ? 'Click again to confirm deletion' : 'Delete this backup'"
                  @click="toggleDeleteBackup(backup)"
                >
                  {{ confirmingDeleteBackupId === backup.id ? 'Confirm?' : '🗑' }}
                </button>
              </div>
            </div>
            <!-- Backup Diff Preview -->
            <div v-if="previewingBackupId === backup.id && backupDiffLoading" class="backup-diff-loading">
              Loading preview…
            </div>
            <div v-if="previewingBackupId === backup.id && backupDiffData" class="diff-side-by-side backup-diff-panel">
              <div class="diff-panel diff-panel--left">
                <div class="diff-panel-header diff-panel-header--left">← Current</div>
                <pre class="diff-panel-body"><template v-for="(line, i) in backupDiffData.left" :key="i"><span :class="{ 'diff-line--removed': line.changed }">{{ line.text }}{{ '\n' }}</span></template></pre>
              </div>
              <div class="diff-panel diff-panel--right">
                <div class="diff-panel-header diff-panel-header--right">→ Backup (restore)</div>
                <pre class="diff-panel-body"><template v-for="(line, i) in backupDiffData.right" :key="i"><span :class="{ 'diff-line--added': line.changed }">{{ line.text }}{{ '\n' }}</span></template></pre>
              </div>
            </div>
          </div>
        </div>

        <EmptyState v-else icon="📦" title="No Backups Yet" message="Create a backup above to safeguard your configuration before making changes." />
      </div>
    </div>
  </div>
</template>

<style scoped src="./ConfigInjectorView.css"></style>
